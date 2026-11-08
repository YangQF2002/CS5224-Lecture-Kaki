"""Forum HTTP routes."""

import asyncio
import json
import logging
from time import time
from typing import Annotated

import jwt
from botocore.exceptions import ClientError
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.concurrency import run_in_threadpool

from app.modules.auth import CurrentUser, get_current_user
from app.modules.profile import username_for

from . import attachment_store, attachments, delivery, realtime, repository
from .schemas import ConnectionTicket, MessageIn, MessageOut, MessagePage, RoomId
from .service import (
    collect_page,
    decode_cursor,
    frontend_origins,
    item_to_message,
    make_message,
    websocket_url,
)

router = APIRouter(prefix="/rooms", tags=["Forum"])
logger = logging.getLogger(__name__)

_Auth = Annotated[CurrentUser, Depends(get_current_user)]


async def _publish(room_id: str, event: dict) -> None:
    # Deployed delivery runs in its own invocation; local sockets stay in-process.
    if websocket_url():
        await run_in_threadpool(delivery.enqueue, room_id, event)
    else:
        await realtime.hub.publish(room_id, event)


@router.post("/{room_id:path}/messages", status_code=201)
async def post_message(
    room_id: RoomId,
    body: MessageIn,
    user: _Auth,
) -> MessageOut:
    # Posting still works, labelled "Student", if profiles are unavailable.
    author_name = await run_in_threadpool(username_for, user.user_id)
    item = make_message(room_id, body.content, user.user_id, author_name)
    if body.attachment_id:
        upload = await run_in_threadpool(
            attachments.owned_upload, room_id, body.attachment_id, user.user_id
        )
        attachment = await run_in_threadpool(attachments.prepare_attachment, upload)
        if attachment is None:
            raise HTTPException(status_code=409, detail="PDF upload is not ready")
        item["attachment"] = attachment
        try:
            await run_in_threadpool(
                attachment_store.post_with_upload, item, body.attachment_id
            )
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
    else:
        await run_in_threadpool(repository.put_message, item)
    message = item_to_message(item)
    await _publish(
        room_id, {"type": "message.created", "message": message.model_dump()}
    )
    return message


@router.post("/{room_id:path}/connection-ticket", status_code=201)
def connection_ticket(
    room_id: RoomId, user: _Auth, request: Request
) -> ConnectionTicket:
    # The shared get_current_user dependency has verified this exact bearer token.
    token = request.headers["authorization"].partition(" ")[2]
    expires_at = int(jwt.decode(token, options={"verify_signature": False})["exp"])
    try:
        return realtime.issue_ticket(room_id, user.user_id, expires_at)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.get("/{room_id:path}/messages")
def get_messages(
    room_id: RoomId,
    user: _Auth,
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> MessagePage:
    start_key: dict | None = None
    if cursor:
        try:
            start_key = decode_cursor(cursor, room_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    items, next_cursor = collect_page(room_id, limit, start_key)
    return MessagePage(items=items, next_cursor=next_cursor)


@router.delete("/{room_id:path}/messages/{message_id}", status_code=204)
async def delete_message(
    room_id: RoomId,
    message_id: str,
    user: _Auth,
) -> None:
    item = await run_in_threadpool(repository.get_message, room_id, message_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Message not found")
    if item["author_id"] != user.user_id:
        raise HTTPException(
            status_code=403, detail="Cannot delete another user's message"
        )

    try:
        await run_in_threadpool(
            repository.delete_message, room_id, message_id, user.user_id
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            # Race: deleted between our read and the conditional delete.
            raise HTTPException(status_code=404, detail="Message not found") from exc
        raise
    await _publish(room_id, {"type": "message.deleted", "message_id": message_id})
    if item.get("attachment"):
        try:
            await run_in_threadpool(attachment_store.delete_object, item["attachment"])
        except repository.ForumStorageUnavailable:
            # No new download links can be issued; existing links expire within 60s.
            # Bucket lifecycle removes residual versions if deletion fails.
            logger.warning("PDF cleanup deferred to bucket lifecycle", exc_info=True)


@router.websocket("/{room_id:path}/live")
async def live_messages(websocket: WebSocket, room_id: RoomId, ticket: str = ""):
    # Deployed APIs hand out API Gateway URLs; this route serves local development.
    origin = websocket.headers.get("origin")
    if origin and origin.rstrip("/") not in frontend_origins():
        await websocket.close(code=1008)
        return
    try:
        session = await run_in_threadpool(realtime.consume_ticket, ticket, room_id)
    except repository.ForumStorageUnavailable:
        await websocket.close(code=1013)
        return
    if session is None:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        async with asyncio.timeout(max(0, int(session["session_expires_at"]) - time())):
            while True:
                # The socket delivers events; posting and deletion stay authenticated HTTP operations.
                try:
                    payload = json.loads(await websocket.receive_text())
                except json.JSONDecodeError, KeyError:
                    await websocket.close(code=1008)
                    break
                if payload == {"action": "ready"}:
                    await realtime.hub.join(
                        room_id, websocket, int(session["session_expires_at"])
                    )
                    await websocket.send_json({"type": "ready", "room_id": room_id})
                elif payload != {"action": "ping"}:
                    await websocket.close(code=1008)
                    break
    except TimeoutError:
        await websocket.close(code=1008, reason="Sign-in expired")
    except WebSocketDisconnect:
        pass
    finally:
        realtime.hub.leave(room_id, websocket)

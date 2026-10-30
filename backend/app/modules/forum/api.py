"""Forum HTTP routes."""

import asyncio
import json
from time import time
from typing import Annotated

from botocore.exceptions import ClientError
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.concurrency import run_in_threadpool

from app.config import frontend_origins
from app.modules.auth import CurrentUser, get_current_user

from . import realtime, repository
from .schemas import ConnectionTicket, MessageIn, MessageOut, MessagePage, RoomId
from .service import collect_page, decode_cursor, item_to_message, make_message

router = APIRouter(prefix="/rooms", tags=["Forum"])

_Auth = Annotated[CurrentUser, Depends(get_current_user)]


@router.post("/{room_id}/messages", status_code=201)
async def post_message(
    room_id: RoomId,
    body: MessageIn,
    user: _Auth,
) -> MessageOut:
    item = make_message(room_id, body.content, user.user_id)
    await run_in_threadpool(repository.put_message, item)
    message = item_to_message(item)
    await realtime.hub.publish(
        room_id, {"type": "message.created", "message": message.model_dump()}
    )
    return message


@router.post("/{room_id}/connection-ticket", status_code=201)
def connection_ticket(room_id: RoomId, user: _Auth) -> ConnectionTicket:
    if user.token_expires_at is None:
        raise HTTPException(status_code=401, detail="Access token expiry is required")
    try:
        return realtime.issue_ticket(room_id, user.user_id, user.token_expires_at)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.get("/{room_id}/messages")
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


@router.delete("/{room_id}/messages/{message_id}", status_code=204)
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
    await realtime.hub.publish(
        room_id, {"type": "message.deleted", "message_id": message_id}
    )


@router.websocket("/{room_id}/live")
async def live_messages(websocket: WebSocket, room_id: RoomId, ticket: str = ""):
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
    await realtime.hub.join(room_id, websocket, int(session["session_expires_at"]))
    try:
        async with asyncio.timeout(max(0, int(session["session_expires_at"]) - time())):
            while True:
                # The socket delivers events; posting and deletion stay authenticated HTTP operations.
                try:
                    payload = json.loads(await websocket.receive_text())
                except json.JSONDecodeError, KeyError:
                    await websocket.close(code=1008)
                    break
                if payload != {"action": "ping"}:
                    await websocket.close(code=1008)
                    break
    except TimeoutError:
        await websocket.close(code=1008, reason="Sign-in expired")
    except WebSocketDisconnect:
        pass
    finally:
        realtime.hub.leave(room_id, websocket)

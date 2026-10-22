"""Forum HTTP routes."""

from typing import Annotated

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.auth import CurrentUser, get_current_user

from . import repository
from .schemas import MessageIn, MessageOut, MessagePage, RoomId
from .service import collect_page, decode_cursor, make_message

router = APIRouter(prefix="/rooms", tags=["Forum"])

_Auth = Annotated[CurrentUser, Depends(get_current_user)]


@router.post("/{room_id}/messages", status_code=201)
def post_message(
    room_id: RoomId,
    body: MessageIn,
    user: _Auth,
) -> MessageOut:
    item = make_message(room_id, body.content, user.user_id)
    repository.put_message(item)
    return MessageOut(
        message_id=item["message_id"],
        room_id=item["room_id"],
        author_id=item["author_id"],
        content=item["content"],
        posted_at=item["posted_at"],
        expires_at=item["expires_at"],
    )


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
def delete_message(
    room_id: RoomId,
    message_id: str,
    user: _Auth,
) -> None:
    item = repository.get_message(room_id, message_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Message not found")
    if item["author_id"] != user.user_id:
        raise HTTPException(
            status_code=403, detail="Cannot delete another user's message"
        )

    try:
        repository.delete_message(room_id, message_id, user.user_id)
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            # Race: deleted between our read and the conditional delete.
            raise HTTPException(status_code=404, detail="Message not found") from exc
        raise

"""Forum business rules: room access, message creation, expiry, pagination."""

import base64
import json
import os
from datetime import UTC, date, datetime, time, timedelta, timezone
from uuid import uuid4

from . import repository
from .schemas import MessageOut

SINGAPORE = timezone(timedelta(hours=8))
_PK_PREFIX = "ROOM#"
_SK_PREFIX = "MSG#"


def room_closes_at(room_id: str) -> datetime:
    """When a lecture's discussion closes: the end of its Monday-to-Sunday week.

    The room ID carries the lecture date in Singapore time. Its messages expire
    at this moment, so access and disposal follow the same rule.
    """
    lecture_day = date.fromisoformat(room_id.split("@")[1][:10])
    next_monday = lecture_day + timedelta(days=7 - lecture_day.weekday())
    return datetime.combine(next_monday, time(0), SINGAPORE).astimezone(UTC)


def pdf_folder(room_id: str) -> str:
    """S3 folder for a room's PDFs: its closing date, removed by the weekly cleanup."""
    return room_closes_at(room_id).astimezone(SINGAPORE).date().isoformat()


def room_is_open(room_id: str) -> bool:
    return datetime.now(UTC) < room_closes_at(room_id)


ROOM_CLOSED = "This lecture's discussion closed at the end of its week"


def make_message(
    room_id: str, content: str, author_id: str, author_name: str | None = None
) -> dict:
    """Build a DynamoDB item for a new message.

    Every message in a room expires when the room closes. The author's
    username is stored as it was when posting.
    """
    now = datetime.now(UTC)
    expires = room_closes_at(room_id)
    # SK is zero-padded milliseconds + UUID so items sort by insertion time.
    ts_ms = int(now.timestamp() * 1000)
    message_id = f"{ts_ms:020d}-{uuid4().hex}"
    item = {
        "PK": f"{_PK_PREFIX}{room_id}",
        "SK": f"{_SK_PREFIX}{message_id}",
        "message_id": message_id,
        "room_id": room_id,
        "author_id": author_id,
        "content": content,
        "posted_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": expires.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ttl": int(expires.timestamp()),
    }
    if author_name:
        item["author_name"] = author_name
    return item


def is_expired(item: dict) -> bool:
    return datetime.now(UTC) >= datetime.fromisoformat(item["expires_at"])


def item_to_message(item: dict) -> MessageOut:
    return MessageOut(
        message_id=item["message_id"],
        room_id=item["room_id"],
        author_id=item["author_id"],
        author_name=item.get("author_name"),
        content=item["content"],
        posted_at=item["posted_at"],
        expires_at=item["expires_at"],
        attachment=item.get("attachment"),
    )


def encode_cursor(last_key: dict, room_id: str) -> str:
    """Encode a DynamoDB LastEvaluatedKey as a URL-safe cursor string."""
    payload = {"pk": last_key["PK"], "sk": last_key["SK"], "room_id": room_id}
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()


def decode_cursor(cursor: str, room_id: str) -> dict:
    """Decode a cursor string back to a DynamoDB ExclusiveStartKey.

    Raises ValueError if the cursor is malformed or belongs to a different room.
    """
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        pk = payload["pk"]
        sk = payload["sk"]
        embedded_room = payload["room_id"]
        if (
            not isinstance(pk, str)
            or not isinstance(sk, str)
            or not isinstance(embedded_room, str)
        ):
            raise TypeError("cursor fields must be strings")
    except Exception as exc:
        raise ValueError("malformed cursor") from exc

    if embedded_room != room_id:
        raise ValueError("cursor belongs to a different room")
    if pk != f"{_PK_PREFIX}{room_id}":
        raise ValueError("cursor PK does not match room")
    if not sk.startswith(_SK_PREFIX):
        raise ValueError("cursor SK is not a message key")

    return {"PK": pk, "SK": sk}


def collect_page(
    room_id: str,
    limit: int,
    start_key: dict | None,
    *,
    table=None,
) -> tuple[list[MessageOut], str | None]:
    """Read one bounded page of an open room's messages.

    A closed room has no readable messages. A page may be partial or empty
    after expiry filtering (older rows may carry an earlier expiry); its cursor
    still allows the caller to continue without an unbounded server-side refill.
    """
    if not room_is_open(room_id):
        return [], None
    oldest_key = _SK_PREFIX
    response = repository.query_messages(
        room_id, limit, start_key, oldest_key=oldest_key, table=table
    )
    collected = [
        item_to_message(item)
        for item in response.get("Items", [])
        if not is_expired(item)
    ]
    collected.reverse()
    last_key = response.get("LastEvaluatedKey")
    next_cursor = encode_cursor(last_key, room_id) if last_key else None
    return collected, next_cursor


def frontend_origins() -> list[str]:
    # Match the timetable contract while keeping the earlier Forum setting valid.
    configured = os.getenv(
        "FRONTEND_ORIGINS",
        os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:8080"),
    )
    return [
        origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()
    ]


def websocket_url() -> str:
    """The API Gateway WebSocket stage URL; empty means local in-process delivery."""
    return os.getenv("FORUM_WEBSOCKET_URL", "").strip().rstrip("/")

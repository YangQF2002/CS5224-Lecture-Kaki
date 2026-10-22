"""Forum business rules: message creation, expiry, pagination."""

import base64
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from . import repository
from .schemas import MessageOut

_EXPIRY_HOURS = 24
_PK_PREFIX = "ROOM#"
_SK_PREFIX = "MSG#"


def make_message(room_id: str, content: str, author_id: str) -> dict:
    """Build a DynamoDB item for a new message.

    All time values are derived from a single server timestamp.
    """
    now = datetime.now(UTC)
    expires = now + timedelta(hours=_EXPIRY_HOURS)
    # SK is zero-padded milliseconds + UUID so items sort by insertion time.
    ts_ms = int(now.timestamp() * 1000)
    message_id = f"{ts_ms:020d}-{uuid4().hex}"
    return {
        "PK": f"{_PK_PREFIX}{room_id}",
        "SK": f"{_SK_PREFIX}{message_id}",
        "message_id": message_id,
        "room_id": room_id,
        "author_id": author_id,
        "content": content,
        "posted_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": expires.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ttl": int(expires.timestamp()) + 3600,  # 1-hour buffer for DynamoDB TTL lag
    }


def is_expired(item: dict) -> bool:
    return datetime.now(UTC) >= datetime.fromisoformat(item["expires_at"])


def item_to_message(item: dict) -> MessageOut:
    return MessageOut(
        message_id=item["message_id"],
        room_id=item["room_id"],
        author_id=item["author_id"],
        content=item["content"],
        posted_at=item["posted_at"],
        expires_at=item["expires_at"],
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
        pk: str = payload["pk"]
        sk: str = payload["sk"]
        embedded_room: str = payload["room_id"]
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
    """Collect up to `limit` unexpired messages, querying as many times as needed.

    Returns (items_oldest_first, next_cursor).
    """
    collected: list[MessageOut] = []
    last_key: dict | None = start_key
    exhausted = False

    while len(collected) < limit and not exhausted:
        remaining = limit - len(collected)
        response = repository.query_messages(room_id, remaining, last_key, table=table)
        for item in response.get("Items", []):
            if not is_expired(item):
                collected.append(item_to_message(item))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            exhausted = True

    # DynamoDB returned newest-first; reverse so the page is oldest-first.
    collected.reverse()

    next_cursor = encode_cursor(last_key, room_id) if last_key else None
    return collected, next_cursor

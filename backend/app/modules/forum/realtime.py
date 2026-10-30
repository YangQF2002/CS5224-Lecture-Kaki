"""Native WebSocket delivery for the shared FastAPI process (one worker in MVP)."""

import asyncio
import hashlib
import logging
import secrets
from time import time
from urllib.parse import quote, urlencode

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import WebSocket, WebSocketDisconnect

from . import repository
from .schemas import ConnectionTicket

logger = logging.getLogger(__name__)


def _ticket_key(ticket: str) -> dict:
    return {
        "PK": f"TICKET#{hashlib.sha256(ticket.encode()).hexdigest()}",
        "SK": "METADATA",
    }


def issue_ticket(
    room_id: str, user_id: str, session_expires_at: int
) -> ConnectionTicket:
    now = int(time())
    if session_expires_at <= now:
        raise ValueError("Access token has expired")
    ticket = secrets.token_urlsafe(32)
    try:
        repository.get_table().put_item(
            Item={
                **_ticket_key(ticket),
                "room_id": room_id,
                "user_id": user_id,
                "session_expires_at": session_expires_at,
                "ttl": min(now + 30, session_expires_at),
            }
        )
    except (BotoCoreError, ClientError) as error:
        raise repository.ForumStorageUnavailable from error
    return ConnectionTicket(
        path=f"/rooms/{quote(room_id, safe='')}/live?{urlencode({'ticket': ticket})}",
        session_expires_at=session_expires_at,
    )


def consume_ticket(ticket: str, room_id: str) -> dict | None:
    if not 20 <= len(ticket) <= 100:
        return None
    try:
        response = repository.get_table().delete_item(
            Key=_ticket_key(ticket),
            ConditionExpression="attribute_exists(PK) AND room_id = :room AND #ttl > :now AND session_expires_at > :now",
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={":room": room_id, ":now": int(time())},
            ReturnValues="ALL_OLD",
        )
        return response["Attributes"]
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise repository.ForumStorageUnavailable from error
    except BotoCoreError as error:
        raise repository.ForumStorageUnavailable from error


class RoomHub:
    """Connections live in memory. Run one worker/instance until a broker is added."""

    def __init__(self):
        self.rooms: dict[str, dict[WebSocket, int]] = {}

    async def join(self, room_id: str, socket: WebSocket, expires_at: int):
        await socket.accept()
        self.rooms.setdefault(room_id, {})[socket] = expires_at

    def leave(self, room_id: str, socket: WebSocket):
        members = self.rooms.get(room_id)
        if members is not None:
            members.pop(socket, None)
            if not members:
                self.rooms.pop(room_id, None)

    async def publish(self, room_id: str, event: dict):
        async def deliver(socket, expires_at):
            try:
                async with asyncio.timeout(1):
                    if expires_at <= time():
                        await socket.close(code=1008, reason="Sign-in expired")
                        self.leave(room_id, socket)
                    else:
                        await socket.send_json({**event, "room_id": room_id})
            except (RuntimeError, WebSocketDisconnect, TimeoutError, OSError):
                # A disconnected/slow recipient must not fail a saved message.
                self.leave(room_id, socket)
                try:
                    async with asyncio.timeout(1):
                        await socket.close(code=1011)
                except (RuntimeError, WebSocketDisconnect, TimeoutError, OSError):
                    logger.debug("Forum connection already closed")
                logger.info("Removed unavailable Forum connection")

        await asyncio.gather(
            *(
                deliver(socket, expiry)
                for socket, expiry in tuple(self.rooms.get(room_id, {}).items())
            )
        )


hub = RoomHub()

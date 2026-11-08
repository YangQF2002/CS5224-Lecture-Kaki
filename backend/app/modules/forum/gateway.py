"""Live delivery through the API Gateway WebSocket API.

API Gateway holds the open sockets; DynamoDB holds which connections are in which
room. Any API process can therefore publish, so the API scales horizontally.
"""

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from time import time

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from . import repository
from .realtime import consume_ticket
from .service import frontend_origins, websocket_url

logger = logging.getLogger(__name__)

_MAX_PARALLEL_SENDS = 16


@lru_cache
def _management_client(endpoint: str):
    region = os.getenv("AWS_REGION", "").strip() or None
    return boto3.session.Session(region_name=region).client(
        "apigatewaymanagementapi",
        endpoint_url=endpoint,
        config=Config(
            connect_timeout=1, read_timeout=2, retries={"total_max_attempts": 2}
        ),
    )


def management_client(endpoint: str | None = None):
    """PostToConnection/DeleteConnection use the stage's https:// endpoint."""
    if endpoint is None:
        endpoint = "https://" + websocket_url().removeprefix("wss://")
    return _management_client(endpoint)


def _close(client, room_id: str, connection_id: str) -> None:
    try:
        client.delete_connection(ConnectionId=connection_id)
    except BotoCoreError, ClientError:
        logger.debug("Forum connection already closed")
    repository.delete_room_connection(room_id, connection_id)


def publish(room_id: str, event: dict) -> None:
    """Send to ready connections; transient failures fail the worker for retry."""
    connections = repository.query_connections(room_id)
    if not connections:
        return
    client = management_client()
    data = json.dumps({**event, "room_id": room_id}).encode()

    def deliver(connection: dict) -> None:
        connection_id = connection["connection_id"]
        try:
            if int(connection["session_expires_at"]) <= time():
                _close(client, room_id, connection_id)
            else:
                client.post_to_connection(ConnectionId=connection_id, Data=data)
        except ClientError as error:
            if error.response["Error"]["Code"] == "GoneException":
                try:
                    repository.delete_room_connection(room_id, connection_id)
                except repository.ForumStorageUnavailable:
                    logger.debug("Stale connection left for TTL cleanup")
            else:
                raise

    with ThreadPoolExecutor(
        max_workers=min(_MAX_PARALLEL_SENDS, len(connections))
    ) as pool:
        list(pool.map(deliver, connections))


def _response(status: int) -> dict:
    return {"statusCode": status}


def handle_event(event: dict) -> dict:
    """Route an API Gateway WebSocket event: $connect, $disconnect or $default."""
    context = event["requestContext"]
    route = context["routeKey"]
    connection_id = context["connectionId"]

    if route == "$connect":
        headers = {
            name.lower(): value for name, value in (event.get("headers") or {}).items()
        }
        origin = headers.get("origin")
        if origin and origin.rstrip("/") not in frontend_origins():
            return _response(403)
        params = event.get("queryStringParameters") or {}
        room_id = params.get("room", "")
        try:
            session = consume_ticket(params.get("ticket", ""), room_id)
            if session is None:
                return _response(401)
            repository.put_connection(
                room_id,
                connection_id,
                session["user_id"],
                int(session["session_expires_at"]),
            )
        except repository.ForumStorageUnavailable:
            return _response(503)
        return _response(200)

    if route == "$disconnect":
        try:
            repository.delete_connection(connection_id)
        except repository.ForumStorageUnavailable:
            logger.warning("Connection left for TTL cleanup", exc_info=True)
        return _response(200)

    # The socket only delivers events; posting and deletion stay authenticated HTTP.
    try:
        payload = json.loads(event.get("body") or "")
    except json.JSONDecodeError:
        payload = None
    if payload == {"action": "ping"}:
        return _response(200)
    endpoint = f"https://{context['domainName']}/{context['stage']}"
    if payload == {"action": "ready"}:
        try:
            session = repository.activate_connection(connection_id)
            if session is not None:
                management_client(endpoint).post_to_connection(
                    ConnectionId=connection_id,
                    Data=json.dumps(
                        {"type": "ready", "room_id": session["room_id"]}
                    ).encode(),
                )
                return _response(200)
        except BotoCoreError, ClientError, repository.ForumStorageUnavailable:
            logger.warning("Forum readiness failed", exc_info=True)
        # A missing acknowledgement makes the browser reconnect with a new ticket.
    try:
        management_client(endpoint).delete_connection(ConnectionId=connection_id)
    except BotoCoreError, ClientError:
        logger.debug("Forum connection already closed")
    return _response(400)

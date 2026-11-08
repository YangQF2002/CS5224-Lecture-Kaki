"""DynamoDB access for the forum module."""

import os
from time import time
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError


class ForumStorageUnavailable(Exception):
    """Configuration, credentials or DynamoDB access are unavailable."""


def get_table(table=None):
    if table is not None:
        return table
    region = os.getenv("AWS_REGION", "").strip()
    name = os.getenv("DYNAMODB_TABLE", "").strip()
    if not region or not name:
        raise ForumStorageUnavailable("Forum table is not configured")
    try:
        return (
            boto3.session.Session(region_name=region)
            .resource(
                "dynamodb",
                config=Config(
                    connect_timeout=1, read_timeout=2, retries={"total_max_attempts": 2}
                ),
            )
            .Table(name)
        )
    except (BotoCoreError, ClientError) as error:
        raise ForumStorageUnavailable from error


def _call(operation: str, *, table=None, **kwargs):
    try:
        return getattr(get_table(table), operation)(**kwargs)
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise
        raise ForumStorageUnavailable from error
    except BotoCoreError as error:
        raise ForumStorageUnavailable from error


def put_message(item: dict[str, Any], *, table=None) -> None:
    _call("put_item", table=table, Item=item)


def query_messages(
    room_id: str,
    limit: int,
    exclusive_start_key: dict | None,
    *,
    oldest_key: str,
    table=None,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("PK").eq(f"ROOM#{room_id}")
        & Key("SK").between(oldest_key, "MSG#~"),
        "Limit": limit,
        "ScanIndexForward": False,
        "ConsistentRead": True,
    }
    if exclusive_start_key:
        kwargs["ExclusiveStartKey"] = exclusive_start_key
    return _call("query", table=table, **kwargs)


def get_message(room_id: str, message_id: str, *, table=None) -> dict[str, Any] | None:
    return _call(
        "get_item",
        table=table,
        Key={"PK": f"ROOM#{room_id}", "SK": f"MSG#{message_id}"},
        ConsistentRead=True,
    ).get("Item")


def delete_message(
    room_id: str, message_id: str, author_id: str, *, table=None
) -> None:
    _call(
        "delete_item",
        table=table,
        Key={"PK": f"ROOM#{room_id}", "SK": f"MSG#{message_id}"},
        ConditionExpression="attribute_exists(PK) AND author_id = :uid",
        ExpressionAttributeValues={":uid": author_id},
    )


# --- Live connections held by the API Gateway WebSocket API ---
# A room item lists the room's connections for fan-out; a connection item lets
# $disconnect, which only knows the connection ID, find its room.


def _room_connection_key(room_id: str, connection_id: str) -> dict[str, str]:
    return {"PK": f"ROOM#{room_id}", "SK": f"CONN#{connection_id}"}


def _connection_key(connection_id: str) -> dict[str, str]:
    return {"PK": f"CONN#{connection_id}", "SK": "METADATA"}


def put_connection(
    room_id: str,
    connection_id: str,
    user_id: str,
    session_expires_at: int,
    *,
    table=None,
) -> None:
    # TTL cleans up after a missed $disconnect; fan-out also skips expired sessions.
    _call(
        "put_item",
        table=table,
        Item={
            **_connection_key(connection_id),
            "room_id": room_id,
            "user_id": user_id,
            "session_expires_at": session_expires_at,
            "ttl": session_expires_at,
        },
    )


def activate_connection(connection_id: str, *, table=None) -> dict | None:
    """Join broadcasts after the handshake, atomically with the session check."""
    session = _call(
        "get_item", table=table, Key=_connection_key(connection_id), ConsistentRead=True
    ).get("Item")
    if session is None or int(session["session_expires_at"]) <= time():
        return None
    encode = TypeSerializer().serialize
    room_id = session["room_id"]
    item = {
        **_room_connection_key(room_id, connection_id),
        "connection_id": connection_id,
        "user_id": session["user_id"],
        "session_expires_at": session["session_expires_at"],
        "ttl": session["session_expires_at"],
    }
    try:
        client = boto3.client(
            "dynamodb",
            region_name=os.environ["AWS_REGION"],
            config=Config(
                connect_timeout=1, read_timeout=2, retries={"total_max_attempts": 2}
            ),
        )
        name = get_table(table).name
        client.transact_write_items(
            TransactItems=[
                {
                    "ConditionCheck": {
                        "TableName": name,
                        "Key": {
                            key: encode(value)
                            for key, value in _connection_key(connection_id).items()
                        },
                        "ConditionExpression": "attribute_exists(PK) AND session_expires_at > :now",
                        "ExpressionAttributeValues": {":now": encode(int(time()))},
                    }
                },
                {
                    "Put": {
                        "TableName": name,
                        "Item": {key: encode(value) for key, value in item.items()},
                    }
                },
            ]
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "TransactionCanceledException" and any(
            reason.get("Code") == "ConditionalCheckFailed"
            for reason in error.response.get("CancellationReasons", [])
        ):
            return None
        raise ForumStorageUnavailable from error
    except BotoCoreError as error:
        raise ForumStorageUnavailable from error
    return session


def delete_room_connection(room_id: str, connection_id: str, *, table=None) -> None:
    # Removing metadata first prevents an in-flight ready from recreating membership.
    _call("delete_item", table=table, Key=_connection_key(connection_id))
    _call("delete_item", table=table, Key=_room_connection_key(room_id, connection_id))


def delete_connection(connection_id: str, *, table=None) -> None:
    item = _call(
        "get_item", table=table, Key=_connection_key(connection_id), ConsistentRead=True
    ).get("Item")
    if item is None:
        return
    delete_room_connection(item["room_id"], connection_id, table=table)


def query_connections(room_id: str, *, table=None) -> list[dict[str, Any]]:
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("PK").eq(f"ROOM#{room_id}")
        & Key("SK").begins_with("CONN#"),
        "ConsistentRead": True,
    }
    items: list[dict[str, Any]] = []
    while True:
        response = _call("query", table=table, **kwargs)
        items.extend(response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            return items
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

"""DynamoDB access for the forum module."""

import os
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
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
            boto3.session.Session(region_name=region).resource("dynamodb").Table(name)
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
    room_id: str, limit: int, exclusive_start_key: dict | None, *, table=None
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("PK").eq(f"ROOM#{room_id}")
        & Key("SK").begins_with("MSG#"),
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

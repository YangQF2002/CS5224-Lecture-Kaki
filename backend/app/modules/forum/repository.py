"""DynamoDB access for the forum module."""

import os
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key


def get_table(table=None):
    """Return the DynamoDB Table resource. Resolved lazily at call time."""
    if table is not None:
        return table
    region = os.environ["AWS_REGION"]
    name = os.environ["DYNAMODB_TABLE"]
    return boto3.resource("dynamodb", region_name=region).Table(name)


def put_message(item: dict[str, Any], *, table=None) -> None:
    get_table(table).put_item(Item=item)


def query_messages(
    room_id: str,
    limit: int,
    exclusive_start_key: dict | None,
    *,
    table=None,
) -> dict[str, Any]:
    """Query up to `limit` messages for a room, newest first."""
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("PK").eq(f"ROOM#{room_id}")
        & Key("SK").begins_with("MSG#"),
        "Limit": limit,
        "ScanIndexForward": False,
    }
    if exclusive_start_key:
        kwargs["ExclusiveStartKey"] = exclusive_start_key
    return get_table(table).query(**kwargs)


def get_message(room_id: str, message_id: str, *, table=None) -> dict[str, Any] | None:
    response = get_table(table).get_item(
        Key={"PK": f"ROOM#{room_id}", "SK": f"MSG#{message_id}"}
    )
    return response.get("Item")


def delete_message(
    room_id: str, message_id: str, author_id: str, *, table=None
) -> None:
    """Delete a message with an ownership condition.

    Raises ConditionalCheckFailedException if the item exists but is not owned
    by author_id, or if it was deleted between the caller's pre-check and this call.
    """
    get_table(table).delete_item(
        Key={"PK": f"ROOM#{room_id}", "SK": f"MSG#{message_id}"},
        ConditionExpression="attribute_exists(PK) AND author_id = :uid",
        ExpressionAttributeValues={":uid": author_id},
    )

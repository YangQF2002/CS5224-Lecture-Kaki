import os
import secrets
from datetime import UTC, datetime
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from .schemas import Profile

# Usernames are unique ignoring case. Each one is reserved by an item in the
# same table, keyed by this prefix plus the lowercased name; Cognito user IDs
# never start with it.
_RESERVATION = "USERNAME#"

_ADJECTIVES = (
    "Brave", "Bright", "Calm", "Clever", "Curious", "Eager", "Gentle", "Happy",
    "Jolly", "Keen", "Kind", "Lively", "Lucky", "Merry", "Mighty", "Nimble",
    "Patient", "Quick", "Quiet", "Sharp", "Steady", "Sunny", "Swift", "Witty",
)  # fmt: skip
_ANIMALS = (
    "Badger", "Bear", "Crane", "Dolphin", "Eagle", "Falcon", "Fox", "Gecko",
    "Heron", "Koala", "Lemur", "Lynx", "Otter", "Owl", "Panda", "Penguin",
    "Puffin", "Rabbit", "Robin", "Seal", "Tiger", "Turtle", "Whale", "Wolf",
)  # fmt: skip


class ProfileRepositoryUnavailable(Exception):
    """DynamoDB could not complete the requested operation."""


class UsernameTaken(Exception):
    """Another user already has this username."""


class _UsernameChanged(Exception):
    """Another request changed this user's username first."""


def random_username() -> str:
    return (
        secrets.choice(_ADJECTIVES)
        + secrets.choice(_ANIMALS)
        + str(secrets.randbelow(90) + 10)
    )


def _reservation_key(username: str) -> dict:
    return {"user_id": f"{_RESERVATION}{username.lower()}"}


class ProfileRepository:
    def __init__(self, table: Any) -> None:
        self._table = table

    def get(self, user_id: str) -> Profile:
        """The user's profile, giving them a random username on first use."""
        item = self._get_item(user_id)
        if item.get("username"):
            return self._profile(item)
        for _ in range(5):
            try:
                self._claim(user_id, random_username(), previous=None)
            except UsernameTaken:
                continue
            except _UsernameChanged:
                pass  # A concurrent request assigned one; read it back.
            return self._profile(self._get_item(user_id))
        raise ProfileRepositoryUnavailable("Could not assign a username")

    def save_topics(self, user_id: str, topics: list[str]) -> Profile:
        try:
            self._table.update_item(
                Key={"user_id": user_id},
                UpdateExpression="SET topics = :topics, updated_at = :now",
                ExpressionAttributeValues={
                    ":topics": topics,
                    ":now": datetime.now(UTC).isoformat(),
                },
            )
        except BotoCoreError, ClientError:
            raise ProfileRepositoryUnavailable from None
        return self.get(user_id)

    def set_username(self, user_id: str, username: str) -> Profile:
        current = self.get(user_id).username
        if current != username:
            try:
                self._claim(user_id, username, previous=current)
            except _UsernameChanged:
                raise ProfileRepositoryUnavailable("Username changed concurrently")
        return self.get(user_id)

    def _claim(self, user_id: str, username: str, previous: str | None) -> None:
        """Reserve the name and set it, releasing the previous name, atomically."""
        # The resource's client converts plain Python values to DynamoDB types.
        same_name = previous is not None and previous.lower() == username.lower()
        items: list[dict] = []
        if not same_name:
            items.append(
                {
                    "Put": {
                        "TableName": self._table.name,
                        "Item": {**_reservation_key(username), "owner_id": user_id},
                        "ConditionExpression": "attribute_not_exists(user_id)",
                    }
                }
            )
        items.append(
            {
                "Update": {
                    "TableName": self._table.name,
                    "Key": {"user_id": user_id},
                    "UpdateExpression": "SET username = :new, updated_at = :now",
                    # Refuse if another request changed the name in the meantime.
                    "ConditionExpression": (
                        "attribute_not_exists(username)"
                        if previous is None
                        else "username = :previous"
                    ),
                    "ExpressionAttributeValues": {
                        ":new": username,
                        ":now": datetime.now(UTC).isoformat(),
                        **({} if previous is None else {":previous": previous}),
                    },
                }
            }
        )
        if previous is not None and not same_name:
            items.append(
                {
                    "Delete": {
                        "TableName": self._table.name,
                        "Key": _reservation_key(previous),
                        "ConditionExpression": "owner_id = :me",
                        "ExpressionAttributeValues": {":me": user_id},
                    }
                }
            )
        try:
            self._table.meta.client.transact_write_items(TransactItems=items)
        except ClientError as error:
            failed = [
                reason.get("Code") == "ConditionalCheckFailed"
                for reason in error.response.get("CancellationReasons", [])
            ]
            update_index = 0 if same_name else 1
            if not same_name and failed[:1] == [True]:
                raise UsernameTaken from None
            if failed[update_index : update_index + 1] == [True]:
                raise _UsernameChanged from None
            raise ProfileRepositoryUnavailable from None
        except BotoCoreError:
            raise ProfileRepositoryUnavailable from None

    def _get_item(self, user_id: str) -> dict:
        try:
            response = self._table.get_item(
                Key={"user_id": user_id}, ConsistentRead=True
            )
        except BotoCoreError, ClientError:
            raise ProfileRepositoryUnavailable from None
        item = response.get("Item")
        return item if isinstance(item, dict) else {}

    @staticmethod
    def _profile(item: dict) -> Profile:
        try:
            return Profile(
                username=item["username"], topics=list(item.get("topics", []))
            )
        except KeyError, ValueError:
            raise ProfileRepositoryUnavailable from None


def get_profile_repository() -> ProfileRepository:
    table_name = os.getenv("PROFILE_TABLE_NAME", "").strip()

    if not table_name:
        raise ProfileRepositoryUnavailable("PROFILE_TABLE_NAME is not configured")

    region = os.getenv("AWS_REGION", "").strip() or "ap-southeast-1"
    try:
        # Resources are not thread-safe; each request owns its session and table.
        dynamodb = boto3.session.Session().resource("dynamodb", region_name=region)
        return ProfileRepository(dynamodb.Table(table_name))
    except BotoCoreError, ClientError:
        raise ProfileRepositoryUnavailable from None


def username_for(user_id: str) -> str | None:
    """The user's Forum display name, or None when profiles are unavailable."""
    try:
        return get_profile_repository().get(user_id).username
    except ProfileRepositoryUnavailable:
        return None

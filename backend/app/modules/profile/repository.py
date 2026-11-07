import os
from datetime import UTC, datetime
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from .schemas import Profile


class ProfileRepositoryUnavailable(Exception):
    """DynamoDB could not complete the requested operation."""


class ProfileRepository:
    def __init__(self, table: Any) -> None:
        self._table = table

    def get(self, user_id: str) -> Profile:
        """The saved profile, or an empty one for a user who has not saved yet."""
        try:
            response = self._table.get_item(
                Key={"user_id": user_id},
                ConsistentRead=True,
            )
        except BotoCoreError, ClientError:
            raise ProfileRepositoryUnavailable from None

        item = response.get("Item")
        if not isinstance(item, dict):
            return Profile()

        try:
            return Profile.model_validate({"topics": item.get("topics", [])})
        except ValueError:
            raise ProfileRepositoryUnavailable from None

    def save(self, user_id: str, profile: Profile) -> Profile:
        item = {
            "user_id": user_id,
            "topics": profile.topics,
            "updated_at": datetime.now(UTC).isoformat(),
        }

        try:
            self._table.put_item(Item=item)
        except BotoCoreError, ClientError:
            raise ProfileRepositoryUnavailable from None

        return profile


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

import os
from datetime import UTC, datetime
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from .schemas import Timetable


class TimetableRepositoryUnavailable(Exception):
    """DynamoDB could not complete the requested operation."""


class TimetableRepository:
    def __init__(self, table: Any) -> None:
        self._table = table

    def get(self, user_id: str) -> Timetable | None:
        try:
            response = self._table.get_item(
                Key={"user_id": user_id},
                ConsistentRead=True,
            )
        except BotoCoreError, ClientError:
            raise TimetableRepositoryUnavailable from None

        item = response.get("Item")

        if not isinstance(item, dict):
            return None

        timetable = item.get("timetable")

        if not isinstance(timetable, dict):
            raise TimetableRepositoryUnavailable

        try:
            return Timetable.model_validate(timetable)
        except ValueError:
            raise TimetableRepositoryUnavailable from None

    def save(self, user_id: str, timetable: Timetable) -> Timetable:
        item = {
            "user_id": user_id,
            "timetable": timetable.model_dump(mode="json", by_alias=True),
            "updated_at": datetime.now(UTC).isoformat(),
        }

        try:
            self._table.put_item(Item=item)
        except BotoCoreError, ClientError:
            raise TimetableRepositoryUnavailable from None

        return timetable

    def delete(self, user_id: str) -> None:
        try:
            self._table.delete_item(Key={"user_id": user_id})
        except BotoCoreError, ClientError:
            raise TimetableRepositoryUnavailable from None


def get_timetable_repository() -> TimetableRepository:
    table_name = os.getenv("TIMETABLE_TABLE_NAME", "").strip()

    if not table_name:
        raise TimetableRepositoryUnavailable("TIMETABLE_TABLE_NAME is not configured")

    region = os.getenv("AWS_REGION", "").strip() or "ap-southeast-1"
    try:
        # Resources are not thread-safe; each request owns its session and table.
        dynamodb = boto3.session.Session().resource("dynamodb", region_name=region)
        return TimetableRepository(dynamodb.Table(table_name))
    except BotoCoreError, ClientError:
        raise TimetableRepositoryUnavailable from None

"""Queue deployed live delivery independently of committed HTTP writes."""

import json
import logging
import os
from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from . import gateway, repository
from .service import is_expired, item_to_message

logger = logging.getLogger(__name__)


@lru_cache
def invocation_client():
    return boto3.client(
        "lambda",
        region_name=os.getenv("AWS_REGION") or None,
        config=Config(
            connect_timeout=1, read_timeout=1, retries={"total_max_attempts": 1}
        ),
    )


def enqueue(room_id: str, event: dict) -> None:
    try:
        function = os.environ["FORUM_FANOUT_FUNCTION"]
        response = invocation_client().invoke(
            FunctionName=function,
            InvocationType="Event",
            Payload=json.dumps({"room_id": room_id, "event": event}).encode(),
        )
        if response.get("StatusCode") != 202:
            logger.error("Forum broadcast could not be queued")
        if body := response.get("Payload"):
            body.close()
    except KeyError, BotoCoreError, ClientError:
        # The HTTP operation is already committed; history remains authoritative.
        logger.exception("Forum broadcast could not be queued")


def handle_event(payload: dict) -> None:
    room_id, event = payload["room_id"], payload["event"]
    if event["type"] == "message.created":
        # Async retries must not replay expired messages or a post already deleted.
        item = repository.get_message(room_id, event["message"]["message_id"])
        if item is None or is_expired(item):
            return
        event = {
            "type": "message.created",
            "message": item_to_message(item).model_dump(),
        }
    gateway.publish(room_id, event)

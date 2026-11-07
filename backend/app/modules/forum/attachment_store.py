"""Private versioned S3 objects and temporary upload records in the Forum table."""

import os
from time import time

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from . import repository

MAX_PDF_BYTES = 15 * 1024 * 1024
UPLOAD_SECONDS = 600


def s3():
    bucket = os.getenv("FORUM_ATTACHMENTS_BUCKET", "").strip()
    region = os.getenv("AWS_REGION", "").strip()
    if not bucket or not region:
        raise repository.ForumStorageUnavailable("PDF storage is not configured")
    try:
        return boto3.client(
            "s3",
            region_name=region,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "virtual"},
                request_checksum_calculation="when_required",
            ),
        ), bucket
    except BotoCoreError as error:
        raise repository.ForumStorageUnavailable from error


def object_call(operation, **kwargs):
    try:
        client, bucket = s3()
        return getattr(client, operation)(Bucket=bucket, **kwargs)
    except (BotoCoreError, ClientError) as error:
        raise repository.ForumStorageUnavailable from error


def upload_key(upload_id):
    return {"PK": f"UPLOAD#{upload_id}", "SK": "METADATA"}


def get_upload(upload_id):
    return repository._call(
        "get_item", Key=upload_key(upload_id), ConsistentRead=True
    ).get("Item")


def create_upload(item):
    # A durable per-user hourly quota also bounds abandoned uploads across restarts.
    now = int(time())
    repository._call(
        "update_item",
        Key={"PK": f"PDFQUOTA#{item['author_id']}#{now // 3600}", "SK": "METADATA"},
        UpdateExpression="SET #ttl = :ttl ADD uploads :one",
        ConditionExpression="attribute_not_exists(uploads) OR uploads < :maximum",
        ExpressionAttributeNames={"#ttl": "ttl"},
        ExpressionAttributeValues={":ttl": now + 7200, ":one": 1, ":maximum": 10},
    )
    repository._call(
        "put_item", Item=item, ConditionExpression="attribute_not_exists(PK)"
    )


def mark_ready(upload_id, attachment):
    repository._call(
        "update_item",
        Key=upload_key(upload_id),
        UpdateExpression="SET attachment = :attachment",
        ConditionExpression="attribute_exists(PK) AND attribute_not_exists(claimed)",
        ExpressionAttributeValues={":attachment": attachment},
    )


def post_with_upload(item, upload_id):
    """Claim the room/author-bound upload and save its message atomically."""
    encode = TypeSerializer().serialize
    values = {
        ":room": item["room_id"],
        ":author": item["author_id"],
        ":version": item["attachment"]["version_id"],
        ":now": int(time()),
        ":claimed": item["message_id"],
    }
    try:
        client = boto3.client("dynamodb", region_name=os.environ["AWS_REGION"])
        table_name = repository.get_table().name
        client.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": table_name,
                        "Key": {
                            key: encode(value)
                            for key, value in upload_key(upload_id).items()
                        },
                        "UpdateExpression": "SET claimed = :claimed",
                        "ConditionExpression": "room_id = :room AND author_id = :author AND attachment.version_id = :version AND #ttl > :now AND attribute_not_exists(claimed)",
                        "ExpressionAttributeNames": {"#ttl": "ttl"},
                        "ExpressionAttributeValues": {
                            key: encode(value) for key, value in values.items()
                        },
                    }
                },
                {
                    "Put": {
                        "TableName": table_name,
                        "Item": {key: encode(value) for key, value in item.items()},
                        "ConditionExpression": "attribute_not_exists(PK)",
                    }
                },
            ]
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "TransactionCanceledException":
            reasons = error.response.get("CancellationReasons", [])
            if any(
                reason.get("Code") == "ConditionalCheckFailed" for reason in reasons
            ):
                raise ValueError("PDF upload expired or was already posted") from error
        raise repository.ForumStorageUnavailable from error
    except BotoCoreError as error:
        raise repository.ForumStorageUnavailable from error


def delete_object(attachment):
    object_call(
        "delete_object", Key=attachment["key"], VersionId=attachment["version_id"]
    )

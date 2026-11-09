"""Room-bound PDF uploads, format validation and authenticated downloads."""

import re
from datetime import datetime
from io import BytesIO
from threading import BoundedSemaphore
from time import time
from typing import Annotated
from urllib.parse import quote
from uuid import uuid4

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.modules.auth import CurrentUser, get_current_user

from . import attachment_store as store
from . import repository
from .schemas import RoomId
from .service import ROOM_CLOSED, is_expired, pdf_folder, room_is_open

router = APIRouter(prefix="/rooms", tags=["Forum PDFs"])
_Auth = Annotated[CurrentUser, Depends(get_current_user)]
_UploadId = Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]
# The MVP runs one worker; cap expensive reads/parsing without queuing threads.
_validation_slots = BoundedSemaphore(2)


class UploadIn(BaseModel):
    filename: str = Field(min_length=1, max_length=120)
    size: int = Field(ge=1, le=store.MAX_PDF_BYTES)

    @field_validator("filename")
    @classmethod
    def pdf_name(cls, value):
        value = value.strip()
        if not value.lower().endswith(".pdf") or re.search(
            r"[\\/\x00-\x1f\x7f]", value
        ):
            raise ValueError(
                "Choose a PDF filename without paths or control characters"
            )
        return value


def owned_upload(room_id, upload_id, user_id):
    item = store.get_upload(upload_id)
    if not item or item["room_id"] != room_id or item["author_id"] != user_id:
        raise HTTPException(status_code=404, detail="PDF upload not found")
    if int(item["ttl"]) <= time() or item.get("claimed"):
        raise HTTPException(
            status_code=410, detail="PDF upload expired or was already posted"
        )
    return item


def read_pdf(attachment):
    result = store.object_call(
        "get_object", Key=attachment["key"], VersionId=attachment["version_id"]
    )
    stream = result["Body"]
    try:
        if (
            result["ContentLength"] != int(attachment["size"])
            or result.get("ContentType") != "application/pdf"
        ):
            raise HTTPException(
                status_code=422, detail="PDF size or type does not match the upload"
            )
        data = stream.read(store.MAX_PDF_BYTES + 1)
    except BotoCoreError as error:
        raise repository.ForumStorageUnavailable from error
    finally:
        stream.close()
    if len(data) != int(attachment["size"]) or len(data) > store.MAX_PDF_BYTES:
        raise HTTPException(
            status_code=422, detail="PDF size does not match the upload"
        )
    return data


def validate_pdf(data):
    try:
        if not data.startswith(b"%PDF-"):
            raise ValueError("Not a PDF")
        pdf = PdfReader(BytesIO(data), strict=True)
        if pdf.is_encrypted or not 1 <= len(pdf.pages) <= 1000:
            raise ValueError("Encrypted, empty or oversized document")
    except (
        PdfReadError,
        NotImplementedError,
        ValueError,
        TypeError,
        KeyError,
        RecursionError,
        OverflowError,
    ) as error:
        raise HTTPException(
            status_code=422,
            detail="Choose a readable, unencrypted PDF with at most 1,000 pages",
        ) from error


def prepare_attachment(item):
    if item.get("attachment"):
        return item["attachment"]
    if not _validation_slots.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail="PDF checking is busy. Try Send again shortly.",
            headers={"Retry-After": "1"},
        )
    try:
        return _prepare_attachment(item)
    finally:
        _validation_slots.release()


def _prepare_attachment(item):
    try:
        client, bucket = store.s3()
        metadata = client.head_object(Bucket=bucket, Key=item["key"])
    except ClientError as error:
        if error.response["Error"]["Code"] in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise repository.ForumStorageUnavailable from error
    except BotoCoreError as error:
        raise repository.ForumStorageUnavailable from error
    version = metadata.get("VersionId")
    if not version or version == "null":
        raise repository.ForumStorageUnavailable("PDF bucket versioning is required")
    attachment = {
        "filename": item["filename"],
        "size": int(item["size"]),
        "key": item["key"],
        "version_id": version,
    }
    # Validate and save this exact version, even if a later upload replaces the key.
    validate_pdf(read_pdf(attachment))
    try:
        store.mark_ready(item["upload_id"], attachment)
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise HTTPException(
                status_code=409, detail="PDF upload expired or was already posted"
            ) from error
        raise
    return attachment


@router.post("/{room_id:path}/attachment-uploads", status_code=201)
def start_upload(room_id: RoomId, body: UploadIn, user: _Auth):
    if not room_is_open(room_id):
        raise HTTPException(status_code=403, detail=ROOM_CLOSED)
    client, bucket = store.s3()
    upload_id = uuid4().hex
    item = {
        **store.upload_key(upload_id),
        "upload_id": upload_id,
        "room_id": room_id,
        "author_id": user.user_id,
        "filename": body.filename,
        "size": body.size,
        # Grouped by closing date so cleanup deletes a closed room's PDFs together.
        "key": f"uploads/{pdf_folder(room_id)}/{upload_id}.pdf",
        "ttl": int(time()) + store.UPLOAD_SECONDS,
    }
    try:
        store.create_upload(item)
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise HTTPException(
                status_code=429, detail="PDF limit reached; try again next hour"
            ) from error
        raise
    try:
        url = client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": bucket,
                "Key": item["key"],
                "ContentType": "application/pdf",
                "ContentLength": body.size,
                "IfNoneMatch": "*",
            },
            ExpiresIn=60,
        )
    except BotoCoreError as error:
        raise repository.ForumStorageUnavailable from error
    return {
        "upload_id": upload_id,
        "url": url,
        "headers": {"Content-Type": "application/pdf", "If-None-Match": "*"},
    }


@router.get("/{room_id:path}/attachment-uploads/{upload_id}")
def upload_status(room_id: RoomId, upload_id: _UploadId, user: _Auth):
    item = owned_upload(room_id, upload_id, user.user_id)
    return {"status": "ready" if prepare_attachment(item) else "pending"}


@router.get("/{room_id:path}/messages/{message_id}/attachment")
def download_pdf(room_id: RoomId, message_id: str, user: _Auth, response: Response):
    item = repository.get_message(room_id, message_id)
    if not item or is_expired(item) or not item.get("attachment"):
        raise HTTPException(status_code=404, detail="PDF is no longer available")
    attachment = item["attachment"]
    # S3 checks expiry when a request starts. Never issue a link beyond the
    # message's access window; downloads already in progress can finish.
    remaining = int(datetime.fromisoformat(item["expires_at"]).timestamp() - time())
    if remaining < 1:
        raise HTTPException(status_code=404, detail="PDF is no longer available")
    expires_in = min(60, remaining)
    s3, bucket = store.s3()
    try:
        url = s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": bucket,
                "Key": attachment["key"],
                "VersionId": attachment["version_id"],
                "ResponseContentType": "application/octet-stream",
                "ResponseContentDisposition": (
                    f"attachment; filename*=UTF-8''{quote(attachment['filename'], safe='')}"
                ),
                "ResponseCacheControl": "no-store",
            },
            ExpiresIn=expires_in,
        )
    except (BotoCoreError, ClientError) as error:
        raise repository.ForumStorageUnavailable() from error
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return {"url": url}

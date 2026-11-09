"""Delete Forum PDFs when their discussion closes.

PDFs are stored as ``uploads/<closing date>/<upload id>.pdf``; the closing date
is the Monday (Singapore time) on which the lecture's week has ended. A weekly
schedule runs this just after Monday 00:00, when that week's messages expire,
and permanently removes every version, including uploads that were never
posted. Keys without a date folder predate this layout and belonged to
24-hour messages, so they are removed too.
"""

import logging
from datetime import UTC, date, datetime, time

from . import attachment_store as store
from .service import SINGAPORE

logger = logging.getLogger(__name__)
_PREFIX = "uploads/"
_BATCH = 1000  # DeleteObjects limit


def _closed(key: str, now: datetime) -> bool:
    parts = key.split("/")
    if len(parts) == 2:
        return True
    try:
        closes = datetime.combine(date.fromisoformat(parts[1]), time(0), SINGAPORE)
    except ValueError:
        logger.warning("Leaving PDF with an unexpected key: %s", key)
        return False
    return closes <= now


def delete_closed_pdfs(now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    client, bucket = store.s3()
    targets = []
    for page in client.get_paginator("list_object_versions").paginate(
        Bucket=bucket, Prefix=_PREFIX
    ):
        for entry in page.get("Versions", []) + page.get("DeleteMarkers", []):
            if _closed(entry["Key"], now):
                targets.append({"Key": entry["Key"], "VersionId": entry["VersionId"]})
    failed = []
    for start in range(0, len(targets), _BATCH):
        response = client.delete_objects(
            Bucket=bucket,
            Delete={"Objects": targets[start : start + _BATCH], "Quiet": True},
        )
        failed += response.get("Errors", [])
    result = {"deleted": len(targets) - len(failed), "failed": len(failed)}
    logger.info("Closed-room PDF cleanup: %s", result)
    if failed:
        # Fail the invocation so the schedule retries and the error alarm fires.
        raise RuntimeError(f"Could not delete {len(failed)} PDF versions")
    return result

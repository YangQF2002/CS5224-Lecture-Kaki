"""Publish a complete lecture snapshot before switching the current-data pointer."""

import hashlib
import json
import logging
from datetime import date, datetime, timedelta
from uuid import uuid4

from botocore.exceptions import ClientError

from .academic_calendar import Semester, week_label
from .lesson_types import LESSON_TYPE_CODES
from .topics import TAXONOMY
from .transform import group_by_date

ROOT = "lectures"
CACHE_CONTROL = "public, max-age=86400, immutable"

logger = logging.getLogger(__name__)

# Below this share of the last published run: refuse a re-run of the same
# semester; publish a new semester but log SMALL_NEW_SEMESTER for the alarm.
MIN_RATIO_OF_PREVIOUS = 0.5
# Matched by the CloudWatch log metric filter in infra/terraform/ingest.tf.
SMALL_NEW_SEMESTER = "SMALL_NEW_SEMESTER"


class SuspiciousDataError(Exception):
    """The dataset is empty or much smaller than the currently published semester."""


def publish(
    s3,
    bucket: str,
    semester: Semester,
    sessions: list[dict],
    modules: list[dict],
    now: datetime,
    *,
    force: bool = False,
) -> dict:
    """Publish a new snapshot, or only record the check if nothing changed

    The snapshot is built in memory first. If its fingerprint matches the live
    one, no files are written: readers and caches keep the current snapshot,
    and current.json only gets a new checkedAt. `force` forces a publish
    """
    prefix = f"{ROOT}/{semester.key}/{uuid4().hex}"
    generated_at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    base = {"acadYear": semester.acad_year, "semester": semester.number}

    current = _get_json(s3, bucket, f"{ROOT}/current.json")
    warning = _check_counts(s3, bucket, semester, len(sessions), current)

    documents: dict[str, dict] = {}

    by_date = group_by_date(sessions)
    for on, day_sessions in by_date.items():
        documents[f"{prefix}/days/{on.isoformat()}.json"] = {
            **base,
            "date": on.isoformat(),
            "week": week_label(semester, on),
            "sessions": day_sessions,
        }

    weeks = _group_by_week(semester, by_date)
    for label, (monday, week_sessions) in weeks.items():
        documents[f"{prefix}/weeks/{label}.json"] = {
            **base,
            "week": label,
            "startDate": monday.isoformat(),
            "endDate": (monday + timedelta(days=6)).isoformat(),
            "sessions": week_sessions,
        }

    documents[f"{prefix}/modules.json"] = {**base, "items": modules}

    documents[f"{prefix}/index.json"] = {
        **base,
        "sessionCount": len(sessions),
        "days": [on.isoformat() for on in by_date],
        "weeks": [
            {
                "week": label,
                "startDate": monday.isoformat(),
                "endDate": (monday + timedelta(days=6)).isoformat(),
                "sessionCount": len(week_sessions),
            }
            for label, (monday, week_sessions) in weeks.items()
        ],
        "lessonTypes": LESSON_TYPE_CODES,
        # Every topic a module can have; the Profile page offers these to choose from.
        "topics": list(TAXONOMY),
    }

    content_hash = _fingerprint(documents, prefix)
    if not force and current and current.get("contentHash") == content_hash:
        # Same data as the live snapshot: keep its files and generatedAt, and
        # only record that it was checked.
        pointer = {k: v for k, v in current.items() if k != "generatedAt"}
        _put_json(
            s3,
            bucket,
            f"{ROOT}/current.json",
            {**pointer, "checkedAt": generated_at},
            current["generatedAt"],
            cache_control="no-cache",
        )
        return {
            "semester": semester.key,
            "sessions": len(sessions),
            "path": current["path"],
            "unchanged": True,
        }

    documents[f"{prefix}/index.json"]["contentHash"] = content_hash
    for key, document in documents.items():
        _put_json(s3, bucket, key, document, generated_at)

    # Readers of the previous pointer can finish using its unchanged snapshot.
    _put_json(
        s3,
        bucket,
        f"{ROOT}/current.json",
        {
            **base,
            "path": f"{prefix}/",
            "contentHash": content_hash,
            "checkedAt": generated_at,
        },
        generated_at,
        cache_control="no-cache",
    )

    result = {
        "semester": semester.key,
        "sessions": len(sessions),
        "path": f"{prefix}/",
        "files": len(documents) + 1,
    }
    if warning:
        result["warning"] = warning
    return result


def _group_by_week(
    semester: Semester, by_date: dict[date, list[dict]]
) -> dict[str, tuple[date, list[dict]]]:
    weeks: dict[str, tuple[date, list[dict]]] = {}
    for on, day_sessions in by_date.items():
        label = week_label(semester, on)
        monday = on - timedelta(days=on.weekday())
        _, week_sessions = weeks.setdefault(label, (monday, []))
        week_sessions.extend(day_sessions)
    return weeks


def _fingerprint(documents: dict[str, dict], prefix: str) -> str:
    """SHA-256 of every file's path and content within the snapshot.

    Leaves out what differs on every run with the same data: the random folder
    name (paths are relative to it) and generatedAt (added only when writing).
    """
    relative = {key.removeprefix(f"{prefix}/"): doc for key, doc in documents.items()}
    text = json.dumps(relative, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(text.encode()).hexdigest()


def _check_counts(
    s3, bucket: str, semester: Semester, count: int, current: dict | None
) -> str | None:
    """Reject unusable data; return a warning for a suspiciously small new semester.

    A re-run of the published semester that drops below half is refused, since
    the current snapshot is better. A new semester cannot be compared with
    itself, so it is compared with the semester it replaces: it is still
    published (the old term has ended), but logged for the alarm to report.
    """
    if count == 0:
        raise SuspiciousDataError("NUSMods returned no lecture sessions")
    if not current:
        return None
    previous = _get_json(s3, bucket, f"{current['path']}index.json")
    if not previous or count >= previous["sessionCount"] * MIN_RATIO_OF_PREVIOUS:
        return None
    same_semester = (current["acadYear"], current["semester"]) == (
        semester.acad_year,
        semester.number,
    )
    if same_semester:
        raise SuspiciousDataError(
            f"Only {count} sessions, down from {previous['sessionCount']} last run"
        )
    warning = (
        f"{semester.key} has {count} sessions, under half of the "
        f"{previous['sessionCount']} in {current['acadYear']}/sem-{current['semester']}; "
        "NUSMods data may be incomplete"
    )
    logger.warning("%s %s", SMALL_NEW_SEMESTER, warning)
    return warning


def _put_json(
    s3,
    bucket: str,
    key: str,
    document: dict,
    generated_at: str,
    *,
    cache_control: str = CACHE_CONTROL,
) -> None:
    body = json.dumps(
        {"generatedAt": generated_at, **document}, ensure_ascii=False
    ).encode()
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json",
        CacheControl=cache_control,
    )


def _get_json(s3, bucket: str, key: str) -> dict | None:
    try:
        return json.load(s3.get_object(Bucket=bucket, Key=key)["Body"])
    except ClientError as error:
        if error.response["Error"]["Code"] in ("404", "NoSuchKey"):
            return None
        raise

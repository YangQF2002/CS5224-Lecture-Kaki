"""Publish a complete lecture snapshot before switching the current-data pointer."""

import json
from datetime import date, datetime, timedelta
from uuid import uuid4

from botocore.exceptions import ClientError

from ingest.academic_calendar import Semester, week_label
from ingest.lesson_types import LESSON_TYPE_CODES
from ingest.transform import group_by_date

ROOT = "lectures"
CACHE_CONTROL = "public, max-age=86400, immutable"

# Refuse to publish if the session count drops below this share of the last run.
MIN_RATIO_OF_PREVIOUS = 0.5


class SuspiciousDataError(Exception):
    """The dataset is empty or much smaller than the currently published semester."""


def publish(
    s3,
    bucket: str,
    semester: Semester,
    sessions: list[dict],
    modules: list[dict],
    now: datetime,
) -> dict:
    prefix = f"{ROOT}/{semester.key}/{uuid4().hex}"
    generated_at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    base = {"acadYear": semester.acad_year, "semester": semester.number}

    _check_counts(s3, bucket, semester, len(sessions))

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
    }
    for key, document in documents.items():
        _put_json(s3, bucket, key, document, generated_at)

    # Readers of the previous pointer can finish using its unchanged snapshot.
    _put_json(
        s3,
        bucket,
        f"{ROOT}/current.json",
        {**base, "path": f"{prefix}/"},
        generated_at,
        cache_control="no-cache",
    )

    return {
        "semester": semester.key,
        "sessions": len(sessions),
        "path": f"{prefix}/",
        "files": len(documents) + 1,
    }


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


def _check_counts(s3, bucket: str, semester: Semester, count: int) -> None:
    if count == 0:
        raise SuspiciousDataError("NUSMods returned no lecture sessions")
    current = _get_json(s3, bucket, f"{ROOT}/current.json")
    if not current or (current["acadYear"], current["semester"]) != (
        semester.acad_year,
        semester.number,
    ):
        return
    previous = _get_json(s3, bucket, f"{current['path']}index.json")
    if previous and count < previous["sessionCount"] * MIN_RATIO_OF_PREVIOUS:
        raise SuspiciousDataError(
            f"Only {count} sessions, down from {previous['sessionCount']} last run"
        )


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

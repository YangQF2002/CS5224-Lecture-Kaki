"""Ingest NUSMods lecture data on schedule or for a manually selected semester."""

import json
import logging
import os
from datetime import UTC, date, datetime, timedelta, timezone

import boto3

from .academic_calendar import ingest_due, semester_for
from .nusmods import fetch_semester
from .publish import publish
from .transform import build_modules, build_sessions

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
SINGAPORE = timezone(timedelta(hours=8))


def handler(event, context, *, s3=None, now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    manual_date = event.get("date") if event else None
    today = (
        date.fromisoformat(manual_date)
        if manual_date
        else now.astimezone(SINGAPORE).date()
    )
    semester = semester_for(today)
    if not manual_date and not ingest_due(semester, today):
        result = {"semester": semester.key, "skipped": f"not due on {today}"}
        logger.info(json.dumps(result))
        return result
    module_info, venue_info = fetch_semester(semester.acad_year, semester.number)
    sessions = build_sessions(module_info, venue_info, semester)
    modules = build_modules(module_info, sessions)

    result = publish(
        s3 or boto3.client("s3"),
        os.environ["WEB_BUCKET"],
        semester,
        sessions,
        modules,
        now,
    )
    logger.info(json.dumps(result))
    return result

"""Transform NUSMods module and venue data into lecture sessions."""

import re
from collections import defaultdict
from datetime import date

from .academic_calendar import EARLY_CLOSURES, Semester, class_dates
from .lesson_types import LESSON_TYPE_CODES
from .venues import building_for, is_online

EXCLUDED_FACULTIES = frozenset({"NUS-ISS"})

_LEVEL = re.compile(r"[A-Z]+(\d)")


def module_level(module_code: str) -> int | None:
    """SC3210 -> 3000."""
    match = _LEVEL.match(module_code)
    return int(match.group(1)) * 1000 if match else None


def split_module_code(raw: str) -> tuple[str, list[str]]:
    """Split cross-listed codes, removing embedded NUSMods zero-width spaces."""
    codes = [c.strip() for c in raw.replace("\u200b", "").split("/") if c.strip()]
    if not codes:
        raise ValueError("NUSMods returned an empty module code")
    return codes[0], codes[1:]


def hhmm(time: str) -> str:
    return f"{time[:2]}:{time[2:]}"


def build_sessions(
    module_info: list[dict], venue_info: dict, semester: Semester
) -> list[dict]:
    """Every lecture session in the semester, sorted by date, start time and module."""
    if not module_info:
        raise ValueError("NUSMods returned an empty module catalogue")
    modules = {m["moduleCode"]: m for m in module_info}

    # (module, lessonType, classNo, date, start, venue) -> (end, size, crossListed).
    # Duplicate slots can have different end times; keep the longer one.
    slots: dict[tuple, tuple] = {}
    for venue, days in venue_info.items():
        for day in days:
            for lesson in day["classes"]:
                if lesson["lessonType"] not in LESSON_TYPE_CODES:
                    continue
                module_code, cross_listed = split_module_code(lesson["moduleCode"])
                module = modules.get(module_code)
                if module is None or any(
                    not isinstance(module.get(field), str) or not module[field].strip()
                    for field in ("title", "faculty", "department")
                ):
                    raise ValueError(f"Incomplete NUSMods metadata for {module_code}")
                if module["faculty"] in EXCLUDED_FACULTIES:
                    continue
                for on in class_dates(semester, day["day"], lesson["weeks"]):
                    end = lesson["endTime"]
                    if cutoff := EARLY_CLOSURES.get(on):
                        if lesson["startTime"] >= cutoff:
                            continue
                        end = min(end, cutoff)
                    key = (
                        module_code,
                        lesson["lessonType"],
                        lesson["classNo"],
                        on,
                        lesson["startTime"],
                        venue,
                    )
                    value = (
                        end,
                        lesson.get("size") or 0,
                        tuple(cross_listed),
                    )
                    if key not in slots or value > slots[key]:
                        slots[key] = value

    sessions = [_session(key + value, modules[key[0]]) for key, value in slots.items()]
    sessions.sort(key=lambda s: (s["date"], s["startTime"], s["moduleCode"], s["id"]))
    return sessions


def _session(occurrence: tuple, module: dict) -> dict:
    module_code, lesson_type, class_no, on, start, venue, end, size, cross = occurrence
    session_id = (
        f"{module_code}-{LESSON_TYPE_CODES[lesson_type]}-{class_no}"
        f"@{on.isoformat()}-{start}-{venue}"
    )
    return {
        "id": session_id,
        "moduleCode": module_code,
        "crossListed": list(cross),
        "moduleTitle": module["title"],
        "faculty": module["faculty"],
        "department": module["department"],
        "level": module_level(module_code),
        "lessonType": lesson_type,
        "classNo": class_no,
        "date": on.isoformat(),
        "startTime": hhmm(start),
        "endTime": hhmm(end),
        "venue": venue,
        "building": building_for(venue),
        "online": is_online(venue),
        "size": size,
    }


def build_modules(module_info: list[dict], sessions: list[dict]) -> list[dict]:
    """Return module metadata for the published lecture sessions."""
    codes = {s["moduleCode"] for s in sessions}
    return [
        {
            "moduleCode": m["moduleCode"],
            "title": m["title"],
            "faculty": m["faculty"],
            "department": m["department"],
            "level": module_level(m["moduleCode"]),
            "moduleCredit": m.get("moduleCredit"),
            "description": m.get("description"),
        }
        for m in sorted(module_info, key=lambda m: m["moduleCode"])
        if m["moduleCode"] in codes
    ]


def group_by_date(sessions: list[dict]) -> dict[date, list[dict]]:
    by_date: dict[date, list[dict]] = defaultdict(list)
    for session in sessions:
        by_date[date.fromisoformat(session["date"])].append(session)
    return dict(sorted(by_date.items()))

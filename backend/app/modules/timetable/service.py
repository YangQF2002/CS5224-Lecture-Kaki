from typing import Any

from .nusmods import (
    NusmodsClient,
    NusmodsModuleNotFound,
    NusmodsUnavailable,
)
from .schemas import Timetable, TimetableSelection


class InvalidTimetableSelection(ValueError):
    """A selection does not exist in current NUSMods data."""


def _semester_timetable(module: dict[str, Any], semester: int) -> list[dict[str, Any]]:
    semester_data = module.get("semesterData")

    if not isinstance(semester_data, list):
        raise NusmodsUnavailable("module contains no semester information")

    for entry in semester_data:
        if (
            not isinstance(entry, dict)
            or type(entry.get("semester")) is not int
            or entry["semester"] not in (1, 2, 3, 4)
        ):
            raise NusmodsUnavailable("module contains invalid semester information")
        if entry.get("semester") == semester:
            lessons = entry.get("timetable")

            if not isinstance(lessons, list):
                raise NusmodsUnavailable("module contains no timetable")

            if any(
                not isinstance(lesson, dict)
                or not isinstance(lesson.get("classNo"), str)
                or not lesson["classNo"].strip()
                or not isinstance(lesson.get("lessonType"), str)
                or not lesson["lessonType"].strip()
                for lesson in lessons
            ):
                raise NusmodsUnavailable("module contains invalid lessons")

            return lessons

    raise InvalidTimetableSelection(f"module is not offered in semester {semester}")


def validate_timetable(timetable: Timetable, nusmods: NusmodsClient) -> Timetable:
    modules: dict[str, dict[str, Any]] = {}
    canonical_selections: list[TimetableSelection] = []

    for selection in timetable.selections:
        module = modules.get(selection.module_code)

        if module is None:
            try:
                module = nusmods.fetch_module(
                    timetable.academic_year, selection.module_code
                )
            except NusmodsModuleNotFound:
                raise InvalidTimetableSelection(
                    f"{selection.module_code} does not exist in "
                    f"{timetable.academic_year}"
                ) from None

            modules[selection.module_code] = module

        module_code = module.get("moduleCode")
        module_title = module.get("title")

        if (
            module_code != selection.module_code
            or not isinstance(module_title, str)
            or not module_title.strip()
            or len(module_title.strip()) > 300
        ):
            raise NusmodsUnavailable(
                f"invalid NUSMods data for {selection.module_code}"
            )

        lessons = _semester_timetable(module, timetable.semester)

        selection_exists = any(
            lesson.get("lessonType") == selection.lesson_type
            and lesson["classNo"] == selection.class_no
            for lesson in lessons
        )

        if not selection_exists:
            raise InvalidTimetableSelection(
                f"{selection.module_code} has no "
                f"{selection.lesson_type} class {selection.class_no}"
            )

        canonical_selections.append(
            TimetableSelection(
                moduleCode=module_code,
                moduleTitle=module_title,
                lessonType=selection.lesson_type,
                classNo=selection.class_no,
            )
        )

    canonical_selections.sort(
        key=lambda selection: (
            selection.module_code,
            selection.lesson_type,
        )
    )

    return Timetable(
        academicYear=timetable.academic_year,
        semester=timetable.semester,
        selections=canonical_selections,
    )

from datetime import date

import pytest

from jobs.lecture_ingest.academic_calendar import (
    SEMESTERS,
    class_dates,
    ingest_due,
    semester_for,
    week_label,
)

SEM1 = SEMESTERS[("2026-2027", 1)]
ALL_WEEKS = list(range(1, 14))


@pytest.mark.parametrize(
    ("today", "expected"),
    [
        (date(2026, 8, 1), ("2026-2027", 1)),
        (date(2027, 1, 4), ("2026-2027", 2)),
        (date(2027, 6, 15), ("2026-2027", 2)),  # June/July keep serving Sem 2
    ],
)
def test_semester_for(today, expected):
    semester = semester_for(today)
    assert (semester.acad_year, semester.number) == expected


def test_semester_for_missing_calendar_entry():
    with pytest.raises(KeyError, match="2027-2028"):
        semester_for(date(2027, 8, 10))


@pytest.mark.parametrize(
    ("day", "label"),
    [
        (date(2026, 8, 10), "week-01"),
        (date(2026, 9, 20), "week-06"),
        (date(2026, 9, 22), "recess"),
        (date(2026, 9, 28), "week-07"),
        (date(2026, 11, 13), "week-13"),
        (date(2026, 11, 16), "reading"),
        (date(2026, 11, 23), "exam-1"),
        (date(2026, 12, 5), "exam-2"),
        (date(2026, 12, 6), None),
        (date(2026, 8, 9), None),
    ],
)
def test_week_label(day, label):
    assert week_label(SEM1, day) == label


def test_list_weeks():
    dates = class_dates(SEM1, "Tuesday", ALL_WEEKS)
    assert len(dates) == 13
    assert dates[0] == date(2026, 8, 11)
    assert date(2026, 9, 22) not in dates  # recess
    assert date(2026, 9, 29) in dates  # week 7
    assert dates[-1] == date(2026, 11, 10)


def test_public_holidays_dropped():
    dates = class_dates(SEM1, "Monday", ALL_WEEKS)
    assert date(2026, 8, 10) not in dates  # National Day observed
    assert date(2026, 11, 9) not in dates  # Deepavali observed
    assert len(dates) == 11


def test_semester_two_calendar():
    semester = SEMESTERS[("2026-2027", 2)]
    assert class_dates(semester, "Thursday", ALL_WEEKS) == [
        date(2027, 1, 14),
        date(2027, 1, 21),
        date(2027, 1, 28),
        date(2027, 2, 4),
        date(2027, 2, 11),
        date(2027, 2, 18),
        date(2027, 3, 4),
        date(2027, 3, 18),
        date(2027, 3, 25),
        date(2027, 4, 1),
        date(2027, 4, 8),
        date(2027, 4, 15),
    ]


def test_date_range_weeks_count_calendar_weeks_from_start():
    weeks = {
        "start": "2026-08-13",
        "end": "2026-11-19",
        "weeks": [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15],
    }
    dates = class_dates(SEM1, "Thursday", weeks)
    assert dates[0] == date(2026, 8, 13)
    assert date(2026, 9, 24) not in dates
    assert dates[-1] == date(2026, 11, 19)
    assert len(dates) == 14


def test_date_range_without_weeks_uses_interval():
    weeks = {"start": "2026-10-01", "end": "2026-10-29", "weekInterval": 2}
    assert class_dates(SEM1, "Thursday", weeks) == [
        date(2026, 10, 1),
        date(2026, 10, 15),
        date(2026, 10, 29),
    ]


def test_date_range_outside_semester_dropped():
    weeks = {"start": "2026-07-11", "end": "2026-08-15", "weeks": [1, 6]}
    assert class_dates(SEM1, "Saturday", weeks) == [date(2026, 8, 15)]


@pytest.mark.parametrize(
    ("today", "due"),
    [
        pytest.param(date(2026, 8, 3), True, id="before-week-one"),
        pytest.param(date(2026, 8, 10), True, id="week-one"),
        pytest.param(date(2026, 8, 17), True, id="week-two"),
        pytest.param(date(2026, 8, 24), True, id="week-three"),
        pytest.param(date(2026, 8, 31), False, id="week-four"),
        pytest.param(date(2026, 9, 7), True, id="first-monday-on-seventh"),
        pytest.param(date(2026, 10, 19), False, id="later-monday"),
        pytest.param(date(2027, 1, 4), True, id="before-semester-two"),
        pytest.param(date(2027, 1, 18), True, id="semester-two-week-two"),
        pytest.param(date(2027, 2, 1), True, id="first-monday-on-first"),
        pytest.param(date(2027, 2, 8), False, id="semester-two-later-monday"),
        pytest.param(date(2026, 9, 1), False, id="monthly-non-monday"),
        pytest.param(date(2026, 8, 18), False, id="weekly-non-monday"),
    ],
)
def test_ingest_due(today, due):
    assert ingest_due(semester_for(today), today) is due

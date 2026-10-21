"""Expand lesson dates using the supported NUS academic calendar."""

from dataclasses import dataclass
from datetime import date, timedelta

DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

RECESS_AFTER_WEEK = 6
LAST_TEACHING_WEEK = 13


@dataclass(frozen=True)
class Semester:
    acad_year: str  # NUSMods format: "2026-2027".
    number: int  # 1 or 2
    week1_monday: date
    last_day: date  # last day of the exam period

    @property
    def key(self) -> str:
        return f"{self.acad_year}/sem-{self.number}"


# https://www.nus.edu.sg/registrar/docs/default-source/calendar/ay2026-2027.pdf
SEMESTERS = {
    ("2026-2027", 1): Semester("2026-2027", 1, date(2026, 8, 10), date(2026, 12, 5)),
    ("2026-2027", 2): Semester("2026-2027", 2, date(2027, 1, 11), date(2027, 5, 8)),
}

# University closures, including observed public holidays.
PUBLIC_HOLIDAYS = {
    date(2026, 8, 9): "National Day",
    date(2026, 8, 10): "National Day (observed)",
    date(2026, 10, 9): "NUS Well-Being Day",
    date(2026, 11, 8): "Deepavali",
    date(2026, 11, 9): "Deepavali (observed)",
    date(2026, 12, 25): "Christmas Day",
    date(2027, 1, 1): "New Year's Day",
    date(2027, 2, 6): "Chinese New Year",
    date(2027, 2, 7): "Chinese New Year",
    date(2027, 2, 8): "Chinese New Year (observed)",
    date(2027, 3, 10): "Hari Raya Puasa",
    date(2027, 3, 11): "NUS Well-Being Day",
    date(2027, 3, 26): "Good Friday",
    date(2027, 5, 1): "Labour Day",
    date(2027, 5, 17): "Hari Raya Haji",
    date(2027, 5, 20): "Vesak Day",
}


def semester_for(today: date) -> Semester:
    """Keep Semester 2 through the summer; special terms are not ingested."""
    if today.month >= 8:
        key = (f"{today.year}-{today.year + 1}", 1)
    else:
        key = (f"{today.year - 1}-{today.year}", 2)
    try:
        return SEMESTERS[key]
    except KeyError:
        raise KeyError(
            f"No calendar entry for {key[0]} semester {key[1]}; add it to SEMESTERS"
        ) from None


def teaching_week_monday(semester: Semester, week: int) -> date:
    """Monday of a teaching week; recess week sits between weeks 6 and 7."""
    offset = week - 1 if week <= RECESS_AFTER_WEEK else week
    return semester.week1_monday + timedelta(weeks=offset)


def week_label(semester: Semester, day: date) -> str | None:
    """Label of the Monday-to-Sunday week containing `day`, or None outside the semester."""
    if not semester.week1_monday <= day <= semester.last_day:
        return None
    index = (day - semester.week1_monday).days // 7
    if index < RECESS_AFTER_WEEK:
        return f"week-{index + 1:02d}"
    if index == RECESS_AFTER_WEEK:
        return "recess"
    if index <= LAST_TEACHING_WEEK:
        return f"week-{index:02d}"
    if index == LAST_TEACHING_WEEK + 1:
        return "reading"
    return f"exam-{index - LAST_TEACHING_WEEK - 1}"


def ingest_due(semester: Semester, today: date) -> bool:
    """Run on Mondays in teaching weeks 1-3, then on the first Monday each month."""
    return today.weekday() == 0 and (
        week_label(semester, today) in {"week-01", "week-02", "week-03"}
        or today.day <= 7
    )


def class_dates(semester: Semester, day_name: str, weeks: list | dict) -> list[date]:
    """Expand lesson dates, excluding holidays and dates outside the semester.

    Date-range week numbers count from their start date, not the teaching calendar.
    """
    if isinstance(weeks, list):
        weekday = DAYS.index(day_name)
        dates = [
            teaching_week_monday(semester, w) + timedelta(days=weekday) for w in weeks
        ]
    else:
        start = date.fromisoformat(weeks["start"])
        end = date.fromisoformat(weeks["end"])
        if "weeks" in weeks:
            dates = [start + timedelta(weeks=w - 1) for w in weeks["weeks"]]
        else:
            step = timedelta(weeks=weeks.get("weekInterval", 1))
            dates = []
            current = start
            while current <= end:
                dates.append(current)
                current += step
        dates = [d for d in dates if d <= end]

    return sorted(
        d
        for d in set(dates)
        if semester.week1_monday <= d <= semester.last_day and d not in PUBLIC_HOLIDAYS
    )

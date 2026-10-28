import pytest

from jobs.lecture_ingest.academic_calendar import SEMESTERS
from jobs.lecture_ingest.transform import (
    build_modules,
    build_sessions,
    module_level,
    split_module_code,
)
from jobs.lecture_ingest.venues import building_for


@pytest.fixture
def sessions(module_info, venue_info, sem1):
    return build_sessions(module_info, venue_info, sem1)


def by_module(sessions, code, class_no=None):
    return [
        s
        for s in sessions
        if s["moduleCode"] == code and (class_no is None or s["classNo"] == class_no)
    ]


def test_session_shape(sessions):
    session = next(
        s for s in sessions if s["id"] == "SC3210-LEC-1@2026-10-13-1000-UTSRC-GLR"
    )
    assert session == {
        "id": "SC3210-LEC-1@2026-10-13-1000-UTSRC-GLR",
        "moduleCode": "SC3210",
        "crossListed": [],
        "moduleTitle": "AI and Society",
        "faculty": "Arts and Social Science",
        "department": "Sociology and Anthropology",
        "level": 3000,
        "lessonType": "Lecture",
        "classNo": "1",
        "date": "2026-10-13",
        "startTime": "10:00",
        "endTime": "12:00",
        "venue": "UTSRC-GLR",
        "building": "UTSRC",
        "online": False,
        "size": 40,
    }


def test_only_lectures(sessions):
    assert {s["lessonType"] for s in sessions} == {"Lecture"}
    assert len(by_module(sessions, "SC3210")) == 13


def test_nus_iss_excluded(sessions):
    assert by_module(sessions, "EBA5003") == []


def test_ids_unique_and_sorted(sessions):
    assert len({s["id"] for s in sessions}) == len(sessions)
    keys = [(s["date"], s["startTime"], s["moduleCode"], s["id"]) for s in sessions]
    assert keys == sorted(keys)


def test_room_change_by_week(sessions):
    laj = by_module(sessions, "LAJ1201", "1")
    assert len(laj) == 11  # 13 Mondays minus National Day and Deepavali (observed)
    assert {s["venue"] for s in laj if s["date"] < "2026-09-21"} == {"LT19"}
    assert {s["venue"] for s in laj if s["date"] > "2026-09-21"} == {"LT14"}


@pytest.mark.parametrize(
    ("start", "end", "expected_end"),
    [
        pytest.param("1000", "1200", "12:00", id="before-cutoff"),
        pytest.param("1200", "1400", "14:00", id="ends-at-cutoff"),
        pytest.param("1300", "1500", "14:00", id="crosses-cutoff"),
        pytest.param("1400", "1600", None, id="starts-at-cutoff"),
        pytest.param("1600", "1800", None, id="after-cutoff"),
    ],
)
def test_cny_eve_cutoff_only_affects_that_date(module_info, start, end, expected_end):
    lesson = {
        "moduleCode": "SC3210",
        "lessonType": "Lecture",
        "classNo": "1",
        "weeks": [4, 5],
        "startTime": start,
        "endTime": end,
    }
    venues = {"UTSRC-GLR": [{"day": "Friday", "classes": [lesson]}]}
    sessions = build_sessions(module_info, venues, SEMESTERS[("2026-2027", 2)])

    expected = [("2027-02-12", f"{end[:2]}:{end[2:]}")]
    if expected_end is not None:
        expected.insert(0, ("2027-02-05", expected_end))
    assert [(s["date"], s["endTime"]) for s in sessions] == expected


def test_duplicate_slot_keeps_longer_entry(sessions):
    bmi = [s for s in by_module(sessions, "BMI5102") if s["date"] == "2026-10-05"]
    assert len(bmi) == 1
    assert bmi[0]["endTime"] == "21:30"


def test_cross_listed_code(sessions):
    ce = by_module(sessions, "CE2112T")
    assert ce
    assert all(s["crossListed"] == ["CE2112"] for s in ce)
    assert (
        ce[0]["moduleTitle"]
        == "Basis of Structural Analysis and Saturated Geomechanics"
    )


def test_online_venue(sessions):
    nm = by_module(sessions, "NM2103")
    online = [s for s in nm if s["online"]]
    assert online and all(s["venue"] == "E-Learn_C" for s in online)
    assert all(s["building"] is None for s in online)
    assert {s["building"] for s in nm if not s["online"]} == {"BIZ2"}


@pytest.mark.parametrize(
    ("venue", "building"),
    [
        ("LT16", "COM2"),
        ("CQT/SR0514", "S15"),
        ("UnknownVenue", None),
        ("E-Learn_C", None),
    ],
)
def test_building_for_venue(venue, building):
    assert building_for(venue) == building


def test_module_level():
    assert module_level("LAJ1201") == 1000
    assert module_level("??") is None


@pytest.mark.parametrize(
    "raw", ["", "\u200b/ /\u200b"], ids=["empty", "no-code-after-cleaning"]
)
def test_empty_module_code_rejected(raw):
    with pytest.raises(ValueError, match="NUSMods returned an empty module code"):
        split_module_code(raw)


def test_build_modules(module_info, sessions):
    modules = build_modules(module_info, sessions)
    assert "EBA5003" not in {m["moduleCode"] for m in modules}
    sc = next(m for m in modules if m["moduleCode"] == "SC3210")
    source = next(m for m in module_info if m["moduleCode"] == "SC3210")
    assert sc["description"] == source["description"]
    assert sc["level"] == 3000


def test_id_does_not_depend_on_other_occurrences(sem1):
    modules = [
        {
            "moduleCode": "CS1234",
            "title": "Example",
            "faculty": "Computing",
            "department": "Computer Science",
        }
    ]
    lesson = {
        "moduleCode": "CS1234",
        "lessonType": "Lecture",
        "classNo": "1",
        "weeks": [1],
        "startTime": "1000",
        "endTime": "1200",
    }
    venues = {"COM1-0101": [{"day": "Tuesday", "classes": [lesson]}]}
    original = build_sessions(modules, venues, sem1)[0]
    venues["COM1-0101"][0]["classes"].append(
        {**lesson, "startTime": "1400", "endTime": "1600"}
    )
    venues["COM2-0101"] = [{"day": "Tuesday", "classes": [lesson]}]
    changed = build_sessions(modules, venues, sem1)
    assert len(changed) == 3
    assert len({s["id"] for s in changed}) == 3
    assert original in changed


@pytest.mark.parametrize("field", ["title", "faculty", "department"])
def test_incomplete_metadata_rejected(module_info, venue_info, sem1, field):
    module_info[0].pop(field)
    with pytest.raises(ValueError, match="Incomplete NUSMods metadata for BMI5102"):
        build_sessions(module_info, venue_info, sem1)


def test_missing_module_metadata_rejected(module_info, venue_info, sem1):
    module_info.pop(0)
    with pytest.raises(ValueError, match="Incomplete NUSMods metadata for BMI5102"):
        build_sessions(module_info, venue_info, sem1)

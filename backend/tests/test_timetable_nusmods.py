import json
from http.client import BadStatusLine
from io import BytesIO
from unittest.mock import Mock
from urllib.error import HTTPError, URLError

import pytest

from app.modules.timetable.nusmods import (
    MAX_RESPONSE_BYTES,
    NusmodsClient,
    NusmodsModuleNotFound,
    NusmodsUnavailable,
)
from app.modules.timetable.schemas import Timetable
from app.modules.timetable.service import InvalidTimetableSelection, validate_timetable


def test_validation_refetches_changed_classes_but_deduplicates_within_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lessons = [
        {"classNo": "1", "lessonType": "Lecture"},
        {"classNo": "02", "lessonType": "Tutorial"},
    ]
    module = {
        "moduleCode": "CS5224",
        "title": "Distributed Systems",
        "semesterData": [{"semester": 1, "timetable": lessons}],
    }
    initial_body = json.dumps(module).encode()
    lessons.pop(0)
    updated_body = json.dumps(module).encode()
    opener = Mock(side_effect=[BytesIO(initial_body), BytesIO(updated_body)])
    monkeypatch.setattr("app.modules.timetable.nusmods.urlopen", opener)
    timetable = Timetable(
        academicYear="2026-2027",
        semester=1,
        selections=[
            {"moduleCode": "CS5224", "moduleTitle": "Client title", **lesson}
            for lesson in json.loads(initial_body)["semesterData"][0]["timetable"]
        ],
    )
    client = NusmodsClient()

    assert len(validate_timetable(timetable, client).selections) == 2
    assert opener.call_count == 1
    request = opener.call_args.args[0]
    assert (
        request.full_url == "https://api.nusmods.com/v2/2026-2027/modules/CS5224.json"
    )
    assert opener.call_args.kwargs == {"timeout": 8}

    with pytest.raises(InvalidTimetableSelection, match="has no Lecture class 1"):
        validate_timetable(timetable, client)
    assert opener.call_count == 2


@pytest.mark.parametrize(
    "body",
    [b"not json", b"\xff", b"[]", b"{} " + b" " * MAX_RESPONSE_BYTES],
    ids=["invalid-json", "invalid-encoding", "non-object", "oversized"],
)
def test_unusable_http_response_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    body: bytes,
) -> None:
    monkeypatch.setattr(
        "app.modules.timetable.nusmods.urlopen", Mock(return_value=BytesIO(body))
    )

    with pytest.raises(NusmodsUnavailable):
        NusmodsClient().fetch_module("2026-2027", "CS5224")


@pytest.mark.parametrize(
    "error,expected",
    [
        (
            HTTPError("https://example.invalid", 404, "Not found", None, None),
            NusmodsModuleNotFound,
        ),
        (
            HTTPError("https://example.invalid", 500, "Server error", None, None),
            NusmodsUnavailable,
        ),
        (URLError("offline"), NusmodsUnavailable),
        (TimeoutError(), NusmodsUnavailable),
        (BadStatusLine("invalid status line"), NusmodsUnavailable),
    ],
)
def test_http_failures_are_classified(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected: type[Exception],
) -> None:
    monkeypatch.setattr(
        "app.modules.timetable.nusmods.urlopen", Mock(side_effect=error)
    )

    with pytest.raises(expected):
        NusmodsClient().fetch_module("2026-2027", "CS5224")

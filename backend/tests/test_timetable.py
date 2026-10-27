from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth import CurrentUser, get_current_user
from app.modules.timetable.api import (
    get_nusmods_client,
    repository_dependency,
)
from app.modules.timetable.nusmods import (
    NusmodsUnavailable,
)
from app.modules.timetable.repository import TimetableRepository
from app.modules.timetable.schemas import Timetable


class FakeRepository:
    def __init__(self) -> None:
        self.values: dict[str, Timetable] = {}

    def get(self, user_id: str) -> Timetable | None:
        return self.values.get(user_id)

    def save(
        self,
        user_id: str,
        timetable: Timetable,
    ) -> Timetable:
        self.values[user_id] = timetable
        return timetable

    def delete(self, user_id: str) -> None:
        self.values.pop(user_id, None)


class FakeNusmodsClient:
    unavailable = False

    def fetch_module(
        self,
        academic_year: str,
        module_code: str,
    ) -> dict[str, Any]:
        if self.unavailable:
            raise NusmodsUnavailable

        assert academic_year == "2026-2027"

        return {
            "moduleCode": module_code,
            "title": "Distributed Systems",
            "semesterData": [
                {
                    "semester": 1,
                    "timetable": [
                        {
                            "classNo": "1",
                            "lessonType": "Lecture",
                            "day": "Monday",
                            "startTime": "1000",
                            "endTime": "1200",
                            "venue": "COM1-0201",
                            "weeks": list(range(1, 14)),
                        },
                        {
                            "classNo": "02",
                            "lessonType": "Tutorial",
                            "day": "Wednesday",
                            "startTime": "1400",
                            "endTime": "1500",
                            "venue": "COM1-0201",
                            "weeks": list(range(1, 14)),
                        },
                    ],
                }
            ],
        }


@pytest.fixture
def dependencies() -> Iterator[
    tuple[FakeRepository, FakeNusmodsClient]
]:
    repository = FakeRepository()
    nusmods = FakeNusmodsClient()

    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id="test-user"
    )
    app.dependency_overrides[repository_dependency] = lambda: repository
    app.dependency_overrides[get_nusmods_client] = lambda: nusmods

    yield repository, nusmods

    app.dependency_overrides.clear()


@pytest.fixture
def client(
    dependencies: tuple[FakeRepository, FakeNusmodsClient],
) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def timetable_payload() -> dict[str, object]:
    return {
        "academicYear": "2026-2027",
        "semester": 1,
        "selections": [
            {
                "moduleCode": "CS5224",
                "moduleTitle": "Untrusted client title",
                "lessonType": "Lecture",
                "classNo": "1",
            }
        ],
    }


def test_missing_timetable_returns_not_found(
    client: TestClient,
) -> None:
    response = client.get("/timetable")

    assert response.status_code == 404


def test_put_validates_and_saves_canonical_timetable(
    client: TestClient,
    dependencies: tuple[FakeRepository, FakeNusmodsClient],
) -> None:
    repository, _ = dependencies

    response = client.put(
        "/timetable",
        json=timetable_payload(),
    )

    assert response.status_code == 200
    assert response.json() == {
        "academicYear": "2026-2027",
        "semester": 1,
        "selections": [
            {
                "moduleCode": "CS5224",
                "moduleTitle": "Distributed Systems",
                "lessonType": "Lecture",
                "classNo": "1",
            }
        ],
    }
    assert repository.values["test-user"].selections[
        0
    ].module_title == "Distributed Systems"


def test_saved_timetable_can_be_read(
    client: TestClient,
) -> None:
    saved = client.put(
        "/timetable",
        json=timetable_payload(),
    )

    response = client.get("/timetable")

    assert response.status_code == 200
    assert response.json() == saved.json()


def test_invalid_class_does_not_replace_existing_timetable(
    client: TestClient,
    dependencies: tuple[FakeRepository, FakeNusmodsClient],
) -> None:
    repository, _ = dependencies
    assert client.put(
        "/timetable",
        json=timetable_payload(),
    ).status_code == 200

    invalid = timetable_payload()
    invalid["selections"][0]["classNo"] = "999"  # type: ignore[index]

    response = client.put("/timetable", json=invalid)

    assert response.status_code == 422
    assert repository.values["test-user"].selections[0].class_no == "1"


def test_nusmods_outage_does_not_replace_existing_timetable(
    client: TestClient,
    dependencies: tuple[FakeRepository, FakeNusmodsClient],
) -> None:
    repository, nusmods = dependencies
    assert client.put(
        "/timetable",
        json=timetable_payload(),
    ).status_code == 200

    nusmods.unavailable = True
    response = client.put(
        "/timetable",
        json=timetable_payload(),
    )

    assert response.status_code == 503
    assert repository.values["test-user"].selections[0].class_no == "1"


def test_delete_timetable(
    client: TestClient,
) -> None:
    assert client.put(
        "/timetable",
        json=timetable_payload(),
    ).status_code == 200

    response = client.delete("/timetable")

    assert response.status_code == 204
    assert client.get("/timetable").status_code == 404


def test_duplicate_lesson_type_is_rejected(
    client: TestClient,
) -> None:
    payload = timetable_payload()
    payload["selections"] = [
        payload["selections"][0],  # type: ignore[index]
        payload["selections"][0],  # type: ignore[index]
    ]

    response = client.put("/timetable", json=payload)

    assert response.status_code == 422

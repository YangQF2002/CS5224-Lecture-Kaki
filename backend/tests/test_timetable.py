from collections.abc import Iterator
from http.client import HTTPResponse
from io import BytesIO
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock

import boto3
import pytest
from botocore.exceptions import NoCredentialsError
from fastapi.testclient import TestClient
from moto import mock_aws

from app.main import app
from app.modules.auth import CurrentUser, get_current_user
from app.modules.timetable.api import repository_dependency
from app.modules.timetable.nusmods import (
    NusmodsClient,
    NusmodsModuleNotFound,
    NusmodsUnavailable,
    get_nusmods_client,
)
from app.modules.timetable.repository import TimetableRepositoryUnavailable
from app.modules.timetable.schemas import Timetable


class FakeRepository:
    def __init__(self) -> None:
        self.values: dict[str, Timetable] = {}

    def get(self, user_id: str) -> Timetable | None:
        return self.values.get(user_id)

    def save(self, user_id: str, timetable: Timetable) -> Timetable:
        self.values[user_id] = timetable
        return timetable

    def delete(self, user_id: str) -> None:
        self.values.pop(user_id, None)


class FakeNusmodsClient:
    unavailable = False

    def fetch_module(self, academic_year: str, module_code: str) -> dict[str, Any]:
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
                        },
                        {
                            "classNo": "02",
                            "lessonType": "Tutorial",
                        },
                    ],
                }
            ],
        }


@pytest.fixture
def repository() -> FakeRepository:
    return FakeRepository()


@pytest.fixture
def nusmods() -> FakeNusmodsClient:
    return FakeNusmodsClient()


@pytest.fixture
def client(
    repository: FakeRepository, nusmods: FakeNusmodsClient
) -> Iterator[TestClient]:
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id="test-user"
    )
    app.dependency_overrides[repository_dependency] = lambda: repository
    app.dependency_overrides[get_nusmods_client] = lambda: nusmods

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def dynamodb_table(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[Any]:
    app.dependency_overrides.pop(repository_dependency)
    monkeypatch.setenv("TIMETABLE_TABLE_NAME", "timetables-test")
    monkeypatch.setenv("AWS_REGION", "ap-southeast-1")
    with mock_aws():
        table = (
            boto3.session.Session()
            .resource("dynamodb", region_name="ap-southeast-1")
            .create_table(
                TableName="timetables-test",
                KeySchema=[{"AttributeName": "user_id", "KeyType": "HASH"}],
                AttributeDefinitions=[
                    {"AttributeName": "user_id", "AttributeType": "S"}
                ],
                BillingMode="PAY_PER_REQUEST",
            )
        )
        yield table


def timetable_payload() -> dict[str, Any]:
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


def test_missing_timetable_returns_not_found(client: TestClient) -> None:
    response = client.get("/timetable")

    assert response.status_code == 404


def test_put_validates_and_saves_canonical_timetable(
    client: TestClient,
    repository: FakeRepository,
) -> None:
    response = client.put("/timetable", json=timetable_payload())

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
    assert (
        repository.values["test-user"].selections[0].module_title
        == "Distributed Systems"
    )


def test_invalid_class_does_not_replace_existing_timetable(
    client: TestClient,
    repository: FakeRepository,
) -> None:
    assert client.put("/timetable", json=timetable_payload()).status_code == 200

    invalid = timetable_payload()
    invalid["selections"][0]["classNo"] = "999"

    response = client.put("/timetable", json=invalid)

    assert response.status_code == 422
    assert repository.values["test-user"].selections[0].class_no == "1"


def test_nusmods_outage_does_not_replace_existing_timetable(
    client: TestClient,
    repository: FakeRepository,
    nusmods: FakeNusmodsClient,
) -> None:
    assert client.put("/timetable", json=timetable_payload()).status_code == 200

    nusmods.unavailable = True
    response = client.put("/timetable", json=timetable_payload())

    assert response.status_code == 503
    assert repository.values["test-user"].selections[0].class_no == "1"


def test_truncated_upstream_response_does_not_replace_saved_timetable(
    client: TestClient,
    repository: FakeRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    saved = client.put("/timetable", json=timetable_payload()).json()
    body = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n10\r\n{}\r\n"
    upstream = HTTPResponse(SimpleNamespace(makefile=lambda *_: BytesIO(body)))
    upstream.begin()
    app.dependency_overrides[get_nusmods_client] = NusmodsClient
    monkeypatch.setattr(
        "app.modules.timetable.nusmods.urlopen", Mock(return_value=upstream)
    )
    save = Mock(wraps=repository.save)
    monkeypatch.setattr(repository, "save", save)

    response = client.put("/timetable", json=timetable_payload())

    assert response.status_code == 503
    assert response.json() == {"detail": "NUSMods validation is unavailable"}
    assert repository.values["test-user"].model_dump(by_alias=True) == saved
    save.assert_not_called()


def test_duplicate_lesson_type_is_rejected(client: TestClient) -> None:
    payload = timetable_payload()
    payload["selections"] = [
        payload["selections"][0],
        payload["selections"][0],
    ]

    response = client.put("/timetable", json=payload)

    assert response.status_code == 422


@pytest.mark.parametrize(
    "changes",
    [
        {"moduleCode": "CS9999"},
        {"title": " "},
        {"title": "x" * 301},
        {"semesterData": None},
        {"semesterData": [None]},
        {"semesterData": [{"semester": "1", "timetable": []}]},
        {"semesterData": [{"semester": True, "timetable": []}]},
        {"semesterData": [{"semester": 1, "timetable": None}]},
        {"semesterData": [{"semester": 1, "timetable": [None]}]},
        {"semesterData": [{"semester": 1, "timetable": [{"classNo": "1"}]}]},
    ],
)
def test_malformed_upstream_does_not_replace_saved_timetable(
    client: TestClient,
    repository: FakeRepository,
    nusmods: FakeNusmodsClient,
    monkeypatch: pytest.MonkeyPatch,
    changes: dict[str, Any],
) -> None:
    saved = client.put("/timetable", json=timetable_payload()).json()
    module = nusmods.fetch_module("2026-2027", "CS5224")
    module.update(changes)
    monkeypatch.setattr(nusmods, "fetch_module", lambda *_: module)

    response = client.put("/timetable", json=timetable_payload())

    assert response.status_code == 503
    assert response.json() == {"detail": "NUSMods validation is unavailable"}
    assert repository.values["test-user"].model_dump(by_alias=True) == saved


@pytest.mark.parametrize("semester_data", [[], [{"semester": 1, "timetable": []}]])
def test_valid_upstream_without_requested_offering_returns_422(
    client: TestClient,
    repository: FakeRepository,
    nusmods: FakeNusmodsClient,
    monkeypatch: pytest.MonkeyPatch,
    semester_data: list[dict[str, Any]],
) -> None:
    saved = client.put("/timetable", json=timetable_payload()).json()
    module = nusmods.fetch_module("2026-2027", "CS5224")
    module["semesterData"] = semester_data
    monkeypatch.setattr(nusmods, "fetch_module", lambda *_: module)

    response = client.put("/timetable", json=timetable_payload())

    assert response.status_code == 422
    assert repository.values["test-user"].model_dump(by_alias=True) == saved


def test_missing_upstream_module_returns_422(
    client: TestClient,
    repository: FakeRepository,
    nusmods: FakeNusmodsClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        nusmods, "fetch_module", Mock(side_effect=NusmodsModuleNotFound)
    )

    assert client.put("/timetable", json=timetable_payload()).status_code == 422
    assert repository.values == {}


@pytest.mark.parametrize(
    "method,operation", [("get", "get"), ("put", "save"), ("delete", "delete")]
)
def test_storage_outage_returns_503(
    client: TestClient,
    repository: FakeRepository,
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    operation: str,
) -> None:
    monkeypatch.setattr(
        repository, operation, Mock(side_effect=TimetableRepositoryUnavailable)
    )

    response = client.request(
        method, "/timetable", json=timetable_payload() if method == "put" else None
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "Timetable storage is unavailable"}


def test_aws_initialization_failure_returns_503(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app.dependency_overrides.pop(repository_dependency)
    monkeypatch.setenv("TIMETABLE_TABLE_NAME", "timetables-test")
    monkeypatch.setattr(
        "app.modules.timetable.repository.boto3.session.Session",
        Mock(side_effect=NoCredentialsError),
    )

    response = client.get("/timetable")

    assert response.status_code == 503
    assert response.json() == {"detail": "Timetable storage is unavailable"}


@pytest.mark.parametrize("method", ["GET", "PUT", "DELETE"])
def test_missing_token_is_rejected_before_storage(
    monkeypatch: pytest.MonkeyPatch,
    method: str,
) -> None:
    factory = Mock(side_effect=AssertionError("storage must not be accessed"))
    monkeypatch.setattr("app.modules.timetable.api.get_timetable_repository", factory)

    with TestClient(app) as client:
        response = client.request(
            method, "/timetable", json=timetable_payload() if method == "PUT" else None
        )

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    factory.assert_not_called()


def test_real_storage_round_trip_and_user_isolation(
    client: TestClient,
    dynamodb_table: Any,
) -> None:
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id="alice")
    alice_saved = client.put("/timetable", json=timetable_payload())
    assert alice_saved.status_code == 200
    assert client.get("/timetable").json() == alice_saved.json()
    assert (
        dynamodb_table.get_item(Key={"user_id": "alice"})["Item"]["timetable"]
        == alice_saved.json()
    )

    app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id="bob")
    assert client.get("/timetable").status_code == 404
    assert client.delete("/timetable").status_code == 204
    bob_payload = timetable_payload()
    bob_payload["selections"][0].update(lessonType="Tutorial", classNo="02")
    bob_saved = client.put("/timetable", json=bob_payload)
    assert bob_saved.status_code == 200
    assert bob_saved.json() != alice_saved.json()
    assert client.get("/timetable").json() == bob_saved.json()

    app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id="alice")
    assert client.get("/timetable").json() == alice_saved.json()
    assert client.delete("/timetable").status_code == 204
    assert client.get("/timetable").status_code == 404

    app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id="bob")
    assert client.get("/timetable").json() == bob_saved.json()


def test_put_replaces_and_clears_existing_timetable(
    client: TestClient,
    dynamodb_table: Any,
    nusmods: FakeNusmodsClient,
) -> None:
    assert client.put("/timetable", json=timetable_payload()).status_code == 200
    replacement = {
        "academicYear": "2026-2027",
        "semester": 1,
        "selections": [
            {
                "moduleCode": "CS5224",
                "moduleTitle": "Distributed Systems",
                "lessonType": "Tutorial",
                "classNo": "02",
            }
        ],
    }

    response = client.put("/timetable", json=replacement)

    assert response.status_code == 200
    assert response.json() == replacement
    stored = client.get("/timetable")
    assert stored.status_code == 200
    assert stored.json() == replacement

    nusmods.unavailable = True
    empty = {"academicYear": "2026-2027", "semester": 1, "selections": []}

    response = client.put("/timetable", json=empty)

    assert response.status_code == 200
    assert response.json() == empty
    stored = client.get("/timetable")
    assert stored.status_code == 200
    assert stored.json() == empty

from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError, NoCredentialsError, PartialCredentialsError

from app.modules.timetable.repository import (
    TimetableRepository,
    TimetableRepositoryUnavailable,
    get_timetable_repository,
)
from app.modules.timetable.schemas import Timetable


@pytest.mark.parametrize("operation", ["get", "save", "delete"])
@pytest.mark.parametrize(
    "error",
    [
        NoCredentialsError(),
        ClientError(
            {"Error": {"Code": "AccessDeniedException", "Message": "denied"}},
            "DynamoDB",
        ),
    ],
)
def test_sdk_operation_failures_are_translated(
    operation: str, error: Exception
) -> None:
    table = Mock()
    getattr(
        table,
        {"get": "get_item", "save": "put_item", "delete": "delete_item"}[operation],
    ).side_effect = error
    repository = TimetableRepository(table)
    with pytest.raises(TimetableRepositoryUnavailable):
        if operation == "save":
            repository.save(
                "alice", Timetable(academicYear="2026-2027", semester=1, selections=[])
            )
        else:
            getattr(repository, operation)("alice")


def test_partial_credentials_during_construction_are_translated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TIMETABLE_TABLE_NAME", "timetables-test")
    session = Mock()
    session.resource.side_effect = PartialCredentialsError(
        provider="env", cred_var="AWS_SECRET_ACCESS_KEY"
    )
    monkeypatch.setattr(
        "app.modules.timetable.repository.boto3.session.Session",
        Mock(return_value=session),
    )

    with pytest.raises(TimetableRepositoryUnavailable):
        get_timetable_repository()


def test_missing_table_configuration_fails_before_sdk_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TIMETABLE_TABLE_NAME", raising=False)
    session = Mock(side_effect=AssertionError("SDK must not be accessed"))
    monkeypatch.setattr(
        "app.modules.timetable.repository.boto3.session.Session", session
    )

    with pytest.raises(TimetableRepositoryUnavailable):
        get_timetable_repository()
    session.assert_not_called()

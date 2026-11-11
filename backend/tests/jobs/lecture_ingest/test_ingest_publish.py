import json
from datetime import UTC, date, datetime
from unittest.mock import Mock

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from jobs.lecture_ingest import handler as ingest_handler
from jobs.lecture_ingest.academic_calendar import SEMESTERS, week_label
from jobs.lecture_ingest.publish import SMALL_NEW_SEMESTER, SuspiciousDataError, publish
from jobs.lecture_ingest.transform import build_modules, build_sessions

BUCKET = "lecturekaki-test-web"
NOW = datetime(2026, 10, 18, 19, 0, tzinfo=UTC)


@pytest.fixture
def s3(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-southeast-1")
    with mock_aws():
        client = boto3.client("s3", region_name="ap-southeast-1")
        client.create_bucket(
            Bucket=BUCKET,
            CreateBucketConfiguration={"LocationConstraint": "ap-southeast-1"},
        )
        yield client


@pytest.fixture
def data(module_info, venue_info, sem1):
    sessions = build_sessions(module_info, venue_info, sem1)
    return sessions, build_modules(module_info, sessions)


def read(s3, key):
    return json.load(s3.get_object(Bucket=BUCKET, Key=key)["Body"])


def objects(s3, prefix=""):
    return {
        item["Key"]: s3.get_object(Bucket=BUCKET, Key=item["Key"])["Body"].read()
        for page in s3.get_paginator("list_objects_v2").paginate(
            Bucket=BUCKET, Prefix=prefix
        )
        for item in page.get("Contents", [])
    }


def test_first_run_publishes_complete_snapshot(s3, sem1, data):
    sessions, modules = data
    result = publish(s3, BUCKET, sem1, sessions, modules, NOW)
    prefix = result["path"]
    index = read(s3, f"{prefix}index.json")

    assert prefix.startswith("lectures/2026-2027/sem-1/")
    assert read(s3, "lectures/current.json")["path"] == prefix
    assert index["sessionCount"] == len(sessions)
    assert index["lessonTypes"] == {"Lecture": "LEC"}
    assert index["generatedAt"] == "2026-10-18T19:00:00Z"
    assert index["days"] == sorted({s["date"] for s in sessions})
    assert {week["week"] for week in index["weeks"]} == {
        week_label(sem1, date.fromisoformat(s["date"])) for s in sessions
    }
    for day in index["days"]:
        assert read(s3, f"{prefix}days/{day}.json")["sessions"] == [
            s for s in sessions if s["date"] == day
        ]
    for week in index["weeks"]:
        document = read(s3, f"{prefix}weeks/{week['week']}.json")
        assert (document["week"], document["startDate"], document["endDate"]) == (
            week["week"],
            week["startDate"],
            week["endDate"],
        )
        expected = [
            s for s in sessions if week["startDate"] <= s["date"] <= week["endDate"]
        ]
        assert document["sessions"] == expected
        assert week["sessionCount"] == len(expected)
    assert read(s3, f"{prefix}modules.json")["items"] == modules
    assert (
        s3.head_object(Bucket=BUCKET, Key="lectures/current.json")["CacheControl"]
        == "no-cache"
    )


def test_republication_switches_pointer_and_preserves_previous_snapshot(s3, sem1, data):
    sessions, modules = data
    first = publish(s3, BUCKET, sem1, sessions, modules, NOW)
    before = objects(s3, first["path"])
    remaining = [s for s in sessions if s["date"] != "2026-10-13"]
    second = publish(s3, BUCKET, sem1, remaining, modules, NOW)

    assert first["path"] != second["path"]
    assert read(s3, "lectures/current.json")["path"] == second["path"]
    assert objects(s3, first["path"]) == before
    assert "2026-10-13" not in read(s3, f"{second['path']}index.json")["days"]
    assert f"{second['path']}days/2026-10-13.json" not in objects(s3, second["path"])


LATER = datetime(2026, 10, 25, 19, 0, tzinfo=UTC)


def test_unchanged_data_only_records_the_check(s3, sem1, data):
    sessions, modules = data
    first = publish(s3, BUCKET, sem1, sessions, modules, NOW)
    pointer = read(s3, "lectures/current.json")
    snapshot = {k: v for k, v in objects(s3).items() if k != "lectures/current.json"}

    second = publish(s3, BUCKET, sem1, sessions, modules, LATER)

    assert second["unchanged"] and second["path"] == first["path"]
    # No snapshot files were written or changed.
    assert {
        k: v for k, v in objects(s3).items() if k != "lectures/current.json"
    } == snapshot
    current = read(s3, "lectures/current.json")
    assert current["path"] == pointer["path"]
    assert current["generatedAt"] == pointer["generatedAt"]
    assert current["contentHash"] == pointer["contentHash"]
    assert current["checkedAt"] == "2026-10-25T19:00:00Z"


def test_changed_data_publishes_a_new_snapshot(s3, sem1, data):
    sessions, modules = data
    first = publish(s3, BUCKET, sem1, sessions, modules, NOW)
    changed = [{**sessions[0], "venue": "LT99"}, *sessions[1:]]

    second = publish(s3, BUCKET, sem1, changed, modules, LATER)

    assert "unchanged" not in second and second["path"] != first["path"]
    current = read(s3, "lectures/current.json")
    assert current["path"] == second["path"]
    assert (
        current["contentHash"] != read(s3, f"{first['path']}index.json")["contentHash"]
    )
    assert (
        current["contentHash"] == read(s3, f"{second['path']}index.json")["contentHash"]
    )


def test_topic_changes_count_as_changes(s3, sem1, data):
    sessions, modules = data
    publish(s3, BUCKET, sem1, sessions, modules, NOW)
    retagged = [{**modules[0], "topics": ["Other"]}, *modules[1:]]
    assert "unchanged" not in publish(s3, BUCKET, sem1, sessions, retagged, LATER)


def test_force_republishes_unchanged_data(s3, sem1, data):
    sessions, modules = data
    first = publish(s3, BUCKET, sem1, sessions, modules, NOW)
    second = publish(s3, BUCKET, sem1, sessions, modules, LATER, force=True)
    assert "unchanged" not in second and second["path"] != first["path"]


def test_pointer_from_before_fingerprints_is_republished_once(s3, sem1, data):
    sessions, modules = data
    publish(s3, BUCKET, sem1, sessions, modules, NOW)
    legacy = read(s3, "lectures/current.json")
    for field in ("contentHash", "checkedAt"):
        legacy.pop(field)
    s3.put_object(
        Bucket=BUCKET, Key="lectures/current.json", Body=json.dumps(legacy).encode()
    )

    assert "unchanged" not in publish(s3, BUCKET, sem1, sessions, modules, LATER)
    assert publish(s3, BUCKET, sem1, sessions, modules, LATER)["unchanged"]


@pytest.mark.parametrize("failure", ["snapshot-file", "current-pointer"])
def test_failed_upload_preserves_published_snapshot(
    s3, sem1, data, monkeypatch, failure
):
    sessions, modules = data
    first = publish(s3, BUCKET, sem1, sessions, modules, NOW)
    pointer = read(s3, "lectures/current.json")
    before = objects(s3, first["path"])
    put = s3.put_object
    calls = 0

    def fail_upload(**kwargs):
        nonlocal calls
        calls += 1
        if (failure == "snapshot-file" and calls == 2) or (
            failure == "current-pointer" and kwargs["Key"] == "lectures/current.json"
        ):
            raise ClientError({"Error": {"Code": "ServiceUnavailable"}}, "PutObject")
        return put(**kwargs)

    monkeypatch.setattr(s3, "put_object", fail_upload)
    changed = [{**s, "venue": "UPDATED"} for s in sessions]
    with pytest.raises(ClientError):
        publish(s3, BUCKET, sem1, changed, modules, NOW)

    assert read(s3, "lectures/current.json") == pointer
    assert objects(s3, first["path"]) == before


def test_big_drop_preserves_all_previous_content(s3, sem1, data):
    sessions, modules = data
    publish(s3, BUCKET, sem1, sessions, modules, NOW)
    before = objects(s3)

    with pytest.raises(SuspiciousDataError):
        publish(s3, BUCKET, sem1, sessions[:10], modules, NOW)

    assert objects(s3) == before


def as_semester(sessions, source, target):
    """The same lectures moved into another semester's dates."""
    shift = target.week1_monday - source.week1_monday
    return [
        {**session, "date": (date.fromisoformat(session["date"]) + shift).isoformat()}
        for session in sessions
    ]


def test_small_new_semester_is_published_with_a_warning(s3, sem1, data, caplog):
    sessions, modules = data
    publish(s3, BUCKET, sem1, sessions, modules, NOW)
    sem2 = SEMESTERS[("2026-2027", 2)]
    few = as_semester(sessions[: len(sessions) // 2 - 1], sem1, sem2)

    with caplog.at_level("WARNING"):
        result = publish(s3, BUCKET, sem2, few, modules, NOW)

    assert read(s3, "lectures/current.json")["semester"] == 2
    assert result["path"] == read(s3, "lectures/current.json")["path"]
    assert "under half" in result["warning"]
    # The CloudWatch metric filter counts this token in the ingest logs.
    assert [r for r in caplog.records if SMALL_NEW_SEMESTER in r.getMessage()]


def test_new_semester_of_similar_size_has_no_warning(s3, sem1, data, caplog):
    sessions, modules = data
    publish(s3, BUCKET, sem1, sessions, modules, NOW)
    sem2 = SEMESTERS[("2026-2027", 2)]

    with caplog.at_level("WARNING"):
        result = publish(
            s3, BUCKET, sem2, as_semester(sessions, sem1, sem2), modules, NOW
        )

    assert "warning" not in result
    assert not [r for r in caplog.records if SMALL_NEW_SEMESTER in r.getMessage()]


def test_empty_dataset_does_not_write(s3, sem1):
    with pytest.raises(SuspiciousDataError):
        publish(s3, BUCKET, sem1, [], [], NOW)
    assert objects(s3) == {}


def test_handler(s3, monkeypatch, module_info, venue_info, data):
    monkeypatch.setenv("WEB_BUCKET", BUCKET)
    fetch = Mock(return_value=(module_info, venue_info))
    monkeypatch.setattr(ingest_handler, "fetch_semester", fetch)
    result = ingest_handler.handler({"date": "2026-10-19"}, None, s3=s3, now=NOW)

    fetch.assert_called_once_with("2026-2027", 1)
    assert result["sessions"] == len(data[0])
    assert read(s3, f"{result['path']}modules.json")["items"] == data[1]


def test_handler_skips_unchanged_data_unless_forced(
    s3, monkeypatch, module_info, venue_info
):
    monkeypatch.setenv("WEB_BUCKET", BUCKET)
    fetch = Mock(return_value=(module_info, venue_info))
    monkeypatch.setattr(ingest_handler, "fetch_semester", fetch)
    run = {"date": "2026-10-19"}
    first = ingest_handler.handler(run, None, s3=s3, now=NOW)

    assert ingest_handler.handler(run, None, s3=s3, now=LATER)["unchanged"]
    forced = ingest_handler.handler({**run, "force": True}, None, s3=s3, now=LATER)
    assert "unchanged" not in forced and forced["path"] != first["path"]


@pytest.mark.parametrize(
    "failure",
    [
        OSError("upstream unavailable"),
        json.JSONDecodeError("invalid JSON", "<html>", 0),
    ],
    ids=["network-error", "invalid-json"],
)
def test_fetch_failure_preserves_existing_data(s3, sem1, data, monkeypatch, failure):
    publish(s3, BUCKET, sem1, *data, NOW)
    before = objects(s3)
    monkeypatch.setattr(ingest_handler, "fetch_semester", Mock(side_effect=failure))
    monkeypatch.setenv("WEB_BUCKET", BUCKET)

    with pytest.raises(type(failure)):
        ingest_handler.handler({"date": "2026-10-19"}, None, s3=s3, now=NOW)

    assert objects(s3) == before


def test_empty_catalogue_preserves_existing_data(
    s3, sem1, data, venue_info, monkeypatch
):
    publish(s3, BUCKET, sem1, *data, NOW)
    before = objects(s3)
    monkeypatch.setattr(
        ingest_handler, "fetch_semester", Mock(return_value=([], venue_info))
    )
    monkeypatch.setenv("WEB_BUCKET", BUCKET)

    with pytest.raises(ValueError, match="empty module catalogue"):
        ingest_handler.handler({"date": "2026-10-19"}, None, s3=s3, now=NOW)

    assert objects(s3) == before


@pytest.mark.parametrize(
    ("now", "due"),
    [
        pytest.param(
            datetime(2026, 10, 4, 19, tzinfo=UTC), True, id="first-monday-sgt"
        ),
        pytest.param(
            datetime(2026, 10, 18, 19, tzinfo=UTC), False, id="later-monday-sgt"
        ),
    ],
)
def test_scheduled_run_uses_singapore_date(
    s3, monkeypatch, module_info, venue_info, now, due
):
    monkeypatch.setenv("WEB_BUCKET", BUCKET)
    fetch = Mock(return_value=(module_info, venue_info))
    monkeypatch.setattr(ingest_handler, "fetch_semester", fetch)

    result = ingest_handler.handler({}, None, s3=s3, now=now)

    if due:
        fetch.assert_called_once_with("2026-2027", 1)
        assert read(s3, "lectures/current.json")["path"] == result["path"]
    else:
        fetch.assert_not_called()
        assert objects(s3) == {}
        assert result == {
            "semester": "2026-2027/sem-1",
            "skipped": "not due on 2026-10-19",
        }

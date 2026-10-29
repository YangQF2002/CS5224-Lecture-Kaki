import json
from datetime import UTC, date, datetime
from unittest.mock import Mock

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from jobs.lecture_ingest import handler as ingest_handler
from jobs.lecture_ingest.academic_calendar import week_label
from jobs.lecture_ingest.publish import SuspiciousDataError, publish
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

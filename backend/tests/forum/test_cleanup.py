"""Closed rooms' PDFs are deleted together, every version, by the weekly job."""

from datetime import datetime, timedelta, timezone

import boto3
import pytest
from moto import mock_aws

from app.aws_lambda import cleanup_handler
from app.modules.forum.cleanup import delete_closed_pdfs
from app.modules.forum.service import pdf_folder

REGION = "ap-southeast-1"
BUCKET = "forum-pdfs-test"
SINGAPORE = timezone(timedelta(hours=8))


@pytest.fixture
def s3(monkeypatch):
    monkeypatch.setenv("AWS_REGION", REGION)
    monkeypatch.setenv("FORUM_ATTACHMENTS_BUCKET", BUCKET)
    for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        monkeypatch.setenv(name, "testing")
    with mock_aws():
        client = boto3.client("s3", region_name=REGION)
        client.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION}
        )
        client.put_bucket_versioning(
            Bucket=BUCKET, VersioningConfiguration={"Status": "Enabled"}
        )
        yield client


def keys(client):
    listing = client.list_object_versions(Bucket=BUCKET)
    entries = listing.get("Versions", []) + listing.get("DeleteMarkers", [])
    return sorted(entry["Key"] for entry in entries)


def test_pdf_folder_is_the_rooms_closing_monday():
    room = "BT1101-LEC-1@2030-10-22-0800-LT11@2026-2027@1"
    assert pdf_folder(room) == "2030-10-28"


def test_deletes_every_version_of_closed_rooms_and_keeps_open_ones(s3):
    closed = "uploads/2030-10-28/a.pdf"
    for _ in range(2):  # Two versions of the same key.
        s3.put_object(Bucket=BUCKET, Key=closed, Body=b"%PDF")
    s3.put_object(Bucket=BUCKET, Key="uploads/2030-10-28/b.pdf", Body=b"%PDF")
    s3.delete_object(Bucket=BUCKET, Key="uploads/2030-10-28/b.pdf")  # Marker.
    s3.put_object(Bucket=BUCKET, Key="uploads/legacy.pdf", Body=b"%PDF")
    s3.put_object(Bucket=BUCKET, Key="uploads/2030-11-04/open.pdf", Body=b"%PDF")

    before_close = datetime(2030, 10, 27, 23, 59, tzinfo=SINGAPORE)
    assert delete_closed_pdfs(before_close) == {"deleted": 1, "failed": 0}
    assert "uploads/legacy.pdf" not in keys(s3)
    assert closed in keys(s3)

    at_close = datetime(2030, 10, 28, 0, 5, tzinfo=SINGAPORE)
    assert delete_closed_pdfs(at_close) == {"deleted": 4, "failed": 0}
    assert keys(s3) == ["uploads/2030-11-04/open.pdf"]


def test_handler_runs_the_cleanup(s3):
    assert cleanup_handler({}, None) == {"deleted": 0, "failed": 0}

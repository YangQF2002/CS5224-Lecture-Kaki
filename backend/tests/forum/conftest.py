"""Offline Forum fixtures with real JWT validation and simulated DynamoDB."""

import json
from io import BytesIO
from time import time
from types import SimpleNamespace
from urllib.parse import parse_qs, quote, urlparse

import boto3
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from moto import mock_aws
from pypdf import PdfWriter

from app.main import app
from app.modules.auth.dependencies import _get_jwks_client
from app.modules.forum import attachment_store as store
from app.modules.forum import repository

REGION = "ap-southeast-1"
POOL = "ap-southeast-1_ForumPool"
CLIENT = "forumclient"


@pytest.fixture(scope="module")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def auth(signing_key):
    def headers(user="student-a"):
        token = jwt.encode(
            {
                "iss": f"https://cognito-idp.{REGION}.amazonaws.com/{POOL}",
                "client_id": CLIENT,
                "token_use": "access",
                "sub": user,
                "exp": int(time()) + 900,
            },
            signing_key,
            algorithm="RS256",
            headers={"kid": "forum-key"},
        )
        return {"Authorization": f"Bearer {token}"}

    return headers


@pytest.fixture
def table(monkeypatch):
    settings = {
        "AWS_REGION": REGION,
        "AWS_DEFAULT_REGION": REGION,
        "COGNITO_USER_POOL_ID": POOL,
        "COGNITO_CLIENT_ID": CLIENT,
        "DYNAMODB_TABLE": "forum-test",
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_SESSION_TOKEN": "testing",
        "AWS_EC2_METADATA_DISABLED": "true",
    }
    for name, value in settings.items():
        monkeypatch.setenv(name, value)
    for name in ("AWS_PROFILE", "AWS_DEFAULT_PROFILE"):
        monkeypatch.delenv(name, raising=False)
    with mock_aws():
        yield boto3.resource("dynamodb", region_name=REGION).create_table(
            TableName="forum-test",
            BillingMode="PAY_PER_REQUEST",
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": name, "AttributeType": "S"} for name in ("PK", "SK")
            ],
        )


@pytest.fixture
def client(table, signing_key, monkeypatch):
    public = jwt.algorithms.RSAAlgorithm.to_jwk(signing_key.public_key(), as_dict=True)
    body = json.dumps(
        {"keys": [{**public, "kid": "forum-key", "alg": "RS256"}]}
    ).encode()
    monkeypatch.setattr(
        "jwt.jwks_client.urllib.request.build_opener",
        lambda *_: SimpleNamespace(open=lambda *args, **kwargs: BytesIO(body)),
    )
    table_fixture = table
    monkeypatch.setattr(repository, "get_table", lambda table=None: table_fixture)
    _get_jwks_client.cache_clear()
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        _get_jwks_client.cache_clear()


@pytest.fixture
def pdf(client, auth, monkeypatch):
    """A private versioned PDF upload shared by HTTP and live-delivery tests."""
    monkeypatch.setenv("FORUM_ATTACHMENTS_BUCKET", "forum-pdfs-test")
    bucket = boto3.client("s3", region_name=REGION)
    bucket.create_bucket(
        Bucket="forum-pdfs-test",
        CreateBucketConfiguration={"LocationConstraint": REGION},
    )
    bucket.put_bucket_versioning(
        Bucket="forum-pdfs-test", VersioningConfiguration={"Status": "Enabled"}
    )
    room = "QT5101-LEC-1@2030-10-22-1600-CQT/SR0514@2026-2027@1"
    base = f"/rooms/{quote(room, safe='')}"
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    data = BytesIO()
    writer.write(data)
    example = data.getvalue()

    def upload(data=None, content_type="application/pdf"):
        data = example if data is None else data
        response = client.post(
            f"{base}/attachment-uploads",
            json={"filename": "lecture.pdf", "size": len(data)},
            headers=auth(),
        )
        assert response.status_code == 201, response.text
        item = response.json()
        signed = parse_qs(urlparse(item["url"]).query)
        assert "content-length" in signed["X-Amz-SignedHeaders"][0]
        assert "if-none-match" in signed["X-Amz-SignedHeaders"][0]
        assert item["headers"] == {
            "Content-Type": "application/pdf",
            "If-None-Match": "*",
        }
        key = store.get_upload(item["upload_id"])["key"]
        result = bucket.put_object(
            Bucket="forum-pdfs-test",
            Key=key,
            Body=data,
            ContentType=content_type,
            IfNoneMatch="*",
        )
        return item["upload_id"], key, result["VersionId"]

    def post(upload_id, user="student-a"):
        return client.post(
            f"{base}/messages",
            json={"content": "", "attachment_id": upload_id},
            headers=auth(user),
        )

    return SimpleNamespace(
        room=room, base=base, bucket=bucket, data=example, upload=upload, post=post
    )

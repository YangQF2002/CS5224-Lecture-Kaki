"""Offline Forum fixtures with real JWT validation and simulated DynamoDB."""

import json
from io import BytesIO
from time import time
from types import SimpleNamespace

import boto3
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from moto import mock_aws

from app.main import app
from app.modules.auth.dependencies import _get_jwks_client
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

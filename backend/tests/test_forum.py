"""Offline forum tests using moto's in-process DynamoDB mock."""

import os
from collections.abc import Iterator
from time import time

import boto3
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from moto import mock_aws

from app.main import app
from app.modules.auth.dependencies import _get_jwks_client
from app.modules.forum import repository

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REGION = "ap-southeast-1"
POOL_ID = "ap-southeast-1_ForumPool"
CLIENT_ID = "forumclient"
ISSUER = f"https://cognito-idp.{REGION}.amazonaws.com/{POOL_ID}"
TABLE = "lecturekaki-dev-forum"

VALID_ROOM = "BT1101-LEC-1@2026-10-20-0800-LT11@2026-2027@1"
OTHER_ROOM = "CS5224-LEC-1@2026-10-21-1000-COM1-0207@2026-2027@1"
USER_A = "user-a-sub"
USER_B = "user-b-sub"

# ---------------------------------------------------------------------------
# Auth helpers (mirrors test_auth.py pattern)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _make_token(key: rsa.RSAPrivateKey, sub: str) -> str:
    now = int(time())
    claims = {
        "iss": ISSUER,
        "client_id": CLIENT_ID,
        "token_use": "access",
        "sub": sub,
        "iat": now,
        "exp": now + 900,
    }
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "forum-key"})


@pytest.fixture(autouse=True)
def auth_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_REGION", REGION)
    monkeypatch.setenv("COGNITO_USER_POOL_ID", POOL_ID)
    monkeypatch.setenv("COGNITO_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("DYNAMODB_TABLE", TABLE)
    _get_jwks_client.cache_clear()
    yield
    _get_jwks_client.cache_clear()


# ---------------------------------------------------------------------------
# DynamoDB mock fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def ddb_table():
    """Create an in-process moto DynamoDB table for each test."""
    with mock_aws():
        os.environ.setdefault("AWS_DEFAULT_REGION", REGION)
        # moto requires dummy credentials
        os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
        os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
        os.environ.setdefault("AWS_SECURITY_TOKEN", "testing")
        os.environ.setdefault("AWS_SESSION_TOKEN", "testing")

        ddb = boto3.resource("dynamodb", region_name=REGION)
        table = ddb.create_table(
            TableName=TABLE,
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield table


@pytest.fixture
def client(
    ddb_table, signing_key: rsa.RSAPrivateKey, monkeypatch: pytest.MonkeyPatch
) -> Iterator[TestClient]:
    """TestClient with moto table injected and JWKS mocked."""
    import json
    from io import BytesIO
    from types import SimpleNamespace

    pub = jwt.algorithms.RSAAlgorithm.to_jwk(signing_key.public_key(), as_dict=True)
    jwks_bytes = json.dumps(
        {"keys": [{**pub, "kid": "forum-key", "alg": "RS256", "use": "sig"}]}
    ).encode()

    monkeypatch.setattr(
        "jwt.jwks_client.urllib.request.build_opener",
        lambda *_: SimpleNamespace(open=lambda req, timeout: BytesIO(jwks_bytes)),
    )

    # Patching get_table here covers both api.py and service.py since
    # service.py imports repository at module level.
    monkeypatch.setattr(repository, "get_table", lambda table=None: ddb_table)

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def auth(key: rsa.RSAPrivateKey, sub: str) -> dict:
    return {"Authorization": f"Bearer {_make_token(key, sub)}"}


def post_msg(client, room: str, content: str, key, sub: str) -> dict:
    r = client.post(
        f"/rooms/{room}/messages", json={"content": content}, headers=auth(key, sub)
    )
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# 1. Authentication required
# ---------------------------------------------------------------------------


def test_post_requires_auth(client: TestClient) -> None:
    r = client.post(f"/rooms/{VALID_ROOM}/messages", json={"content": "hi"})
    assert r.status_code == 401


def test_get_requires_auth(client: TestClient) -> None:
    r = client.get(f"/rooms/{VALID_ROOM}/messages")
    assert r.status_code == 401


def test_delete_requires_auth(client: TestClient) -> None:
    r = client.delete(f"/rooms/{VALID_ROOM}/messages/fake-id")
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# 2. room_id validation on all three endpoints
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_room",
    [
        "BT1101-LEC-1@2026-10-20-0800-LT11",  # missing acadYear+semester
        "BT1101-TUT-1@2026-10-20-0800-LT11@2026-2027@1",  # not LEC
        "bt1101-LEC-1@2026-10-20-0800-LT11@2026-2027@1",  # lowercase module
        "BT1101-LEC-1@2026-10-20-0800-LT11@2026-2027@5",  # semester 5
        "",
    ],
)
def test_invalid_room_id_rejected(
    client: TestClient, signing_key, bad_room: str
) -> None:
    headers = auth(signing_key, USER_A)
    if bad_room:
        assert (
            client.post(
                f"/rooms/{bad_room}/messages", json={"content": "x"}, headers=headers
            ).status_code
            == 422
        )
        assert (
            client.get(f"/rooms/{bad_room}/messages", headers=headers).status_code
            == 422
        )
        assert (
            client.delete(f"/rooms/{bad_room}/messages/x", headers=headers).status_code
            == 422
        )


# ---------------------------------------------------------------------------
# 3. Post and read
# ---------------------------------------------------------------------------


def test_post_returns_201_with_message(client: TestClient, signing_key) -> None:
    msg = post_msg(client, VALID_ROOM, "Hello forum", signing_key, USER_A)
    assert msg["author_id"] == USER_A
    assert msg["content"] == "Hello forum"
    assert msg["room_id"] == VALID_ROOM
    assert "message_id" in msg
    assert "posted_at" in msg
    assert "expires_at" in msg


def test_author_id_from_token_not_body(client: TestClient, signing_key) -> None:
    r = client.post(
        f"/rooms/{VALID_ROOM}/messages",
        json={"content": "spoof", "author_id": "attacker"},
        headers=auth(signing_key, USER_A),
    )
    assert r.status_code == 201
    assert r.json()["author_id"] == USER_A


def test_get_returns_posted_messages(client: TestClient, signing_key) -> None:
    post_msg(client, VALID_ROOM, "first", signing_key, USER_A)
    post_msg(client, VALID_ROOM, "second", signing_key, USER_B)

    r = client.get(f"/rooms/{VALID_ROOM}/messages", headers=auth(signing_key, USER_A))
    assert r.status_code == 200
    contents = [m["content"] for m in r.json()["items"]]
    assert "first" in contents
    assert "second" in contents


# ---------------------------------------------------------------------------
# 4. Content validation
# ---------------------------------------------------------------------------


def test_empty_content_rejected(client: TestClient, signing_key) -> None:
    r = client.post(
        f"/rooms/{VALID_ROOM}/messages",
        json={"content": "   "},
        headers=auth(signing_key, USER_A),
    )
    assert r.status_code == 422


def test_content_too_long_rejected(client: TestClient, signing_key) -> None:
    r = client.post(
        f"/rooms/{VALID_ROOM}/messages",
        json={"content": "x" * 501},
        headers=auth(signing_key, USER_A),
    )
    assert r.status_code == 422


def test_content_exactly_500_accepted(client: TestClient, signing_key) -> None:
    r = client.post(
        f"/rooms/{VALID_ROOM}/messages",
        json={"content": "x" * 500},
        headers=auth(signing_key, USER_A),
    )
    assert r.status_code == 201


# ---------------------------------------------------------------------------
# 5. Room isolation
# ---------------------------------------------------------------------------


def test_room_isolation(client: TestClient, signing_key) -> None:
    post_msg(client, VALID_ROOM, "room-a message", signing_key, USER_A)
    post_msg(client, OTHER_ROOM, "room-b message", signing_key, USER_A)

    r = client.get(f"/rooms/{VALID_ROOM}/messages", headers=auth(signing_key, USER_A))
    contents = [m["content"] for m in r.json()["items"]]
    assert "room-a message" in contents
    assert "room-b message" not in contents


# ---------------------------------------------------------------------------
# 6. Delete
# ---------------------------------------------------------------------------


def test_delete_own_message(client: TestClient, signing_key) -> None:
    msg = post_msg(client, VALID_ROOM, "to delete", signing_key, USER_A)
    r = client.delete(
        f"/rooms/{VALID_ROOM}/messages/{msg['message_id']}",
        headers=auth(signing_key, USER_A),
    )
    assert r.status_code == 204

    r = client.get(f"/rooms/{VALID_ROOM}/messages", headers=auth(signing_key, USER_A))
    assert all(m["message_id"] != msg["message_id"] for m in r.json()["items"])


def test_delete_other_users_message_returns_403(
    client: TestClient, signing_key
) -> None:
    msg = post_msg(client, VALID_ROOM, "owned by A", signing_key, USER_A)
    r = client.delete(
        f"/rooms/{VALID_ROOM}/messages/{msg['message_id']}",
        headers=auth(signing_key, USER_B),
    )
    assert r.status_code == 403


def test_delete_nonexistent_message_returns_404(
    client: TestClient, signing_key
) -> None:
    r = client.delete(
        f"/rooms/{VALID_ROOM}/messages/00000000000000000000-nonexistent",
        headers=auth(signing_key, USER_A),
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 7. Expiry filtering
# ---------------------------------------------------------------------------


def test_expired_message_not_returned(
    client: TestClient, signing_key, monkeypatch
) -> None:
    import app.modules.forum.service as svc

    # Post a message, then make is_expired always return True for it
    msg = post_msg(client, VALID_ROOM, "will expire", signing_key, USER_A)

    original_is_expired = svc.is_expired

    def always_expired(item):
        if item.get("message_id") == msg["message_id"]:
            return True
        return original_is_expired(item)

    monkeypatch.setattr(svc, "is_expired", always_expired)

    r = client.get(f"/rooms/{VALID_ROOM}/messages", headers=auth(signing_key, USER_A))
    assert all(m["message_id"] != msg["message_id"] for m in r.json()["items"])


# ---------------------------------------------------------------------------
# 8. Pagination
# ---------------------------------------------------------------------------


def test_pagination_51_messages(client: TestClient, signing_key) -> None:
    for i in range(51):
        post_msg(client, VALID_ROOM, f"msg {i:03d}", signing_key, USER_A)

    r1 = client.get(
        f"/rooms/{VALID_ROOM}/messages?limit=50", headers=auth(signing_key, USER_A)
    )
    assert r1.status_code == 200
    page1 = r1.json()
    assert len(page1["items"]) == 50
    assert page1["next_cursor"] is not None

    r2 = client.get(
        f"/rooms/{VALID_ROOM}/messages?limit=50&cursor={page1['next_cursor']}",
        headers=auth(signing_key, USER_A),
    )
    assert r2.status_code == 200
    page2 = r2.json()
    assert len(page2["items"]) == 1


def test_cursor_wrong_room_returns_422(client: TestClient, signing_key) -> None:
    # Post enough to get a cursor
    for i in range(51):
        post_msg(client, VALID_ROOM, f"p {i}", signing_key, USER_A)

    r = client.get(
        f"/rooms/{VALID_ROOM}/messages?limit=50", headers=auth(signing_key, USER_A)
    )
    cursor = r.json()["next_cursor"]

    # Use that cursor against a different room
    r2 = client.get(
        f"/rooms/{OTHER_ROOM}/messages?cursor={cursor}",
        headers=auth(signing_key, USER_A),
    )
    assert r2.status_code == 422


def test_malformed_cursor_returns_422(client: TestClient, signing_key) -> None:
    r = client.get(
        f"/rooms/{VALID_ROOM}/messages?cursor=notbase64!!!",
        headers=auth(signing_key, USER_A),
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 9. Page ordering (oldest first within a page)
# ---------------------------------------------------------------------------


def test_page_is_oldest_first(client: TestClient, signing_key) -> None:
    for i in range(3):
        post_msg(client, VALID_ROOM, f"ordered {i}", signing_key, USER_A)

    r = client.get(f"/rooms/{VALID_ROOM}/messages", headers=auth(signing_key, USER_A))
    items = r.json()["items"]
    posted_ats = [m["posted_at"] for m in items]
    assert posted_ats == sorted(posted_ats)

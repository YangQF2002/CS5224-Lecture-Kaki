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
# 7. Expiry filtering — real is_expired check on a seeded expired record
# ---------------------------------------------------------------------------


def test_expired_message_not_returned(
    client: TestClient, signing_key, ddb_table
) -> None:
    from datetime import UTC, datetime, timedelta

    # Seed a message whose expires_at is already in the past.
    now = datetime.now(UTC)
    past = now - timedelta(hours=25)
    expired_item = {
        "PK": f"ROOM#{VALID_ROOM}",
        "SK": f"MSG#{int(past.timestamp() * 1000):020d}-expired",
        "message_id": f"{int(past.timestamp() * 1000):020d}-expired",
        "room_id": VALID_ROOM,
        "author_id": USER_A,
        "content": "this is expired",
        "posted_at": past.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": (past + timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ttl": int((past + timedelta(hours=25)).timestamp()),
    }
    ddb_table.put_item(Item=expired_item)

    # Also post a live message so the room is non-empty.
    post_msg(client, VALID_ROOM, "still visible", signing_key, USER_A)

    r = client.get(f"/rooms/{VALID_ROOM}/messages", headers=auth(signing_key, USER_A))
    assert r.status_code == 200
    contents = [m["content"] for m in r.json()["items"]]
    assert "this is expired" not in contents
    assert "still visible" in contents


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


def test_cursor_with_non_string_fields_returns_422(
    client: TestClient, signing_key
) -> None:
    import base64
    import json

    # Craft a cursor where sk is a number, not a string.
    bad = base64.urlsafe_b64encode(
        json.dumps(
            {"pk": f"ROOM#{VALID_ROOM}", "sk": 12345, "room_id": VALID_ROOM}
        ).encode()
    ).decode()
    r = client.get(
        f"/rooms/{VALID_ROOM}/messages?cursor={bad}",
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


# Native live delivery shares the existing FastAPI server and authenticated rooms.


def ticket_path(client, signing_key, room=VALID_ROOM, user=USER_A):
    response = client.post(
        f"/rooms/{room}/connection-ticket", headers=auth(signing_key, user)
    )
    assert response.status_code == 201
    return response.json()["path"]


def test_ticket_requires_authentication(client):
    assert client.post(f"/rooms/{VALID_ROOM}/connection-ticket").status_code == 401


def test_ticket_uses_expiry_from_the_validated_access_token(client, signing_key):
    token = _make_token(signing_key, USER_A)
    expiry = jwt.decode(token, options={"verify_signature": False})["exp"]
    response = client.post(
        f"/rooms/{VALID_ROOM}/connection-ticket",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201
    assert response.json()["session_expires_at"] == expiry


@pytest.mark.parametrize("invalid", ["signature", "expiry", "client"])
def test_ticket_rejects_invalid_access_tokens(client, signing_key, invalid):
    claims = jwt.decode(
        _make_token(signing_key, USER_A), options={"verify_signature": False}
    )
    key = signing_key
    if invalid == "signature":
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    elif invalid == "expiry":
        claims["exp"] = int(time()) - 1
    else:
        claims["client_id"] = "another-client"
    token = jwt.encode(claims, key, algorithm="RS256", headers={"kid": "forum-key"})
    response = client.post(
        f"/rooms/{VALID_ROOM}/connection-ticket",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 401


def test_live_post_and_delete_reach_two_signed_in_users(client, signing_key):
    a = ticket_path(client, signing_key, user=USER_A)
    b = ticket_path(client, signing_key, user=USER_B)
    with client.websocket_connect(a) as first, client.websocket_connect(b) as second:
        message = post_msg(client, VALID_ROOM, "live reply", signing_key, USER_A)
        for socket in (first, second):
            event = socket.receive_json()
            assert event["type"] == "message.created"
            assert event["room_id"] == VALID_ROOM
            assert event["message"]["message_id"] == message["message_id"]
            assert event["message"]["author_id"] == USER_A
        assert (
            client.delete(
                f"/rooms/{VALID_ROOM}/messages/{message['message_id']}",
                headers=auth(signing_key, USER_B),
            ).status_code
            == 403
        )
        assert (
            client.delete(
                f"/rooms/{VALID_ROOM}/messages/{message['message_id']}",
                headers=auth(signing_key, USER_A),
            ).status_code
            == 204
        )
        for socket in (first, second):
            assert socket.receive_json() == {
                "type": "message.deleted",
                "room_id": VALID_ROOM,
                "message_id": message["message_id"],
            }


def test_ticket_is_single_use(client, signing_key):
    from starlette.websockets import WebSocketDisconnect

    path = ticket_path(client, signing_key)
    with (
        client.websocket_connect(path),
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(path),
    ):
        pass


def test_ticket_cannot_join_another_room(client, signing_key):
    from starlette.websockets import WebSocketDisconnect

    path = ticket_path(client, signing_key)
    from urllib.parse import quote

    wrong = path.replace(quote(VALID_ROOM, safe=""), quote(OTHER_ROOM, safe=""))
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(wrong):
        pass
    # A failed room switch must not consume the valid ticket.
    with client.websocket_connect(path):
        pass


def test_expired_ticket_rejected_without_waiting_for_ttl(
    client, signing_key, ddb_table
):
    from urllib.parse import parse_qs, urlparse

    from starlette.websockets import WebSocketDisconnect

    from app.modules.forum import realtime

    path = ticket_path(client, signing_key)
    ticket = parse_qs(urlparse(path).query)["ticket"][0]
    ddb_table.update_item(
        Key=realtime._ticket_key(ticket),
        UpdateExpression="SET #ttl = :past",
        ExpressionAttributeNames={"#ttl": "ttl"},
        ExpressionAttributeValues={":past": int(time()) - 1},
    )
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(path):
        pass


def test_socket_requires_ticket(client):
    from starlette.websockets import WebSocketDisconnect

    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(f"/rooms/{VALID_ROOM}/live"),
    ):
        pass


def test_socket_origin_and_receive_only_contract(client, signing_key):
    from starlette.websockets import WebSocketDisconnect

    path = ticket_path(client, signing_key)
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(path, headers={"Origin": "https://unrelated.example"}),
    ):
        pass
    with client.websocket_connect(
        path, headers={"Origin": "http://localhost:5173"}
    ) as socket:
        socket.send_json({"action": "ping"})
        socket.send_json({"action": "post", "content": "spoofed"})
        with pytest.raises(WebSocketDisconnect):
            socket.receive_json()
    assert (
        client.get(
            f"/rooms/{VALID_ROOM}/messages", headers=auth(signing_key, USER_A)
        ).json()["items"]
        == []
    )


def test_hub_room_isolation_expiry_and_transport_failures():
    import asyncio
    from unittest.mock import AsyncMock

    from app.modules.forum.realtime import RoomHub

    async def scenario():
        hub = RoomHub()
        a, b, expired, failed = [AsyncMock() for _ in range(4)]
        await hub.join(VALID_ROOM, a, int(time()) + 100)
        await hub.join(OTHER_ROOM, b, int(time()) + 100)
        await hub.join(VALID_ROOM, expired, int(time()) - 1)
        await hub.join(VALID_ROOM, failed, int(time()) + 100)
        failed.send_json.side_effect = RuntimeError("closed")
        await hub.publish(VALID_ROOM, {"type": "message.deleted", "message_id": "id"})
        a.send_json.assert_awaited_once()
        b.send_json.assert_not_awaited()
        expired.send_json.assert_not_awaited()
        expired.close.assert_awaited_once_with(code=1008, reason="Sign-in expired")
        assert set(hub.rooms[VALID_ROOM]) == {a}

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "path,method",
    [
        (f"/rooms/{VALID_ROOM}/messages", "get"),
        (f"/rooms/{VALID_ROOM}/connection-ticket", "post"),
    ],
)
def test_storage_failure_returns_503(client, signing_key, monkeypatch, path, method):
    from botocore.exceptions import NoCredentialsError

    def unavailable(table=None):
        raise NoCredentialsError()

    monkeypatch.setattr(repository, "get_table", unavailable)
    response = getattr(client, method)(path, headers=auth(signing_key, USER_A))
    assert response.status_code == 503


def test_missing_config_fails_before_sdk_access(monkeypatch):
    from unittest.mock import Mock

    monkeypatch.delenv("DYNAMODB_TABLE", raising=False)
    session = Mock(side_effect=AssertionError("SDK must not be accessed"))
    monkeypatch.setattr(repository.boto3.session, "Session", session)
    with pytest.raises(repository.ForumStorageUnavailable):
        repository.get_table()
    session.assert_not_called()


def test_cors_allows_post_and_future_timetable_put(client):
    for method in ("POST", "PUT"):
        response = client.options(
            f"/rooms/{VALID_ROOM}/messages",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": method,
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert response.status_code == 200


def test_frontend_origins_prefers_shared_setting(monkeypatch):
    from app.modules.forum.service import frontend_origins

    monkeypatch.setenv(
        "FRONTEND_ORIGINS", " https://site.example/ , http://localhost:5173 "
    )
    monkeypatch.setenv("CORS_ORIGINS", "https://old.example")
    assert frontend_origins() == ["https://site.example", "http://localhost:5173"]


def test_configured_region_is_available_to_region_aware_credentials(monkeypatch):
    from botocore.credentials import Credentials
    from botocore.exceptions import NoRegionError
    from botocore.session import Session

    monkeypatch.delenv("AWS_DEFAULT_REGION", raising=False)
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.delenv("AWS_DEFAULT_PROFILE", raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", os.devnull)
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", os.devnull)

    def region_aware_credentials(session):
        if not session.get_config_variable("region"):
            raise NoRegionError()
        return Credentials("testing", "testing")

    monkeypatch.setattr(Session, "get_credentials", region_aware_credentials)
    assert repository.get_table().meta.client.meta.region_name == REGION


def test_idle_socket_closes_when_authenticated_session_expires(
    client, signing_key, ddb_table
):
    from urllib.parse import parse_qs, urlparse

    from starlette.websockets import WebSocketDisconnect

    from app.modules.forum import realtime

    path = ticket_path(client, signing_key)
    ticket = parse_qs(urlparse(path).query)["ticket"][0]
    ddb_table.update_item(
        Key=realtime._ticket_key(ticket),
        UpdateExpression="SET session_expires_at = :soon",
        ExpressionAttributeValues={":soon": int(time()) + 2},
    )
    with client.websocket_connect(path) as socket:
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()
        assert closed.value.code == 1008
    assert VALID_ROOM not in realtime.hub.rooms

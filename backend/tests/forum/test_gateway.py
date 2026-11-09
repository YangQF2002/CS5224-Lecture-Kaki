"""Live delivery through the API Gateway WebSocket API (deployed mode)."""

import json
from time import time
from types import SimpleNamespace
from urllib.parse import parse_qs, quote, urlparse

import pytest
from botocore.exceptions import ClientError

from app.modules.forum import delivery, gateway

ROOM = "BT1101-LEC-1@2030-10-22-0800-LT11@2026-2027@1"
MESSAGES = f"/rooms/{quote(ROOM, safe='')}/messages"
WS_URL = "wss://example.execute-api.ap-southeast-1.amazonaws.com/live"


class FakeManagementApi:
    """Records PostToConnection/DeleteConnection; listed IDs are already gone."""

    def __init__(self):
        self.sent: dict[str, list[dict]] = {}
        self.closed: list[str] = []
        self.gone: set[str] = set()
        self.queued: list[dict] = []

    def drain(self):
        while self.queued:
            delivery.handle_event(self.queued.pop(0))

    def post_to_connection(self, ConnectionId, Data):
        if ConnectionId in self.gone:
            raise ClientError(
                {"Error": {"Code": "GoneException", "Message": "gone"}},
                "PostToConnection",
            )
        self.sent.setdefault(ConnectionId, []).append(json.loads(Data))

    def delete_connection(self, ConnectionId):
        self.closed.append(ConnectionId)


@pytest.fixture
def api(client, monkeypatch):
    monkeypatch.setenv("FORUM_WEBSOCKET_URL", WS_URL)
    fake = FakeManagementApi()
    monkeypatch.setattr(gateway, "management_client", lambda endpoint=None: fake)
    monkeypatch.setenv("FORUM_FANOUT_FUNCTION", "fanout-test")

    def invoke(**kwargs):
        assert kwargs["InvocationType"] == "Event"
        fake.queued.append(json.loads(kwargs["Payload"]))
        return {"StatusCode": 202}

    monkeypatch.setattr(
        delivery, "invocation_client", lambda: SimpleNamespace(invoke=invoke)
    )
    return fake


def connect_event(connection_id, query, origin="http://localhost:5173"):
    return {
        "requestContext": {
            "routeKey": "$connect",
            "connectionId": connection_id,
            "domainName": "example.execute-api.ap-southeast-1.amazonaws.com",
            "stage": "live",
        },
        "headers": {"Origin": origin},
        "queryStringParameters": query,
    }


def connect(client, auth, connection_id, user="student-a", ready=True, **kwargs):
    response = client.post(
        f"/rooms/{quote(ROOM, safe='')}/connection-ticket", headers=auth(user)
    )
    assert response.status_code == 201
    url = urlparse(response.json()["path"])
    query = {name: values[0] for name, values in parse_qs(url.query).items()}
    response = gateway.handle_event(connect_event(connection_id, query, **kwargs))
    if response["statusCode"] == 200 and ready:
        return route("$default", connection_id, json.dumps({"action": "ready"}))
    return response


def route(route_key, connection_id, body=None):
    return gateway.handle_event(
        {
            "requestContext": {
                "routeKey": route_key,
                "connectionId": connection_id,
                "domainName": "example.execute-api.ap-southeast-1.amazonaws.com",
                "stage": "live",
            },
            "body": body,
        }
    )


def test_ticket_points_at_the_websocket_api(client, auth, api):
    response = client.post(
        f"/rooms/{quote(ROOM, safe='')}/connection-ticket", headers=auth()
    )
    url = urlparse(response.json()["path"])
    assert f"{url.scheme}://{url.netloc}{url.path}" == WS_URL
    assert parse_qs(url.query)["room"] == [ROOM]


def test_any_process_fans_out_to_every_connection_in_the_room(client, auth, api):
    assert connect(client, auth, "conn-a")["statusCode"] == 200
    assert connect(client, auth, "conn-b", user="student-b")["statusCode"] == 200
    api.sent.clear()

    message = client.post(MESSAGES, json={"content": "Live"}, headers=auth()).json()
    assert api.sent == {}
    api.drain()
    for connection_id in ("conn-a", "conn-b"):
        assert api.sent[connection_id] == [
            {"type": "message.created", "message": message, "room_id": ROOM}
        ]
    # Connection records share the room partition but never appear as messages.
    assert client.get(MESSAGES, headers=auth()).json()["items"] == [message]

    url = f"{MESSAGES}/{message['message_id']}"
    assert client.delete(url, headers=auth()).status_code == 204
    api.drain()
    assert api.sent["conn-b"][-1] == {
        "type": "message.deleted",
        "message_id": message["message_id"],
        "room_id": ROOM,
    }


def test_connect_rejects_reused_tickets_wrong_rooms_and_other_origins(
    client, auth, api
):
    response = client.post(
        f"/rooms/{quote(ROOM, safe='')}/connection-ticket", headers=auth()
    )
    query = {
        name: values[0]
        for name, values in parse_qs(urlparse(response.json()["path"]).query).items()
    }
    wrong_room = {**query, "room": ROOM.replace("BT1101", "CS5224")}
    assert gateway.handle_event(connect_event("c1", wrong_room))["statusCode"] == 401
    assert gateway.handle_event(connect_event("c1", query))["statusCode"] == 200
    assert gateway.handle_event(connect_event("c2", query))["statusCode"] == 401
    assert gateway.handle_event(connect_event("c3", None))["statusCode"] == 401
    assert (
        connect(client, auth, "c4", origin="https://other.example")["statusCode"] == 403
    )


def test_gone_and_expired_connections_are_removed(client, auth, api, table):
    connect(client, auth, "gone")
    connect(client, auth, "expired")
    connect(client, auth, "live")
    api.sent.clear()
    api.gone.add("gone")
    table.update_item(
        Key={"PK": f"ROOM#{ROOM}", "SK": "CONN#expired"},
        UpdateExpression="SET session_expires_at = :past",
        ExpressionAttributeValues={":past": int(time()) - 1},
    )

    client.post(MESSAGES, json={"content": "Live"}, headers=auth())
    api.drain()

    assert list(api.sent) == ["live"]
    assert api.closed == ["expired"]
    remaining = {
        item["connection_id"] for item in gateway.repository.query_connections(ROOM)
    }
    assert remaining == {"live"}
    assert "Item" not in table.get_item(Key={"PK": "CONN#gone", "SK": "METADATA"})


def test_disconnect_and_ping(client, auth, api, table):
    connect(client, auth, "conn-a")
    assert route("$default", "conn-a", json.dumps({"action": "ping"})) == {
        "statusCode": 200
    }
    assert route("$default", "conn-a", "hello")["statusCode"] == 400
    assert api.closed == ["conn-a"]
    assert route("$disconnect", "conn-a") == {"statusCode": 200}
    assert table.scan()["Items"] == []
    # A repeated or unknown disconnect is harmless.
    assert route("$disconnect", "conn-a") == {"statusCode": 200}


def test_saved_message_survives_unavailable_connection_storage(
    client, auth, api, monkeypatch
):
    def unavailable(_room):
        raise gateway.repository.ForumStorageUnavailable()

    monkeypatch.setattr(gateway.repository, "query_connections", unavailable)
    response = client.post(MESSAGES, json={"content": "Saved"}, headers=auth())
    assert response.status_code == 201
    with pytest.raises(gateway.repository.ForumStorageUnavailable):
        api.drain()


def test_pending_connection_is_not_broadcast_until_ready(client, auth, api):
    assert connect(client, auth, "joining", ready=False)["statusCode"] == 200
    assert gateway.repository.query_connections(ROOM) == []
    api.gone.add("joining")
    message = client.post(
        MESSAGES, json={"content": "During handshake"}, headers=auth()
    ).json()
    api.drain()
    api.gone.clear()
    assert (
        route("$default", "joining", json.dumps({"action": "ready"}))["statusCode"]
        == 200
    )
    assert api.sent["joining"] == [{"type": "ready", "room_id": ROOM}]
    delivery.handle_event(
        {"room_id": ROOM, "event": {"type": "message.created", "message": message}}
    )
    assert api.sent["joining"][-1]["message"] == message


def test_ready_is_idempotent_and_rejects_expired_or_disconnected_sessions(
    client, auth, api, table
):
    connect(client, auth, "ready")
    original = gateway.repository.query_connections(ROOM)
    assert (
        route("$default", "ready", json.dumps({"action": "ready"}))["statusCode"] == 200
    )
    assert gateway.repository.query_connections(ROOM) == original
    route("$disconnect", "ready")
    assert (
        route("$default", "ready", json.dumps({"action": "ready"}))["statusCode"] == 400
    )
    assert gateway.repository.query_connections(ROOM) == []
    connect(client, auth, "expired", ready=False)
    table.update_item(
        Key={"PK": "CONN#expired", "SK": "METADATA"},
        UpdateExpression="SET session_expires_at = :past",
        ExpressionAttributeValues={":past": int(time()) - 1},
    )
    assert (
        route("$default", "expired", json.dumps({"action": "ready"}))["statusCode"]
        == 400
    )
    assert gateway.repository.query_connections(ROOM) == []


def test_disconnect_during_ready_cannot_restore_room_membership(
    client, auth, api, monkeypatch
):
    connect(client, auth, "racing", ready=False)
    original = gateway.repository.boto3.client("dynamodb", region_name="ap-southeast-1")

    def transact(**kwargs):
        gateway.repository.delete_connection("racing")
        return original.transact_write_items(**kwargs)

    monkeypatch.setattr(
        gateway.repository.boto3,
        "client",
        lambda *args, **kwargs: SimpleNamespace(transact_write_items=transact),
    )
    assert gateway.repository.activate_connection("racing") is None
    assert gateway.repository.query_connections(ROOM) == []


def test_transient_delivery_failure_retries_but_does_not_fail_http(
    client, auth, api, monkeypatch
):
    connect(client, auth, "receiver")

    def unavailable(**kwargs):
        raise ClientError(
            {"Error": {"Code": "LimitExceededException", "Message": "retry"}},
            "PostToConnection",
        )

    monkeypatch.setattr(api, "post_to_connection", unavailable)
    assert (
        client.post(MESSAGES, json={"content": "Saved"}, headers=auth()).status_code
        == 201
    )
    with pytest.raises(ClientError):
        api.drain()


def test_enqueue_failure_keeps_saved_posts_and_deletions_successful(
    client, auth, api, monkeypatch
):
    def unavailable(**kwargs):
        raise ClientError(
            {"Error": {"Code": "ServiceException", "Message": "retry"}}, "Invoke"
        )

    monkeypatch.setattr(
        delivery, "invocation_client", lambda: SimpleNamespace(invoke=unavailable)
    )
    monkeypatch.setattr(
        gateway, "publish", lambda *args: pytest.fail("HTTP must not run broadcasts")
    )
    response = client.post(MESSAGES, json={"content": "Saved"}, headers=auth())
    assert response.status_code == 201
    assert client.get(MESSAGES, headers=auth()).json()["items"] == [response.json()]
    assert (
        client.delete(
            f"{MESSAGES}/{response.json()['message_id']}", headers=auth()
        ).status_code
        == 204
    )
    assert client.get(MESSAGES, headers=auth()).json()["items"] == []


@pytest.mark.parametrize("status,failed", [(202, False), (500, True)])
def test_enqueue_checks_acceptance_and_closes_response(
    api, monkeypatch, caplog, status, failed
):
    from io import BytesIO

    body = BytesIO()
    monkeypatch.setattr(
        delivery,
        "invocation_client",
        lambda: SimpleNamespace(
            invoke=lambda **kwargs: {"StatusCode": status, "Payload": body}
        ),
    )
    delivery.enqueue(ROOM, {"type": "message.deleted", "message_id": "old"})
    assert body.closed
    assert ("Forum broadcast could not be queued" in caplog.text) is failed


def test_retried_create_does_not_replay_expired_message(client, auth, api, table):
    from datetime import UTC, datetime, timedelta

    connect(client, auth, "receiver")
    message = client.post(MESSAGES, json={"content": "Saved"}, headers=auth()).json()
    table.update_item(
        Key={"PK": f"ROOM#{ROOM}", "SK": f"MSG#{message['message_id']}"},
        UpdateExpression="SET expires_at = :past",
        ExpressionAttributeValues={
            ":past": (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
        },
    )
    api.sent.clear()
    api.drain()
    assert api.sent == {}


def test_retried_create_does_not_replay_deleted_message(client, auth, api):
    connect(client, auth, "receiver")
    message = client.post(MESSAGES, json={"content": "Saved"}, headers=auth()).json()
    assert (
        client.delete(f"{MESSAGES}/{message['message_id']}", headers=auth()).status_code
        == 204
    )
    api.sent.clear()
    api.drain()
    assert api.sent["receiver"] == [
        {
            "type": "message.deleted",
            "message_id": message["message_id"],
            "room_id": ROOM,
        }
    ]


def test_http_handler_serves_api_gateway_http_api_events():
    from app.aws_lambda import http_handler

    event = {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": "/health",
        "rawQueryString": "",
        "headers": {"host": "example.execute-api.ap-southeast-1.amazonaws.com"},
        "requestContext": {
            "http": {
                "method": "GET",
                "path": "/health",
                "protocol": "HTTP/1.1",
                "sourceIp": "203.0.113.1",
                "userAgent": "test",
            },
            "stage": "$default",
        },
        "isBase64Encoded": False,
    }
    response = http_handler(event, None)
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"status": "ok"}

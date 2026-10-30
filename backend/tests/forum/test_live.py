"""Primary live delivery and connection-ticket checks."""

from time import time
from urllib.parse import quote

import pytest
from starlette.websockets import WebSocketDisconnect

ROOM = "BT1101-LEC-1@2026-10-20-0800-LT11@2026-2027@1"
OTHER_ROOM = ROOM.replace("BT1101", "CS5224")
MESSAGES = f"/rooms/{quote(ROOM, safe='')}/messages"


def ticket(client, auth, user="student-a"):
    response = client.post(
        f"/rooms/{quote(ROOM, safe='')}/connection-ticket", headers=auth(user)
    )
    assert response.status_code == 201
    return response.json()["path"]


def test_live_delivery_and_author_only_deletion(client, auth):
    first_path, second_path = ticket(client, auth), ticket(client, auth, "student-b")
    with (
        client.websocket_connect(first_path) as first,
        client.websocket_connect(second_path) as second,
    ):
        message = client.post(
            MESSAGES, json={"content": "Live question"}, headers=auth()
        ).json()
        for socket in (first, second):
            event = socket.receive_json()
            assert event["type"] == "message.created"
            assert event["message"] == message
        url = f"{MESSAGES}/{message['message_id']}"
        assert client.delete(url, headers=auth("student-b")).status_code == 403
        assert client.delete(url, headers=auth()).status_code == 204
        for socket in (first, second):
            assert socket.receive_json()["type"] == "message.deleted"


def test_ticket_is_room_bound_and_single_use(client, auth):
    url = ticket(client, auth)
    wrong = url.replace(quote(ROOM, safe=""), quote(OTHER_ROOM, safe=""))
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(wrong):
        pass
    with client.websocket_connect(url):
        pass
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(url):
        pass


def test_socket_requires_a_ticket(client):
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(f"/rooms/{ROOM}/live"),
    ):
        pass


def test_expired_ticket_is_rejected_before_ttl_cleanup(client, auth, table):
    url = ticket(client, auth)
    item = table.scan()["Items"][0]
    table.update_item(
        Key={name: item[name] for name in ("PK", "SK")},
        UpdateExpression="SET #ttl = :past",
        ExpressionAttributeNames={"#ttl": "ttl"},
        ExpressionAttributeValues={":past": int(time()) - 1},
    )
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(url):
        pass


def test_socket_rejects_an_unrelated_website_origin(client, auth):
    url = ticket(client, auth)
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(url, headers={"Origin": "https://other.example"}),
    ):
        pass

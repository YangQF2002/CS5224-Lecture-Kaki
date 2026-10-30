"""Primary Forum HTTP, permission, expiry and pagination checks."""

from datetime import UTC, datetime, timedelta
from urllib.parse import quote

import pytest

from app.modules.forum.service import make_message

ROOM = "BT1101-LEC-1@2026-10-20-0800-LT11@2026-2027@1"
SLASH_ROOM = "QT5101-LEC-1@2026-10-20-1600-CQT/SR0514@2026-2027@1"


def path(room=ROOM):
    return f"/rooms/{quote(room, safe='')}/messages"


@pytest.mark.parametrize("room", [ROOM, SLASH_ROOM])
def test_create_read_and_delete_own_message(client, auth, room):
    response = client.post(
        path(room), json={"content": "A lecture question"}, headers=auth()
    )
    assert response.status_code == 201
    message = response.json()
    assert message["author_id"] == "student-a"
    assert client.get(path(room), headers=auth()).json()["items"] == [message]
    assert (
        client.delete(
            f"{path(room)}/{message['message_id']}", headers=auth()
        ).status_code
        == 204
    )
    assert client.get(path(room), headers=auth()).json()["items"] == []


@pytest.mark.parametrize(
    ("method", "suffix"), [("POST", ""), ("GET", ""), ("DELETE", "/missing")]
)
def test_authentication_required(client, method, suffix):
    response = client.request(method, path() + suffix, json={"content": "hello"})
    assert response.status_code == 401


@pytest.mark.parametrize("content", ["   ", "x" * 501])
def test_invalid_message_rejected(client, auth, content):
    assert (
        client.post(path(), json={"content": content}, headers=auth()).status_code
        == 422
    )


@pytest.mark.parametrize(
    "room", ["invalid-room", ROOM.replace("2026-10-20", "2026-02-30")]
)
def test_invalid_room_rejected(client, auth, room):
    assert client.get(path(room), headers=auth()).status_code == 422


def test_expired_messages_are_hidden_before_ttl_cleanup(client, auth, table):
    expired = make_message(ROOM, "expired", "student-a")
    expired["expires_at"] = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
    table.put_item(Item=expired)
    client.post(path(), json={"content": "visible"}, headers=auth())
    assert [
        item["content"] for item in client.get(path(), headers=auth()).json()["items"]
    ] == ["visible"]


def test_history_pages_preserve_order_without_duplicates(client, auth):
    messages = []
    for index in range(3):
        messages.append(
            client.post(path(), json={"content": str(index)}, headers=auth()).json()
        )
    first = client.get(path(), params={"limit": 2}, headers=auth()).json()
    assert len(first["items"]) == 2
    ids = [item["message_id"] for item in first["items"]]
    assert ids == sorted(ids)
    second = client.get(
        path(), params={"limit": 2, "cursor": first["next_cursor"]}, headers=auth()
    ).json()
    assert len(second["items"]) == 1
    assert second["next_cursor"] is None
    assert {item["message_id"] for item in first["items"] + second["items"]} == {
        item["message_id"] for item in messages
    }

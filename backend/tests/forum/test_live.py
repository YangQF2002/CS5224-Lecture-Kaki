"""Primary live delivery and connection-ticket checks."""

from datetime import UTC, datetime, timedelta
from time import time
from urllib.parse import parse_qs, quote, urlparse

import pytest
from botocore.exceptions import ClientError
from starlette.websockets import WebSocketDisconnect

from app.modules.forum import attachment_store as store

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


def test_pdf_live_history_download_and_delete(client, auth, pdf, monkeypatch):
    upload_id, key, version = pdf.upload()
    ticket = client.post(
        f"{pdf.base}/connection-ticket", headers=auth("student-b")
    ).json()["path"]
    with client.websocket_connect(ticket) as socket:
        response = pdf.post(upload_id)
        assert response.status_code == 201, response.text
        message = response.json()
        assert message["content"] == ""
        assert datetime.fromisoformat(message["expires_at"]) - datetime.fromisoformat(
            message["posted_at"]
        ) == timedelta(hours=24)
        assert message["attachment"] == {
            "filename": "lecture.pdf",
            "size": len(pdf.data),
        }
        assert socket.receive_json()["message"] == message
        assert client.get(f"{pdf.base}/messages", headers=auth()).json()["items"] == [
            message
        ]
        url = f"{pdf.base}/messages/{message['message_id']}"
        # Downloads must sign the pinned version without reading any PDF bytes.
        from app.modules.forum import attachments

        def no_read(_):
            pytest.fail("Download authorization must not read the PDF")

        monkeypatch.setattr(attachments, "read_pdf", no_read)
        download = client.get(url + "/attachment", headers=auth("student-b"))
        assert download.status_code == 200
        assert download.headers["cache-control"] == "no-store"
        assert download.headers["x-content-type-options"] == "nosniff"
        signed = urlparse(download.json()["url"])
        params = parse_qs(signed.query)
        assert signed.scheme == "https"
        assert signed.hostname == "forum-pdfs-test.s3.ap-southeast-1.amazonaws.com"
        assert signed.path == f"/{key}"
        assert params["versionId"] == [version]
        assert params["X-Amz-Expires"] == ["60"]
        assert params["response-cache-control"] == ["no-store"]
        assert params["response-content-type"] == ["application/octet-stream"]
        assert params["response-content-disposition"] == [
            "attachment; filename*=UTF-8''lecture.pdf"
        ]
        assert client.delete(url, headers=auth("student-b")).status_code == 403
        assert client.delete(url, headers=auth()).status_code == 204
        assert socket.receive_json()["type"] == "message.deleted"
        assert client.get(url + "/attachment", headers=auth()).status_code == 404
    with pytest.raises(ClientError) as missing:
        pdf.bucket.get_object(Bucket="forum-pdfs-test", Key=key, VersionId=version)
    assert missing.value.response["Error"]["Code"] == "NoSuchVersion"


def test_pdf_version_is_pinned_and_expired_download_is_denied(client, auth, pdf, table):
    upload_id, key, version = pdf.upload()
    assert (
        client.get(f"{pdf.base}/attachment-uploads/{upload_id}", headers=auth()).json()[
            "status"
        ]
        == "ready"
    )
    pdf.bucket.put_object(
        Bucket="forum-pdfs-test",
        Key=key,
        Body=b"replacement",
        ContentType="application/pdf",
    )
    message = pdf.post(upload_id).json()
    url = f"{pdf.base}/messages/{message['message_id']}/attachment"
    signed = client.get(url, headers=auth()).json()["url"]
    assert parse_qs(urlparse(signed).query)["versionId"] == [version]
    original = pdf.bucket.get_object(
        Bucket="forum-pdfs-test", Key=key, VersionId=version
    )
    assert original["Body"].read() == pdf.data
    table.update_item(
        Key={"PK": f"ROOM#{pdf.room}", "SK": f"MSG#{message['message_id']}"},
        UpdateExpression="SET expires_at = :past",
        ExpressionAttributeValues={
            ":past": (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
        },
    )
    assert client.get(url, headers=auth()).status_code == 404
    assert client.get(url).status_code == 401


def test_stale_simultaneous_claim_cannot_create_another_message(
    client, auth, pdf, monkeypatch
):
    from app.modules.forum import attachments

    upload_id, _, _ = pdf.upload()
    client.get(f"{pdf.base}/attachment-uploads/{upload_id}", headers=auth())
    stale = store.get_upload(upload_id)
    assert pdf.post(upload_id).status_code == 201
    monkeypatch.setattr(attachments, "owned_upload", lambda *args: stale)
    assert pdf.post(upload_id).status_code == 409
    assert len(client.get(f"{pdf.base}/messages", headers=auth()).json()["items"]) == 1


def test_s3_cleanup_failure_does_not_restore_download_access(
    client, auth, pdf, monkeypatch
):
    from app.modules.forum.repository import ForumStorageUnavailable

    upload_id, _, _ = pdf.upload()
    message = pdf.post(upload_id).json()

    def fail_cleanup(_):
        raise ForumStorageUnavailable()

    monkeypatch.setattr(store, "delete_object", fail_cleanup)
    url = f"{pdf.base}/messages/{message['message_id']}"
    assert client.delete(url, headers=auth()).status_code == 204
    assert client.get(url + "/attachment", headers=auth()).status_code == 404


@pytest.mark.parametrize("remaining", [90, 45, 0.5, -1])
def test_download_link_cannot_outlive_message(
    client, auth, pdf, table, monkeypatch, remaining
):
    from time import time

    from app.modules.forum import attachments

    upload_id, _, _ = pdf.upload()
    message = pdf.post(upload_id).json()
    now = int(time())
    monkeypatch.setattr(attachments, "time", lambda: now)
    table.update_item(
        Key={"PK": f"ROOM#{pdf.room}", "SK": f"MSG#{message['message_id']}"},
        UpdateExpression="SET expires_at = :expiry",
        ExpressionAttributeValues={
            ":expiry": datetime.fromtimestamp(now + remaining, UTC).isoformat()
        },
    )
    response = client.get(
        f"{pdf.base}/messages/{message['message_id']}/attachment", headers=auth()
    )
    if remaining < 1:
        assert response.status_code == 404
    else:
        assert response.status_code == 200
        params = parse_qs(urlparse(response.json()["url"]).query)
        assert int(params["X-Amz-Expires"][0]) == min(60, remaining)


def test_pdf_posts_keep_profile_usernames(client, auth, pdf, monkeypatch):
    from app.modules.forum import api

    monkeypatch.setattr(api, "username_for", lambda user_id: "LectureKaki")
    upload_id, _, _ = pdf.upload()
    response = pdf.post(upload_id)
    assert response.status_code == 201
    message = response.json()
    assert message["author_name"] == "LectureKaki"
    assert message["attachment"]["filename"] == "lecture.pdf"

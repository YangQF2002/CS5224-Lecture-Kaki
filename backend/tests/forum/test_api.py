"""Primary Forum HTTP, permission, expiry and pagination checks."""

from datetime import UTC, datetime, timedelta
from io import BytesIO
from unittest.mock import Mock
from urllib.parse import quote, urlparse

import pytest
from botocore.exceptions import ClientError
from pypdf import PdfWriter
from pypdf.generic import NameObject, NumberObject

from app.modules.forum import attachment_store as store
from app.modules.forum.service import make_message

ROOM = "BT1101-LEC-1@2030-10-22-0800-LT11@2026-2027@1"
SLASH_ROOM = "QT5101-LEC-1@2030-10-22-1600-CQT/SR0514@2026-2027@1"


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
    "room", ["invalid-room", ROOM.replace("2030-10-22", "2026-02-30")]
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


def test_pdf_upload_is_author_room_bound_and_single_use(client, auth, pdf):
    upload_id, _, _ = pdf.upload()
    assert pdf.post(upload_id, "student-b").status_code == 404
    other = pdf.base.replace("QT5101", "QT5201U")
    assert (
        client.get(
            f"{other}/attachment-uploads/{upload_id}", headers=auth()
        ).status_code
        == 404
    )
    assert client.get(
        f"{pdf.base}/attachment-uploads/{upload_id}", headers=auth()
    ).json() == {"status": "ready"}
    assert pdf.post(upload_id).status_code == 201
    assert pdf.post(upload_id).status_code in {409, 410}


def test_pdf_must_be_uploaded_before_posting(client, auth, pdf):
    response = client.post(
        f"{pdf.base}/attachment-uploads",
        json={"filename": "lecture.pdf", "size": 100},
        headers=auth(),
    )
    upload_id = response.json()["upload_id"]
    assert client.get(
        f"{pdf.base}/attachment-uploads/{upload_id}", headers=auth()
    ).json() == {"status": "pending"}
    assert pdf.post(upload_id).status_code == 409
    assert client.get(f"{pdf.base}/messages", headers=auth()).json()["items"] == []


def test_pdf_validation_and_upload_limit(client, auth, pdf):
    for body in [
        {"filename": "file.exe", "size": 10},
        {"filename": "../file.pdf", "size": 10},
        {"filename": "file.pdf", "size": store.MAX_PDF_BYTES + 1},
        {"filename": "file.pdf", "size": 0},
    ]:
        assert (
            client.post(
                f"{pdf.base}/attachment-uploads", json=body, headers=auth()
            ).status_code
            == 422
        )
    upload_id, _, _ = pdf.upload(data=b"%PDF-pretending to be a document")
    assert pdf.post(upload_id).status_code == 422
    for _ in range(9):
        assert (
            client.post(
                f"{pdf.base}/attachment-uploads",
                json={"filename": "file.pdf", "size": 10},
                headers=auth(),
            ).status_code
            == 201
        )
    assert (
        client.post(
            f"{pdf.base}/attachment-uploads",
            json={"filename": "file.pdf", "size": 10},
            headers=auth(),
        ).status_code
        == 429
    )


def test_expired_upload_and_unconfigured_storage(client, auth, pdf, table, monkeypatch):
    upload_id, _, _ = pdf.upload()
    table.update_item(
        Key=store.upload_key(upload_id),
        UpdateExpression="SET #ttl = :past",
        ExpressionAttributeNames={"#ttl": "ttl"},
        ExpressionAttributeValues={":past": 1},
    )
    assert pdf.post(upload_id).status_code == 410
    monkeypatch.delenv("FORUM_ATTACHMENTS_BUCKET")
    assert (
        client.post(
            f"{pdf.base}/attachment-uploads",
            json={"filename": "file.pdf", "size": 10},
            headers=auth(),
        ).status_code
        == 503
    )
    assert (
        client.post(
            f"{pdf.base}/messages", json={"content": "Text still works"}, headers=auth()
        ).status_code
        == 201
    )


def test_encrypted_pdf_and_mismatched_upload_size_are_rejected(client, auth, pdf):
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.encrypt("password")
    data = BytesIO()
    writer.write(data)
    upload_id, _, _ = pdf.upload(data=data.getvalue())
    assert pdf.post(upload_id).status_code == 422
    upload_id, key, _ = pdf.upload()
    pdf.bucket.put_object(
        Bucket="forum-pdfs-test", Key=key, Body=b"short", ContentType="application/pdf"
    )
    assert pdf.post(upload_id).status_code == 422


@pytest.mark.parametrize("content_type", ["text/plain", "application/octet-stream"])
def test_pdf_content_type_is_validated(client, auth, pdf, content_type):
    upload_id, _, _ = pdf.upload(content_type=content_type)
    assert pdf.post(upload_id).status_code == 422
    assert client.get(f"{pdf.base}/messages", headers=auth()).json()["items"] == []


def test_pdf_validation_does_not_require_object_tags(client, auth, pdf, monkeypatch):
    upload_id, _, version = pdf.upload()
    reads = []

    class PdfStorage:
        def head_object(self, **kwargs):
            return pdf.bucket.head_object(**kwargs)

        def get_object(self, **kwargs):
            reads.append(kwargs)
            return pdf.bucket.get_object(**kwargs)

        def get_object_tagging(self, **kwargs):
            raise ClientError({"Error": {"Code": "AccessDenied"}}, "GetObjectTagging")

    monkeypatch.setattr(store, "s3", lambda: (PdfStorage(), "forum-pdfs-test"))
    for _ in range(2):
        response = client.get(
            f"{pdf.base}/attachment-uploads/{upload_id}", headers=auth()
        )
        assert response.status_code == 200, response.text
        assert response.json() == {"status": "ready"}
    assert len(reads) == 1
    assert reads[0]["VersionId"] == version
    assert pdf.post(upload_id).status_code == 201


def test_conditional_upload_does_not_replace_an_existing_file(client, auth, pdf):
    _, key, _ = pdf.upload()
    with pytest.raises(ClientError) as duplicate:
        pdf.bucket.put_object(
            Bucket="forum-pdfs-test",
            Key=key,
            Body=pdf.data,
            ContentType="application/pdf",
            IfNoneMatch="*",
        )
    assert duplicate.value.response["Error"]["Code"] == "PreconditionFailed"


def test_upload_uses_regional_s3_endpoint(client, auth, pdf):
    response = client.post(
        f"{pdf.base}/attachment-uploads",
        json={"filename": "lecture.pdf", "size": 100},
        headers=auth(),
    )
    assert response.status_code == 201
    assert (
        urlparse(response.json()["url"]).hostname
        == "forum-pdfs-test.s3.ap-southeast-1.amazonaws.com"
    )


@pytest.mark.parametrize("encryption", ["certificate", "unsupported-version"])
def test_unsupported_pdf_encryption_returns_validation_error(
    client, auth, pdf, encryption
):
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.encrypt("password")
    entry = writer._encrypt_entry
    assert entry is not None
    if encryption == "certificate":
        entry[NameObject("/Filter")] = NameObject("/Adobe.PubSec")
    else:
        entry[NameObject("/V")] = NumberObject(99)
    data = BytesIO()
    writer.write(data)
    upload_id, _, _ = pdf.upload(data=data.getvalue())
    response = client.get(f"{pdf.base}/attachment-uploads/{upload_id}", headers=auth())
    assert response.status_code == 422, response.text
    assert pdf.post(upload_id).status_code == 422
    assert client.get(f"{pdf.base}/messages", headers=auth()).json()["items"] == []


def test_room_closes_at_the_end_of_its_lecture_week():
    from app.modules.forum.service import room_closes_at

    # Wednesday, Monday and Sunday lectures all close at Monday 00:00 SGT.
    for day in ("2030-10-23", "2030-10-21", "2030-10-27"):
        room = ROOM.replace("2030-10-22", day)
        assert room_closes_at(room) == datetime(2030, 10, 27, 16, tzinfo=UTC)


def test_closed_room_is_empty_and_rejects_new_activity(
    client, auth, table, monkeypatch
):
    closed = ROOM.replace("2030-10-22", "2026-08-12")  # Week 1, long past.
    item = make_message(ROOM, "left over", "student-a")
    item.update(PK=f"ROOM#{closed}", room_id=closed)
    table.put_item(Item=item)
    query = Mock(wraps=table.query)
    monkeypatch.setattr(table, "query", query)
    base = f"/rooms/{closed}"
    assert client.get(f"{base}/messages", headers=auth()).json() == {
        "items": [],
        "next_cursor": None,
    }
    assert query.call_count == 0
    for response in (
        client.post(f"{base}/messages", json={"content": "hi"}, headers=auth()),
        client.post(f"{base}/connection-ticket", headers=auth()),
        client.post(
            f"{base}/attachment-uploads",
            json={"filename": "a.pdf", "size": 10},
            headers=auth(),
        ),
    ):
        assert response.status_code == 403, response.text
        assert "closed" in response.json()["detail"]


def test_history_returns_a_cursor_without_filling_through_expired_rows(
    client, auth, table, monkeypatch
):
    from unittest.mock import Mock

    timestamp = int((datetime.now(UTC) - timedelta(seconds=1)).timestamp() * 1000)
    for index in range(4):
        item = make_message(ROOM, "visible" if index == 0 else "expired", "student-a")
        message_id = f"{timestamp + index:020d}-{index:032x}"
        item.update(SK=f"MSG#{message_id}", message_id=message_id)
        if index:
            item["expires_at"] = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
        table.put_item(Item=item)
    query = Mock(wraps=table.query)
    monkeypatch.setattr(table, "query", query)
    first = client.get(path(), params={"limit": 2}, headers=auth()).json()
    assert first["items"] == [] and first["next_cursor"]
    assert query.call_count == 1
    second = client.get(
        path(), params={"limit": 2, "cursor": first["next_cursor"]}, headers=auth()
    ).json()
    assert [item["content"] for item in second["items"]] == ["visible"]
    assert second["next_cursor"] is None and query.call_count == 2


def test_pdf_validation_capacity_preserves_cached_and_text_posts(
    client, auth, pdf, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, Lock

    from app.modules.forum import attachments

    ids = [pdf.upload()[0] for _ in range(4)]

    def status(upload_id):
        return client.get(f"{pdf.base}/attachment-uploads/{upload_id}", headers=auth())

    assert status(ids[0]).status_code == 200
    entered, release, lock = Event(), Event(), Lock()
    original = attachments.read_pdf
    active = 0

    def read(attachment):
        nonlocal active
        with lock:
            active += 1
            if active == 2:
                entered.set()
        assert release.wait(5), "Validation gate was not released"
        return original(attachment)

    monkeypatch.setattr(attachments, "read_pdf", read)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = [pool.submit(status, upload_id) for upload_id in ids[1:3]]
        try:
            assert entered.wait(5)
            busy = status(ids[3])
            assert busy.status_code == 429
            assert busy.headers["retry-after"] == "1"
            assert pdf.post(ids[0]).status_code == 201
            assert (
                client.post(
                    f"{pdf.base}/messages",
                    json={"content": "Text still works"},
                    headers=auth(),
                ).status_code
                == 201
            )
        finally:
            release.set()
        assert all(request.result(timeout=10).status_code == 200 for request in pending)
    assert status(ids[3]).status_code == 200


def test_pdf_capacity_is_released_after_validation_errors(client, auth, pdf):
    for _ in range(3):
        upload_id, _, _ = pdf.upload(data=b"%PDF-invalid")
        assert (
            client.get(
                f"{pdf.base}/attachment-uploads/{upload_id}", headers=auth()
            ).status_code
            == 422
        )
    upload_id, _, _ = pdf.upload()
    assert (
        client.get(
            f"{pdf.base}/attachment-uploads/{upload_id}", headers=auth()
        ).status_code
        == 200
    )

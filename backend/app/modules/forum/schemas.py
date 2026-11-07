"""Forum data contracts."""

import re
from datetime import date, time
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

# Format: <moduleCode>-LEC-<classNo>@<YYYY-MM-DD>-<HHMM>-<venue>@<acadYear>@<semester>
# e.g.   BT1101-LEC-1@2026-10-20-0800-LT11@2026-2027@1
_ROOM_ID_RE = re.compile(
    r"^[A-Z0-9]+-LEC-[A-Za-z0-9.]+@\d{4}-\d{2}-\d{2}-\d{4}-[\w./-]+@\d{4}-\d{4}@[1-4]$"
)


def _validate_room_id(value: str) -> str:
    if not _ROOM_ID_RE.fullmatch(value):
        raise ValueError(
            "room_id must be <moduleCode>-LEC-<classNo>@<YYYY-MM-DD>-<HHMM>-<venue>"
            "@<acadYear>@<semester>"
        )
    occurrence, academic_year = value.split("@")[1:3]
    try:
        date.fromisoformat(occurrence[:10])
        clock = occurrence[11:15]
        time(int(clock[:2]), int(clock[2:]))
        start, end = map(int, academic_year.split("-"))
        if start < 1 or end != start + 1:
            raise ValueError
    except ValueError:
        raise ValueError(
            "room_id contains an invalid date, time or academic year"
        ) from None
    return value


RoomId = Annotated[str, AfterValidator(_validate_room_id)]


class AttachmentOut(BaseModel):
    filename: str
    size: int


class MessageIn(BaseModel):
    content: str = Field(default="", max_length=500)
    attachment_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")

    def model_post_init(self, __context: object, /) -> None:
        stripped = self.content.strip()
        if not stripped and not self.attachment_id:
            raise ValueError("A message or PDF is required")
        object.__setattr__(self, "content", stripped)


class MessageOut(BaseModel):
    message_id: str
    room_id: str
    author_id: str
    # The author's username; never their email. None for older messages or
    # when profiles were unavailable at posting time.
    author_name: str | None = None
    content: str
    posted_at: str
    expires_at: str
    attachment: AttachmentOut | None = None


class MessagePage(BaseModel):
    items: list[MessageOut]
    next_cursor: str | None


class ConnectionTicket(BaseModel):
    path: str
    session_expires_at: int

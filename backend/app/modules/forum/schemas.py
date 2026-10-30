"""Forum data contracts."""

import re
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

# Format: <moduleCode>-LEC-<classNo>@<YYYY-MM-DD>-<HHMM>-<venue>@<acadYear>@<semester>
# e.g.   BT1101-LEC-1@2026-10-20-0800-LT11@2026-2027@1
_ROOM_ID_RE = re.compile(
    r"^[A-Z0-9]+-LEC-[A-Za-z0-9.]+@\d{4}-\d{2}-\d{2}-\d{4}-[\w.-]+@\d{4}-\d{4}@[1-4]$"
)


def _validate_room_id(value: str) -> str:
    if not _ROOM_ID_RE.fullmatch(value):
        raise ValueError(
            "room_id must be <moduleCode>-LEC-<classNo>@<YYYY-MM-DD>-<HHMM>-<venue>"
            "@<acadYear>@<semester>"
        )
    return value


RoomId = Annotated[str, AfterValidator(_validate_room_id)]


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=500)

    def model_post_init(self, __context: object, /) -> None:
        stripped = self.content.strip()
        if not stripped:
            raise ValueError("content must not be blank")
        object.__setattr__(self, "content", stripped)


class MessageOut(BaseModel):
    message_id: str
    room_id: str
    author_id: str
    content: str
    posted_at: str
    expires_at: str


class MessagePage(BaseModel):
    items: list[MessageOut]
    next_cursor: str | None


class ConnectionTicket(BaseModel):
    path: str
    session_expires_at: int

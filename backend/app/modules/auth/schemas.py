from pydantic import BaseModel, Field


class CurrentUser(BaseModel):
    user_id: str
    # Internal credential lifetime, excluded from /auth/me responses.
    token_expires_at: int | None = Field(default=None, exclude=True)

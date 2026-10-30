from pydantic import BaseModel


class CurrentUser(BaseModel):
    user_id: str

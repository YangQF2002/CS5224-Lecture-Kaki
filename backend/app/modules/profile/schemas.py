from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator

# The lecture snapshot (index.json) publishes the topic taxonomy; the API stays
# independent of it and only bounds what a user can store.
TopicName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)
]

# Shown to other users on the Forum. Letters, digits, "_" and "-" only, which
# also keeps email addresses out of usernames.
Username = Annotated[
    str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9_-]{3,20}$")
]


class TopicsIn(BaseModel):
    topics: list[TopicName] = Field(default_factory=list, max_length=50)

    @field_validator("topics")
    @classmethod
    def unique_topics(cls, topics: list[str]) -> list[str]:
        return list(dict.fromkeys(topics))


class UsernameIn(BaseModel):
    username: Username


class Profile(BaseModel):
    username: str
    topics: list[str]

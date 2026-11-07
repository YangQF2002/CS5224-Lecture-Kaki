from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator

# The lecture snapshot (index.json) publishes the topic taxonomy; the API stays
# independent of it and only bounds what a user can store.
TopicName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)
]


class Profile(BaseModel):
    topics: list[TopicName] = Field(default_factory=list, max_length=50)

    @field_validator("topics")
    @classmethod
    def unique_topics(cls, topics: list[str]) -> list[str]:
        return list(dict.fromkeys(topics))

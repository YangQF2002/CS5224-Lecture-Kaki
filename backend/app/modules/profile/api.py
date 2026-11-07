from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.modules.auth import CurrentUser, get_current_user

from .repository import (
    ProfileRepository,
    ProfileRepositoryUnavailable,
    UsernameTaken,
    get_profile_repository,
)
from .schemas import Profile, TopicsIn, UsernameIn

router = APIRouter(prefix="/profile", tags=["Profile"])


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Profile storage is unavailable",
    )


def repository_dependency() -> ProfileRepository:
    try:
        return get_profile_repository()
    except ProfileRepositoryUnavailable:
        raise _unavailable() from None


CurrentUserDependency = Annotated[CurrentUser, Depends(get_current_user)]
RepositoryDependency = Annotated[ProfileRepository, Depends(repository_dependency)]


@router.get("", response_model=Profile)
def read_profile(
    user: CurrentUserDependency,
    repository: RepositoryDependency,
) -> Profile:
    try:
        return repository.get(user.user_id)
    except ProfileRepositoryUnavailable:
        raise _unavailable() from None


@router.put("/topics", response_model=Profile)
def replace_topics(
    body: TopicsIn,
    user: CurrentUserDependency,
    repository: RepositoryDependency,
) -> Profile:
    try:
        return repository.save_topics(user.user_id, body.topics)
    except ProfileRepositoryUnavailable:
        raise _unavailable() from None


@router.put("/username", response_model=Profile)
def change_username(
    body: UsernameIn,
    user: CurrentUserDependency,
    repository: RepositoryDependency,
) -> Profile:
    try:
        return repository.set_username(user.user_id, body.username)
    except UsernameTaken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That username is already taken",
        ) from None
    except ProfileRepositoryUnavailable:
        raise _unavailable() from None

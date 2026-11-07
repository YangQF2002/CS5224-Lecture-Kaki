from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.modules.auth import CurrentUser, get_current_user

from .repository import (
    ProfileRepository,
    ProfileRepositoryUnavailable,
    get_profile_repository,
)
from .schemas import Profile

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


@router.put("", response_model=Profile)
def replace_profile(
    profile: Profile,
    user: CurrentUserDependency,
    repository: RepositoryDependency,
) -> Profile:
    try:
        return repository.save(user.user_id, profile)
    except ProfileRepositoryUnavailable:
        raise _unavailable() from None

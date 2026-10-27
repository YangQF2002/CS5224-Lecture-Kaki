from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.modules.auth import CurrentUser, get_current_user

from .nusmods import (
    NusmodsClient,
    NusmodsUnavailable,
    get_nusmods_client,
)
from .repository import (
    TimetableRepository,
    TimetableRepositoryUnavailable,
    get_timetable_repository,
)
from .schemas import Timetable
from .service import InvalidTimetableSelection, validate_timetable

router = APIRouter(
    prefix="/timetable",
    tags=["Timetable"],
)


def repository_dependency() -> TimetableRepository:
    try:
        return get_timetable_repository()
    except TimetableRepositoryUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Timetable storage is unavailable",
        ) from None


CurrentUserDependency = Annotated[
    CurrentUser,
    Depends(get_current_user),
]
RepositoryDependency = Annotated[
    TimetableRepository,
    Depends(repository_dependency),
]
NusmodsDependency = Annotated[
    NusmodsClient,
    Depends(get_nusmods_client),
]


@router.get("", response_model=Timetable)
def read_timetable(
    user: CurrentUserDependency,
    repository: RepositoryDependency,
) -> Timetable:
    try:
        timetable = repository.get(user.user_id)
    except TimetableRepositoryUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Timetable storage is unavailable",
        ) from None

    if timetable is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Timetable not found",
        )

    return timetable


@router.put("", response_model=Timetable)
def replace_timetable(
    timetable: Timetable,
    user: CurrentUserDependency,
    repository: RepositoryDependency,
    nusmods: NusmodsDependency,
) -> Timetable:
    try:
        validated = validate_timetable(timetable, nusmods)
        return repository.save(user.user_id, validated)
    except InvalidTimetableSelection as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from None
    except NusmodsUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="NUSMods validation is unavailable",
        ) from None
    except TimetableRepositoryUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Timetable storage is unavailable",
        ) from None


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_timetable(
    user: CurrentUserDependency,
    repository: RepositoryDependency,
) -> Response:
    try:
        repository.delete(user.user_id)
    except TimetableRepositoryUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Timetable storage is unavailable",
        ) from None

    return Response(status_code=status.HTTP_204_NO_CONTENT)

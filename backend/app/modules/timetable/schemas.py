from typing import Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_serializer,
    model_validator,
)

MODULE_CODE_PATTERN = r"^[A-Z]{2,4}\s?\d{4}[A-Z0-9]{0,3}$"
ACADEMIC_YEAR_PATTERN = r"^\d{4}-\d{4}$"


class TimetableSelection(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, extra="forbid", str_strip_whitespace=True
    )

    module_code: str = Field(
        alias="moduleCode",
        min_length=6,
        max_length=12,
        pattern=MODULE_CODE_PATTERN,
    )
    module_title: str = Field(alias="moduleTitle", min_length=1, max_length=300)
    lesson_type: str = Field(alias="lessonType", min_length=1, max_length=100)
    class_no: str = Field(alias="classNo", min_length=1, max_length=50)
    day: str | None = Field(default=None, min_length=1, max_length=20)
    week: int | None = Field(default=None, ge=1, le=13)
    source: Literal["discover"] | None = None

    @model_serializer(mode="wrap")
    def omit_empty_occurrence_fields(self, handler):
        return {key: value for key, value in handler(self).items() if value is not None}

    @field_validator("module_code", mode="before")
    @classmethod
    def normalize_module_code(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().upper()
        return value


class Timetable(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, extra="forbid", str_strip_whitespace=True
    )

    academic_year: str = Field(alias="academicYear", pattern=ACADEMIC_YEAR_PATTERN)
    semester: Literal[1, 2, 3, 4]
    selections: list[TimetableSelection] = Field(max_length=100)

    @model_validator(mode="after")
    def validate_timetable(self) -> Self:
        start_year, end_year = map(int, self.academic_year.split("-"))

        if end_year != start_year + 1:
            raise ValueError("academic year must contain consecutive years")

        identifiers = [
            (
                selection.module_code,
                selection.lesson_type,
                selection.week,
                selection.day,
            )
            for selection in self.selections
        ]

        if len(identifiers) != len(set(identifiers)):
            raise ValueError("a module may contain only one class per lesson type")

        return self


class TimetableBook(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True, extra="forbid", str_strip_whitespace=True
    )

    academic_year: str = Field(alias="academicYear", pattern=ACADEMIC_YEAR_PATTERN)
    # JSON object keys arrive as strings; Pydantic coerces them to integers
    # before the validator checks the supported semester range.
    semesters: dict[int, list[TimetableSelection]]

    @model_validator(mode="after")
    def validate_book(self) -> Self:
        start_year, end_year = map(int, self.academic_year.split("-"))
        if end_year != start_year + 1:
            raise ValueError("academic year must contain consecutive years")

        if any(semester not in (1, 2, 3, 4) for semester in self.semesters):
            raise ValueError("semester must be one of 1, 2, 3, or 4")

        for selections in self.semesters.values():
            identifiers = [
                (
                    selection.module_code,
                    selection.lesson_type,
                    selection.week,
                    selection.day,
                )
                for selection in selections
            ]
            if len(identifiers) != len(set(identifiers)):
                raise ValueError("a module may contain only one class per lesson type")
            if len(selections) > 100:
                raise ValueError("a semester may contain at most 100 selections")

        return self

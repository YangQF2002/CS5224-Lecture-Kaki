import json
from pathlib import Path

import pytest

from ingest.academic_calendar import SEMESTERS

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def module_info() -> list[dict]:
    return json.loads((FIXTURES / "moduleInfo.json").read_text(encoding="utf-8"))


@pytest.fixture
def venue_info() -> dict:
    return json.loads(
        (FIXTURES / "venueInformation-sem1.json").read_text(encoding="utf-8")
    )


@pytest.fixture
def sem1():
    return SEMESTERS[("2026-2027", 1)]

"""Download NUSMods module and venue data."""

import json
import time
import urllib.request
from typing import Any

BASE_URL = "https://api.nusmods.com/v2"


def fetch_json(url: str, *, attempts: int = 3, timeout: float = 60) -> Any:
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return json.load(response)
        except OSError:
            if attempt == attempts:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def fetch_semester(acad_year: str, semester: int) -> tuple[list[dict], dict]:
    """Return moduleInfo and venueInformation for one semester."""
    module_info = fetch_json(f"{BASE_URL}/{acad_year}/moduleInfo.json")
    venue_info = fetch_json(
        f"{BASE_URL}/{acad_year}/semesters/{semester}/venueInformation.json"
    )
    return module_info, venue_info

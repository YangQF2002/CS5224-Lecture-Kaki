import json
from functools import lru_cache
from http.client import HTTPException
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

API_BASE_URL = "https://api.nusmods.com/v2"
MAX_RESPONSE_BYTES = 5 * 1024 * 1024


class NusmodsUnavailable(Exception):
    """The NUSMods service could not provide usable data."""


class NusmodsModuleNotFound(Exception):
    """The requested module does not exist for the academic year."""


class NusmodsClient:
    def fetch_module(self, academic_year: str, module_code: str) -> dict[str, Any]:
        encoded_code = quote(module_code, safe="")
        url = f"{API_BASE_URL}/{academic_year}/modules/{encoded_code}.json"
        request = Request(url, headers={"User-Agent": "LectureKaki/1.0"})

        try:
            with urlopen(request, timeout=8) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
        except HTTPError as error:
            if error.code == 404:
                raise NusmodsModuleNotFound(module_code) from None
            raise NusmodsUnavailable("NUSMods request failed") from None
        except HTTPException, URLError, TimeoutError, OSError:
            raise NusmodsUnavailable("NUSMods is unavailable") from None

        if len(body) > MAX_RESPONSE_BYTES:
            raise NusmodsUnavailable("NUSMods response is too large")

        try:
            payload = json.loads(body)
        except UnicodeDecodeError, json.JSONDecodeError:
            raise NusmodsUnavailable("NUSMods returned an invalid response") from None

        if not isinstance(payload, dict):
            raise NusmodsUnavailable("NUSMods returned an invalid module")

        return payload


@lru_cache
def get_nusmods_client() -> NusmodsClient:
    return NusmodsClient()

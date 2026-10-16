"""Require an @u.nus.edu email address for sign-up."""

import re
from typing import Any

_LOCAL_PART = r"[a-z0-9!#$%&'*+/=?^_`{|}~-]+"
_NUS_EMAIL = re.compile(
    rf"{_LOCAL_PART}(?:\.{_LOCAL_PART})*@u\.nus\.edu", re.IGNORECASE | re.ASCII
)
SIGNUP_ERROR = "Sign up requires a valid @u.nus.edu email address."


def lambda_handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    email = event.get("request", {}).get("userAttributes", {}).get("email")
    if not isinstance(email, str) or _NUS_EMAIL.fullmatch(email) is None:
        raise ValueError(SIGNUP_ERROR)

    return event

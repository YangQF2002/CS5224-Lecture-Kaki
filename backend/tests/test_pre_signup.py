from copy import deepcopy

import pytest

from lambdas.pre_signup.handler import lambda_handler


@pytest.mark.parametrize(
    "email",
    ["student@u.nus.edu", "Student.Name@U.NUS.EDU", "student+test@u.nus.edu"],
)
def test_allowed_signup_preserves_confirmation_requirements(email: str) -> None:
    event = {
        "triggerSource": "PreSignUp_SignUp",
        "request": {"userAttributes": {"email": email}},
        "response": {
            "autoConfirmUser": False,
            "autoVerifyEmail": False,
            "autoVerifyPhone": False,
        },
    }
    original = deepcopy(event)

    result = lambda_handler(event, None)

    assert result == original


@pytest.mark.parametrize(
    "email",
    [
        "student@example.invalid",
        "student@nus.edu.sg",
        "student@u.nus.edu.evil",
        "student@evilu.nus.edu",
        "student@sub.u.nus.edu",
        "student@u-nus-edu",
        "student@@u.nus.edu",
        "@u.nus.edu",
        "student",
        "student name@u.nus.edu",
        "student..name@u.nus.edu",
        ".student@u.nus.edu",
        "student.@u.nus.edu",
        "student@u.nus.edu\n",
        " student@u.nus.edu",
        "student@u.nus.edu ",
        "student@u.nus.ed\u0443",
        "student@u.nu\u017f.edu",
        "",
        None,
        123,
    ],
)
def test_disallowed_or_malformed_email_is_rejected(email: object) -> None:
    event = {"request": {"userAttributes": {"email": email}}, "response": {}}

    with pytest.raises(ValueError, match=r"@u\.nus\.edu"):
        lambda_handler(event, None)


@pytest.mark.parametrize(
    "event", [{}, {"request": {}}, {"request": {"userAttributes": {}}}]
)
def test_missing_email_is_rejected(event: dict) -> None:
    with pytest.raises(ValueError, match=r"@u\.nus\.edu"):
        lambda_handler(event, None)


def test_allowed_signup_does_not_add_confirmation_flags() -> None:
    event = {
        "request": {"userAttributes": {"email": "student@u.nus.edu"}},
        "response": {},
    }

    result = lambda_handler(event, None)

    assert result["response"] == {}

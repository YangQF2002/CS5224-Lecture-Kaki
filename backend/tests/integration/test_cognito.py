import os
import secrets
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import httpx2
import jwt
import pytest
from dotenv import dotenv_values
from fastapi.testclient import TestClient

from app.auth import _get_jwks_client
from app.main import app

pytestmark = pytest.mark.cognito


@pytest.fixture(scope="module")
def live_config() -> Iterator[dict[str, str]]:
    file_values = dotenv_values(Path(__file__).resolve().parents[2] / ".env.local")
    config_names = (
        "AWS_REGION",
        "COGNITO_USER_POOL_ID",
        "COGNITO_CLIENT_ID",
    )
    names = (
        *config_names,
        "COGNITO_TEST_ACCESS_TOKEN",
        "COGNITO_TEST_ID_TOKEN",
    )
    settings = {
        name: os.getenv(name, file_values.get(name) or "").strip() for name in names
    }
    missing = [name for name in config_names if not settings[name]]
    if missing:
        pytest.fail(
            f"Set {', '.join(missing)} in backend/.env.local before live testing.",
            pytrace=False,
        )

    with pytest.MonkeyPatch.context() as patch:
        for name in config_names:
            patch.setenv(name, settings[name])
        _get_jwks_client.cache_clear()
        try:
            yield settings
        finally:
            _get_jwks_client.cache_clear()


@pytest.fixture(scope="module")
def live_tokens(live_config: dict[str, str]) -> dict[str, str]:
    access_token = live_config["COGNITO_TEST_ACCESS_TOKEN"]
    id_token = live_config["COGNITO_TEST_ID_TOKEN"]
    if not access_token or not id_token:
        pytest.fail(
            "Set fresh COGNITO_TEST_ACCESS_TOKEN and COGNITO_TEST_ID_TOKEN from "
            "the same login in backend/.env.local.",
            pytrace=False,
        )

    # Verify the ID token before testing its rejection as an API credential.
    issuer = (
        f"https://cognito-idp.{live_config['AWS_REGION']}.amazonaws.com/"
        f"{live_config['COGNITO_USER_POOL_ID']}"
    )
    key = _get_jwks_client(issuer).get_signing_key_from_jwt(id_token)
    claims = jwt.decode(
        id_token,
        key.key,
        algorithms=["RS256"],
        issuer=issuer,
        audience=live_config["COGNITO_CLIENT_ID"],
        options={"require": ["exp", "iss", "aud", "sub", "token_use"]},
    )
    assert claims["token_use"] == "id"
    assert claims["sub"].strip()
    return {"access": access_token, "id": id_token, "user_id": claims["sub"]}


@pytest.fixture(scope="module")
def client(live_config) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def get_me(client: TestClient, token: str) -> httpx2.Response:
    return client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})


def test_real_tokens_authenticate_only_with_access_token(client, live_tokens) -> None:
    response = get_me(client, live_tokens["access"])

    assert response.status_code == 200
    assert response.json() == {"user_id": live_tokens["user_id"]}

    response = get_me(client, live_tokens["id"])

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


@pytest.mark.parametrize("domain", ["example.com", "u.nus.edu.example.com"])
def test_cognito_rejects_non_nus_signup(live_config, domain) -> None:
    email = f"lecture-kaki-test-{uuid4().hex}@{domain}"
    response = httpx2.post(
        f"https://cognito-idp.{live_config['AWS_REGION']}.amazonaws.com/",
        headers={
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": "AWSCognitoIdentityProviderService.SignUp",
        },
        json={
            "ClientId": live_config["COGNITO_CLIENT_ID"],
            "Username": email,
            "Password": f"Aa1!{secrets.token_urlsafe(24)}",
            "UserAttributes": [{"Name": "email", "Value": email}],
        },
        timeout=10,
    )

    assert response.status_code == 400
    error = response.json()
    assert error["__type"].split("#")[-1] == "UserLambdaValidationException"
    assert "@u.nus.edu" in error["message"]

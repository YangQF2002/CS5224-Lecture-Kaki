import json
import os
import subprocess
import sys
from collections.abc import Iterator
from io import BytesIO
from time import time
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.error import URLError

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from httpx2 import Response

from app.auth import _get_jwks_client, get_current_user
from app.main import app

REGION = "ap-southeast-1"
POOL_ID = "ap-southeast-1_TestPool"
CLIENT_ID = "testclient"
ISSUER = f"https://cognito-idp.{REGION}.amazonaws.com/{POOL_ID}"
DOMAIN = "https://test.auth.ap-southeast-1.amazoncognito.com"


@pytest.fixture(scope="module")
def signing_keys() -> list[rsa.RSAPrivateKey]:
    return [
        rsa.generate_private_key(public_exponent=65537, key_size=2048) for _ in range(2)
    ]


def jwks(key: rsa.RSAPrivateKey, kid: str = "test-key") -> bytes:
    public_key = jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    return json.dumps(
        {"keys": [{**public_key, "kid": kid, "alg": "RS256", "use": "sig"}]}
    ).encode()


def token_claims(**overrides: object) -> dict[str, object]:
    now = int(time())
    return {
        "iss": ISSUER,
        "client_id": CLIENT_ID,
        "token_use": "access",
        "sub": "test-user",
        "iat": now,
        "exp": now + 900,
        **overrides,
    }


def access_token(
    key: rsa.RSAPrivateKey, kid: str | None = "test-key", **overrides: object
) -> str:
    headers = {} if kid is None else {"kid": kid}
    return jwt.encode(
        token_claims(**overrides), key, algorithm="RS256", headers=headers
    )


@pytest.fixture(autouse=True)
def auth_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("AWS_REGION", REGION)
    monkeypatch.setenv("COGNITO_USER_POOL_ID", POOL_ID)
    monkeypatch.setenv("COGNITO_CLIENT_ID", CLIENT_ID)
    _get_jwks_client.cache_clear()
    yield
    _get_jwks_client.cache_clear()


@pytest.fixture
def jwks_http(
    monkeypatch: pytest.MonkeyPatch, signing_keys: list[rsa.RSAPrivateKey]
) -> Mock:
    opener = Mock(side_effect=lambda request, timeout: BytesIO(jwks(signing_keys[0])))
    monkeypatch.setattr(
        "jwt.jwks_client.urllib.request.build_opener",
        lambda *handlers: SimpleNamespace(open=opener),
    )
    return opener


@pytest.fixture
def client(jwks_http: Mock) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Mock:
    clock = Mock(return_value=0.0)
    for module in ("jwt.api_jwk", "jwt.jwk_set_cache", "jwt.jwks_client"):
        monkeypatch.setattr(f"{module}.time", SimpleNamespace(monotonic=clock))
    return clock


def get_me(client: TestClient, token: str) -> Response:
    return client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})


def assert_unauthorised(response: Response) -> None:
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_valid_token_returns_only_user_id(client: TestClient, signing_keys) -> None:
    for user_id in ("first-user", "second-user"):
        response = get_me(client, access_token(signing_keys[0], sub=user_id))

        assert response.status_code == 200
        assert response.json() == {"user_id": user_id}


def test_oauth_bearer_string_returns_current_user(signing_keys, jwks_http) -> None:
    user = get_current_user(access_token(signing_keys[0]))

    assert user.user_id == "test-user"


@pytest.mark.parametrize("authorisation", [None, "Basic abc", "Bearer", "Bearer abc"])
def test_missing_or_malformed_credentials(client: TestClient, authorisation) -> None:
    headers = {} if authorisation is None else {"Authorization": authorisation}

    assert_unauthorised(client.get("/auth/me", headers=headers))


@pytest.mark.parametrize(
    ("claim", "value"),
    [
        ("exp", 0),
        ("exp", "not-a-time"),
        ("iss", ISSUER + "/other"),
        ("client_id", "another-client"),
        ("sub", ""),
        ("sub", "  "),
        ("sub", 123),
        ("iat", int(time()) + 3600),
    ],
)
def test_invalid_claims_are_rejected(
    client: TestClient, signing_keys, claim, value
) -> None:
    assert_unauthorised(get_me(client, access_token(signing_keys[0], **{claim: value})))


@pytest.mark.parametrize("claim", ["exp", "iss", "sub", "client_id", "token_use"])
def test_missing_required_claim_is_rejected(
    client: TestClient, signing_keys, claim
) -> None:
    claims = token_claims()
    del claims[claim]
    token = jwt.encode(
        claims, signing_keys[0], algorithm="RS256", headers={"kid": "test-key"}
    )

    assert_unauthorised(get_me(client, token))


def test_id_token_is_rejected_even_with_matching_client_id(
    client, signing_keys
) -> None:
    token = access_token(signing_keys[0], token_use="id", aud=CLIENT_ID)

    assert_unauthorised(get_me(client, token))


def test_audience_does_not_replace_client_id_check(
    client: TestClient, signing_keys
) -> None:
    token = access_token(signing_keys[0], client_id="another-client", aud=CLIENT_ID)

    assert_unauthorised(get_me(client, token))


def test_tampered_claim_is_rejected(client: TestClient, signing_keys) -> None:
    header, payload, signature = access_token(signing_keys[0]).split(".")
    claims = json.loads(jwt.utils.base64url_decode(payload))
    claims["sub"] = "forged-user"
    tampered_payload = jwt.utils.base64url_encode(json.dumps(claims).encode()).decode()

    token = f"{header}.{tampered_payload}.{signature}"
    response = get_me(client, token)

    assert_unauthorised(response)
    assert token not in response.text


@pytest.mark.parametrize("algorithm", ["HS256", "RS512", "none"])
def test_other_algorithms_are_rejected(
    client: TestClient, signing_keys, algorithm, jwks_http: Mock
) -> None:
    key = {"RS512": signing_keys[0], "HS256": "x" * 32, "none": None}[algorithm]
    token = jwt.encode(
        token_claims(),
        key,
        algorithm=algorithm,
        headers={"kid": "test-key"},
    )

    assert_unauthorised(get_me(client, token))
    jwks_http.assert_not_called()


@pytest.mark.parametrize("kid", [None, ""])
def test_missing_or_invalid_key_id_is_rejected(
    client: TestClient, signing_keys, kid, jwks_http
) -> None:
    token = access_token(signing_keys[0], kid=kid)

    assert_unauthorised(get_me(client, token))
    jwks_http.assert_not_called()


def test_signing_keys_are_cached_and_use_only_configured_url(
    client, signing_keys, jwks_http
) -> None:
    token = jwt.encode(
        token_claims(),
        signing_keys[0],
        algorithm="RS256",
        headers={"kid": "test-key", "jku": "https://attacker.invalid/keys"},
    )

    assert get_me(client, token).status_code == 200
    assert get_me(client, token).status_code == 200
    jwks_http.assert_called_once()
    assert jwks_http.call_args.args[0].full_url == f"{ISSUER}/.well-known/jwks.json"
    assert 0 < jwks_http.call_args.kwargs["timeout"] < float("inf")


@pytest.mark.parametrize("rotated_key_available", [True, False])
def test_unknown_key_refreshes_after_cooldown(
    client, signing_keys, jwks_http, clock, rotated_key_available
) -> None:
    assert get_me(client, access_token(signing_keys[0])).status_code == 200
    token = access_token(signing_keys[1], kid="rotated-key")

    assert_unauthorised(get_me(client, token))
    assert jwks_http.call_count == 1

    clock.return_value = 31.0
    if rotated_key_available:
        jwks_http.side_effect = lambda request, timeout: BytesIO(
            jwks(signing_keys[1], "rotated-key")
        )
    response = get_me(client, token)

    assert jwks_http.call_count == 2
    if rotated_key_available:
        assert response.status_code == 200
        assert response.json() == {"user_id": "test-user"}
    else:
        assert_unauthorised(response)


@pytest.mark.parametrize("during_refresh", [False, True])
def test_jwks_outage_returns_service_unavailable(
    client, signing_keys, jwks_http, clock, during_refresh
) -> None:
    token = access_token(signing_keys[0])
    if during_refresh:
        assert get_me(client, token).status_code == 200
        clock.return_value = 31.0
        token = access_token(signing_keys[1], kid="rotated-key")
    jwks_http.side_effect = URLError("private upstream details")

    response = get_me(client, token)

    assert response.status_code == 503
    assert "private upstream details" not in response.text
    assert token not in response.text


@pytest.mark.parametrize("payload", [b"invalid JSON", b"[]", b'{"keys": []}'])
def test_malformed_jwks_returns_service_unavailable(
    client, signing_keys, jwks_http, payload
) -> None:
    jwks_http.side_effect = lambda request, timeout: BytesIO(payload)

    response = get_me(client, access_token(signing_keys[0]))

    assert response.status_code == 503


def test_cached_key_still_works_during_jwks_outage(
    client, signing_keys, jwks_http
) -> None:
    token = access_token(signing_keys[0])
    assert get_me(client, token).status_code == 200
    jwks_http.side_effect = URLError("offline")

    assert get_me(client, token).status_code == 200
    assert jwks_http.call_count == 1


@pytest.mark.parametrize("upstream_unavailable", [False, True])
def test_expired_key_cache_does_not_keep_trusting_old_keys(
    client, signing_keys, jwks_http, clock, upstream_unavailable
) -> None:
    token = access_token(signing_keys[0])
    assert get_me(client, token).status_code == 200
    clock.return_value = 301.0
    if upstream_unavailable:
        jwks_http.side_effect = URLError("offline")
    else:
        jwks_http.side_effect = lambda request, timeout: BytesIO(
            jwks(signing_keys[1], "rotated-key")
        )

    response = get_me(client, token)

    assert jwks_http.call_count == 2
    if upstream_unavailable:
        assert response.status_code == 503
    else:
        assert_unauthorised(response)


@pytest.mark.parametrize(
    "variable", ["AWS_REGION", "COGNITO_USER_POOL_ID", "COGNITO_CLIENT_ID"]
)
def test_missing_configuration_returns_service_unavailable(
    client, signing_keys, monkeypatch, variable, jwks_http
) -> None:
    monkeypatch.delenv(variable)

    response = get_me(client, access_token(signing_keys[0]))

    assert response.status_code == 503
    jwks_http.assert_not_called()


def test_swagger_uses_cognito_code_flow_with_pkce() -> None:
    script = """
import json
from app.main import app
schema = app.openapi()
print(json.dumps({"oauth": app.swagger_ui_init_oauth, "security": schema["components"]["securitySchemes"], "paths": schema["paths"]}))
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        env={**os.environ, "COGNITO_DOMAIN": DOMAIN},
        capture_output=True,
        text=True,
        check=True,
        timeout=15,
    )
    settings = json.loads(result.stdout)
    assert settings["oauth"]["clientId"] == CLIENT_ID
    assert settings["oauth"]["scopes"] == "openid"
    assert settings["oauth"]["usePkceWithAuthorizationCodeGrant"] is True
    flow = settings["security"]["OAuth2AuthorizationCodeBearer"]["flows"][
        "authorizationCode"
    ]
    assert flow["authorizationUrl"] == f"{DOMAIN}/oauth2/authorize"
    assert flow["tokenUrl"] == f"{DOMAIN}/oauth2/token"
    assert settings["paths"]["/auth/me"]["get"]["security"] == [
        {"OAuth2AuthorizationCodeBearer": []}
    ]

"""Validate Cognito access tokens for protected API routes."""

import os
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
    OAuth2AuthorizationCodeBearer,
)
from jwt import PyJWKClient
from jwt.exceptions import (
    InvalidTokenError,
    PyJWKClientConnectionError,
    PyJWKClientError,
    PyJWTError,
)
from pydantic import BaseModel

_domain = os.getenv("COGNITO_DOMAIN", "").strip().rstrip("/")
_bearer = (
    OAuth2AuthorizationCodeBearer(
        authorizationUrl=f"{_domain}/oauth2/authorize",
        tokenUrl=f"{_domain}/oauth2/token",
        scopes={"openid": "Sign in with Cognito"},
        auto_error=False,
    )
    if _domain
    else HTTPBearer(auto_error=False)
)


class CurrentUser(BaseModel):
    user_id: str


class _JWKClient(PyJWKClient):
    def fetch_data(self) -> Any:
        try:
            return super().fetch_data()
        except (PyJWTError, ValueError) as error:
            # Malformed responses from the trusted endpoint are service failures.
            raise PyJWKClientConnectionError("Signing keys are unavailable") from error


@lru_cache
def _get_jwks_client(issuer: str) -> PyJWKClient:
    return _JWKClient(f"{issuer}/.well-known/jwks.json", timeout=5)


def _unauthorised() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Invalid or missing access token",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Annotated[str | HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> CurrentUser:
    token = (
        credentials.credentials
        if isinstance(credentials, HTTPAuthorizationCredentials)
        else credentials
    )
    if not token:
        raise _unauthorised()

    region = os.getenv("AWS_REGION", "").strip()
    pool_id = os.getenv("COGNITO_USER_POOL_ID", "").strip()
    client_id = os.getenv("COGNITO_CLIENT_ID", "").strip()
    if not all((region, pool_id, client_id)):
        raise HTTPException(status_code=503, detail="Authentication is unavailable")

    issuer = f"https://cognito-idp.{region}.amazonaws.com/{pool_id}"
    try:
        header = jwt.get_unverified_header(token)
        if (
            header.get("alg") != "RS256"
            or not isinstance(header.get("kid"), str)
            or not header["kid"]
        ):
            raise InvalidTokenError()

        key = _get_jwks_client(issuer).get_signing_key(header["kid"])
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            issuer=issuer,
            options={
                "require": ["exp", "iss", "sub", "client_id", "token_use"],
                # Cognito access tokens identify the app with client_id, not aud.
                "verify_aud": False,
            },
        )
        if (
            claims["client_id"] != client_id
            or claims["token_use"] != "access"
            or not claims["sub"].strip()
        ):
            raise InvalidTokenError()
    except PyJWKClientConnectionError:
        raise HTTPException(
            status_code=503, detail="Authentication is unavailable"
        ) from None
    except InvalidTokenError, PyJWKClientError:
        raise _unauthorised() from None

    return CurrentUser(user_id=claims["sub"])


router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get("/me")
def read_current_user(
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    return user

import pytest
from fastapi.testclient import TestClient

from app.main import app


def test_health_is_public_without_auth_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for variable in (
        "AWS_REGION",
        "COGNITO_USER_POOL_ID",
        "COGNITO_CLIENT_ID",
        "COGNITO_DOMAIN",
    ):
        monkeypatch.delenv(variable, raising=False)

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

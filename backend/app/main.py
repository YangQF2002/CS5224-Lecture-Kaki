import os

from fastapi import FastAPI

from app.health import router as health_router
from app.modules.auth import router as auth_router
from app.modules.forum import router as forum_router

app = FastAPI(
    title="LectureKaki API",
    swagger_ui_init_oauth=(
        {
            "clientId": os.getenv("COGNITO_CLIENT_ID", "").strip(),
            "scopes": "openid",
            "usePkceWithAuthorizationCodeGrant": True,
        }
        if os.getenv("COGNITO_DOMAIN", "").strip()
        and os.getenv("COGNITO_CLIENT_ID", "").strip()
        else None
    ),
)
app.include_router(auth_router)
app.include_router(health_router)
app.include_router(forum_router)

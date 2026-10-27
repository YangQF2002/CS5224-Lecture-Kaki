import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.health import router as health_router
from app.modules.auth import router as auth_router
from app.modules.timetable import router as timetable_router

def frontend_origins() -> list[str]:
    configured = os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,http://localhost:8080",
    )

    return [
        origin.strip().rstrip("/")
        for origin in configured.split(",")
        if origin.strip()
    ]

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins(),
    allow_credentials=False,
    allow_methods=["GET", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth_router)
app.include_router(timetable_router)
app.include_router(health_router)

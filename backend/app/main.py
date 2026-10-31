import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.health import router as health_router
from app.modules.auth import router as auth_router
from app.modules.forum import router as forum_router
from app.modules.forum.repository import ForumStorageUnavailable
from app.modules.forum.service import frontend_origins
from app.modules.timetable import router as timetable_router

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
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(ForumStorageUnavailable)
async def forum_storage_unavailable(_request, _error):
    return JSONResponse(
        status_code=503, content={"detail": "Forum storage is unavailable"}
    )


app.include_router(auth_router)
app.include_router(timetable_router)
app.include_router(health_router)
app.include_router(forum_router)

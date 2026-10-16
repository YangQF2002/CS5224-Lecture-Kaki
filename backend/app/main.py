import os

from fastapi import FastAPI

from app.auth import router as auth_router

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


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

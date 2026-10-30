"""Shared browser-origin configuration for HTTP and WebSocket requests."""

import os


def frontend_origins() -> list[str]:
    # Match the timetable contract while keeping the earlier Forum setting valid.
    configured = os.getenv(
        "FRONTEND_ORIGINS",
        os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:8080"),
    )
    return [
        origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()
    ]

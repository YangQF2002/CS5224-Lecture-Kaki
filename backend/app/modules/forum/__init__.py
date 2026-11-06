"""Public forum interface."""

from fastapi import APIRouter

from .api import router as message_router
from .attachments import router as attachment_router

router = APIRouter()
router.include_router(message_router)
router.include_router(attachment_router)

__all__ = ["router"]

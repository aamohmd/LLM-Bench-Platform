"""Administrator-only installation setup guide; never exposes credentials."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.app.core.auth import require_api_key

router = APIRouter(prefix="/onboarding", tags=["Setup guide"])


class TutorialState(BaseModel):
    status: Literal["active", "dismissed", "completed"]


def _store(request: Request):
    if request.app.state.history_store is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return request.app.state.history_store


@router.get("")
def progress(request: Request, auth: dict = Depends(require_api_key("admin"))):
    return _store(request).onboarding_progress()


@router.patch("")
def update_progress(payload: TutorialState, request: Request, auth: dict = Depends(require_api_key("admin"))):
    return _store(request).set_onboarding_status(payload.status)

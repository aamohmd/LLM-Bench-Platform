"""Authenticated session metadata for the dashboard shell."""

from fastapi import APIRouter, Depends

from backend.app.core.auth import require_api_key

router = APIRouter(tags=["auth-session"])


@router.get("/auth/session")
def get_session(auth: dict = Depends(require_api_key(scope="visitor"))) -> dict:
    """Return only the caller's role; protected resources remain separately gated."""
    return {"scope": auth["scope"]}

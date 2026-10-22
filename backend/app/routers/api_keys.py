"""Admin-only API key lifecycle endpoints for the dashboard settings page."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.app.core.auth import require_api_key
from backend.app.repositories.history_store import ApiKeyRecord, BenchmarkHistoryRepository
from backend.app.schemas import ApiKeyCreateRequest, ApiKeyCreateResponse, ApiKeySummary


router = APIRouter(tags=["api-keys"], dependencies=[Depends(require_api_key(scope="admin"))])


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _summary(record: ApiKeyRecord) -> ApiKeySummary:
    now = datetime.now(timezone.utc)
    status = "revoked" if record.revoked_at else "expired" if record.expires_at and _utc(record.expires_at) <= now else "active"
    return ApiKeySummary(
        id=record.id,
        name=record.name,
        scope=record.scope,
        environment=record.environment,
        created_at=record.created_at,
        last_used_at=record.last_used_at,
        expires_at=record.expires_at,
        revoked_at=record.revoked_at,
        status=status,
    )


def _history_store(request: Request) -> BenchmarkHistoryRepository:
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return history_store


@router.get("/api-keys", response_model=list[ApiKeySummary])
def list_api_keys(request: Request) -> list[ApiKeySummary]:
    return [_summary(record) for record in _history_store(request).list_api_keys()]


@router.post("/api-keys", response_model=ApiKeyCreateResponse, status_code=201)
def create_api_key(payload: ApiKeyCreateRequest, request: Request) -> ApiKeyCreateResponse:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Key name is required")
    if payload.expires_at and _utc(payload.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="Expiry must be in the future")

    raw_key = f"llm_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    record = _history_store(request).create_api_key(
        key_hash,
        name,
        payload.scope,
        environment=payload.environment.strip() if payload.environment else None,
        expires_at=payload.expires_at,
    )
    return ApiKeyCreateResponse(**_summary(record).model_dump(), key=raw_key)


@router.delete("/api-keys/{key_id}", status_code=200)
def revoke_api_key(key_id: int, request: Request) -> dict[str, str]:
    if not _history_store(request).revoke_api_key_by_id(key_id):
        raise HTTPException(status_code=404, detail="API key is unavailable or already revoked")
    return {"status": "revoked"}

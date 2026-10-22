"""
Validates API keys on incoming requests via the X-API-Key header.
Runs inside the hosted backend (Railway); gates every route except /health.
Checks against hashed keys in the api_keys table (see history_store.py).
Two scopes exist: "admin" (read, contribute, and key lifecycle) and "visitor"
(read-only). Benchmark submission requires an admin key.
"""

import hashlib
import logging
from datetime import datetime, timezone
from fastapi import Depends, HTTPException, Security
from fastapi.security.api_key import APIKeyHeader
from backend.app.repositories.history_store import BenchmarkHistoryRepository
from backend.app.core.config import get_settings
from fastapi import Request

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
logger = logging.getLogger(__name__)

def require_api_key(scope: str):
    def _require_api_key(
        request: Request,
        api_key_value: str = Security(api_key_header)
    ) -> dict:
        if not api_key_value:
            raise HTTPException(status_code=401, detail="API Key is missing")
        
        # Hash the incoming key
        key_hash = hashlib.sha256(api_key_value.encode("utf-8")).hexdigest()
        
        # We need the history_store from the app state
        history_store: BenchmarkHistoryRepository | None = request.app.state.history_store
        
        # If the app is starting or running offline/without DB, we might not have a history store, 
        # but in our architecture, the control plane always has it. 
        if not history_store:
            raise HTTPException(status_code=503, detail="Database unavailable")

        record = history_store.get_api_key(key_hash)
        if not record:
            raise HTTPException(status_code=401, detail="Invalid API Key")
        
        if record.revoked_at:
            raise HTTPException(status_code=401, detail="API Key has been revoked")

        expires_at = record.expires_at
        if expires_at and (expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="API Key has expired")

        if scope == "admin":
            if record.scope != "admin":
                raise HTTPException(status_code=403, detail="Insufficient permissions")
        elif scope == "visitor":
            if record.scope not in ["admin", "visitor"]:
                raise HTTPException(status_code=403, detail="Insufficient permissions")
        else:
            raise HTTPException(status_code=500, detail="Invalid authorization policy")

        history_store.touch_api_key(record.id)
        logger.debug(
            "Authenticated API request",
            extra={"api_key_id": record.id, "api_key_name": record.name, "required_scope": scope},
        )
        return {"id": record.id, "name": record.name, "scope": record.scope}
    
    return _require_api_key

"""Shared HTTP handling for permanent registry deletion."""

from fastapi import HTTPException, Request
from backend.app.repositories.history_store import DeletionConflict


def registry_deletion(request: Request, kind: str, entry_id: str, *, delete=False, expected_run_count=None):
    store = request.app.state.history_store
    if store is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    try:
        if delete:
            return store.delete_registry_entry(kind, entry_id, expected_run_count)
        return store.registry_deletion_impact(kind, entry_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DeletionConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

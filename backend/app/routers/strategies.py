"""Dynamic Strategy Registry API.

Provides full CRUD operations for prompt strategies / directives (zero hardcoding).
Allows listing, creating, updating, and deleting reasoning directives via API.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from backend.app.core.auth import require_api_key
from backend.app.routers.registry_deletion import registry_deletion
from backend.app.schemas import (
    PromptStrategyCreate,
    PromptStrategyResponse,
    PromptStrategyUpdate,
)

router = APIRouter(
    prefix="/strategies",
    tags=["strategies"],
    dependencies=[Depends(require_api_key(scope="admin"))],
)


def store(request: Request):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return history_store


@router.get("", response_model=list[PromptStrategyResponse])
def list_strategies(
    request: Request,
    include_inactive: bool = Query(default=False),
):
    """List all registered prompt strategies / reasoning directives."""
    return store(request).list_strategies(include_inactive=include_inactive)


@router.get("/{strategy_id_or_name}", response_model=PromptStrategyResponse)
def get_strategy(request: Request, strategy_id_or_name: str):
    """Retrieve details for a specific strategy by ID or slug name."""
    strategy = store(request).get_strategy(strategy_id_or_name)
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return strategy


@router.post(
    "",
    response_model=PromptStrategyResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_strategy(request: Request, payload: PromptStrategyCreate):
    """Create a new custom prompt reasoning directive (Admin only)."""
    try:
        return store(request).create_strategy(
            name=payload.name,
            label=payload.label,
            description=payload.description,
            directive_text=payload.directive_text,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.put(
    "/{strategy_id}",
    response_model=PromptStrategyResponse,
)
def update_strategy(request: Request, strategy_id: str, payload: PromptStrategyUpdate):
    """Update an existing prompt strategy (Admin only)."""
    strategy = store(request).update_strategy(
        strategy_id,
        label=payload.label,
        description=payload.description,
        directive_text=payload.directive_text,
        is_active=payload.is_active,
    )
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return strategy


@router.delete(
    "/{strategy_id}",
    status_code=status.HTTP_200_OK,
)
def delete_strategy(request: Request, strategy_id: str, expected_run_count: int | None = Query(None, ge=0)):
    """Delete a custom prompt strategy. Built-in strategies cannot be deleted (Admin only)."""
    return registry_deletion(request, "strategy", strategy_id, delete=True, expected_run_count=expected_run_count)


@router.get("/{strategy_id}/deletion-impact")
def strategy_deletion_impact(request: Request, strategy_id: str):
    return registry_deletion(request, "strategy", strategy_id)

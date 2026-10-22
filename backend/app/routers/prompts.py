"""Admin-only prompt registry."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from backend.app.core.auth import require_api_key
from backend.app.schemas import PromptComposeResponse, PromptCreate, PromptResponse, PromptUpdate
from backend.app.routers.registry_deletion import registry_deletion

router = APIRouter(
    prefix="/prompts",
    tags=["prompts"],
    dependencies=[Depends(require_api_key(scope="admin"))],
)


def store(request: Request):
    history_store = request.app.state.history_store
    if not history_store:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return history_store


@router.get("", response_model=list[PromptResponse])
def list_prompts(request: Request):
    return store(request).list_prompts()


@router.get("/compose", response_model=PromptComposeResponse)
def compose_prompt(
    request: Request,
    prompt: str = Query(..., description="Foundational prompt ID or name"),
    strategy: str | None = Query(default=None, description="Optional strategy/directive ID or name"),
):
    composed = store(request).compose_prompt(prompt, strategy)
    if not composed:
        raise HTTPException(status_code=404, detail="Prompt or strategy not found")
    return composed



@router.get("/{prompt_id_or_name}", response_model=PromptResponse)
def get_prompt(request: Request, prompt_id_or_name: str):
    prompt = store(request).get_prompt(prompt_id_or_name)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt


@router.post("", response_model=PromptResponse, status_code=status.HTTP_201_CREATED)
def create_prompt(request: Request, payload: PromptCreate):
    try:
        return store(request).create_prompt(
            payload.name,
            payload.system_prompt,
            payload.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.put("/{prompt_id}", response_model=PromptResponse)
def update_prompt(request: Request, prompt_id: str, payload: PromptUpdate):
    prompt = store(request).update_prompt(
        prompt_id,
        payload.system_prompt,
        payload.description,
    )
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt


@router.get("/{prompt_id}/deletion-impact")
def prompt_deletion_impact(request: Request, prompt_id: str):
    return registry_deletion(request, "prompt", prompt_id)


@router.delete("/{prompt_id}")
def delete_prompt(request: Request, prompt_id: str, expected_run_count: int | None = Query(None, ge=0)):
    return registry_deletion(request, "prompt", prompt_id, delete=True, expected_run_count=expected_run_count)

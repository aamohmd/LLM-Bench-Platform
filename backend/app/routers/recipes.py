"""Domain-neutral deployment recipe export endpoints."""

from __future__ import annotations

import shlex
from datetime import datetime, timezone

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query

from backend.app.core.auth import require_api_key
from backend.app.schemas import ProductionRecipe, RecipeExportResponse

router = APIRouter(
    prefix="/recipes",
    tags=["recipes"],
    dependencies=[Depends(require_api_key(scope="visitor"))],
)


def _generate_artifacts(recipe: ProductionRecipe) -> RecipeExportResponse:
    """Render deployment artifacts from an explicit, measured recipe."""
    infra = recipe.infra_config
    if infra.engine != "vllm":
        raise HTTPException(status_code=422, detail="Deployment blueprint export currently supports the vLLM engine only")
    prompt = recipe.prompt_config
    rag = recipe.rag_config
    sla = recipe.sla_verdict

    vllm_args = [
        "python3",
        "-m",
        "vllm.entrypoints.openai.api_server",
        "--model",
        infra.model,
        "--max-model-len",
        str(infra.max_context_len),
        "--gpu-memory-utilization",
        str(infra.gpu_memory_utilization),
        "--port",
        "8000",
        "--host",
        "0.0.0.0",
    ]
    if infra.quantization and infra.quantization.lower() != "bfloat16":
        vllm_args.extend(("--quantization", infra.quantization.lower()))
    if infra.tensor_parallel_size > 1:
        vllm_args.extend(("--tensor-parallel-size", str(infra.tensor_parallel_size)))
    if infra.kv_cache_dtype:
        vllm_args.extend(("--kv-cache-dtype", infra.kv_cache_dtype))
    if infra.enable_prefix_caching is not None:
        vllm_args.append("--enable-prefix-caching" if infra.enable_prefix_caching else "--no-enable-prefix-caching")
    vllm_command = shlex.join(vllm_args)

    container_args = vllm_args[3:]
    docker_yaml = yaml.safe_dump(
        {
            "services": {
                "llm-inference": {
                    "image": "vllm/vllm-openai:latest",
                    "runtime": "nvidia",
                    "environment": ["HUGGING_FACE_HUB_TOKEN=${HF_TOKEN}"],
                    "command": container_args,
                    "ports": ["8000:8000"],
                    "ipc": "host",
                    "deploy": {
                        "resources": {
                            "reservations": {
                                "devices": [{
                                    "driver": "nvidia",
                                    "count": infra.tensor_parallel_size,
                                    "capabilities": ["gpu"],
                                }]
                            }
                        }
                    },
                    "restart": "unless-stopped",
                }
            }
        },
        sort_keys=False,
    )

    rag_config = {
        "collection_name": f"{recipe.workload}_documents",
        "chunk_size": rag.chunk_size,
        "chunk_overlap": rag.chunk_overlap,
        "top_k": rag.top_k,
        "use_reranker": rag.use_reranker,
        "reranker_model": rag.reranker_model,
        "injection_format": rag.injection_format,
        "prompt_strategy": prompt.system_template_id,
        "temperature": prompt.temperature,
        "max_tokens": prompt.max_output_tokens,
    }
    rag_config_py = "RAG_CONFIG = " + repr(rag_config) + "\n"

    recipe_yaml = yaml.safe_dump(
        {
            "name": recipe.name,
            "workload": recipe.workload,
            "description": recipe.description,
            "prompt": prompt.model_dump(),
            "rag": rag.model_dump(),
            "infra": infra.model_dump(),
            "sla_guarantees": sla.model_dump(),
        },
        sort_keys=False,
    )
    certificate = {
        "certificate_id": f"SLA-CERT-{recipe.id}",
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "workload": recipe.workload,
        "model": infra.model,
        "fit_status": sla.fit_status,
        "is_golden": sla.is_golden,
        "verified_metrics": {
            "decode_tps": sla.decode_tps,
            "median_ttft_ms": round(sla.median_ttft_s * 1000, 1),
            "p95_ttft_ms": round(sla.p95_ttft_s * 1000, 1),
            "accuracy_pct": round(sla.quality_score * 100, 1),
            "peak_vram_pct": sla.peak_vram_pct,
            "error_rate_pct": sla.error_rate_pct,
        },
    }
    return RecipeExportResponse(
        recipe_id=recipe.id,
        recipe_name=recipe.name,
        workload=recipe.workload,
        vllm_command=vllm_command,
        docker_compose_yaml=docker_yaml,
        rag_config_py=rag_config_py,
        recipe_yaml=recipe_yaml,
        sla_certificate=certificate,
    )


@router.get("", response_model=list[ProductionRecipe])
def list_recipes(
    workload: str | None = Query(default=None, description="Filter by recipe workload"),
) -> list[ProductionRecipe]:
    """Return no fabricated presets; measured recipes must come from registry data."""
    del workload
    return []


@router.get("/{recipe_id}", response_model=ProductionRecipe)
def get_recipe(recipe_id: str) -> ProductionRecipe:
    raise HTTPException(status_code=404, detail=f"Recipe '{recipe_id}' is not registered")


@router.get("/{recipe_id}/export", response_model=RecipeExportResponse)
def export_recipe(recipe_id: str) -> RecipeExportResponse:
    raise HTTPException(status_code=404, detail=f"Recipe '{recipe_id}' is not registered")


@router.post("/export", response_model=RecipeExportResponse)
def export_custom_recipe(payload: ProductionRecipe) -> RecipeExportResponse:
    """Generate a deployment blueprint from an explicitly supplied recipe."""
    return _generate_artifacts(payload)

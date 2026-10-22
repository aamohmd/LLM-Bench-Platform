from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

class CompositeComponent(BaseModel):
    score: float | None = None
    basis: str = ""


class CompositeScoreResult(BaseModel):
    profile: str
    tier: str
    score: float | None = None
    partial: bool = False
    available_components: list[str] = []
    weights_used: dict[str, float] = {}
    components: dict[str, CompositeComponent] = {}


class CompositeProfilesResponse(BaseModel):
    tiers: list[dict]
    profiles: dict[str, dict]


class PipelineConfigCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    engine: Literal["vllm", "ollama"] | str
    model: str = Field(min_length=1, max_length=200)
    quantization: str | None = None
    max_context_len: int = Field(gt=0, le=131072, default=4096)
    gpu_memory_utilization: float | None = Field(default=None, ge=0.1, le=1.0)
    retrieval_k: int | None = Field(default=None, ge=1, le=50)
    reranker_model: str | None = None
    agent_topology: str = Field(default="direct", max_length=100)
    parameters: dict[str, Any] = Field(default_factory=dict)


class PipelineConfigResponse(BaseModel):
    id: str
    config_hash: str
    created_at: datetime
    name: str
    engine: str
    model: str
    quantization: str | None = None
    max_context_len: int
    gpu_memory_utilization: float | None = None
    retrieval_k: int | None = None
    reranker_model: str | None = None
    agent_topology: str = "direct"
    parameters: dict[str, Any] = Field(default_factory=dict)


class RecipePromptConfig(BaseModel):
    system_template_id: str = Field(default="strict_json")
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    response_format: str = Field(default="json_object")
    max_output_tokens: int = Field(default=256, ge=16, le=4096)
    system_prompt: str | None = None


class PromptCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    system_prompt: str = Field(min_length=1, max_length=100_000)
    description: str | None = Field(default=None, max_length=5_000)


class PromptUpdate(BaseModel):
    system_prompt: str | None = Field(default=None, min_length=1, max_length=100_000)
    description: str | None = Field(default=None, max_length=5_000)


class PromptResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    is_builtin: bool = False
    system_prompt: str
    content_hash: str
    usage_count: int = 0
    created_at: datetime
    updated_at: datetime



class PromptStrategyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    label: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=5_000)
    directive_text: str | None = Field(default=None, max_length=100_000)


class PromptStrategyUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=5_000)
    directive_text: str | None = Field(default=None, max_length=100_000)
    is_active: bool | None = None


class PromptStrategyResponse(BaseModel):
    id: str
    name: str
    label: str
    description: str | None = None
    directive_text: str | None = None
    is_builtin: bool = False
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class PromptComponentInfo(BaseModel):
    id: str
    name: str
    content_hash: str | None = None


class StrategyComponentInfo(BaseModel):
    id: str
    name: str
    label: str


class PromptComposeResponse(BaseModel):
    base: PromptComponentInfo
    strategy: StrategyComponentInfo | None = None
    composite_name: str
    composite_hash: str
    system_prompt: str


class RecipeRAGConfig(BaseModel):
    chunk_size: int = Field(default=350)
    chunk_overlap: int = Field(default=50)
    top_k: int = Field(default=3, ge=1, le=20)
    use_reranker: bool = Field(default=True)
    reranker_model: str | None = Field(default="BAAI/bge-reranker-v2-m3")
    injection_format: str = Field(default="xml_tags")


class RecipeInfraConfig(BaseModel):
    engine: str
    model: str
    quantization: str | None = None
    max_context_len: int = Field(default=4096, ge=512, le=131072)
    gpu_memory_utilization: float = Field(default=0.90, ge=0.5, le=0.98)
    concurrency_limit: int = Field(default=10, ge=1, le=128)
    tensor_parallel_size: int = Field(default=1, ge=1)
    kv_cache_dtype: str | None = None
    enable_prefix_caching: bool | None = None


class RecipeSLAVerdict(BaseModel):
    is_golden: bool = False
    fit_status: Literal["Qualified", "Near-Miss", "Needs Evidence", "Rejected"] = "Needs Evidence"
    decode_tps: float
    median_ttft_s: float
    p95_ttft_s: float
    quality_score: float
    peak_vram_pct: float
    error_rate_pct: float = 0.0
    evaluation_summary: str = ""


class ProductionRecipe(BaseModel):
    id: str
    name: str
    workload: str
    workload_title: str
    description: str = ""
    prompt_config: RecipePromptConfig
    rag_config: RecipeRAGConfig
    infra_config: RecipeInfraConfig
    sla_verdict: RecipeSLAVerdict
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RecipeExportResponse(BaseModel):
    recipe_id: str
    recipe_name: str
    workload: str
    vllm_command: str
    docker_compose_yaml: str
    rag_config_py: str
    recipe_yaml: str
    sla_certificate: dict[str, Any]


class TraceStepItem(BaseModel):
    step_name: str
    step_type: Literal[
        "retrieval",
        "rerank",
        "llm_prefill",
        "llm_decode",
        "agent_deliberation",
        "transition",
        "critic_verification",
    ] | str
    start_ms: float
    duration_ms: float
    metadata: dict[str, Any] | None = None


class RunTraceResponse(BaseModel):
    run_id: str
    model: str
    engine: str
    pipeline_config_id: str | None = None
    total_duration_ms: float
    steps: list[TraceStepItem]


class ParetoPointResponse(BaseModel):
    run_id: str
    config_id: str | None = None
    config_name: str | None = None
    model: str
    engine: str
    quantization: str | None = None
    concurrency: int
    decode_tps: float | None = None
    ttft_s: float | None = None
    quality_score: float | None = None
    peak_gpu_mem_mb: float | None = None
    is_pareto_optimal: bool = False


class BenchmarkRun(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = None
    timestamp: datetime | None = None
    model: str
    prompt_category: str | None = None
    mode: Literal["warm", "cold"] | str | None = None
    num_runs: int = Field(ge=1)
    experiment_tag: str | None = None
    # Safe default: only explicitly tagged required rows may affect approval.
    concurrency_scope: Literal["required", "exploratory"] = "exploratory"
    run_type: Literal["approval", "diagnostic"] = "diagnostic"
    approval_run_id: str | None = None
    suite_id: str | None = None
    scoreboard_suite_id: str | None = None
    category_id: str | None = None
    benchmark_commit: str | None = None
    model_revision: str | None = None
    pipeline_config_id: str | None = None
    prompt_id: str | None = None
    prompt_name: str | None = None
    prompt_sha256: str | None = None
    prompt_strategy: str | None = None
    system_prompt_snapshot: str | None = Field(default=None, exclude=True)
    pipeline_config: PipelineConfigResponse | None = None
    trace_timeline: list[TraceStepItem] | None = None
    trace_timeline_json: str | None = None

    median_ttft_s: float | None = Field(default=None, ge=0)
    p95_ttft_s: float | None = Field(default=None, ge=0)
    p99_ttft_s: float | None = Field(default=None, ge=0)
    median_e2e_s: float | None = Field(default=None, ge=0)
    median_prefill_tps: float | None = Field(default=None, ge=0)
    median_decode_tps: float | None = Field(default=None, ge=0)
    aggregate_output_tps: float | None = Field(default=None, ge=0)
    median_model_memory_mb: float | None = Field(default=None, ge=0)
    quality_score: float | None = Field(default=None, ge=0, le=1)
    quality_success_count: int | None = Field(default=None, ge=0)
    quality_failed_count: int | None = Field(default=None, ge=0)
    quality_total_count: int | None = Field(default=None, ge=0)
    quality_success_rate: float | None = Field(default=None, ge=0, le=1)
    catastrophic_failure_count: int = Field(default=0, ge=0)
    quality_buckets: dict[str, dict] | None = None
    category_results: dict[str, dict] | None = None
    suite_category_snapshot: list[dict[str, Any]] | None = None
    decision_mode: dict | None = None
    task_scores: dict[str, dict] | None = None
    error_count: int = Field(default=0, ge=0)
    generation_timeout_count: int = Field(default=0, ge=0)
    generation_timeout_rate: float = Field(default=0.0, ge=0, le=1)
    concurrency: int = Field(default=1, ge=1)
    framework: str | None = None
    quantization: str | None = None
    context_len: int | str | None = None
    engine_config: dict[str, Any] | None = None
    output_token_source: str | None = None
    hardware: str | None = None

    # Auto-detected hardware facts
    hw_detection_status: str | None = None
    hw_platform: str | None = None
    hw_cpu_model: str | None = None
    hw_cpu_physical_cores: int | None = None
    hw_cpu_logical_cores: int | None = None
    hw_ram_gb: float | None = None
    hw_gpu_name: str | None = None
    hw_gpu_memory_mb: int | None = None
    hw_gpu_driver: str | None = None
    hw_gpu_count: int | None = None
    hw_aws_instance_type: str | None = None
    
    # Composite score (derived, compute-on-read)
    hardware_tier: str | None = None
    composite_scores: dict[str, CompositeScoreResult] | None = None
    
    # Deep inference metrics
    peak_gpu_mem_mb: float | None = Field(default=None, ge=0)
    avg_gpu_mem_mb: float | None = Field(default=None, ge=0)
    peak_kv_cache_pct: float | None = Field(default=None, ge=0, le=100)
    avg_kv_cache_pct: float | None = Field(default=None, ge=0, le=100)
    avg_itl_ms: float | None = Field(default=None, ge=0)
    p95_itl_ms: float | None = Field(default=None, ge=0)
    sample_count: int | None = Field(default=None, ge=0)
    gpu_failed_count: int | None = Field(default=None, ge=0)
    kv_failed_count: int | None = Field(default=None, ge=0)
    itl_failed_count: int | None = Field(default=None, ge=0)
    vllm_failed_count: int | None = Field(default=None, ge=0)


class BenchmarkSampleSubmission(BaseModel):
    ts: float = Field(ge=0)
    gpu_mem_mb: float | None = Field(default=None, ge=0)
    kv_cache_pct: float | None = Field(default=None, ge=0, le=100)
    itl_ms: float | None = Field(default=None, ge=0)


class BenchmarkRunSubmission(BenchmarkRun):
    """Validated runner payload while retaining supported auxiliary telemetry."""

    model_config = ConfigDict(extra="allow")

    model: str = Field(min_length=1, max_length=200)
    submission_id: UUID | None = None
    prompt_category: str | None = Field(default=None, max_length=100)
    mode: Literal["warm", "cold"] | None = None
    experiment_tag: str | None = Field(default=None, min_length=1, max_length=200)
    git_revision: str | None = Field(default=None, max_length=128)
    prompt_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    system_prompt_snapshot: str | None = Field(default=None, max_length=100_000)
    samples: list[BenchmarkSampleSubmission] | None = None


class BenchmarkOverview(BaseModel):
    total_runs: int
    models: int
    latest_run: BenchmarkRun | None


class ApprovalEvaluationResponse(BaseModel):
    approval_run_id: str
    verdict: Literal["Qualified", "Near-Miss", "Needs Evidence", "Rejected"]
    reasons: list[str] = []
    category_scores: dict[str, float | None] = {}
    category_evidence: dict[str, dict[str, dict]] = {}
    required_result_count: int
    evaluated_result_count: int
    composite_scores: dict[str, CompositeScoreResult] | None = None





class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    results_available: bool
    task_suite_available: bool


class BenchmarkIngestionReadiness(BaseModel):
    status: Literal["ready"] = "ready"
    contract_version: int = Field(ge=1)
    persistence: Literal["reachable"] = "reachable"
    git_revision: str | None = None


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scope: Literal["admin", "visitor"]
    environment: str | None = Field(default=None, max_length=100)
    expires_at: datetime | None = None


class ApiKeySummary(BaseModel):
    id: int
    name: str
    scope: Literal["admin", "visitor"]
    environment: str | None = None
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    status: Literal["active", "revoked", "expired"]


class ApiKeyCreateResponse(ApiKeySummary):
    key: str


class OllamaModel(BaseModel):
    name: str
    size_bytes: int | None = Field(default=None, ge=0)
    framework: str = "ollama"



class BenchmarkHistoryPoint(BaseModel):
    id: UUID
    created_at: datetime
    model: str
    prompt_category: str
    mode: Literal["warm", "cold"]
    num_runs: int = Field(ge=1)
    experiment_tag: str | None = None
    # Safe default for historical/legacy rows; approval runners must tag this.
    concurrency_scope: Literal["required", "exploratory"] = "exploratory"
    run_type: Literal["approval", "diagnostic"] = "diagnostic"
    approval_run_id: str | None = None
    suite_id: str | None = None
    scoreboard_suite_id: str | None = None
    category_id: str | None = None
    benchmark_commit: str | None = None
    model_revision: str | None = None
    pipeline_config_id: str | None = None
    prompt_id: str | None = None
    prompt_name: str | None = None
    prompt_sha256: str | None = None
    prompt_strategy: str | None = None

    concurrency: int = Field(default=1, ge=1)
    error_count: int = Field(default=0, ge=0)
    generation_timeout_count: int = Field(default=0, ge=0)
    generation_timeout_rate: float = Field(default=0.0, ge=0, le=1)
    median_ttft_s: float | None = Field(default=None, ge=0)
    p95_ttft_s: float | None = Field(default=None, ge=0)
    p99_ttft_s: float | None = Field(default=None, ge=0)
    median_e2e_s: float | None = Field(default=None, ge=0)
    median_prefill_tps: float | None = Field(default=None, ge=0)
    median_decode_tps: float | None = Field(default=None, ge=0)
    aggregate_output_tps: float | None = Field(default=None, ge=0)
    median_model_memory_mb: float | None = Field(default=None, ge=0)

    framework: str | None = None
    quantization: str | None = None
    context_len: int | str | None = None
    engine_config: dict[str, Any] | None = None
    prompt_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    output_token_source: str | None = None
    quality_score: float | None = Field(default=None, ge=0, le=1)
    quality_success_count: int | None = Field(default=None, ge=0)
    quality_failed_count: int | None = Field(default=None, ge=0)
    quality_total_count: int | None = Field(default=None, ge=0)
    quality_success_rate: float | None = Field(default=None, ge=0, le=1)
    catastrophic_failure_count: int = Field(default=0, ge=0)
    quality_buckets: dict[str, dict] | None = None
    category_results: dict[str, dict] | None = None
    suite_category_snapshot: list[dict[str, Any]] | None = None
    decision_mode: dict | None = None
    task_scores: dict[str, dict] | None = None


    # Auto-detected hardware facts
    hw_detection_status: str | None = None
    hw_platform: str | None = None
    hw_cpu_model: str | None = None
    hw_cpu_physical_cores: int | None = None
    hw_cpu_logical_cores: int | None = None
    hw_ram_gb: float | None = None
    hw_gpu_name: str | None = None
    hw_gpu_memory_mb: int | None = None
    hw_gpu_driver: str | None = None
    hw_gpu_count: int | None = None
    hw_aws_instance_type: str | None = None

    # Composite score (derived, compute-on-read)
    hardware_tier: str | None = None
    composite_scores: dict[str, CompositeScoreResult] | None = None

    # Deep inference metrics
    peak_gpu_mem_mb: float | None = Field(default=None, ge=0)
    avg_gpu_mem_mb: float | None = Field(default=None, ge=0)
    peak_kv_cache_pct: float | None = Field(default=None, ge=0, le=100)
    avg_kv_cache_pct: float | None = Field(default=None, ge=0, le=100)
    avg_itl_ms: float | None = Field(default=None, ge=0)
    p95_itl_ms: float | None = Field(default=None, ge=0)
    sample_count: int | None = Field(default=None, ge=0)
    gpu_failed_count: int | None = Field(default=None, ge=0)
    kv_failed_count: int | None = Field(default=None, ge=0)
    itl_failed_count: int | None = Field(default=None, ge=0)
    vllm_failed_count: int | None = Field(default=None, ge=0)


class BenchmarkRunSample(BaseModel):
    sample_ts: datetime
    gpu_mem_mb: float | None = None
    kv_cache_pct: float | None = None
    itl_ms: float | None = None


class BenchmarkRunDetail(BenchmarkHistoryPoint):
    samples: list[BenchmarkRunSample] | None = None
    trace_timeline: list[TraceStepItem] | None = None
    pipeline_config: PipelineConfigResponse | None = None


class ExperimentTagSummary(BaseModel):
    tag: str
    run_count: int = 0
    models: list[str] = []
    concurrencies: list[int] = []
    first_run_at: datetime | None = None
    last_run_at: datetime | None = None


class TaskSchema(BaseModel):
    id: str
    suite_id: str | None = None
    suite_name: str | None = None
    domain: str | None = "general"
    category_id: str
    prompt: str
    expected_answer: Any
    task_type: str
    bucket: str = "general"
    language: str = "en"
    tolerance: dict[str, Any] | None = None
    scoring_config: dict[str, Any] | None = None
    program: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TaskCreate(BaseModel):
    id: str
    suite_id: str | None = None
    suite_name: str | None = None
    domain: str | None = "general"
    category_id: str
    prompt: str
    expected_answer: Any
    task_type: str
    bucket: str = "general"
    language: str = "en"
    tolerance: dict[str, Any] | None = None
    scoring_config: dict[str, Any] | None = None
    program: str | None = None

    @field_validator("task_type")
    @classmethod
    def supported_task_type(cls, value: str) -> str:
        from backend.app.services.task_parser import VALID_TASK_TYPES
        if value not in VALID_TASK_TYPES:
            raise ValueError(f"Unsupported task_type '{value}'; use GET /api/v1/scorers for available scorers")
        return value

    @model_validator(mode="after")
    def valid_scoring_contract(self):
        from benchmark_scoring import validate_task
        validate_task(self.model_dump())
        return self


class BenchmarkSuiteSchema(BaseModel):
    id: str
    parent_suite_id: str | None = None
    sla_criteria_id: str | None = None
    sla_criteria: dict[str, Any] | None = None
    name: str
    domain: str = "general"
    description: str | None = None
    default_scorer: str | None = None
    default_tolerance: dict[str, Any] | None = None
    task_count: int = 0
    task_groups: list[dict[str, Any]] = []
    is_required: bool = True
    is_active: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None


class BenchmarkSuiteCreate(BaseModel):
    id: str | None = None
    parent_suite_id: str | None = None
    sla_criteria_id: str | None = None
    name: str
    domain: str = "general"
    description: str | None = None
    default_scorer: str | None = None
    default_tolerance: dict[str, Any] | None = None
    is_required: bool = True
    is_active: bool = True


class BenchmarkSuiteDetail(BenchmarkSuiteSchema):
    tasks: list[TaskSchema] = []


class TaskListResponse(BaseModel):
    tasks: list[TaskSchema]
    total: int
    offset: int
    limit: int


class TaskSummaryResponse(BaseModel):
    total_tasks: int
    categories: dict[str, int]


class ScorecardCriteriaSchema(BaseModel):
    id: str
    suite_id: str | None = None
    scoreboard_suite_id: str | None = None
    name: str
    description: str | None = None
    min_decode_tps: float = 25.0
    fast_ttft_s: float = 0.8
    tail_ttft_ceiling_s: float = 1.5
    interactive_ttft_max_s: float = 3.0
    min_quality_score: float = 0.75
    quality_surplus_tradeoff: float = 1.10
    memory_stability_max_pct: float = 85.0
    max_error_rate: float = 0.01
    weight_quality: float = 0.60
    weight_speed: float = 0.25
    weight_fit: float = 0.15
    is_default: bool = False
    is_locked: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ScorecardCriteriaCreate(BaseModel):
    id: str
    suite_id: str | None = None
    scoreboard_suite_id: str | None = None
    name: str
    description: str | None = None
    min_decode_tps: float = 25.0
    fast_ttft_s: float = 0.8
    tail_ttft_ceiling_s: float = 1.5
    interactive_ttft_max_s: float = 3.0
    min_quality_score: float = 0.75
    quality_surplus_tradeoff: float = 1.10
    memory_stability_max_pct: float = 85.0
    max_error_rate: float = 0.01
    weight_quality: float = 0.60
    weight_speed: float = 0.25
    weight_fit: float = 0.15
    is_default: bool = False


class ScorecardCriteriaUpdate(BaseModel):
    suite_id: str | None = None
    scoreboard_suite_id: str | None = None
    name: str | None = None
    description: str | None = None
    min_decode_tps: float | None = None
    fast_ttft_s: float | None = None
    tail_ttft_ceiling_s: float | None = None
    interactive_ttft_max_s: float | None = None
    min_quality_score: float | None = None
    quality_surplus_tradeoff: float | None = None
    memory_stability_max_pct: float | None = None
    max_error_rate: float | None = None
    weight_quality: float | None = None
    weight_speed: float | None = None
    weight_fit: float | None = None
    is_default: bool | None = None


class ScorecardCriteriaAssignment(BaseModel):
    criteria_id: str

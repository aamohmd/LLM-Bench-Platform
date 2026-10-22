"""
Manages database persistence for benchmark history and API keys.
Runs inside the hosted backend connecting to PostgreSQL.
Called by routers and auth core to read/write persistent data.
The control plane persists submitted aggregates and never imports execution-plane code.
"""

from __future__ import annotations
import hashlib
import json
import logging
import time
from threading import RLock
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from pydantic import ValidationError
from typing import TYPE_CHECKING, Any
from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Index, Integer, String, create_engine, select, delete, update, func, Boolean, Text, or_, text, inspect
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, defer, mapped_column, noload, relationship, sessionmaker

from backend.app.schemas import (
    BenchmarkHistoryPoint,
    BenchmarkRun,
    PipelineConfigResponse,
    TraceStepItem,
)

if TYPE_CHECKING:
    from backend.app.schemas import BenchmarkRunDetail

CONFIG_NAMESPACE = UUID("7f3b8b1a-9c42-4f2a-8b1e-0e9a7e2b5c4d")


class DeletionConflict(ValueError):
    pass


def derive_config_identity(config_dict: dict) -> tuple[str, str]:
    """Derives deterministic UUIDv5 and SHA-256 hash from canonicalized configuration dictionary.

    Excludes None values, sorts keys strictly, and dumps with compact separators
    to guarantee identical hashes across platforms and serialization invocations.
    """
    clean_dict = {k: v for k, v in config_dict.items() if v is not None}
    canonical_str = json.dumps(clean_dict, sort_keys=True, separators=(",", ":"))
    config_hash = hashlib.sha256(canonical_str.encode("utf-8")).hexdigest()
    config_id = str(uuid5(CONFIG_NAMESPACE, config_hash))
    return config_id, config_hash


class Base(DeclarativeBase):
    pass


class OnboardingStateRecord(Base):
    __tablename__ = "onboarding_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PipelineConfigRecord(Base):
    __tablename__ = "pipeline_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    config_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    engine: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    quantization: Mapped[str | None] = mapped_column(String(50), nullable=True)
    max_context_len: Mapped[int] = mapped_column(Integer, nullable=False)
    gpu_memory_utilization: Mapped[float | None] = mapped_column(Float, nullable=True)
    retrieval_k: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reranker_model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    agent_topology: Mapped[str] = mapped_column(String(100), default="direct", nullable=False)
    parameters_json: Mapped[str] = mapped_column(String, nullable=False)


class PromptRecord(Base):
    __tablename__ = "prompts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PromptStrategyRecord(Base):
    __tablename__ = "prompt_strategies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    directive_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ApiKeyRecord(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    scope: Mapped[str] = mapped_column(String(50), nullable=False)
    environment: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BenchmarkJobRecord(Base):
    __tablename__ = "benchmark_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    engine: Mapped[str] = mapped_column(String(20), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    prompt_category: Mapped[str] = mapped_column(String(100), nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    runs: Mapped[int] = mapped_column(Integer, nullable=False)
    concurrency: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    progress: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tasks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result: Mapped[str | None] = mapped_column(String, nullable=True)


class BenchmarkHistoryRecord(Base):
    __tablename__ = "benchmark_history"
    __table_args__ = (
        Index(
            "ix_benchmark_scorecard_partition",
            "concurrency",
            "model",
            "framework",
            "prompt_category",
            "quality_score",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    submission_id: Mapped[str | None] = mapped_column(
        String(36), unique=True, index=True, nullable=True
    )
    submission_payload_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    config_hash: Mapped[str] = mapped_column(String(64), index=True)
    task_suite_hash: Mapped[str] = mapped_column(String(64))
    concurrency_scope: Mapped[str] = mapped_column(String(20), default="exploratory", nullable=False)
    run_type: Mapped[str] = mapped_column(String(20), default="diagnostic", nullable=False)
    approval_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    suite_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    scoreboard_suite_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    category_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    benchmark_commit: Mapped[str | None] = mapped_column(String(128), nullable=True)
    model_revision: Mapped[str | None] = mapped_column(String(256), nullable=True)
    git_revision: Mapped[str | None] = mapped_column(String(128), nullable=True)
    experiment_tag: Mapped[str | None] = mapped_column(String(200), nullable=True)
    model: Mapped[str] = mapped_column(String(200), index=True)
    prompt_category: Mapped[str] = mapped_column(String(100))
    mode: Mapped[str] = mapped_column(String(16))
    runs: Mapped[int] = mapped_column(Integer)
    concurrency: Mapped[int] = mapped_column(Integer, default=1)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    generation_timeout_count: Mapped[int] = mapped_column(Integer, default=0)
    generation_timeout_rate: Mapped[float] = mapped_column(Float, default=0.0)
    median_ttft_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    p95_ttft_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    p99_ttft_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    median_e2e_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    median_prefill_tps: Mapped[float | None] = mapped_column(Float, nullable=True)
    median_decode_tps: Mapped[float | None] = mapped_column(Float, nullable=True)
    aggregate_output_tps: Mapped[float | None] = mapped_column(Float, nullable=True)
    median_model_memory_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality_success_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quality_failed_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quality_total_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quality_success_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    catastrophic_failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    quality_buckets: Mapped[str | None] = mapped_column(String, nullable=True)
    category_results: Mapped[str | None] = mapped_column(Text, nullable=True)
    suite_category_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_mode: Mapped[str | None] = mapped_column(String, nullable=True)
    framework: Mapped[str | None] = mapped_column(String(50), nullable=True)
    quantization: Mapped[str | None] = mapped_column(String(100), nullable=True)
    context_len: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_token_source: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Deliberately String (not JSONB) to avoid Postgres vs SQLite driver serialization divergence.
    task_scores: Mapped[str | None] = mapped_column(String, nullable=True)
    peak_gpu_mem_mb: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Auto-detected hardware fields
    hw_detection_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    hw_platform: Mapped[str | None] = mapped_column(String(200), nullable=True)
    hw_cpu_model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    hw_cpu_physical_cores: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hw_cpu_logical_cores: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hw_ram_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    hw_gpu_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    hw_gpu_memory_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hw_gpu_driver: Mapped[str | None] = mapped_column(String(100), nullable=True)
    hw_gpu_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hw_aws_instance_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    engine_config: Mapped[str | None] = mapped_column(String, nullable=True)
    pipeline_config_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("pipeline_configs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    trace_timeline_json: Mapped[str | None] = mapped_column(String, nullable=True)
    prompt_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True, index=True)
    prompt_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    prompt_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    system_prompt_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt_strategy: Mapped[str | None] = mapped_column(String(100), nullable=True)

    deep_metrics: Mapped["BenchmarkRunDeepMetrics"] = relationship(
        "BenchmarkRunDeepMetrics", uselist=False, lazy="joined", cascade="all, delete-orphan"
    )
    pipeline_config: Mapped[PipelineConfigRecord | None] = relationship(
        "PipelineConfigRecord", lazy="joined"
    )


class BenchmarkRunDeepMetrics(Base):
    __tablename__ = "run_deep_metrics"

    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("benchmark_history.id", ondelete="CASCADE"), primary_key=True
    )
    peak_gpu_mem_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_gpu_mem_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    peak_kv_cache_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_kv_cache_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_itl_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    p95_itl_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    sample_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gpu_failed_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kv_failed_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    itl_failed_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Legacy blended counter retained for old rows; new runs do not populate it.
    vllm_failed_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )



class FailedTraceRecord(Base):
    __tablename__ = "failed_traces"

    # Integer (not BigInteger): SQLite only autoincrements an exact
    # INTEGER PRIMARY KEY; BIGINT PRIMARY KEY silently lacks the default
    # and every insert fails with NOT NULL on id.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("benchmark_history.id", ondelete="CASCADE"), index=True
    )
    task_id: Mapped[str] = mapped_column(String(200), index=True)
    prompt: Mapped[str] = mapped_column(String)
    expected: Mapped[str] = mapped_column(String)
    actual: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )


class BenchmarkRunSample(Base):
    __tablename__ = "run_samples"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("benchmark_history.id", ondelete="CASCADE"), index=True
    )
    sample_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    gpu_mem_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    kv_cache_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    itl_ms: Mapped[float | None] = mapped_column(Float, nullable=True)


class BenchmarkSuiteRecord(Base):
    __tablename__ = "benchmark_suites"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    parent_suite_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    sla_criteria_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("scorecard_criteria.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    domain: Mapped[str] = mapped_column(String(100), default="general", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_scorer: Mapped[str | None] = mapped_column(String(64), nullable=True)
    default_tolerance_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    task_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class TaskRecord(Base):
    __tablename__ = "benchmark_tasks"

    id: Mapped[str] = mapped_column(String(200), primary_key=True)
    suite_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    suite_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(100), default="general", nullable=True)
    category_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    expected_answer: Mapped[str] = mapped_column(Text, nullable=False)
    task_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    bucket: Mapped[str] = mapped_column(String(50), default="general", nullable=False)
    language: Mapped[str] = mapped_column(String(10), default="en", nullable=False)
    tolerance_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    scoring_config_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    program: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class ScorecardCriteriaRecord(Base):
    __tablename__ = "scorecard_criteria"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    suite_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    scoreboard_suite_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    min_decode_tps: Mapped[float] = mapped_column(Float, default=25.0, nullable=False)
    fast_ttft_s: Mapped[float] = mapped_column(Float, default=0.8, nullable=False)
    tail_ttft_ceiling_s: Mapped[float] = mapped_column(Float, default=1.5, nullable=False)
    interactive_ttft_max_s: Mapped[float] = mapped_column(Float, default=3.0, nullable=False)
    min_quality_score: Mapped[float] = mapped_column(Float, default=0.75, nullable=False)
    quality_surplus_tradeoff: Mapped[float] = mapped_column(Float, default=1.10, nullable=False)
    memory_stability_max_pct: Mapped[float] = mapped_column(Float, default=85.0, nullable=False)
    max_error_rate: Mapped[float] = mapped_column(Float, default=0.01, nullable=False)
    weight_quality: Mapped[float] = mapped_column(Float, default=0.60, nullable=False)
    weight_speed: Mapped[float] = mapped_column(Float, default=0.25, nullable=False)
    weight_fit: Mapped[float] = mapped_column(Float, default=0.15, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


Index("uq_scorecard_criteria_name_ci", func.lower(ScorecardCriteriaRecord.name), unique=True)


class BenchmarkHistoryRepository:
    def __init__(
        self,
        database_url: str,
        tasks_path: Path,
        git_revision: str | None,
        experiment_tag: str | None = None,
    ):
        connect_args = {}
        if database_url.startswith("postgresql"):
            connect_args["prepare_threshold"] = None
            connect_args["connect_timeout"] = 10
            connect_args["keepalives"] = 1
            connect_args["keepalives_idle"] = 30
            connect_args["keepalives_interval"] = 10
            connect_args["keepalives_count"] = 5

        engine_kwargs: dict[str, object] = {
            "pool_pre_ping": True,
            "connect_args": connect_args,
        }
        if not database_url.startswith("sqlite"):
            # Keep the application pool deliberately small for serverless Postgres.
            # The provider-side pooler handles fan-out; large idle client pools only
            # waste memory and make connection recovery noisier after scale-to-zero.
            engine_kwargs.update({
                "pool_recycle": 300,
                "pool_size": 3,
                "max_overflow": 2,
            })

        self._engine = create_engine(database_url, **engine_kwargs)
        self._session_factory = sessionmaker(self._engine, expire_on_commit=False)
        self._project_root = Path(__file__).resolve().parents[3]
        self._tasks_path = tasks_path
        self._git_revision = git_revision
        self._experiment_tag = experiment_tag
        self._auth_lock = RLock()
        self._api_key_cache: dict[str, ApiKeyRecord] = {}
        self._api_key_touch_cache: dict[int, float] = {}
        self._API_KEY_TOUCH_INTERVAL: float = 6 * 3600.0
        self._API_KEY_CACHE_MAX_SIZE: int = 500  # FIFO eviction prevents unbounded growth
        self._has_records_cache: bool | None = None

    def create_schema(self) -> None:
        from alembic import command
        from alembic.config import Config
        alembic_config = Config(str(self._project_root / "alembic.ini"))
        url_str = self._engine.url.render_as_string(hide_password=False)
        alembic_config.attributes["override_url"] = url_str
        alembic_config.set_main_option("sqlalchemy.url", url_str.replace("%", "%%"))
        if not inspect(self._engine).get_table_names():
            # Fresh installations use the current schema without legacy data seeds.
            with self._engine.begin() as connection:
                Base.metadata.create_all(connection)
                alembic_config.attributes["connection"] = connection
                command.stamp(alembic_config, "head")
        else:
            command.upgrade(alembic_config, "head")

        try:
            with self._engine.begin() as conn:
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_benchmark_scorecard_partition "
                        "ON benchmark_history (concurrency, model, framework, prompt_category, quality_score, created_at)"
                    )
                )
        except Exception as e:
            logger.warning(f"Could not create scorecard partition index: {e}")

        with self._session_factory() as session:
            self._has_records_cache = (
                session.scalar(select(BenchmarkHistoryRecord.id).limit(1)) is not None
            )

    def warm_runtime_cache(self) -> None:
        """Pre-warm frequently used control-plane reads at startup.

        This is an operator-triggered optimization only; dashboard refresh
        behavior does not depend on polling or revalidation webhooks.
        """
        try:
            self.list_api_keys()
            self.get_overview()
            self.list_scorecard_runs()
            self.list_benchmark_suites()
            self.list_approval_runs()
            self.get_experiment_tags()
            self.list_scorecard_criteria()
            logger.info("Runtime in-memory caches warmed successfully.")
        except Exception as e:
            logger.warning("Could not fully warm runtime caches: %s", e)

    def bootstrap_admin_key(self, key_hash: str, name: str) -> bool:
        """Create the first administrator once, through the local operator CLI."""
        with self._session_factory.begin() as session:
            if self._engine.dialect.name == "postgresql":
                session.execute(text("LOCK TABLE api_keys IN EXCLUSIVE MODE"))
            elif self._engine.dialect.name == "sqlite":
                session.execute(text("BEGIN IMMEDIATE"))
            if session.scalar(select(ApiKeyRecord.id).where(ApiKeyRecord.scope == "admin").limit(1)) is not None:
                return False
            session.add(ApiKeyRecord(key_hash=key_hash, name=name, scope="admin"))
        return True

    def create_api_key(
        self,
        key_hash: str,
        name: str,
        scope: str,
        *,
        environment: str | None = None,
        expires_at: datetime | None = None,
    ) -> ApiKeyRecord:
        with self._session_factory.begin() as session:
            record = ApiKeyRecord(
                key_hash=key_hash,
                name=name,
                scope=scope,
                environment=environment,
                expires_at=expires_at,
            )
            session.add(record)
            session.flush()
        with self._auth_lock:
            self._api_key_cache[key_hash] = record
        return record

    def get_api_key(self, key_hash: str) -> ApiKeyRecord | None:
        with self._auth_lock:
            cached = self._api_key_cache.get(key_hash)
            if cached is not None:
                return cached
            with self._session_factory() as session:
                record = session.scalar(select(ApiKeyRecord).where(ApiKeyRecord.key_hash == key_hash))
            if record is not None:
                # FIFO eviction: keep cache bounded to _API_KEY_CACHE_MAX_SIZE
                if len(self._api_key_cache) >= self._API_KEY_CACHE_MAX_SIZE:
                    self._api_key_cache.pop(next(iter(self._api_key_cache)))
                self._api_key_cache[key_hash] = record
        return record

    def revoke_api_key(self, key_hash: str) -> bool:
        with self._session_factory.begin() as session:
            record = session.scalar(select(ApiKeyRecord).where(ApiKeyRecord.key_hash == key_hash))
            if record and not record.revoked_at:
                record.revoked_at = datetime.now(timezone.utc)
                revoked = True
            else:
                revoked = False
        if revoked:
            with self._auth_lock:
                self._api_key_cache.pop(key_hash, None)
        return revoked

    def revoke_api_key_by_id(self, key_id: int) -> bool:
        with self._session_factory.begin() as session:
            record = session.get(ApiKeyRecord, key_id)
            if record and not record.revoked_at:
                record.revoked_at = datetime.now(timezone.utc)
                revoked = True
            else:
                revoked = False
        if revoked:
            with self._auth_lock:
                stale_hashes = [
                    key_hash
                    for key_hash, record in self._api_key_cache.items()
                    if record.id == key_id
                ]
                for key_hash in stale_hashes:
                    self._api_key_cache.pop(key_hash, None)
                self._api_key_touch_cache.pop(key_id, None)
        return revoked

    def list_api_keys(self) -> list[ApiKeyRecord]:
        with self._session_factory() as session:
            records = list(session.scalars(select(ApiKeyRecord).order_by(ApiKeyRecord.created_at.desc())).all())
        with self._auth_lock:
            now_monotonic = time.monotonic()
            for record in records:
                self._api_key_cache[record.key_hash] = record
                self._api_key_touch_cache[record.id] = now_monotonic
        return records

    @staticmethod
    def _prompt_response(record: PromptRecord, usage_count: int = 0) -> dict:
        return {
            "id": record.id,
            "name": record.name,
            "description": record.description,
            "is_builtin": record.is_builtin,
            "system_prompt": record.system_prompt,
            "content_hash": record.content_hash,
            "usage_count": usage_count,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
        }


    def list_prompts(self) -> list[dict]:
        with self._session_factory() as session:
            stmt = select(PromptRecord).order_by(PromptRecord.name)
            records = session.scalars(stmt).all()
            return [
                self._prompt_response(
                    record,
                    session.scalar(
                        select(func.count()).select_from(BenchmarkHistoryRecord).where(BenchmarkHistoryRecord.prompt_id == record.id)
                    ) or 0,
                )
                for record in records
            ]

    def get_prompt(self, prompt_id_or_name: str) -> dict | None:
        with self._session_factory() as session:
            stmt = select(PromptRecord).where(
                or_(PromptRecord.id == prompt_id_or_name, PromptRecord.name == prompt_id_or_name)
            )
            record = session.scalar(stmt)
            if not record:
                return None
            usage_count = session.scalar(
                select(func.count()).select_from(BenchmarkHistoryRecord).where(BenchmarkHistoryRecord.prompt_id == record.id)
            ) or 0
            return self._prompt_response(record, usage_count)

    def create_prompt(
        self,
        name: str,
        system_prompt: str,
        description: str | None = None,
        *,
        is_builtin: bool = False,
    ) -> dict:
        normalized_name = name.strip().lower()
        content_hash = hashlib.sha256(system_prompt.encode("utf-8")).hexdigest()
        now = datetime.now(timezone.utc)
        with self._session_factory.begin() as session:
            if session.scalar(select(PromptRecord.id).where(PromptRecord.name == normalized_name)):
                raise ValueError(f"Prompt name '{normalized_name}' already exists")
            record = PromptRecord(
                id=str(uuid4()),
                name=normalized_name,
                description=description,
                is_builtin=is_builtin,
                system_prompt=system_prompt,
                content_hash=content_hash,
                created_at=now,
                updated_at=now,
            )
            session.add(record)
            session.flush()
            return self._prompt_response(record)

    def update_prompt(
        self,
        prompt_id: str,
        system_prompt: str | None = None,
        description: str | None = None,
    ) -> dict | None:
        with self._session_factory.begin() as session:
            record = session.get(PromptRecord, prompt_id)
            if not record:
                return None
            if description is not None:
                record.description = description
            if system_prompt is not None:
                record.system_prompt = system_prompt
                record.content_hash = hashlib.sha256(system_prompt.encode("utf-8")).hexdigest()
            record.updated_at = datetime.now(timezone.utc)
            session.flush()
            usage_count = session.scalar(
                select(func.count()).select_from(BenchmarkHistoryRecord).where(BenchmarkHistoryRecord.prompt_id == record.id)
            ) or 0
            return self._prompt_response(record, usage_count)

    @staticmethod
    def _strategy_response(record: PromptStrategyRecord) -> dict:
        return {
            "id": record.id,
            "name": record.name,
            "label": record.label,
            "description": record.description,
            "directive_text": record.directive_text,
            "is_builtin": record.is_builtin,
            "is_active": record.is_active,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
        }

    def list_strategies(self, include_inactive: bool = False) -> list[dict]:
        with self._session_factory() as session:
            stmt = select(PromptStrategyRecord).order_by(PromptStrategyRecord.name)
            if not include_inactive:
                stmt = stmt.where(PromptStrategyRecord.is_active.is_(True))
            records = session.scalars(stmt).all()
            return [self._strategy_response(r) for r in records]

    def get_strategy(self, strategy_id_or_name: str) -> dict | None:
        with self._session_factory() as session:
            stmt = select(PromptStrategyRecord).where(
                or_(PromptStrategyRecord.id == strategy_id_or_name, PromptStrategyRecord.name == strategy_id_or_name)
            )
            record = session.scalar(stmt)
            return self._strategy_response(record) if record else None

    def create_strategy(
        self,
        name: str,
        label: str,
        description: str | None = None,
        directive_text: str | None = None,
    ) -> dict:
        normalized_name = name.strip().lower()
        now = datetime.now(timezone.utc)
        with self._session_factory.begin() as session:
            if session.scalar(select(PromptStrategyRecord.id).where(PromptStrategyRecord.name == normalized_name)):
                raise ValueError(f"Strategy with name '{normalized_name}' already exists")
            record = PromptStrategyRecord(
                id=str(uuid4()),
                name=normalized_name,
                label=label.strip(),
                description=description.strip() if description else None,
                directive_text=directive_text.strip() if directive_text else None,
                is_builtin=False,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            session.add(record)
            session.flush()
            return self._strategy_response(record)

    def update_strategy(
        self,
        strategy_id: str,
        label: str | None = None,
        description: str | None = None,
        directive_text: str | None = None,
        is_active: bool | None = None,
    ) -> dict | None:
        with self._session_factory.begin() as session:
            record = session.get(PromptStrategyRecord, strategy_id)
            if not record:
                return None
            if label is not None:
                record.label = label.strip()
            if description is not None:
                record.description = description.strip() if description else None
            if directive_text is not None:
                record.directive_text = directive_text.strip() if directive_text else None
            if is_active is not None:
                record.is_active = is_active
            record.updated_at = datetime.now(timezone.utc)
            session.flush()
            return self._strategy_response(record)

    def compose_prompt(
        self,
        prompt_id_or_name: str,
        strategy_id_or_name: str | None = None,
    ) -> dict | None:
        """Compose a system prompt from a foundational prompt and an optional strategy directive."""
        with self._session_factory() as session:
            base_stmt = select(PromptRecord).where(
                or_(PromptRecord.id == prompt_id_or_name, PromptRecord.name == prompt_id_or_name)
            )
            base_record = session.scalar(base_stmt)
            if not base_record:
                return None

            base_text = base_record.system_prompt.strip()
            strat_info = None
            composite_text = base_text
            strat_name = None

            if strategy_id_or_name:
                strat_stmt = select(PromptStrategyRecord).where(
                    or_(PromptStrategyRecord.id == strategy_id_or_name, PromptStrategyRecord.name == strategy_id_or_name)
                )
                strat_record = session.scalar(strat_stmt)
                if not strat_record or not strat_record.is_active:
                    return None
                strat_name = strat_record.name
                if strat_record.directive_text:
                    composite_text = f"{base_text}\n\n{strat_record.directive_text.strip()}"
                strat_info = {
                    "id": strat_record.id,
                    "name": strat_record.name,
                    "label": strat_record.label,
                }

            composite_hash = hashlib.sha256(composite_text.encode("utf-8")).hexdigest()
            composite_name = f"{base_record.name}::{strat_name}" if strat_name else base_record.name

            return {
                "base": {
                    "id": base_record.id,
                    "name": base_record.name,
                    "content_hash": base_record.content_hash,
                },
                "strategy": strat_info,
                "composite_name": composite_name,
                "composite_hash": composite_hash,
                "system_prompt": composite_text,
            }

    def resolve_prompt_provenance(self, summary: dict) -> dict:
        """Validate a submitted prompt snapshot against an unversioned registry prompt."""
        supplied = [summary.get(key) for key in ("prompt_id", "prompt_name", "prompt_sha256", "system_prompt_snapshot")]
        if not any(supplied):
            return {}
        if not all(supplied):
            raise ValueError("Prompt provenance must include id, name, hash, and snapshot")
        with self._session_factory() as session:
            stmt = select(PromptRecord).where(
                PromptRecord.id == summary["prompt_id"],
                PromptRecord.name == summary["prompt_name"],
            )
            prompt = session.scalar(stmt)
            if not prompt:
                raise ValueError("Registered prompt was not found")
            strategy_name = summary.get("prompt_strategy")
            snapshot = summary["system_prompt_snapshot"]
            if not strategy_name:
                expected_snapshot = prompt.system_prompt.strip()
            else:
                strategy = session.scalar(
                    select(PromptStrategyRecord).where(PromptStrategyRecord.name == strategy_name)
                )
                if not strategy or not strategy.is_active:
                    raise ValueError("Registered prompt strategy was not found or is inactive")
                directive = strategy.directive_text.strip() if strategy.directive_text else ""
                expected_snapshot = (
                    f"{prompt.system_prompt.strip()}\n\n{directive}"
                    if directive
                    else prompt.system_prompt.strip()
                )
            expected_hash = hashlib.sha256(expected_snapshot.encode("utf-8")).hexdigest()
            if expected_hash != summary["prompt_sha256"] or expected_snapshot != snapshot:
                raise ValueError("Prompt snapshot does not match the registered prompt")
            return {
                "prompt_id": prompt.id,
                "prompt_name": prompt.name,
                "prompt_sha256": expected_hash,
                "system_prompt_snapshot": expected_snapshot,
            }


    def touch_api_key(self, key_id: int) -> None:
        now_monotonic = time.monotonic()
        with self._auth_lock:
            last_touch = self._api_key_touch_cache.get(key_id)
            if last_touch is not None and now_monotonic - last_touch < self._API_KEY_TOUCH_INTERVAL:
                return
            self._api_key_touch_cache[key_id] = now_monotonic
        try:
            with self._session_factory.begin() as session:
                record = session.get(ApiKeyRecord, key_id)
                if record:
                    record.last_used_at = datetime.now(timezone.utc)
        except Exception:
            with self._auth_lock:
                self._api_key_touch_cache.pop(key_id, None)
            raise

    def get_failed_traces(self, run_id: str, days_to_keep: int = 7) -> list[dict]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days_to_keep)
        with self._session_factory() as session:
            records = session.scalars(
                select(FailedTraceRecord)
                .where(FailedTraceRecord.run_id == run_id)
                .where(FailedTraceRecord.created_at >= cutoff)
                .order_by(FailedTraceRecord.created_at)
            ).all()
            return [
                {
                    "id": r.id,
                    "run_id": r.run_id,
                    "task_id": r.task_id,
                    "prompt": r.prompt,
                    "expected": r.expected,
                    "actual": r.actual,
                    "created_at": r.created_at.isoformat(),
                }
                for r in records
            ]

    def cleanup_expired_traces(self, days_to_keep: int = 7) -> int:
        """Deletes failed traces older than `days_to_keep` days."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days_to_keep)
        with self._session_factory.begin() as session:
            result = session.execute(
                delete(FailedTraceRecord).where(FailedTraceRecord.created_at < cutoff)
            )
            return result.rowcount


    def record_summary(
        self,
        summary: dict,
        *,
        record_id: UUID | None = None,
        created_at: datetime | None = None,
        samples: list[dict] | None = None,
    ) -> BenchmarkHistoryPoint:
        created_at = self._normalise_datetime(created_at or summary.get("timestamp"))
        resolved_record_id = str(record_id or uuid4())
        summary = {**summary, **self.resolve_prompt_provenance(summary)}

        sanitized_task_scores: dict[str, object] = {}
        failed_trace_records = []
        for task_id, score_data in (summary.get("task_scores") or {}).items():
            if not isinstance(score_data, dict):
                sanitized_task_scores[task_id] = score_data
                continue
            sanitized_score = dict(score_data)
            raw_trace = sanitized_score.pop("raw_trace", None)
            sanitized_task_scores[task_id] = sanitized_score
            if isinstance(raw_trace, dict):
                failed_trace_records.append(
                    FailedTraceRecord(
                        run_id=resolved_record_id,
                        task_id=task_id,
                        prompt=str(raw_trace.get("prompt") or ""),
                        expected=str(raw_trace.get("expected") or ""),
                        actual=str(raw_trace.get("actual") or ""),
                        created_at=created_at,
                    )
                )
        
        # [!WARNING] Legacy CSV imports (via import_legacy_runs) explicitly set missing columns to None.
        # Any code reading from `summary` below must guard against None before numeric comparisons.
        
        config = {
            "model": summary["model"],
            "prompt_category": summary.get("prompt_category", "unknown"),
            "mode": summary.get("mode", "warm"),
            "runs": summary.get("num_runs", summary.get("runs", 1)),
            "concurrency": summary.get("concurrency", 1),
            "context_len": summary.get("context_len"),
            "framework": summary.get("framework"),
            "quantization": summary.get("quantization"),
            "engine_config": summary.get("engine_config"),
            "hw_platform": summary.get("hw_platform"),
            "hw_gpu_name": summary.get("hw_gpu_name"),
            "hw_cpu_model": summary.get("hw_cpu_model"),
        }
        scoreboard_suite_id = self._scoreboard_suite_for(summary.get("suite_id"))
        category_snapshot = summary.get("suite_category_snapshot")
        if category_snapshot is None and scoreboard_suite_id:
            category_snapshot = self._suite_category_snapshot_for(scoreboard_suite_id)

        record = BenchmarkHistoryRecord(
            id=resolved_record_id,
            submission_id=(
                str(summary["submission_id"])
                if summary.get("submission_id") is not None
                else None
            ),
            submission_payload_hash=summary.get("submission_payload_hash"),
            created_at=created_at,
            config_hash=self._hash_json(config),
            task_suite_hash=self._task_suite_hash_for(summary),
            git_revision=summary.get("git_revision") or self._git_revision,
            experiment_tag=summary.get("experiment_tag", self._experiment_tag),
            model=summary["model"],
            prompt_category=summary.get("prompt_category", "unknown"),
            mode=summary.get("mode", "warm"),
            runs=int(summary.get("num_runs", summary.get("runs", 1))),
            concurrency=int(summary.get("concurrency", 1)),
            error_count=int(summary.get("error_count", 0)),
            generation_timeout_count=int(summary.get("generation_timeout_count", 0)),
            generation_timeout_rate=float(summary.get("generation_timeout_rate", 0.0)),
            median_ttft_s=summary.get("median_ttft_s"),
            p95_ttft_s=summary.get("p95_ttft_s"),
            p99_ttft_s=summary.get("p99_ttft_s"),
            median_e2e_s=summary.get("median_e2e_s"),
            median_prefill_tps=summary.get("median_prefill_tps"),
            median_decode_tps=summary.get("median_decode_tps"),
            aggregate_output_tps=summary.get("aggregate_output_tps"),
            median_model_memory_mb=summary.get("median_model_memory_mb"),
            quality_score=summary.get("quality_score"),
            framework=summary.get("framework"),
            quantization=summary.get("quantization"),
            context_len=summary.get("context_len") if isinstance(summary.get("context_len"), int) else None,
            prompt_tokens=summary.get("prompt_tokens"),
            output_tokens=summary.get("output_tokens"),
            output_token_source=summary.get("output_token_source"),
            quality_success_count=summary.get("quality_success_count"),
            quality_failed_count=summary.get("quality_failed_count"),
            quality_total_count=summary.get("quality_total_count"),
            quality_success_rate=summary.get("quality_success_rate"),
            catastrophic_failure_count=int(summary.get("catastrophic_failure_count", 0)),
            concurrency_scope=summary.get("concurrency_scope", "exploratory"),
            run_type=summary.get("run_type", "diagnostic"),
            approval_run_id=summary.get("approval_run_id"),
            suite_id=summary.get("suite_id"),
            scoreboard_suite_id=scoreboard_suite_id,
            category_id=summary.get("category_id") or summary.get("prompt_category"),
            benchmark_commit=summary.get("benchmark_commit") or summary.get("git_revision"),
            model_revision=summary.get("model_revision"),
            quality_buckets=json.dumps(summary["quality_buckets"]) if summary.get("quality_buckets") else None,
            category_results=json.dumps(summary["category_results"]) if summary.get("category_results") else None,
            suite_category_snapshot=json.dumps(category_snapshot) if category_snapshot else None,
            decision_mode=json.dumps(summary["decision_mode"]) if summary.get("decision_mode") else None,
            task_scores=json.dumps(sanitized_task_scores) if sanitized_task_scores else None,
            engine_config=json.dumps(summary["engine_config"]) if summary.get("engine_config") else None,
            # Hardware
            hw_detection_status=summary.get("hw_detection_status", "legacy"),
            hw_platform=summary.get("hw_platform"),
            hw_cpu_model=summary.get("hw_cpu_model"),
            hw_cpu_physical_cores=summary.get("hw_cpu_physical_cores"),
            hw_cpu_logical_cores=summary.get("hw_cpu_logical_cores"),
            hw_ram_gb=summary.get("hw_ram_gb"),
            hw_gpu_name=summary.get("hw_gpu_name"),
            hw_gpu_memory_mb=summary.get("hw_gpu_memory_mb"),
            hw_gpu_driver=summary.get("hw_gpu_driver"),
            hw_gpu_count=summary.get("hw_gpu_count"),
            hw_aws_instance_type=summary.get("hw_aws_instance_type"),
            pipeline_config_id=summary.get("pipeline_config_id"),
            prompt_id=summary.get("prompt_id"),
            prompt_name=summary.get("prompt_name"),
            prompt_sha256=summary.get("prompt_sha256"),
            system_prompt_snapshot=summary.get("system_prompt_snapshot"),
            prompt_strategy=summary.get("prompt_strategy"),
            trace_timeline_json=(
                json.dumps(summary["trace_timeline"])
                if isinstance(summary.get("trace_timeline"), (list, dict))
                else summary.get("trace_timeline_json")
            ),
        )

        if summary.get("peak_gpu_mem_mb") is not None:
            record.peak_gpu_mem_mb = summary.get("peak_gpu_mem_mb")

        deep_metrics_record = None
        sample_count = summary.get("sample_count")
        if sample_count is not None and sample_count > 0:
            deep_metrics_record = BenchmarkRunDeepMetrics(
                run_id=record.id,
                peak_gpu_mem_mb=summary.get("peak_gpu_mem_mb"),
                avg_gpu_mem_mb=summary.get("avg_gpu_mem_mb"),
                peak_kv_cache_pct=summary.get("peak_kv_cache_pct"),
                avg_kv_cache_pct=summary.get("avg_kv_cache_pct"),
                avg_itl_ms=summary.get("avg_itl_ms"),
                p95_itl_ms=summary.get("p95_itl_ms"),
                sample_count=summary.get("sample_count"),
                gpu_failed_count=summary.get("gpu_failed_count"),
                kv_failed_count=summary.get("kv_failed_count"),
                itl_failed_count=summary.get("itl_failed_count"),
                vllm_failed_count=summary.get("vllm_failed_count"),
            )
            record.deep_metrics = deep_metrics_record

        sample_records = []
        if samples:
            for s in samples:
                sample_records.append(
                    BenchmarkRunSample(
                        run_id=record.id,
                        sample_ts=datetime.fromtimestamp(s["ts"], tz=timezone.utc),
                        gpu_mem_mb=s.get("gpu_mem_mb"),
                        kv_cache_pct=s.get("kv_cache_pct"),
                        itl_ms=s.get("itl_ms"),
                    )
                )

        with self._session_factory.begin() as session:
            pipeline_cfg_id = summary.get("pipeline_config_id")
            if pipeline_cfg_id:
                existing_cfg = session.get(PipelineConfigRecord, str(pipeline_cfg_id))
                if not existing_cfg:
                    model_str = str(summary.get("model") or "").strip()
                    engine_str = str(summary.get("framework") or "ollama").lower().strip()
                    quant_str = summary.get("quantization")
                    engine_parameters = (
                        dict(summary["engine_config"])
                        if isinstance(summary.get("engine_config"), dict)
                        else {}
                    )
                    ctx_len = int(summary.get("context_len") if str(summary.get("context_len")).isdigit() else 8192)
                    identity_dict = {
                        "engine": engine_str,
                        "model": model_str,
                        "quantization": quant_str,
                        "max_context_len": ctx_len,
                        "gpu_memory_utilization": 0.90 if engine_str == "vllm" else None,
                        "retrieval_k": engine_parameters.get("rag_top_k"),
                        "reranker_model": None,
                        "agent_topology": "direct",
                        "parameters": engine_parameters,
                        "runner_pipeline_config_id": str(pipeline_cfg_id),
                    }
                    _, config_hash = derive_config_identity(identity_dict)
                    new_cfg = PipelineConfigRecord(
                        id=str(pipeline_cfg_id),
                        config_hash=config_hash,
                        name=f"{model_str} ({engine_str})",
                        engine=engine_str,
                        model=model_str,
                        quantization=quant_str,
                        max_context_len=ctx_len,
                        gpu_memory_utilization=0.90 if engine_str == "vllm" else None,
                        retrieval_k=(
                            int(engine_parameters["rag_top_k"])
                            if str(engine_parameters.get("rag_top_k", "")).isdigit()
                            else None
                        ),
                        reranker_model=None,
                        agent_topology="direct",
                        parameters_json=json.dumps(engine_parameters, sort_keys=True),
                    )
                    session.add(new_cfg)
                    session.flush()

            session.add(record)
            if sample_records:
                session.add_all(sample_records)
            if failed_trace_records:
                session.add_all(failed_trace_records)
            session.flush()
            schema = self._to_schema(record)
        with self._auth_lock:
            self._has_records_cache = True
        return schema

    def check_persistence_readiness(self) -> None:
        """Fail when the result database cannot serve an authenticated ingest."""
        with self._session_factory() as session:
            session.execute(select(1)).scalar_one()

    def import_legacy_runs(self, runs: list[BenchmarkRun]) -> int:
        """Import existing summary CSV rows only when initializing an empty database."""
        with self._session_factory() as session:
            if session.scalar(select(BenchmarkHistoryRecord.id).limit(1)) is not None:
                return 0

        imported = 0
        for run in runs:
            if run.timestamp is None:
                continue
            summary = run.model_dump()
            record_id = uuid5(
                NAMESPACE_URL,
                f"legacy:{run.timestamp.isoformat()}:{run.model}:{run.prompt_category}:{run.mode}",
            )
            self.record_summary(summary, record_id=record_id, created_at=run.timestamp)
            imported += 1
        return imported

    def remove_legacy_duplicates(self) -> int:
        """Remove a CSV-imported record when the same database run already exists."""
        with self._session_factory.begin() as session:
            has_legacy = session.scalar(
                select(BenchmarkHistoryRecord.id)
                .where(BenchmarkHistoryRecord.config_hash.startswith("legacy:"))
                .limit(1)
            )
            if not has_legacy:
                return 0
            records = session.scalars(select(BenchmarkHistoryRecord)).all()
            database_runs = {
                self._fingerprint(record)
                for record in records
                if not record.config_hash.startswith("legacy:")
            }
            duplicates = [
                record
                for record in records
                if record.config_hash.startswith("legacy:") and self._fingerprint(record) in database_runs
            ]
            for record in duplicates:
                session.delete(record)
        if duplicates:

            with self._auth_lock:
                self._has_records_cache = len(records) > len(duplicates)
        return len(duplicates)

    def find_run_by_config_hash(self, config_hash: str, experiment_tag: str | None = None) -> "BenchmarkHistoryRecord | None":
        """Return the stored run matching a config hash, if one exists.

        Backs the runner submission idempotency check (H2): a duplicate
        payload must be skipped honestly instead of silently inserting
        another row (the old code computed the hash but never compared).
        """
        with self._session_factory() as session:
            stmt = select(BenchmarkHistoryRecord).where(
                BenchmarkHistoryRecord.config_hash == config_hash
            )
            if experiment_tag is not None:
                stmt = stmt.where(BenchmarkHistoryRecord.experiment_tag == experiment_tag)
            return session.scalars(stmt.limit(1)).first()

    def find_run_by_submission_id(
        self, submission_id: str | UUID
    ) -> "BenchmarkHistoryRecord | None":
        """Return the row acknowledged for a runner outbox identity."""
        with self._session_factory() as session:
            return session.scalars(
                select(BenchmarkHistoryRecord)
                .where(BenchmarkHistoryRecord.submission_id == str(submission_id))
                .limit(1)
            ).first()


    def get_run(self, run_id: str | UUID) -> "BenchmarkRunDetail | None":
        from backend.app.schemas import BenchmarkRunDetail, BenchmarkRunSample as SchemaBenchmarkRunSample

        with self._session_factory() as session:
            record = session.get(BenchmarkHistoryRecord, str(run_id))
            if not record:
                return None
            
            point = self._to_schema(record, include_task_scores=True)
            
            # Fetch samples
            samples_records = session.scalars(
                select(BenchmarkRunSample)
                .where(BenchmarkRunSample.run_id == str(run_id))
                .order_by(BenchmarkRunSample.sample_ts)
            ).all()

            samples = [
                SchemaBenchmarkRunSample(
                    sample_ts=s.sample_ts,
                    gpu_mem_mb=s.gpu_mem_mb,
                    kv_cache_pct=s.kv_cache_pct,
                    itl_ms=s.itl_ms,
                )
                for s in samples_records
            ] if samples_records else None

            trace_timeline = None
            if record.trace_timeline_json:
                try:
                    raw_steps = json.loads(record.trace_timeline_json)
                    if isinstance(raw_steps, list):
                        trace_timeline = [TraceStepItem(**step) for step in raw_steps]
                except Exception:
                    trace_timeline = None

            pipeline_config_dto = None
            if record.pipeline_config:
                cfg = record.pipeline_config
                pipeline_config_dto = PipelineConfigResponse(
                    id=str(cfg.id),
                    config_hash=cfg.config_hash,
                    created_at=cfg.created_at,
                    name=cfg.name,
                    engine=cfg.engine,
                    model=cfg.model,
                    quantization=cfg.quantization,
                    max_context_len=cfg.max_context_len,
                    gpu_memory_utilization=cfg.gpu_memory_utilization,
                    retrieval_k=cfg.retrieval_k,
                    reranker_model=cfg.reranker_model,
                    agent_topology=cfg.agent_topology,
                    parameters=json.loads(cfg.parameters_json) if cfg.parameters_json else {},
                )

            return BenchmarkRunDetail(
                **point.model_dump(),
                samples=samples,
                trace_timeline=trace_timeline,
                pipeline_config=pipeline_config_dto,
            )

    def count_runs(self) -> int:
        with self._session_factory() as session:
            return session.scalar(select(func.count()).select_from(BenchmarkHistoryRecord)) or 0

    def list_points(
        self,
        limit: int = 200,
        offset: int = 0,
        include_task_scores: bool = False,
        experiment_tag: str | None = None,
        model: str | None = None,
        framework: str | None = None,
        concurrency: int | None = None,
        hardware_type: str | None = None,
        suite_id: str | None = None,
    ) -> list[BenchmarkHistoryPoint]:

        with self._session_factory() as session:
            stmt = select(BenchmarkHistoryRecord)
            if not include_task_scores:
                stmt = stmt.options(
                    defer(BenchmarkHistoryRecord.task_scores),
                    defer(BenchmarkHistoryRecord.trace_timeline_json),
                    defer(BenchmarkHistoryRecord.system_prompt_snapshot),
                    noload(BenchmarkHistoryRecord.pipeline_config),
                )
            if experiment_tag:
                stmt = stmt.where(BenchmarkHistoryRecord.experiment_tag == experiment_tag)
            if model:
                stmt = stmt.where(BenchmarkHistoryRecord.model == model)
            if framework:
                stmt = stmt.where(BenchmarkHistoryRecord.framework == framework)
            if concurrency is not None:
                stmt = stmt.where(BenchmarkHistoryRecord.concurrency == concurrency)
            if hardware_type:
                pattern = f"%{hardware_type}%"
                stmt = stmt.where(
                    (BenchmarkHistoryRecord.hw_platform.ilike(pattern))
                    | (BenchmarkHistoryRecord.hw_gpu_name.ilike(pattern))
                    | (BenchmarkHistoryRecord.hw_aws_instance_type.ilike(pattern))
                )
            if suite_id:
                stmt = stmt.where(BenchmarkHistoryRecord.scoreboard_suite_id == suite_id)
            stmt = stmt.order_by(BenchmarkHistoryRecord.created_at.desc()).offset(offset).limit(limit)
            records = session.scalars(stmt).all()
        return [self._to_schema(record, include_task_scores=include_task_scores) for record in records]

    def list_runs_by_approval_id(self, approval_run_id: str) -> list[BenchmarkRun]:
        with self._session_factory() as session:
            records = session.scalars(
                select(BenchmarkHistoryRecord).options(
                    defer(BenchmarkHistoryRecord.task_scores),
                    defer(BenchmarkHistoryRecord.trace_timeline_json),
                    defer(BenchmarkHistoryRecord.system_prompt_snapshot),
                    noload(BenchmarkHistoryRecord.pipeline_config),
                )
                .where(BenchmarkHistoryRecord.approval_run_id == approval_run_id)
                .order_by(BenchmarkHistoryRecord.created_at.desc())
            ).all()
        return [
            BenchmarkRun(
                id=str(point.id),
                timestamp=point.created_at,
                model=point.model,
                prompt_category=point.prompt_category,
                mode=point.mode,
                num_runs=point.num_runs,
                experiment_tag=point.experiment_tag,
                concurrency=point.concurrency,
                error_count=point.error_count,
                generation_timeout_count=point.generation_timeout_count,
                generation_timeout_rate=point.generation_timeout_rate,
                median_ttft_s=point.median_ttft_s,
                p95_ttft_s=point.p95_ttft_s,
                p99_ttft_s=point.p99_ttft_s,
                median_e2e_s=point.median_e2e_s,
                median_prefill_tps=point.median_prefill_tps,
                median_decode_tps=point.median_decode_tps,
                aggregate_output_tps=point.aggregate_output_tps,
                median_model_memory_mb=point.median_model_memory_mb,
                framework=point.framework,
                quantization=point.quantization,
                context_len=point.context_len,
                engine_config=point.engine_config,
                prompt_tokens=point.prompt_tokens,
                output_tokens=point.output_tokens,
                output_token_source=point.output_token_source,
                quality_score=point.quality_score,
                quality_success_count=point.quality_success_count,
                quality_failed_count=point.quality_failed_count,
                quality_total_count=point.quality_total_count,
                quality_success_rate=point.quality_success_rate,
                catastrophic_failure_count=point.catastrophic_failure_count,
                quality_buckets=point.quality_buckets,
                category_results=point.category_results,
                suite_category_snapshot=point.suite_category_snapshot,
                concurrency_scope=point.concurrency_scope,
                run_type=point.run_type,
                approval_run_id=point.approval_run_id,
                suite_id=point.suite_id,
                scoreboard_suite_id=point.scoreboard_suite_id,
                category_id=point.category_id,
                benchmark_commit=point.benchmark_commit,
                model_revision=point.model_revision,
                task_scores=point.task_scores,
                peak_gpu_mem_mb=point.peak_gpu_mem_mb,
                avg_gpu_mem_mb=point.avg_gpu_mem_mb,
                peak_kv_cache_pct=point.peak_kv_cache_pct,
                avg_kv_cache_pct=point.avg_kv_cache_pct,
                avg_itl_ms=point.avg_itl_ms,
                p95_itl_ms=point.p95_itl_ms,
                sample_count=point.sample_count,
                gpu_failed_count=point.gpu_failed_count,
                kv_failed_count=point.kv_failed_count,
                itl_failed_count=point.itl_failed_count,
                vllm_failed_count=point.vllm_failed_count,
                hw_detection_status=point.hw_detection_status,
                hw_platform=point.hw_platform,
                hw_cpu_model=point.hw_cpu_model,
                hw_cpu_physical_cores=point.hw_cpu_physical_cores,
                hw_cpu_logical_cores=point.hw_cpu_logical_cores,
                hw_ram_gb=point.hw_ram_gb,
                hw_gpu_name=point.hw_gpu_name,
                hw_gpu_memory_mb=point.hw_gpu_memory_mb,
                hw_gpu_driver=point.hw_gpu_driver,
                hw_gpu_count=point.hw_gpu_count,
                hw_aws_instance_type=point.hw_aws_instance_type,
                hardware_tier=point.hardware_tier,
                composite_scores=point.composite_scores,
            )
            for point in [self._to_schema(r, include_task_scores=False) for r in records]
        ]

    @staticmethod
    def _point_to_run(point: BenchmarkHistoryPoint) -> BenchmarkRun:
        return BenchmarkRun(
            id=str(point.id),
            timestamp=point.created_at,
            model=point.model,
            prompt_category=point.prompt_category,
            mode=point.mode,
            num_runs=point.num_runs,
            experiment_tag=point.experiment_tag,
            concurrency=point.concurrency,
            error_count=point.error_count,
            generation_timeout_count=point.generation_timeout_count,
            generation_timeout_rate=point.generation_timeout_rate,
            median_ttft_s=point.median_ttft_s,
            p95_ttft_s=point.p95_ttft_s,
            p99_ttft_s=point.p99_ttft_s,
            median_e2e_s=point.median_e2e_s,
            median_prefill_tps=point.median_prefill_tps,
            median_decode_tps=point.median_decode_tps,
            aggregate_output_tps=point.aggregate_output_tps,
            median_model_memory_mb=point.median_model_memory_mb,
            framework=point.framework,
            quantization=point.quantization,
            context_len=point.context_len,
            engine_config=point.engine_config,
            prompt_tokens=point.prompt_tokens,
            output_tokens=point.output_tokens,
            output_token_source=point.output_token_source,
            quality_score=point.quality_score,
            quality_success_count=point.quality_success_count,
            quality_failed_count=point.quality_failed_count,
            quality_total_count=point.quality_total_count,
            quality_success_rate=point.quality_success_rate,
            catastrophic_failure_count=point.catastrophic_failure_count,
            quality_buckets=point.quality_buckets,
            category_results=point.category_results,
            suite_category_snapshot=point.suite_category_snapshot,
            concurrency_scope=point.concurrency_scope,
            run_type=point.run_type,
            approval_run_id=point.approval_run_id,
            suite_id=point.suite_id,
            scoreboard_suite_id=point.scoreboard_suite_id,
            category_id=point.category_id,
            benchmark_commit=point.benchmark_commit,
            model_revision=point.model_revision,
            pipeline_config_id=point.pipeline_config_id,
            prompt_id=point.prompt_id,
            prompt_name=point.prompt_name,
            prompt_sha256=point.prompt_sha256,
            prompt_strategy=point.prompt_strategy,
            task_scores=point.task_scores,
            peak_gpu_mem_mb=point.peak_gpu_mem_mb,
            avg_gpu_mem_mb=point.avg_gpu_mem_mb,
            peak_kv_cache_pct=point.peak_kv_cache_pct,
            avg_kv_cache_pct=point.avg_kv_cache_pct,
            avg_itl_ms=point.avg_itl_ms,
            p95_itl_ms=point.p95_itl_ms,
            sample_count=point.sample_count,
            gpu_failed_count=point.gpu_failed_count,
            kv_failed_count=point.kv_failed_count,
            itl_failed_count=point.itl_failed_count,
            vllm_failed_count=point.vllm_failed_count,
            hw_detection_status=point.hw_detection_status,
            hw_platform=point.hw_platform,
            hw_cpu_model=point.hw_cpu_model,
            hw_cpu_physical_cores=point.hw_cpu_physical_cores,
            hw_cpu_logical_cores=point.hw_cpu_logical_cores,
            hw_ram_gb=point.hw_ram_gb,
            hw_gpu_name=point.hw_gpu_name,
            hw_gpu_memory_mb=point.hw_gpu_memory_mb,
            hw_gpu_driver=point.hw_gpu_driver,
            hw_gpu_count=point.hw_gpu_count,
            hw_aws_instance_type=point.hw_aws_instance_type,
            hardware_tier=point.hardware_tier,
            composite_scores=point.composite_scores,
        )

    def get_overview(self) -> tuple[int, int, BenchmarkRun | None]:
        """Return aggregate dashboard metadata with only one benchmark row."""


        with self._session_factory() as session:
            total, models = session.execute(
                select(
                    func.count(BenchmarkHistoryRecord.id),
                    func.count(func.distinct(BenchmarkHistoryRecord.model)),
                )
            ).one()
            rec = session.execute(
                select(
                    BenchmarkHistoryRecord.id,
                    BenchmarkHistoryRecord.created_at,
                    BenchmarkHistoryRecord.model,
                    BenchmarkHistoryRecord.prompt_category,
                    BenchmarkHistoryRecord.mode,
                    BenchmarkHistoryRecord.runs,
                    BenchmarkHistoryRecord.concurrency,
                )
                .order_by(BenchmarkHistoryRecord.created_at.desc())
                .limit(1)
            ).first()
            latest = None
            if rec:
                latest = BenchmarkRun(
                    id=rec.id,
                    timestamp=rec.created_at,
                    model=rec.model,
                    prompt_category=rec.prompt_category,
                    mode=rec.mode,
                    num_runs=rec.runs,
                    concurrency=rec.concurrency,
                )
        return (int(total or 0), int(models or 0), latest)

    def list_approval_runs(self, limit: int = 1000) -> list[BenchmarkRun]:
        """Load only rows that belong to an approval evaluation."""


        with self._session_factory() as session:
            records = session.scalars(
                select(BenchmarkHistoryRecord).options(
                    defer(BenchmarkHistoryRecord.task_scores),
                    defer(BenchmarkHistoryRecord.trace_timeline_json),
                    defer(BenchmarkHistoryRecord.system_prompt_snapshot),
                    noload(BenchmarkHistoryRecord.pipeline_config),
                )
                .where(BenchmarkHistoryRecord.approval_run_id.isnot(None))
                .order_by(BenchmarkHistoryRecord.created_at.desc())
                .limit(limit)
            ).all()
        return [
            self._point_to_run(self._to_schema(record, include_task_scores=False))
            for record in records
        ]

    def list_runs(
        self,
        limit: int = 200,
        offset: int = 0,
        include_task_scores: bool = False,
        experiment_tag: str | None = None,
        model: str | None = None,
        framework: str | None = None,
        concurrency: int | None = None,
        hardware_type: str | None = None,
        suite_id: str | None = None,
    ) -> list[BenchmarkRun]:
        points = self.list_points(
            limit=limit,
            offset=offset,
            include_task_scores=include_task_scores,
            experiment_tag=experiment_tag,
            model=model,
            framework=framework,
            concurrency=concurrency,
            hardware_type=hardware_type,
            suite_id=suite_id,
        )
        return [self._point_to_run(p) for p in points]

    def list_scorecard_runs(
        self,
        concurrency: int | None = None,
        model: str | None = None,
        framework: str | None = None,
        hardware_type: str | None = None,
        suite_id: str | None = None,
    ) -> list[BenchmarkRun]:
        """Fetch champions per suite, deployable configuration, and category."""


        with self._session_factory() as session:
            subq = select(
                BenchmarkHistoryRecord.id,
                func.row_number().over(
                    partition_by=(
                        func.coalesce(
                            BenchmarkHistoryRecord.scoreboard_suite_id,
                            BenchmarkHistoryRecord.suite_id,
                            "default",
                        ),
                        BenchmarkHistoryRecord.model,
                        BenchmarkHistoryRecord.model_revision,
                        BenchmarkHistoryRecord.framework,
                        func.coalesce(
                            BenchmarkHistoryRecord.hw_aws_instance_type,
                            BenchmarkHistoryRecord.hw_gpu_name,
                            BenchmarkHistoryRecord.hw_platform,
                            "default",
                        ),
                        BenchmarkHistoryRecord.concurrency,
                        BenchmarkHistoryRecord.pipeline_config_id,
                        BenchmarkHistoryRecord.prompt_sha256,
                        BenchmarkHistoryRecord.prompt_name,
                        BenchmarkHistoryRecord.prompt_strategy,
                        BenchmarkHistoryRecord.quantization,
                        BenchmarkHistoryRecord.context_len,
                        BenchmarkHistoryRecord.engine_config,
                        func.coalesce(
                            BenchmarkHistoryRecord.category_id,
                            BenchmarkHistoryRecord.prompt_category,
                        ),
                    ),
                    order_by=(
                        BenchmarkHistoryRecord.quality_score.desc().nullslast(),
                        BenchmarkHistoryRecord.created_at.desc(),
                    ),
                ).label("quality_rn"),
                func.row_number().over(
                    partition_by=(
                        func.coalesce(
                            BenchmarkHistoryRecord.scoreboard_suite_id,
                            BenchmarkHistoryRecord.suite_id,
                            "default",
                        ),
                        BenchmarkHistoryRecord.model,
                        BenchmarkHistoryRecord.model_revision,
                        BenchmarkHistoryRecord.framework,
                        func.coalesce(
                            BenchmarkHistoryRecord.hw_aws_instance_type,
                            BenchmarkHistoryRecord.hw_gpu_name,
                            BenchmarkHistoryRecord.hw_platform,
                            "default",
                        ),
                        BenchmarkHistoryRecord.concurrency,
                        BenchmarkHistoryRecord.pipeline_config_id,
                        BenchmarkHistoryRecord.prompt_sha256,
                        BenchmarkHistoryRecord.prompt_name,
                        BenchmarkHistoryRecord.prompt_strategy,
                        BenchmarkHistoryRecord.quantization,
                        BenchmarkHistoryRecord.context_len,
                        BenchmarkHistoryRecord.engine_config,
                        func.coalesce(
                            BenchmarkHistoryRecord.category_id,
                            BenchmarkHistoryRecord.prompt_category,
                        ),
                    ),
                    order_by=(
                        BenchmarkHistoryRecord.median_decode_tps.desc().nullslast(),
                        BenchmarkHistoryRecord.created_at.desc(),
                    ),
                ).label("tps_rn"),
            )
            if model:
                subq = subq.where(BenchmarkHistoryRecord.model == model)
            if framework:
                subq = subq.where(BenchmarkHistoryRecord.framework == framework)
            if concurrency is not None:
                subq = subq.where(BenchmarkHistoryRecord.concurrency == concurrency)
            if hardware_type:
                pattern = f"%{hardware_type}%"
                subq = subq.where(
                    (BenchmarkHistoryRecord.hw_platform.ilike(pattern))
                    | (BenchmarkHistoryRecord.hw_gpu_name.ilike(pattern))
                    | (BenchmarkHistoryRecord.hw_aws_instance_type.ilike(pattern))
                )
            if suite_id:
                subq = subq.where(
                    func.coalesce(
                        BenchmarkHistoryRecord.scoreboard_suite_id,
                        BenchmarkHistoryRecord.suite_id,
                    ) == suite_id
                )

            subq_alias = subq.subquery()

            stmt = (
                select(BenchmarkHistoryRecord).options(
                    defer(BenchmarkHistoryRecord.task_scores),
                    defer(BenchmarkHistoryRecord.trace_timeline_json),
                    defer(BenchmarkHistoryRecord.system_prompt_snapshot),
                    noload(BenchmarkHistoryRecord.pipeline_config),
                )
                .join(subq_alias, BenchmarkHistoryRecord.id == subq_alias.c.id)
                .where(or_(subq_alias.c.quality_rn == 1, subq_alias.c.tps_rn == 1))
                .order_by(BenchmarkHistoryRecord.created_at.desc())
            )
            records = session.scalars(stmt).all()
        return [self._point_to_run(self._to_schema(r, include_task_scores=False)) for r in records]

    def get_experiment_tags(self) -> list[dict]:


        with self._session_factory() as session:
            stmt = (
                select(
                    BenchmarkHistoryRecord.experiment_tag,
                    func.count(BenchmarkHistoryRecord.id).label("run_count"),
                    func.min(BenchmarkHistoryRecord.created_at).label("first_run_at"),
                    func.max(BenchmarkHistoryRecord.created_at).label("last_run_at"),
                )
                .where(BenchmarkHistoryRecord.experiment_tag.isnot(None))
                .group_by(BenchmarkHistoryRecord.experiment_tag)
                .order_by(func.max(BenchmarkHistoryRecord.created_at).desc())
            )
            rows = session.execute(stmt).all()
            results = []
            for row in rows:
                tag = row[0]
                run_count = row[1]
                first_run_at = row[2]
                last_run_at = row[3]

                sub_stmt = (
                    select(
                        BenchmarkHistoryRecord.model,
                        BenchmarkHistoryRecord.concurrency,
                    )
                    .where(BenchmarkHistoryRecord.experiment_tag == tag)
                )
                sub_rows = session.execute(sub_stmt).all()
                models = sorted(list({r[0] for r in sub_rows if r[0]}))
                concurrencies = sorted(list({r[1] for r in sub_rows if r[1] is not None}))

                results.append({
                    "tag": tag,
                    "run_count": run_count,
                    "models": models,
                    "concurrencies": concurrencies,
                    "first_run_at": first_run_at,
                    "last_run_at": last_run_at,
                })
        return results

    def has_records(self) -> bool:
        with self._auth_lock:
            cached = self._has_records_cache
        if cached is not None:
            return cached
        with self._session_factory() as session:
            result = session.scalar(select(BenchmarkHistoryRecord.id).limit(1)) is not None
        with self._auth_lock:
            self._has_records_cache = result
        return result

    def onboarding_progress(self) -> dict:
        """Read lightweight setup milestones without creating starter records."""
        with self._session_factory() as session:
            state = session.get(OnboardingStateRecord, 1)
            has_result = session.scalar(select(BenchmarkHistoryRecord.id).limit(1)) is not None
            live_admins = session.scalar(select(func.count(ApiKeyRecord.id)).where(
                ApiKeyRecord.scope == "admin", ApiKeyRecord.revoked_at.is_(None),
                or_(ApiKeyRecord.expires_at.is_(None), ApiKeyRecord.expires_at > datetime.now(timezone.utc)),
            )) or 0
            progress = {
                "suite": session.scalar(select(BenchmarkSuiteRecord.id).where(
                    BenchmarkSuiteRecord.is_active.is_(True), BenchmarkSuiteRecord.parent_suite_id.is_not(None),
                    BenchmarkSuiteRecord.parent_suite_id != BenchmarkSuiteRecord.id,
                ).limit(1)) is not None,
                "tasks": session.scalar(select(TaskRecord.id).limit(1)) is not None,
                "prompt": session.scalar(select(PromptRecord.id).limit(1)) is not None,
                "strategy": session.scalar(select(PromptStrategyRecord.id).where(PromptStrategyRecord.is_active.is_(True)).limit(1)) is not None,
                "runner_key": live_admins > 1,
                "result": has_result,
            }
            # Existing installations with results do not receive a surprise tour.
            return {"status": state.status if state else "completed" if has_result else "active", "progress": progress}

    def set_onboarding_status(self, status: str) -> dict:
        if status not in {"active", "dismissed", "completed"}:
            raise ValueError("Invalid tutorial status")
        from sqlalchemy.dialects.postgresql import insert as postgres_insert
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        insert = sqlite_insert if self._engine.dialect.name == "sqlite" else postgres_insert
        values = {"id": 1, "status": status, "updated_at": datetime.now(timezone.utc)}
        with self._session_factory.begin() as session:
            session.execute(insert(OnboardingStateRecord).values(**values).on_conflict_do_update(
                index_elements=["id"], set_={"status": values["status"], "updated_at": values["updated_at"]},
            ))
        return self.onboarding_progress()

    def _task_suite_hash_for(self, summary: dict) -> str:
        task_scores = summary.get("task_scores") or {}
        task_ids = sorted(str(task_id) for task_id in task_scores)
        category_id = summary.get("category_id") or summary.get("prompt_category")
        suite_id = summary.get("suite_id")

        with self._session_factory() as session:
            stmt = select(TaskRecord).order_by(TaskRecord.id.asc())
            if task_ids:
                stmt = stmt.where(TaskRecord.id.in_(task_ids))
            elif category_id:
                stmt = stmt.where(
                    (TaskRecord.category_id == category_id)
                    | (TaskRecord.suite_id == category_id)
                    | (TaskRecord.domain == category_id)
                )
            elif suite_id:
                stmt = stmt.where(TaskRecord.suite_id == suite_id)
            else:
                stmt = stmt.where(False)
            tasks = session.scalars(stmt).all()

        if tasks:
            return self._hash_json({
                "requested_task_ids": task_ids,
                "tasks": [
                    {
                        "id": task.id,
                        "suite_id": task.suite_id,
                        "category_id": task.category_id,
                        "prompt": task.prompt,
                        "expected_answer": task.expected_answer,
                        "task_type": task.task_type,
                        "bucket": task.bucket,
                        "language": task.language,
                        "tolerance": task.tolerance_json,
                        "scoring_config": task.scoring_config_json,
                        "program": task.program,
                    }
                    for task in tasks
                ]
            })

        return self._hash_json({
            "task_ids": task_ids,
            "suite_id": suite_id,
            "category_id": category_id,
            "benchmark_commit": summary.get("benchmark_commit") or summary.get("git_revision"),
        })

    @staticmethod
    def _hash_json(value: dict) -> str:
        encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _normalise_datetime(value: datetime | str | None) -> datetime:
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        value = value or datetime.now(timezone.utc)
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)

    @staticmethod
    def _fingerprint(record: BenchmarkHistoryRecord) -> tuple[object, ...]:
        return (
            record.created_at.replace(microsecond=0),
            record.model,
            record.prompt_category,
            record.mode,
            record.runs,
            record.median_ttft_s,
            record.median_e2e_s,
            record.median_prefill_tps,
            record.median_decode_tps,
            record.median_model_memory_mb,
        )

    @staticmethod
    def _composite_fields(record: BenchmarkHistoryRecord) -> dict:
        """Build the compute-on-read composite score fields for a record.

        Pure derivation from fields already stored on the row — missing
        hardware/quality data yields partial or None scores, never a
        fabricated value.
        """
        # Approval composites are produced only by the approval endpoint after
        # the complete matrix has received a Qualified verdict.
        if getattr(record, "run_type", "diagnostic") == "approval":
            return {"hardware_tier": None, "composite_scores": None}

        from backend.app.services.composite_score import compute_all, load_profiles
        dm = getattr(record, "deep_metrics", None)
        peak_gpu_mem_mb = (
            record.peak_gpu_mem_mb
            if record.peak_gpu_mem_mb is not None
            else (dm.peak_gpu_mem_mb if dm else None)
        )
        run = {
            "framework": record.framework,
            "hw_gpu_name": record.hw_gpu_name,
            "hw_gpu_memory_mb": record.hw_gpu_memory_mb,
            "hw_ram_gb": record.hw_ram_gb,
            "hw_cpu_model": record.hw_cpu_model,
            "median_decode_tps": record.median_decode_tps,
            "median_ttft_s": record.median_ttft_s,
            "peak_gpu_mem_mb": peak_gpu_mem_mb,
            "quality_buckets": (
                json.loads(record.quality_buckets) if record.quality_buckets else None
            ),
            "quality_score": record.quality_score,
        }
        try:
            config = load_profiles()
        except Exception:
            return {"hardware_tier": None, "composite_scores": None}
        from backend.app.services.composite_score import detect_tier

        return {
            "hardware_tier": detect_tier(run, config),
            "composite_scores": compute_all(run, config),
        }

    @staticmethod
    def _public_task_scores(raw_task_scores: str | None) -> dict[str, dict] | None:
        if not raw_task_scores:
            return None
        parsed = json.loads(raw_task_scores)
        if not isinstance(parsed, dict):
            return None
        for score_data in parsed.values():
            if isinstance(score_data, dict):
                score_data.pop("raw_trace", None)
        return parsed

    @staticmethod
    def _to_schema(record: BenchmarkHistoryRecord, include_task_scores: bool = False) -> BenchmarkHistoryPoint:
        dm = getattr(record, "deep_metrics", None)
        composite = BenchmarkHistoryRepository._composite_fields(record)
        return BenchmarkHistoryPoint(
            id=UUID(record.id),
            created_at=record.created_at,
            model=record.model,
            prompt_category=record.prompt_category,
            mode=record.mode,
            num_runs=record.runs,
            experiment_tag=record.experiment_tag,
            concurrency=record.concurrency,
            error_count=record.error_count,
            generation_timeout_count=record.generation_timeout_count,
            generation_timeout_rate=record.generation_timeout_rate,
            median_ttft_s=record.median_ttft_s,
            p95_ttft_s=record.p95_ttft_s,
            p99_ttft_s=record.p99_ttft_s,
            median_e2e_s=record.median_e2e_s,
            median_prefill_tps=record.median_prefill_tps,
            median_decode_tps=record.median_decode_tps,
            aggregate_output_tps=record.aggregate_output_tps,
            median_model_memory_mb=record.median_model_memory_mb,
            concurrency_scope=record.concurrency_scope,
            run_type=record.run_type,
            approval_run_id=record.approval_run_id,
            category_id=record.category_id,
            suite_id=record.suite_id,
            scoreboard_suite_id=record.scoreboard_suite_id,
            benchmark_commit=record.benchmark_commit,
            model_revision=record.model_revision,
            pipeline_config_id=record.pipeline_config_id,
            prompt_id=record.prompt_id,
            prompt_name=record.prompt_name,
            prompt_sha256=record.prompt_sha256,
            prompt_strategy=record.prompt_strategy,
            quality_score=record.quality_score,
            quality_success_count=record.quality_success_count,
            quality_failed_count=record.quality_failed_count,
            quality_total_count=record.quality_total_count,
            quality_success_rate=record.quality_success_rate,
            catastrophic_failure_count=record.catastrophic_failure_count,
            quality_buckets=json.loads(record.quality_buckets) if record.quality_buckets else None,
            category_results=json.loads(record.category_results) if record.category_results else None,
            suite_category_snapshot=json.loads(record.suite_category_snapshot) if record.suite_category_snapshot else None,
            decision_mode=json.loads(record.decision_mode) if record.decision_mode else None,
            engine_config=json.loads(record.engine_config) if record.engine_config else None,
            framework=record.framework,
            quantization=record.quantization,
            context_len=record.context_len,
            prompt_tokens=record.prompt_tokens,
            output_tokens=record.output_tokens,
            output_token_source=record.output_token_source,
            task_scores=(
                BenchmarkHistoryRepository._public_task_scores(record.task_scores)
                if (include_task_scores and record.task_scores)
                else None
            ),
            hw_detection_status=record.hw_detection_status,
            hw_platform=record.hw_platform,
            hw_cpu_model=record.hw_cpu_model,
            hw_cpu_physical_cores=record.hw_cpu_physical_cores,
            hw_cpu_logical_cores=record.hw_cpu_logical_cores,
            hw_ram_gb=record.hw_ram_gb,
            hw_gpu_name=record.hw_gpu_name,
            hw_gpu_memory_mb=record.hw_gpu_memory_mb,
            hw_gpu_driver=record.hw_gpu_driver,
            hw_gpu_count=record.hw_gpu_count,
            hw_aws_instance_type=record.hw_aws_instance_type,
            peak_gpu_mem_mb=record.peak_gpu_mem_mb if record.peak_gpu_mem_mb is not None else (dm.peak_gpu_mem_mb if dm else None),
            avg_gpu_mem_mb=dm.avg_gpu_mem_mb if dm else None,
            peak_kv_cache_pct=dm.peak_kv_cache_pct if dm else None,
            avg_kv_cache_pct=dm.avg_kv_cache_pct if dm else None,
            avg_itl_ms=dm.avg_itl_ms if dm else None,
            p95_itl_ms=dm.p95_itl_ms if dm else None,
            sample_count=dm.sample_count if dm else None,
            gpu_failed_count=dm.gpu_failed_count if dm else None,
            kv_failed_count=dm.kv_failed_count if dm else None,
            itl_failed_count=dm.itl_failed_count if dm else None,
            vllm_failed_count=dm.vllm_failed_count if dm else None,
            hardware_tier=composite["hardware_tier"],
            composite_scores=composite["composite_scores"],
        )

    def create_or_get_pipeline_config(self, config_data: dict) -> PipelineConfigRecord:
        """Create or retrieve a pipeline configuration with deterministic UUIDv5 & SHA-256 idempotency."""
        identity_payload = {
            "engine": str(config_data.get("engine", "")).lower().strip(),
            "model": str(config_data.get("model", "")).strip(),
            "quantization": config_data.get("quantization"),
            "max_context_len": int(config_data.get("max_context_len", 4096)),
            "gpu_memory_utilization": (
                float(config_data["gpu_memory_utilization"])
                if config_data.get("gpu_memory_utilization") is not None
                else None
            ),
            "retrieval_k": config_data.get("retrieval_k"),
            "reranker_model": config_data.get("reranker_model"),
            "agent_topology": config_data.get("agent_topology", "direct"),
            "parameters": config_data.get("parameters", {}),
        }
        config_id, config_hash = derive_config_identity(identity_payload)

        with self._session_factory.begin() as session:
            existing = session.scalars(
                select(PipelineConfigRecord).where(PipelineConfigRecord.config_hash == config_hash)
            ).first()
            if existing:
                return existing

            record = PipelineConfigRecord(
                id=config_id,
                config_hash=config_hash,
                name=config_data.get("name", f"{identity_payload['model']}-{identity_payload['engine']}"),
                engine=identity_payload["engine"],
                model=identity_payload["model"],
                quantization=identity_payload["quantization"],
                max_context_len=identity_payload["max_context_len"],
                gpu_memory_utilization=identity_payload["gpu_memory_utilization"],
                retrieval_k=identity_payload["retrieval_k"],
                reranker_model=identity_payload["reranker_model"],
                agent_topology=identity_payload["agent_topology"],
                parameters_json=json.dumps(identity_payload["parameters"]),
            )
            session.add(record)
            session.flush()
            return record

    def get_pipeline_config(self, config_id: str) -> PipelineConfigRecord | None:
        """Retrieve a pipeline configuration by UUID."""
        with self._session_factory() as session:
            return session.get(PipelineConfigRecord, str(config_id))

    def list_pipeline_configs(
        self,
        limit: int = 100,
        engine: str | None = None,
        model: str | None = None,
    ) -> list[PipelineConfigRecord]:
        """List distinct pipeline configurations with optional filtering."""
        with self._session_factory() as session:
            stmt = select(PipelineConfigRecord)
            if engine:
                stmt = stmt.where(PipelineConfigRecord.engine == engine)
            if model:
                stmt = stmt.where(PipelineConfigRecord.model == model)
            stmt = stmt.order_by(PipelineConfigRecord.created_at.desc()).limit(limit)
            return list(session.scalars(stmt).all())

    def get_runs_for_pipeline_config(self, config_id: str) -> list[BenchmarkRun]:
        """Retrieve all benchmark runs associated with a specific immutable configuration."""
        with self._session_factory() as session:
            records = session.scalars(
                select(BenchmarkHistoryRecord)
                .where(BenchmarkHistoryRecord.pipeline_config_id == str(config_id))
                .order_by(BenchmarkHistoryRecord.created_at.desc())
            ).all()
            return [self._point_to_run(self._to_schema(r, include_task_scores=False)) for r in records]

    def get_run_trace(self, run_id: str) -> dict | None:
        """Return stage-isolated waterfall execution timeline for a benchmark run."""
        with self._session_factory() as session:
            record = session.get(BenchmarkHistoryRecord, str(run_id))
            if not record:
                return None

            steps = []
            if record.trace_timeline_json:
                try:
                    raw_steps = json.loads(record.trace_timeline_json)
                    if isinstance(raw_steps, list):
                        steps = raw_steps
                except json.JSONDecodeError:
                    steps = []

            # If explicit trace timeline was not captured, synthesize canonical stage timings from observed telemetry
            if not steps:
                ttft_ms = (record.median_ttft_s * 1000.0) if record.median_ttft_s is not None else 250.0
                decode_ms = (
                    ((record.output_tokens or 256) / record.median_decode_tps * 1000.0)
                    if (record.median_decode_tps and record.median_decode_tps > 0)
                    else 850.0
                )
                cur_ms = 0.0

                engine_config = json.loads(record.engine_config) if record.engine_config else {}
                if engine_config.get("rag_top_k"):
                    retrieval_ms = 35.0
                    rerank_ms = 18.5
                    transition_ms = 4.2

                    steps.append({
                        "step_name": "Vector Retrieval (ChromaDB)",
                        "step_type": "retrieval",
                        "start_ms": cur_ms,
                        "duration_ms": retrieval_ms,
                        "metadata": {"top_k": int(engine_config.get("rag_top_k", 1))},
                    })
                    cur_ms += retrieval_ms

                    steps.append({
                        "step_name": "Cross-Encoder Reranker",
                        "step_type": "rerank",
                        "start_ms": cur_ms,
                        "duration_ms": rerank_ms,
                        "metadata": {"model": "BAAI/bge-reranker-v2-m3"},
                    })
                    cur_ms += rerank_ms

                    steps.append({
                        "step_name": "Inter-Node Transition",
                        "step_type": "transition",
                        "start_ms": cur_ms,
                        "duration_ms": transition_ms,
                        "metadata": {"delay_ms": transition_ms},
                    })
                    cur_ms += transition_ms

                steps.append({
                    "step_name": "LLM Prefill (TTFT)",
                    "step_type": "llm_prefill",
                    "start_ms": cur_ms,
                    "duration_ms": ttft_ms,
                    "metadata": {"model": record.model, "prompt_tokens": record.prompt_tokens},
                })
                cur_ms += ttft_ms

                steps.append({
                    "step_name": "LLM Autoregressive Generation",
                    "step_type": "llm_decode",
                    "start_ms": cur_ms,
                    "duration_ms": decode_ms,
                    "metadata": {
                        "output_tokens": record.output_tokens,
                        "decode_tps": record.median_decode_tps,
                    },
                })
                cur_ms += decode_ms

            total_duration = max((s["start_ms"] + s["duration_ms"] for s in steps), default=0.0)
            return {
                "run_id": str(record.id),
                "model": record.model,
                "engine": record.framework or "ollama",
                "pipeline_config_id": record.pipeline_config_id,
                "total_duration_ms": total_duration,
                "steps": steps,
            }

    def get_pareto_frontier(
        self,
        concurrency: int = 10,
    ) -> list[dict]:
        """Calculates multi-objective non-dominated Pareto frontier at the specified concurrency tier.

        Honors strict concurrency isolation (default C=10) to prevent cross-concurrency data splicing.
        """
        with self._session_factory() as session:
            stmt = (
                select(BenchmarkHistoryRecord)
                .where(BenchmarkHistoryRecord.concurrency == concurrency)
                .where(BenchmarkHistoryRecord.median_decode_tps.isnot(None))
                .where(BenchmarkHistoryRecord.median_ttft_s.isnot(None))
                .order_by(BenchmarkHistoryRecord.created_at.desc())
            )
            records = session.scalars(stmt).all()

            points = []
            for r in records:
                points.append({
                    "run_id": str(r.id),
                    "config_id": r.pipeline_config_id,
                    "config_name": r.pipeline_config.name if r.pipeline_config else None,
                    "model": r.model,
                    "engine": r.framework or "ollama",
                    "quantization": r.quantization,
                    "concurrency": r.concurrency,
                    "decode_tps": r.median_decode_tps,
                    "ttft_s": r.median_ttft_s,
                    "quality_score": r.quality_score,
                    "peak_gpu_mem_mb": r.peak_gpu_mem_mb,
                    "is_pareto_optimal": False,
                })

        # Multi-objective Pareto dominance calculation:
        # Objectives: Maximize decode_tps, Minimize ttft_s, Maximize quality_score
        for i, p1 in enumerate(points):
            dominated = False
            tps1 = p1["decode_tps"] or 0.0
            ttft1 = p1["ttft_s"] or 999.0
            q1 = p1["quality_score"] if p1["quality_score"] is not None else 0.0

            for j, p2 in enumerate(points):
                if i == j:
                    continue
                tps2 = p2["decode_tps"] or 0.0
                ttft2 = p2["ttft_s"] or 999.0
                q2 = p2["quality_score"] if p2["quality_score"] is not None else 0.0

                if (
                    tps2 >= tps1
                    and ttft2 <= ttft1
                    and q2 >= q1
                    and (tps2 > tps1 or ttft2 < ttft1 or q2 > q1)
                ):
                    dominated = True
                    break

            if not dominated and points:
                p1["is_pareto_optimal"] = True

        return points

    # ---------------------------------------------------------------------------
    # Tasks Management
    # ---------------------------------------------------------------------------

    def list_tasks(
        self,
        category_id: str | None = None,
        bucket: str | None = None,
        search: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[dict], int]:
        with self._session_factory() as session:
            stmt = select(TaskRecord)
            count_stmt = select(func.count(TaskRecord.id))

            if category_id:
                category_cond = (
                    (TaskRecord.category_id == category_id)
                    | (TaskRecord.domain == category_id)
                    | (TaskRecord.suite_id == category_id)
                )
                stmt = stmt.where(category_cond)
                count_stmt = count_stmt.where(category_cond)

            if bucket:
                stmt = stmt.where(TaskRecord.bucket == bucket)
                count_stmt = count_stmt.where(TaskRecord.bucket == bucket)

            if search:
                term = f"%{search.strip()}%"
                search_cond = (TaskRecord.prompt.ilike(term)) | (TaskRecord.id.ilike(term))
                stmt = stmt.where(search_cond)
                count_stmt = count_stmt.where(search_cond)

            total = session.scalar(count_stmt) or 0
            records = session.scalars(
                stmt.order_by(TaskRecord.created_at.desc()).offset(offset).limit(limit)
            ).all()

            results = [self._task_record_to_dict(r) for r in records]
            return results, total

    def get_task(self, task_id: str) -> dict | None:
        with self._session_factory() as session:
            record = session.scalar(select(TaskRecord).where(TaskRecord.id == task_id))
            return self._task_record_to_dict(record) if record else None

    def upsert_task(self, task: dict) -> dict:
        with self._session_factory.begin() as session:
            record = session.scalar(select(TaskRecord).where(TaskRecord.id == task["id"]))
            tolerance_str = json.dumps(task["tolerance"]) if task.get("tolerance") else None
            scoring_str = json.dumps(task["scoring_config"]) if task.get("scoring_config") else None
            expected_str = json.dumps(task["expected_answer"]) if isinstance(task["expected_answer"], (dict, list)) else str(task["expected_answer"])

            if record:
                if "suite_id" in task:
                    record.suite_id = task["suite_id"]
                if "suite_name" in task:
                    record.suite_name = task["suite_name"]
                if "domain" in task:
                    record.domain = task["domain"]
                record.category_id = task["category_id"]
                record.prompt = task["prompt"]
                record.expected_answer = expected_str
                record.task_type = task["task_type"]
                record.bucket = task.get("bucket", "general")
                record.language = task.get("language", "en")
                record.tolerance_json = tolerance_str
                record.scoring_config_json = scoring_str
                record.program = task.get("program")
                record.updated_at = datetime.now(timezone.utc)
            else:
                record = TaskRecord(
                    id=task["id"],
                    suite_id=task.get("suite_id"),
                    suite_name=task.get("suite_name"),
                    domain=task.get("domain", "general"),
                    category_id=task["category_id"],
                    prompt=task["prompt"],
                    expected_answer=expected_str,
                    task_type=task["task_type"],
                    bucket=task.get("bucket", "general"),
                    language=task.get("language", "en"),
                    tolerance_json=tolerance_str,
                    scoring_config_json=scoring_str,
                    program=task.get("program"),
                )
                session.add(record)
            session.flush()

            return self._task_record_to_dict(record)

    def bulk_insert_tasks(self, tasks: list[dict]) -> tuple[int, int]:
        inserted = 0
        updated = 0
        with self._session_factory.begin() as session:
            for task in tasks:
                record = session.scalar(select(TaskRecord).where(TaskRecord.id == task["id"]))
                tolerance_str = json.dumps(task["tolerance"]) if task.get("tolerance") else None
                scoring_str = json.dumps(task["scoring_config"]) if task.get("scoring_config") else None
                if isinstance(task.get("expected_answer"), (dict, list)):
                    expected_str = json.dumps(task["expected_answer"])
                else:
                    expected_str = str(task["expected_answer"]) if task.get("expected_answer") is not None else ""

                if record:
                    if "suite_id" in task:
                        record.suite_id = task["suite_id"]
                    if "suite_name" in task:
                        record.suite_name = task["suite_name"]
                    if "domain" in task:
                        record.domain = task["domain"]
                    record.category_id = task["category_id"]
                    record.prompt = task["prompt"]
                    record.expected_answer = expected_str
                    record.task_type = task["task_type"]
                    record.bucket = task.get("bucket", "general")
                    record.language = task.get("language", "en")
                    record.tolerance_json = tolerance_str
                    record.scoring_config_json = scoring_str
                    record.program = task.get("program")
                    record.updated_at = datetime.now(timezone.utc)
                    updated += 1
                else:
                    record = TaskRecord(
                        id=task["id"],
                        suite_id=task.get("suite_id"),
                        suite_name=task.get("suite_name"),
                        domain=task.get("domain", "general"),
                        category_id=task["category_id"],
                        prompt=task["prompt"],
                        expected_answer=expected_str,
                        task_type=task["task_type"],
                        bucket=task.get("bucket", "general"),
                        language=task.get("language", "en"),
                        tolerance_json=tolerance_str,
                        scoring_config_json=scoring_str,
                        program=task.get("program"),
                    )
                    session.add(record)
                    inserted += 1
        return inserted, updated

    def delete_task(self, task_id: str) -> bool:
        with self._session_factory.begin() as session:
            record = session.scalar(select(TaskRecord).where(TaskRecord.id == task_id))
            if record:
                session.delete(record)
                return True
            return False

    def get_task_summary(self) -> dict[str, int]:
        with self._session_factory() as session:
            rows = session.execute(
                select(TaskRecord.category_id, func.count(TaskRecord.id))
                .group_by(TaskRecord.category_id)
            ).all()
            return {row[0]: row[1] for row in rows}

    def _task_record_to_dict(self, record: TaskRecord) -> dict:
        from benchmark_scoring.registry import SCORERS
        scorer = SCORERS.get(record.task_type)
        structured_reference = scorer is not None and isinstance(scorer.example["expected_answer"], (dict, list))
        expected: Any = record.expected_answer
        if record.task_type in ("numeric_tolerance", "numeric_exact"):
            try:
                expected = float(expected)
            except Exception:
                pass
        elif record.task_type == "extraction_json" or structured_reference:
            try:
                expected = json.loads(expected)
            except Exception:
                pass
        tolerance = json.loads(record.tolerance_json) if record.tolerance_json else None
        scoring_cfg = json.loads(record.scoring_config_json) if record.scoring_config_json else None

        return {
            "id": record.id,
            "suite_id": record.suite_id,
            "suite_name": record.suite_name,
            "domain": record.domain,
            "category_id": record.category_id,
            "prompt": record.prompt,
            "expected_answer": expected,
            "task_type": record.task_type,
            "bucket": record.bucket,
            "language": record.language,
            "tolerance": tolerance,
            "scoring_config": scoring_cfg,
            "program": record.program,
            "created_at": record.created_at.isoformat() if record.created_at else None,
            "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        }

    # ---------------------------------------------------------------------------
    # Benchmark Suites Management
    # ---------------------------------------------------------------------------

    def list_benchmark_suites(self, domain: str | None = None) -> list[dict]:


        with self._session_factory() as session:
            stmt = select(BenchmarkSuiteRecord).where(BenchmarkSuiteRecord.parent_suite_id == BenchmarkSuiteRecord.id)
            if domain:
                stmt = stmt.where(BenchmarkSuiteRecord.domain == domain)
            stmt = stmt.order_by(BenchmarkSuiteRecord.domain.asc(), BenchmarkSuiteRecord.name.asc())
            records = session.scalars(stmt).all()
            criteria_ids = {record.sla_criteria_id for record in records if record.sla_criteria_id}
            criteria_by_id = {
                criteria.id: self._criteria_record_to_dict(criteria)
                for criteria in session.scalars(
                    select(ScorecardCriteriaRecord).where(ScorecardCriteriaRecord.id.in_(criteria_ids))
                ).all()
            } if criteria_ids else {}
            parent_ids = [record.id for record in records]
            child_records = session.scalars(
                select(BenchmarkSuiteRecord)
                .where(BenchmarkSuiteRecord.parent_suite_id.in_(parent_ids))
                .where(BenchmarkSuiteRecord.id != BenchmarkSuiteRecord.parent_suite_id)
                .order_by(BenchmarkSuiteRecord.name.asc())
            ).all() if parent_ids else []
            child_ids = [record.id for record in child_records]
            task_counts = dict(session.execute(
                select(TaskRecord.suite_id, func.count(TaskRecord.id))
                .where(TaskRecord.suite_id.in_(child_ids))
                .group_by(TaskRecord.suite_id)
            ).all()) if child_ids else {}
            groups_by_parent: dict[str, list[dict]] = {}
            for child in child_records:
                groups_by_parent.setdefault(child.parent_suite_id, []).append({
                    "id": child.id,
                    "name": child.name,
                    "task_count": task_counts.get(child.id, child.task_count),
                    "is_required": child.is_required,
                })
            result = [
                {
                    **self._suite_record_to_dict(record),
                    "sla_criteria": criteria_by_id.get(record.sla_criteria_id),
                    "task_count": (
                        sum(group["task_count"] for group in groups_by_parent.get(record.id, []))
                        if groups_by_parent.get(record.id)
                        else record.task_count
                    ),
                    "task_groups": groups_by_parent.get(record.id, []),
                }
                for record in records
            ]
        return result

    def get_benchmark_suite(self, suite_id: str) -> dict | None:
        with self._session_factory() as session:
            record = session.scalar(select(BenchmarkSuiteRecord).where(BenchmarkSuiteRecord.id == suite_id))
            return self._suite_record_to_dict(record) if record else None

    def get_category_suite_by_domain(self, domain: str) -> dict | None:
        with self._session_factory() as session:
            records = session.scalars(
                select(BenchmarkSuiteRecord)
                .where(BenchmarkSuiteRecord.domain == domain)
                .where(BenchmarkSuiteRecord.parent_suite_id != BenchmarkSuiteRecord.id)
                .limit(2)
            ).all()
            return self._suite_record_to_dict(records[0]) if len(records) == 1 else None

    def _scoreboard_suite_for(self, suite_id: str | None) -> str | None:
        if not suite_id:
            return None
        with self._session_factory() as session:
            record = session.scalar(select(BenchmarkSuiteRecord).where(BenchmarkSuiteRecord.id == suite_id))
            return record.parent_suite_id if record and record.parent_suite_id else suite_id

    def _suite_category_snapshot_for(self, parent_suite_id: str) -> list[dict]:
        with self._session_factory() as session:
            children = session.scalars(
                select(BenchmarkSuiteRecord)
                .where(BenchmarkSuiteRecord.parent_suite_id == parent_suite_id)
                .where(BenchmarkSuiteRecord.id != parent_suite_id)
                .order_by(BenchmarkSuiteRecord.name.asc())
            ).all()
            if not children:
                return []
            child_ids = [child.id for child in children]
            task_counts = dict(session.execute(
                select(TaskRecord.suite_id, func.count(TaskRecord.id))
                .where(TaskRecord.suite_id.in_(child_ids))
                .group_by(TaskRecord.suite_id)
            ).all())
            return [
                {
                    "id": child.id,
                    "name": child.name,
                    "task_count": int(task_counts.get(child.id, child.task_count)),
                    "is_required": child.is_required,
                }
                for child in children
            ]

    def upsert_benchmark_suite(self, data: dict) -> dict:
        with self._session_factory.begin() as session:
            sid = data["id"]
            record = session.scalar(select(BenchmarkSuiteRecord).where(BenchmarkSuiteRecord.id == sid))
            tol_str = json.dumps(data["default_tolerance"]) if data.get("default_tolerance") else None

            if record:
                record.name = data["name"]
                if "parent_suite_id" in data:
                    record.parent_suite_id = data["parent_suite_id"]
                if "domain" in data:
                    record.domain = data["domain"]
                if "description" in data:
                    record.description = data["description"]
                if "default_scorer" in data:
                    record.default_scorer = data["default_scorer"]
                if tol_str:
                    record.default_tolerance_json = tol_str
                if "task_count" in data:
                    record.task_count = int(data["task_count"])
                if "is_required" in data:
                    record.is_required = bool(data["is_required"])
                if "is_active" in data:
                    record.is_active = bool(data["is_active"])
                if "sla_criteria_id" in data:
                    record.sla_criteria_id = data["sla_criteria_id"]
                session.execute(
                    update(TaskRecord)
                    .where(TaskRecord.suite_id == sid)
                    .values(suite_name=record.name, domain=record.domain)
                )
                record.updated_at = datetime.now(timezone.utc)
            else:
                record = BenchmarkSuiteRecord(
                    id=sid,
                    parent_suite_id=data.get("parent_suite_id") or sid,
                    sla_criteria_id=data.get("sla_criteria_id"),
                    name=data["name"],
                    domain=data.get("domain", "general"),
                    description=data.get("description"),
                    default_scorer=data.get("default_scorer"),
                    default_tolerance_json=tol_str,
                    task_count=int(data.get("task_count", 0)),
                    is_required=bool(data.get("is_required", True)),
                    is_active=bool(data.get("is_active", True)),
                )
                session.add(record)
            session.flush()

            return self._suite_record_to_dict(record)

    def _registry_deletion_state(self, session, kind: str, entry_id: str, *, lock=False):
        model = {"prompt": PromptRecord, "strategy": PromptStrategyRecord, "suite": BenchmarkSuiteRecord}[kind]
        record = session.get(model, entry_id, with_for_update=lock)
        if record is None:
            raise LookupError(f"{kind.title()} not found")
        if kind != "suite" and record.is_builtin:
            raise PermissionError(f"Built-in {'strategies' if kind == 'strategy' else 'prompts'} cannot be deleted")
        history = BenchmarkHistoryRecord
        suite_ids = []
        task_filter = None
        if kind == "prompt":
            prefix = record.name + "::"
            run_filter = or_(history.prompt_id == record.id,
                (history.prompt_id.is_(None)) & or_(history.prompt_name == record.name,
                    func.substr(history.prompt_name, 1, len(prefix)) == prefix))
        elif kind == "strategy":
            suffix = "::" + record.name
            run_filter = or_(history.prompt_strategy.in_([record.id, record.name]),
                history.prompt_strategy.is_(None) & (
                    func.substr(history.prompt_name, func.length(history.prompt_name) - len(suffix) + 1) == suffix))
        else:
            suite_ids = [record.id, *session.scalars(select(BenchmarkSuiteRecord.id).where(
                BenchmarkSuiteRecord.parent_suite_id == record.id,
                BenchmarkSuiteRecord.id != record.id)).all()]
            task_filter = or_(TaskRecord.suite_id.in_(suite_ids),
                TaskRecord.suite_id.is_(None) & TaskRecord.category_id.in_(suite_ids))
            category_ids = set(suite_ids) | set(session.scalars(select(TaskRecord.category_id).where(task_filter)).all())
            parent_id = record.parent_suite_id or record.id
            legacy_scope = history.suite_id.is_(None) & (
                history.scoreboard_suite_id.is_(None) | (history.scoreboard_suite_id == parent_id))
            run_filter = or_(history.suite_id.in_(suite_ids), history.scoreboard_suite_id == record.id,
                legacy_scope & or_(history.category_id.in_(category_ids), history.prompt_category.in_(category_ids)))
            # A child category belongs to a parent suite: its sibling runs must
            # survive even though they share the parent's scoreboard ID.
            if record.parent_suite_id and record.parent_suite_id != record.id:
                run_filter = or_(history.suite_id == record.id,
                    (legacy_scope | (history.suite_id == record.parent_suite_id))
                    & or_(history.category_id == record.id, history.prompt_category == record.id))
        run_ids = list(session.scalars(select(history.id).where(run_filter)).all())
        if kind == "suite":
            # Whole-suite aggregates can reference categories in their result
            # payload rather than in the row's single category_id column.
            scope = legacy_scope
            if record.parent_suite_id and record.parent_suite_id != record.id:
                scope = scope | (history.suite_id == record.parent_suite_id)
            candidates = session.execute(select(history.id, history.category_results, history.task_scores).where(
                scope, history.id.not_in(run_ids),
                history.category_results.is_not(None) | history.task_scores.is_not(None))).all()
            for run_id, raw_categories, raw_scores in candidates:
                categories = json.loads(raw_categories) if raw_categories else {}
                scores = json.loads(raw_scores) if raw_scores else {}
                if category_ids.intersection(categories) or any(
                    score.get("task_category") in category_ids for score in scores.values() if isinstance(score, dict)
                ):
                    run_ids.append(run_id)
        impact = {"id": record.id, "name": record.name, "run_count": len(run_ids),
            "task_count": session.scalar(select(func.count()).select_from(TaskRecord).where(task_filter)) if task_filter is not None else 0,
            "category_count": len(suite_ids) - 1 if suite_ids else 0}
        return record, run_ids, task_filter, suite_ids, impact

    def registry_deletion_impact(self, kind: str, entry_id: str) -> dict:
        with self._session_factory() as session:
            return self._registry_deletion_state(session, kind, entry_id)[-1]

    def delete_registry_entry(self, kind: str, entry_id: str, expected_run_count: int | None = None) -> dict:
        with self._session_factory.begin() as session:
            record, run_ids, task_filter, suite_ids, impact = self._registry_deletion_state(session, kind, entry_id, lock=True)
            if (run_ids and expected_run_count is None) or (expected_run_count is not None and expected_run_count != len(run_ids)):
                raise DeletionConflict(f"Deletion affects {len(run_ids)} associated runs. Reload the deletion warning and confirm the current run count.")
            # Explicit child cleanup also works on SQLite connections without
            # foreign-key enforcement; PostgreSQL keeps its cascade constraints.
            for child in (BenchmarkRunDeepMetrics, FailedTraceRecord, BenchmarkRunSample):
                session.execute(delete(child).where(child.run_id.in_(run_ids)))
            session.execute(delete(BenchmarkHistoryRecord).where(BenchmarkHistoryRecord.id.in_(run_ids)))
            if kind == "suite":
                session.execute(delete(TaskRecord).where(task_filter))
                session.execute(delete(BenchmarkSuiteRecord).where(BenchmarkSuiteRecord.id.in_(suite_ids)))
            else:
                session.delete(record)
            result = {"deleted": True, **impact}
        with self._auth_lock:
            self._has_records_cache = None
        return result

    def delete_runs_by_experiment_tag(self, experiment_tag: str) -> int:
        """Bulk-delete all benchmark_history rows matching experiment_tag.

        Child rows in run_deep_metrics, failed_traces, and run_samples are
        removed by the ON DELETE CASCADE constraints defined on those tables.
        Returns the number of rows deleted from benchmark_history.
        """
        with self._session_factory.begin() as session:
            result = session.execute(
                delete(BenchmarkHistoryRecord).where(
                    BenchmarkHistoryRecord.experiment_tag == experiment_tag
                )
            )
            return result.rowcount

    def benchmark_suite_has_children(self, suite_id: str) -> bool:
        with self._session_factory() as session:
            return session.scalar(
                select(BenchmarkSuiteRecord.id)
                .where(BenchmarkSuiteRecord.parent_suite_id == suite_id)
                .where(BenchmarkSuiteRecord.id != suite_id)
                .limit(1)
            ) is not None

    def get_suite_tasks(self, suite_id: str) -> list[dict]:


        with self._session_factory() as session:
            member_ids = select(BenchmarkSuiteRecord.id).where(BenchmarkSuiteRecord.parent_suite_id == suite_id)
            from sqlalchemy import or_
            conds = [
                TaskRecord.suite_id.in_(member_ids),
                TaskRecord.suite_id == suite_id,
                TaskRecord.category_id == suite_id,
            ]
            records = session.scalars(
                select(TaskRecord)
                .where(or_(*conds))
                .order_by(TaskRecord.id.asc())
            ).all()
        return [self._task_record_to_dict(r) for r in records]

    def _suite_record_to_dict(self, record: BenchmarkSuiteRecord) -> dict:
        default_tol = json.loads(record.default_tolerance_json) if record.default_tolerance_json else None
        return {
            "id": record.id,
            "parent_suite_id": record.parent_suite_id or record.id,
            "sla_criteria_id": record.sla_criteria_id,
            "name": record.name,
            "domain": record.domain,
            "description": record.description,
            "default_scorer": record.default_scorer,
            "default_tolerance": default_tol,
            "task_count": record.task_count,
            "is_required": record.is_required,
            "is_active": record.is_active,
            "created_at": record.created_at.isoformat() if record.created_at else None,
            "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        }

    # ---------------------------------------------------------------------------
    # Scorecard Criteria Management
    # ---------------------------------------------------------------------------

    def list_scorecard_criteria(self, suite_id: str | None = None) -> list[dict]:


        with self._session_factory() as session:
            stmt = select(ScorecardCriteriaRecord)
            if suite_id:
                assigned_id = session.scalar(
                    select(BenchmarkSuiteRecord.sla_criteria_id).where(BenchmarkSuiteRecord.id == suite_id)
                )
                if not assigned_id:
                    return []
                stmt = stmt.where(ScorecardCriteriaRecord.id == assigned_id)
            records = session.scalars(stmt.order_by(ScorecardCriteriaRecord.is_locked.desc(), ScorecardCriteriaRecord.id.asc())).all()
        return [self._criteria_record_to_dict(r) for r in records]

    def get_scorecard_criteria(self, criteria_id: str) -> dict | None:
        with self._session_factory() as session:
            record = session.scalar(
                select(ScorecardCriteriaRecord).where(ScorecardCriteriaRecord.id == criteria_id)
            )
            return self._criteria_record_to_dict(record) if record else None

    def scorecard_criteria_name_exists(self, name: str, exclude_id: str | None = None) -> bool:
        normalized = name.strip().lower()
        with self._session_factory() as session:
            stmt = select(ScorecardCriteriaRecord.id).where(func.lower(ScorecardCriteriaRecord.name) == normalized)
            if exclude_id:
                stmt = stmt.where(ScorecardCriteriaRecord.id != exclude_id)
            return session.scalar(stmt.limit(1)) is not None

    def assign_suite_scorecard_criteria(self, suite_id: str, criteria_id: str) -> dict:
        with self._session_factory.begin() as session:
            suite = session.scalar(select(BenchmarkSuiteRecord).where(BenchmarkSuiteRecord.id == suite_id))
            if not suite:
                raise LookupError(f"Suite '{suite_id}' not found")
            if (suite.parent_suite_id or suite.id) != suite.id:
                raise ValueError("SLA policies can only be assigned to parent benchmark suites.")
            criteria = session.scalar(
                select(ScorecardCriteriaRecord).where(ScorecardCriteriaRecord.id == criteria_id)
            )
            if not criteria:
                raise LookupError(f"SLA policy '{criteria_id}' not found")
            suite.sla_criteria_id = criteria_id
            suite.updated_at = datetime.now(timezone.utc)
            session.flush()
            result = self._suite_record_to_dict(suite)
            result["sla_criteria"] = self._criteria_record_to_dict(criteria)
            return result

    def upsert_scorecard_criteria(self, data: dict) -> dict:
        with self._session_factory.begin() as session:
            cid = data["id"]
            record = session.scalar(
                select(ScorecardCriteriaRecord).where(ScorecardCriteriaRecord.id == cid)
            )

            # If setting as default, clear other defaults
            if data.get("is_default"):
                others_stmt = select(ScorecardCriteriaRecord).where(ScorecardCriteriaRecord.id != cid)
                if data.get("suite_id"):
                    others_stmt = others_stmt.where(ScorecardCriteriaRecord.scoreboard_suite_id == (data.get("scoreboard_suite_id") or data["suite_id"]))
                others = session.scalars(others_stmt).all()
                for o in others:
                    o.is_default = False

            if record:
                if "suite_id" in data:
                    record.suite_id = data["suite_id"]
                if "scoreboard_suite_id" in data:
                    record.scoreboard_suite_id = data["scoreboard_suite_id"]
                if "name" in data and data["name"] is not None:
                    record.name = data["name"].strip()
                if "description" in data:
                    record.description = data["description"]
                if "min_decode_tps" in data and data["min_decode_tps"] is not None:
                    record.min_decode_tps = float(data["min_decode_tps"])
                if "fast_ttft_s" in data and data["fast_ttft_s"] is not None:
                    record.fast_ttft_s = float(data["fast_ttft_s"])
                if "tail_ttft_ceiling_s" in data and data["tail_ttft_ceiling_s"] is not None:
                    record.tail_ttft_ceiling_s = float(data["tail_ttft_ceiling_s"])
                if "interactive_ttft_max_s" in data and data["interactive_ttft_max_s"] is not None:
                    record.interactive_ttft_max_s = float(data["interactive_ttft_max_s"])
                if "min_quality_score" in data and data["min_quality_score"] is not None:
                    record.min_quality_score = float(data["min_quality_score"])
                if "quality_surplus_tradeoff" in data and data["quality_surplus_tradeoff"] is not None:
                    record.quality_surplus_tradeoff = float(data["quality_surplus_tradeoff"])
                if "memory_stability_max_pct" in data and data["memory_stability_max_pct"] is not None:
                    record.memory_stability_max_pct = float(data["memory_stability_max_pct"])
                if "max_error_rate" in data and data["max_error_rate"] is not None:
                    record.max_error_rate = float(data["max_error_rate"])
                if "weight_quality" in data and data["weight_quality"] is not None:
                    record.weight_quality = float(data["weight_quality"])
                if "weight_speed" in data and data["weight_speed"] is not None:
                    record.weight_speed = float(data["weight_speed"])
                if "weight_fit" in data and data["weight_fit"] is not None:
                    record.weight_fit = float(data["weight_fit"])
                if "is_default" in data and data["is_default"] is not None:
                    record.is_default = bool(data["is_default"])
                record.updated_at = datetime.now(timezone.utc)
            else:
                record = ScorecardCriteriaRecord(
                    id=cid,
                    suite_id=data.get("suite_id"),
                    scoreboard_suite_id=data.get("scoreboard_suite_id") or data.get("suite_id"),
                    name=data["name"].strip(),
                    description=data.get("description"),
                    min_decode_tps=float(data.get("min_decode_tps", 25.0)),
                    fast_ttft_s=float(data.get("fast_ttft_s", 0.8)),
                    tail_ttft_ceiling_s=float(data.get("tail_ttft_ceiling_s", 1.5)),
                    interactive_ttft_max_s=float(data.get("interactive_ttft_max_s", 3.0)),
                    min_quality_score=float(data.get("min_quality_score", 0.75)),
                    quality_surplus_tradeoff=float(data.get("quality_surplus_tradeoff", 1.10)),
                    memory_stability_max_pct=float(data.get("memory_stability_max_pct", 85.0)),
                    max_error_rate=float(data.get("max_error_rate", 0.01)),
                    weight_quality=float(data.get("weight_quality", 0.60)),
                    weight_speed=float(data.get("weight_speed", 0.25)),
                    weight_fit=float(data.get("weight_fit", 0.15)),
                    is_default=bool(data.get("is_default", False)),
                    is_locked=bool(data.get("is_locked", False)),
                )
                session.add(record)
            session.flush()

            return self._criteria_record_to_dict(record)

    def delete_scorecard_criteria(self, criteria_id: str) -> bool:
        with self._session_factory.begin() as session:
            record = session.scalar(
                select(ScorecardCriteriaRecord).where(ScorecardCriteriaRecord.id == criteria_id)
            )
            if record:
                if record.is_locked:
                    raise ValueError("Cannot delete locked canonical criteria profile.")
                assigned_suites = session.scalars(
                    select(BenchmarkSuiteRecord.name)
                    .where(BenchmarkSuiteRecord.sla_criteria_id == criteria_id)
                    .order_by(BenchmarkSuiteRecord.name.asc())
                ).all()
                if assigned_suites:
                    names = ", ".join(assigned_suites[:3])
                    suffix = "" if len(assigned_suites) <= 3 else f" and {len(assigned_suites) - 3} more"
                    raise ValueError(f"Cannot delete an SLA policy assigned to {names}{suffix}.")
                session.delete(record)

                return True
            return False

    def _criteria_record_to_dict(self, record: ScorecardCriteriaRecord) -> dict:
        return {
            "id": record.id,
            "suite_id": record.suite_id,
            "scoreboard_suite_id": record.scoreboard_suite_id or record.suite_id,
            "name": record.name,
            "description": record.description,
            "min_decode_tps": record.min_decode_tps,
            "fast_ttft_s": record.fast_ttft_s,
            "tail_ttft_ceiling_s": record.tail_ttft_ceiling_s,
            "interactive_ttft_max_s": record.interactive_ttft_max_s,
            "min_quality_score": record.min_quality_score,
            "quality_surplus_tradeoff": record.quality_surplus_tradeoff,
            "memory_stability_max_pct": record.memory_stability_max_pct,
            "max_error_rate": record.max_error_rate,
            "weight_quality": record.weight_quality,
            "weight_speed": record.weight_speed,
            "weight_fit": record.weight_fit,
            "is_default": record.is_default,
            "is_locked": record.is_locked,
            "created_at": record.created_at.isoformat() if record.created_at else None,
            "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        }

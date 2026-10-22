from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(_PROJECT_ROOT / ".env", override=False)


class ConfigurationError(RuntimeError):
    """Raised at startup when a required environment variable is missing."""


def _require(name: str) -> str:
    """Return the value of a required env var or raise ConfigurationError."""
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigurationError(
            f"Required environment variable '{name}' is not set. "
            f"Add it to your .env file. See .env.example for reference."
        )
    return value


def _optional(name: str, default: str) -> str:
    """Return an env var value or a safe default. Used for infrastructure URLs
    and paths that have a correct local-dev value but are overridden in Docker."""
    val = os.environ.get(name, "").strip() or default
    
    # If we are running inside Docker, rewrite localhost/127.0.0.1 to host.docker.internal
    # so that the container can reach services running natively on the host (like Mac Metal vLLM).
    if os.path.exists("/.dockerenv"):
        val = val.replace("127.0.0.1", "host.docker.internal")
        val = val.replace("localhost", "host.docker.internal")
        os.environ[name] = val
        
    return val


@dataclass(frozen=True)
class Settings:
    project_root: Path
    results_dir: Path
    tasks_path: Path
    database_url: str           # required — no default
    git_revision: str | None    # optional — CI injects this
    experiment_tag: str | None  # optional — human phase label
    allowed_origins: str = ""

    @property
    def cors_origins(self) -> list[str]:
        if not self.allowed_origins:
            return ["http://localhost:3000"]
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


def get_settings() -> Settings:
    db_url = _require("DATABASE_URL")
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

    return Settings(
        project_root=_PROJECT_ROOT,
        # Paths: default to project-relative dirs for local dev;
        # docker compose overrides these to /app/data/... inside the container.
        results_dir=Path(_optional("RESULTS_DIR", str(_PROJECT_ROOT / "data" / "results"))),
        tasks_path=Path(_optional("TASKS_PATH", str(_PROJECT_ROOT / "data" / "task_suite.json"))),

        # DATABASE_URL is the only strictly required variable — it's a secret
        # and there is no safe default value.
        database_url=db_url,
        git_revision=os.environ.get("GIT_REVISION") or None,
        experiment_tag=os.environ.get("EXPERIMENT_TAG") or None,
        # Browser origins allowed through CORS. Raw env read (NOT _optional):
        # ALLOWED_ORIGINS are external browser origins and must never be
        # rewritten to host.docker.internal. Empty → localhost:3000 default.
        allowed_origins=os.environ.get("ALLOWED_ORIGINS", ""),
    )

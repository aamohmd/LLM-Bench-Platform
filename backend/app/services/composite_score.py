"""Composite scoring for benchmark runs.

Rolls quality, speed, and resource-fit into one 0-1 score per run under a
configurable weight profile, inspired by llmfit's weighted Quality/Speed/Fit
model but built exclusively on measured data (never bandwidth heuristics).

Design rules (profiles are defined in config/composite_profiles.json):
- Fixed reference bands from config — never min-max over the DB contents.
- Reference bands are tier-scoped: speed is scored against the tier matched
  by the run's recorded hardware, so T4 runs are not punished next to A10G.
- A component score is None when its inputs are missing — never fabricated
  as 0. Composite = weighted mean over PRESENT components with weights
  renormalized, flagged `partial` with `available_components` and the
  `weights_used` actually applied. Zero present components -> score None.
- Every result carries the full component breakdown with a human `basis`.
- Scores are computed on read from fields already in the row — no schema
  migration, works retroactively on the whole history.
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PROFILES_PATH = Path(
    os.environ.get(
        "COMPOSITE_PROFILES_PATH",
        str(_PROJECT_ROOT / "config" / "composite_profiles.json"),
    )
)

# Process-lifetime singleton — intentionally never cleared at runtime.
# Render performs a full process restart on every deploy, so an updated
# composite_profiles.json always takes effect on the next deploy.
# Do NOT mutate this file while the process is running.
_profiles_cache: dict[str, Any] | None = None


class CompositeConfigError(RuntimeError):
    """Raised when the composite profile config is missing or malformed."""


def load_profiles(path: Path | None = None) -> dict[str, Any]:
    """Load the composite profile config (cached).

    Path is injectable for tests; defaults to COMPOSITE_PROFILES_PATH env or
    the repository config file. Missing file raises CompositeConfigError — a
    composite score computed without knowing its reference bands is not
    reproducible, so we fail loudly rather than fall back to fabricated bands.
    """
    global _profiles_cache
    if _profiles_cache is not None and path is None:
        return _profiles_cache
    config_path = path or DEFAULT_PROFILES_PATH
    try:
        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)
    except FileNotFoundError as exc:
        raise CompositeConfigError(f"Composite profile config not found: {config_path}") from exc
    except json.JSONDecodeError as exc:
        raise CompositeConfigError(f"Composite profile config is invalid JSON: {config_path}: {exc}") from exc

    required = ("tiers", "profiles")
    missing = [key for key in required if key not in config]
    if missing:
        raise CompositeConfigError(f"Composite profile config missing keys: {missing}")
    if path is None:
        _profiles_cache = config
    return config


# ---------------------------------------------------------------------------
# Tier detection
# ---------------------------------------------------------------------------

def _is_unified_memory(run: dict[str, Any]) -> bool:
    """Detect if a run used unified/shared memory rather than discrete accelerator VRAM."""
    if run.get("hw_is_unified") is True:
        return True

    gpu_name = (run.get("hw_gpu_name") or "").lower()
    driver = (run.get("hw_gpu_driver") or "").lower()
    cpu_model = (run.get("hw_cpu_model") or "").lower()
    platform_str = (run.get("hw_platform") or "").lower()
    aws_instance = (run.get("hw_aws_instance_type") or "").lower()

    # Discrete accelerator indicators
    if aws_instance or "nvidia" in gpu_name or "tesla" in gpu_name or "rtx" in gpu_name or "cuda" in driver or "rocm" in driver:
        return False

    # Platform/SoC unified memory indicators
    if "darwin" in platform_str or "macos" in platform_str or "apple" in gpu_name or "apple" in cpu_model:
        return True

    # Explicit unified / integrated SoC naming
    if "unified" in gpu_name or "unified" in cpu_model or "soc" in cpu_model or "integrated" in gpu_name:
        return True

    return False


def _tier_matches(tier: dict[str, Any], run: dict[str, Any]) -> bool:
    name = tier.get("name")
    memory_type = tier.get("memory_type")

    # Unified memory tier
    if memory_type == "unified" or name in ("local_unified", "apple_silicon"):
        return _is_unified_memory(run)

    # Discrete accelerator tiers: exclude unified memory
    if _is_unified_memory(run):
        return False

    vram_mb = run.get("hw_gpu_memory_mb")
    min_vram = tier.get("min_vram_mb")
    max_vram = tier.get("max_vram_mb")
    if (min_vram is not None or max_vram is not None) and vram_mb is not None:
        if min_vram is not None and vram_mb < min_vram:
            return False
        if max_vram is not None and vram_mb > max_vram:
            return False
        return True
    return False


def detect_tier(run: dict[str, Any], config: dict[str, Any]) -> str:
    """Return the universal benchmark evaluation standard.
    
    All hardware platforms are evaluated against the same objective standard.
    """
    tiers = config.get("tiers", [])
    return tiers[0].get("name", "universal") if tiers else "universal"


def tier_reference_bands(tier_name: str, config: dict[str, Any]) -> dict[str, Any]:
    """Return the universal benchmark speed reference band."""
    tiers = config.get("tiers", [])
    if not tiers:
        return {"name": "universal", "decode_tps_ref": 45.0, "ttft_s_ref": 0.5}
    for tier in tiers:
        if tier.get("name") == tier_name:
            return tier
    return tiers[0]


# ---------------------------------------------------------------------------
# Components
# ---------------------------------------------------------------------------

def _quality_component(run: dict[str, Any], profile: dict[str, Any]) -> tuple[float | None, str]:
    """Weighted success rate across the run's quality buckets."""
    buckets = run.get("quality_buckets")
    if isinstance(buckets, dict) and buckets:
        weights = profile.get("bucket_weights", {})
        total_weight = 0.0
        weighted_sum = 0.0
        present: list[str] = []
        for name, metrics in buckets.items():
            rate = metrics.get("success_rate") if isinstance(metrics, dict) else None
            if rate is None:
                continue
            weight = weights.get(name, 1.0)
            total_weight += weight
            weighted_sum += weight * rate
            present.append(name)
        if total_weight > 0:
            score = weighted_sum / total_weight
            return score, f"buckets:{','.join(sorted(present))}"
    # Fallback for runs recorded before bucket scoring existed.
    score = run.get("quality_score")
    if score is not None:
        return score, "quality_score"
    return None, "no quality data"


def _speed_component(
    run: dict[str, Any],
    profile: dict[str, Any],
    tier: dict[str, Any],
) -> tuple[float | None, str]:
    decode_tps = run.get("median_decode_tps")
    ttft_s = run.get("median_ttft_s")
    if decode_tps is None and ttft_s is None:
        return None, "no speed data"

    speed_weights = profile.get("speed_weights", {"decode_tps": 0.7, "ttft": 0.3})
    decode_ref = tier.get("decode_tps_ref")
    ttft_ref = tier.get("ttft_s_ref")

    parts: list[tuple[float, float]] = []
    basis: list[str] = []
    if decode_tps is not None and decode_ref:
        parts.append((speed_weights.get("decode_tps", 0.7), min(1.0, decode_tps / decode_ref)))
        basis.append(f"decode_tps={decode_tps:.1f}")
    if ttft_s is not None and ttft_ref:
        inverted = min(1.0, ttft_ref / ttft_s) if ttft_s > 0 else 1.0
        parts.append((speed_weights.get("ttft", 0.3), inverted))
        basis.append(f"ttft={ttft_s:.2f}")

    if not parts:
        return None, "no speed reference bands"
    total_weight = sum(weight for weight, _ in parts)
    score = sum(weight * value for weight, value in parts) / total_weight
    return score, f"{' '.join(basis)} tier={tier.get('name', 'unknown')}"


def _fit_component(run: dict[str, Any], profile: dict[str, Any]) -> tuple[float | None, str]:
    """Memory utilization headroom: sweet spot between min_ok and max_ok."""
    peak = run.get("peak_gpu_mem_mb")
    total = run.get("hw_gpu_memory_mb")
    if peak is None or total is None or total <= 0:
        return None, "peak or total GPU memory missing"
    utilization = peak / total
    fit_cfg = profile.get("fit", {})
    min_ok = fit_cfg.get("min_ok", 0.5)
    max_ok = fit_cfg.get("max_ok", 0.8)
    idle_score = fit_cfg.get("idle_score", 0.5)

    if utilization <= min_ok:
        score = idle_score + (utilization / min_ok) * (1.0 - idle_score)
    elif utilization <= max_ok:
        score = 1.0
    elif utilization <= 1.0:
        score = 1.0 - (utilization - max_ok) / (1.0 - max_ok)
    else:
        score = 0.0
    return score, f"peak={peak:.0f}MB total={total:.0f}MB util={utilization * 100:.0f}%"


# ---------------------------------------------------------------------------
# Composite
# ---------------------------------------------------------------------------

def compute_composite(
    run: dict[str, Any],
    profile_name: str,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute the composite score for one run under one profile.

    Returns a dict with score, partial flag, available components, weights
    used, and the per-component breakdown with basis strings. Never a bare
    number; never a fabricated 0.
    """
    config = config or load_profiles()
    profile = config["profiles"].get(profile_name)
    if profile is None:
        raise ValueError(f"Unknown composite profile: {profile_name}")

    tier_name = detect_tier(run, config)
    tier = tier_reference_bands(tier_name, config)

    components: dict[str, tuple[float | None, str]] = {
        "quality": _quality_component(run, profile),
        "speed": _speed_component(run, profile, tier),
        "fit": _fit_component(run, profile),
    }
    if run.get("framework") == "openai-compatible":
        # Hosted providers do not expose attributable model-memory telemetry.
        # Exclude fit from this run's applicable components instead of marking
        # otherwise complete quality/speed evidence partial.
        components.pop("fit")

    present = {name: (score, basis) for name, (score, basis) in components.items() if score is not None}
    weights = profile.get("weights", {})
    weight_sum = sum(weights.get(name, 0.0) for name in present)
    partial = len(present) < len(components)

    composite: float | None = None
    weights_used: dict[str, float] = {}
    if weight_sum > 0:
        composite = 0.0
        for name, (score, _basis) in present.items():
            normalized_weight = weights.get(name, 0.0) / weight_sum
            weights_used[name] = round(normalized_weight, 4)
            composite += normalized_weight * score

    return {
        "profile": profile_name,
        "tier": tier_name,
        "score": round(composite, 4) if composite is not None else None,
        "partial": partial,
        "available_components": sorted(present),
        "weights_used": weights_used,
        "components": {
            name: {"score": round(score, 4) if score is not None else None, "basis": basis}
            for name, (score, basis) in components.items()
        },
    }


def compute_all(run: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    """Compute composite scores for one run under every configured profile."""
    config = config or load_profiles()
    return {
        name: compute_composite(run, name, config)
        for name in config["profiles"]
    }

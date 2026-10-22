"""Domain-neutral qualification of benchmark approval runs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable


@dataclass(frozen=True)
class ApprovalEvaluation:
    verdict: str
    reasons: tuple[str, ...] = ()
    category_scores: dict[str, float | None] = field(default_factory=dict)
    category_evidence: dict[str, dict[str, dict]] = field(default_factory=dict)
    required_result_count: int = 0
    evaluated_result_count: int = 0


def _category_id(result: dict) -> str:
    return str(result.get("category_id") or result.get("prompt_category") or "unknown")


def _required_categories(results: list[dict]) -> set[str]:
    configured: set[str] = set()
    for result in results:
        snapshot = result.get("suite_category_snapshot")
        if not isinstance(snapshot, list):
            continue
        for item in snapshot:
            if isinstance(item, dict) and item.get("is_required", True):
                category_id = item.get("id") or item.get("category_id")
                if category_id:
                    configured.add(str(category_id))
    return configured or {_category_id(result) for result in results}


def _error_rate(result: dict) -> float | None:
    if result.get("error_rate") is not None:
        return float(result["error_rate"])
    total = result.get("quality_total_count")
    failed = result.get("error_count")
    if total:
        return float(failed or 0) / float(total)
    return None


def evaluate_approval_run(
    results: Iterable[dict],
    *,
    approval_run_id: str,
) -> ApprovalEvaluation:
    """Evaluate only required rows belonging to one approval execution.

    Categories come from the run's registry snapshot; no domain catalog is
    embedded in the control plane. Quality below 75% rejects, scores within
    five points of that boundary are near-misses, and absent evidence remains
    explicitly unqualified.
    """
    scoped = [
        result
        for result in results
        if result.get("approval_run_id") == approval_run_id
        and result.get("run_type") == "approval"
        and result.get("concurrency_scope") == "required"
    ]
    categories = _required_categories(scoped)
    levels = {int(result.get("concurrency", 0)) for result in scoped}
    expected = {(category, level) for category in categories for level in levels}
    keyed: dict[tuple[str, int], dict] = {}
    duplicates: set[tuple[str, int]] = set()
    for result in scoped:
        key = (_category_id(result), int(result.get("concurrency", 0)))
        if key in keyed:
            duplicates.add(key)
        keyed[key] = result

    reasons: list[str] = []
    missing = sorted(expected - set(keyed))
    if missing:
        reasons.append("missing required results: " + ", ".join(f"{cat}@C{level}" for cat, level in missing))
    if duplicates:
        reasons.append("duplicate required results: " + ", ".join(f"{cat}@C{level}" for cat, level in sorted(duplicates)))

    category_scores: dict[str, float | None] = {}
    category_evidence: dict[str, dict[str, dict]] = {}
    rejected: list[str] = []
    near_misses: list[str] = []
    for (category, level), result in keyed.items():
        score = result.get("quality_score")
        score = float(score) if score is not None else None
        evidence_reasons: list[str] = []
        status = "Qualified"
        if score is None:
            status = "Needs Evidence"
            evidence_reasons.append("quality score is missing")
        elif score < 0.70:
            status = "Rejected"
            evidence_reasons.append(f"quality {score:.1%} is below 70%")
            rejected.append(f"{category}@C{level}: {evidence_reasons[-1]}")
        elif score < 0.75:
            status = "Near-Miss"
            evidence_reasons.append(f"quality {score:.1%} is below the 75% target")
            near_misses.append(f"{category}@C{level}: {evidence_reasons[-1]}")

        catastrophic = int(result.get("catastrophic_failure_count") or 0)
        error_rate = _error_rate(result)
        if catastrophic:
            status = "Rejected"
            rejected.append(f"{category}@C{level}: {catastrophic} catastrophic failure(s)")
        if result.get("slo_breach"):
            status = "Rejected"
            rejected.append(f"{category}@C{level}: {result.get('breach_reason') or 'operational SLA breach'}")
        if error_rate is not None and error_rate > 0.01:
            status = "Rejected"
            rejected.append(f"{category}@C{level}: error rate {error_rate:.2%} exceeds 1%")

        category_evidence.setdefault(category, {})[f"C{level}"] = {
            "status": status,
            "category_score": score,
            "reasons": evidence_reasons,
        }
        prior = category_scores.get(category)
        category_scores[category] = score if prior is None else min(prior, score) if score is not None else prior

    required_count = len(expected)
    if rejected:
        verdict = "Rejected"
        reasons = rejected + reasons
    elif reasons or any(score is None for score in category_scores.values()) or not scoped:
        verdict = "Needs Evidence"
        if not scoped:
            reasons.append("no required approval results were submitted")
    elif near_misses:
        verdict = "Near-Miss"
        reasons = near_misses
    else:
        verdict = "Qualified"

    return ApprovalEvaluation(
        verdict,
        tuple(reasons),
        category_scores,
        category_evidence,
        required_count,
        len(scoped),
    )

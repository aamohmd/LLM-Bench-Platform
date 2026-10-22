from __future__ import annotations

import csv
import json
from pathlib import Path

from backend.app.schemas import BenchmarkRun


class RepositoryDataError(Exception):
    """Raised when benchmark data cannot be parsed safely."""


class BenchmarkRepository:
    def __init__(self, results_dir: Path, tasks_path: Path):
        self.results_dir = results_dir
        self.tasks_path = tasks_path

    def list_runs(
        self,
        experiment_tag: str | None = None,
        model: str | None = None,
        framework: str | None = None,
        concurrency: int | None = None,
        hardware_type: str | None = None,
        suite_id: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[BenchmarkRun]:
        summary_path = self.results_dir / "summary.csv"
        if not summary_path.exists():
            return []

        try:
            with summary_path.open(newline="") as handle:
                rows = list(csv.DictReader(handle))
        except (OSError, csv.Error) as exc:
            raise RepositoryDataError("Benchmark results are unreadable") from exc

        runs: list[BenchmarkRun] = []
        for row in rows:
            if not row.get("model") or row.get("num_runs") in {None, "", "0"}:
                continue
            try:
                runs.append(BenchmarkRun.model_validate(self._normalise_row(row)))
            except (TypeError, ValueError) as exc:
                raise RepositoryDataError("Benchmark results contain an invalid row") from exc
        
        filtered = sorted(runs, key=lambda run: run.timestamp or "", reverse=True)
        if experiment_tag:
            filtered = [r for r in filtered if r.experiment_tag == experiment_tag]
        if model:
            filtered = [r for r in filtered if r.model == model]
        if framework:
            filtered = [r for r in filtered if r.framework == framework]
        if concurrency is not None:
            filtered = [r for r in filtered if r.concurrency == concurrency]
        if hardware_type:
            ht = hardware_type.lower()
            filtered = [
                r for r in filtered
                if (r.hw_platform and ht in r.hw_platform.lower())
                or (r.hw_gpu_name and ht in r.hw_gpu_name.lower())
                or (r.hw_aws_instance_type and ht in r.hw_aws_instance_type.lower())
            ]
        if suite_id:
            filtered = [
                r for r in filtered
                if (r.scoreboard_suite_id or r.suite_id) == suite_id
            ]
        if limit is not None:
            return filtered[offset : offset + limit]
        return filtered[offset:]

    def list_scorecard_runs(
        self,
        concurrency: int | None = None,
        model: str | None = None,
        framework: str | None = None,
        hardware_type: str | None = None,
        suite_id: str | None = None,
    ) -> list[BenchmarkRun]:
        runs = self.list_runs(
            concurrency=concurrency,
            model=model,
            framework=framework,
            hardware_type=hardware_type,
            suite_id=suite_id,
        )
        partitions: dict[tuple, list[BenchmarkRun]] = {}
        for r in runs:
            hw = r.hw_aws_instance_type or r.hw_gpu_name or r.hw_platform or "default"
            cat = r.category_id or r.prompt_category or "default"
            engine_config = json.dumps(r.engine_config or {}, sort_keys=True, separators=(",", ":"))
            key = (
                r.scoreboard_suite_id or r.suite_id or "default",
                r.model,
                r.model_revision,
                r.framework,
                hw,
                r.concurrency,
                r.pipeline_config_id,
                r.prompt_sha256,
                r.prompt_name,
                r.prompt_strategy,
                r.quantization,
                r.context_len,
                engine_config,
                cat,
            )
            partitions.setdefault(key, []).append(r)

        selected: dict[int, BenchmarkRun] = {}
        for part_runs in partitions.values():
            with_q = [r for r in part_runs if r.quality_score is not None]
            if with_q:
                with_q.sort(key=lambda x: (x.quality_score or 0, str(x.timestamp or "")), reverse=True)
                selected[id(with_q[0])] = with_q[0]
            with_tps = [r for r in part_runs if (r.median_decode_tps or 0) > 0]
            if with_tps:
                with_tps.sort(key=lambda x: (x.median_decode_tps or 0, str(x.timestamp or "")), reverse=True)
                selected[id(with_tps[0])] = with_tps[0]
            if not with_q and not with_tps and part_runs:
                selected[id(part_runs[0])] = part_runs[0]

        return sorted(selected.values(), key=lambda x: str(x.timestamp or ""), reverse=True)

    def get_experiment_tags(self) -> list[dict]:
        runs = self.list_runs()
        tags_map: dict[str, dict] = {}
        for r in runs:
            if not r.experiment_tag:
                continue
            tag = r.experiment_tag
            if tag not in tags_map:
                tags_map[tag] = {
                    "tag": tag,
                    "run_count": 0,
                    "models": set(),
                    "concurrencies": set(),
                    "first_run_at": r.timestamp,
                    "last_run_at": r.timestamp,
                }
            item = tags_map[tag]
            item["run_count"] += 1
            if r.model:
                item["models"].add(r.model)
            if r.concurrency is not None:
                item["concurrencies"].add(r.concurrency)
            if r.timestamp:
                if not item["first_run_at"] or r.timestamp < item["first_run_at"]:
                    item["first_run_at"] = r.timestamp
                if not item["last_run_at"] or r.timestamp > item["last_run_at"]:
                    item["last_run_at"] = r.timestamp

        return [
            {
                "tag": v["tag"],
                "run_count": v["run_count"],
                "models": sorted(list(v["models"])),
                "concurrencies": sorted(list(v["concurrencies"])),
                "first_run_at": v["first_run_at"],
                "last_run_at": v["last_run_at"],
            }
            for v in sorted(tags_map.values(), key=lambda x: str(x["last_run_at"] or ""), reverse=True)
        ]


    @staticmethod
    def _normalise_row(row: dict[str, str]) -> dict[str, object]:
        numeric_fields = {
            "num_runs", "median_ttft_s", "median_e2e_s", "median_prefill_tps",
            "median_decode_tps", "median_model_memory_mb",
        }
        normalised: dict[str, object] = {}
        for key, value in row.items():
            if value == "":
                normalised[key] = None
            elif key == "num_runs":
                normalised[key] = int(value)
            elif key in numeric_fields:
                normalised[key] = float(value)
            elif key in ("task_scores", "quality_buckets") and value:
                import ast
                try:
                    normalised[key] = ast.literal_eval(value)
                except Exception:
                    normalised[key] = None
            else:
                normalised[key] = value
        return normalised

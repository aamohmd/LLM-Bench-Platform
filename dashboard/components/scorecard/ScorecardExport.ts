import type { BenchmarkRun } from "../../lib/benchmarks";
import { engineLabel, hardwareLabel, errorRate } from "../../lib/benchmarks";
import { UNIVERSAL_STANDARDS, type ModelScorecard, type ScorecardCriteria } from "../../lib/scorecard";
import type { ApprovalEvaluation } from "../../lib/benchmarks";

export interface ScorecardExportRow {
  key: string;
  run: BenchmarkRun;
  card: ModelScorecard;
  hasDataForConcurrency: boolean;
  isCandidate?: boolean;
  approvalEvaluation?: ApprovalEvaluation;
  categoryResults: { categoryId: string; score: number | null; label: string; minimumQuality: number; isRequired?: boolean }[];
  deploymentMeanAccuracy: number | null;
}

export function exportScorecardCsv(
  allRows: ScorecardExportRow[],
  selectedConcurrency: number,
  criteria?: ScorecardCriteria | null,
): void {
  const escapeCsv = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    if (/^[=+\-@\t\r\n]/.test(str)) str = "'" + str;
    str = str.replace(/"/g, '""');
    return `"${str}"`;
  };

  // Dynamically collect unique categories across allRows
  const categoryMap = new Map<string, string>();
  for (const row of allRows) {
    for (const cat of row.categoryResults) {
      if (!categoryMap.has(cat.categoryId)) {
        categoryMap.set(cat.categoryId, cat.label || cat.categoryId);
      }
    }
  }
  const dynamicCategories = Array.from(categoryMap.entries()).map(([id, label]) => ({ id, label }));

  const headers = [
    "Model",
    "Framework / Engine",
    "Hardware Platform",
    "Evaluation Concurrency",
    "Production Status",
    "Qualification Verdict",
    "Verdict Reason",
    "Composite Score (0-100)",
    "Gate 1: Decode TPS",
    "Gate 1 Result",
    "Gate 2: Median TTFT (s)",
    "Gate 2 Result",
    "Gate 3: p95 TTFT (s)",
    "Gate 3 Result",
    "Gate 4: Quality (%)",
    "Gate 4 Result",
    "Gate 5: Memory / KV Saturation (%)",
    "Gate 5 Result",
    "Precondition: Error Rate (%)",
    "Precondition Result",
    ...dynamicCategories.map((c) => `${c.label} (%)`),
    "Strengths",
    "Identified Gaps",
  ];

  const rows = allRows.map((d) => {
    const card = d.card;
    const catScore = (id: string) => {
      const found = d.categoryResults.find((c) => c.categoryId === id);
      return found && found.score != null ? `${(found.score * 100).toFixed(1)}%` : "N/A";
    };

    const tpsVal = d.hasDataForConcurrency ? (d.run.median_decode_tps ?? d.run.aggregate_output_tps ?? null) : null;
    const ttftVal = d.hasDataForConcurrency ? (d.run.median_ttft_s ?? null) : null;
    const p95Val = d.hasDataForConcurrency ? (d.run.p95_ttft_s ?? null) : null;
    const qualityVal = d.hasDataForConcurrency ? d.deploymentMeanAccuracy : null;
    const used = d.run.peak_gpu_mem_mb ?? null;
    const total = d.run.hw_gpu_memory_mb ?? (d.run.hw_ram_gb != null ? d.run.hw_ram_gb * 1024 : null);
    const vramPct = used != null && total != null && total > 0 ? used / total * 100 : null;
    const kvVal = d.hasDataForConcurrency
      ? (d.run.framework === "vllm" ? d.run.peak_kv_cache_pct ?? vramPct : vramPct) : null;
    const errVal = d.hasDataForConcurrency && d.run ? errorRate(d.run) : null;

    const g1Pass = tpsVal != null ? (tpsVal >= (criteria?.min_decode_tps ?? UNIVERSAL_STANDARDS.minTargetDecodeTps) ? "PASS" : "FAIL") : "UNTESTED";
    const g2Pass = ttftVal != null ? (ttftVal <= (criteria?.fast_ttft_s ?? UNIVERSAL_STANDARDS.fastTtftSeconds) ? "PASS" : "FAIL") : "UNTESTED";
    const g3Pass = p95Val != null ? (p95Val <= (criteria?.tail_ttft_ceiling_s ?? UNIVERSAL_STANDARDS.tailTtftCeilingSeconds) ? "PASS" : "FAIL") : "UNTESTED";
    const g4Pass = qualityVal != null ? (qualityVal >= (criteria?.min_quality_score ?? UNIVERSAL_STANDARDS.strictQualityMin) ? "PASS" : "FAIL") : "UNTESTED";
    const g5Pass = d.run.framework === "openai-compatible" ? "N/A" : kvVal != null ? (kvVal <= (criteria?.memory_stability_max_pct ?? UNIVERSAL_STANDARDS.memoryStabilityMaxPct) ? "PASS" : "FAIL") : "UNTESTED";
    const precondPass = errVal != null ? (errVal <= (criteria?.max_error_rate ?? UNIVERSAL_STANDARDS.maxAllowedErrorRate) ? "PASS" : "FAIL") : "UNTESTED";

    return [
      escapeCsv(d.run.model),
      escapeCsv(engineLabel(d.run.framework)),
      escapeCsv(hardwareLabel(d.run)),
      escapeCsv(`C=${selectedConcurrency}`),
      escapeCsv(d.hasDataForConcurrency ? "Verified Under Load" : (d.isCandidate ? "Candidate (Evaluated at Other Concurrency)" : "Untested at Target Concurrency")),
      escapeCsv(d.approvalEvaluation ? d.approvalEvaluation.verdict : card.verdict),
      escapeCsv(card.verdictReason),
      escapeCsv(d.hasDataForConcurrency ? card.score.toFixed(1) : "N/A"),
      escapeCsv(tpsVal != null ? `${tpsVal.toFixed(1)} tok/s` : "N/A"),
      escapeCsv(g1Pass),
      escapeCsv(ttftVal != null ? `${ttftVal.toFixed(3)} s` : "N/A"),
      escapeCsv(g2Pass),
      escapeCsv(p95Val != null ? `${p95Val.toFixed(3)} s` : "N/A"),
      escapeCsv(g3Pass),
      escapeCsv(qualityVal != null ? `${(qualityVal * 100).toFixed(1)}%` : "N/A"),
      escapeCsv(g4Pass),
      escapeCsv(kvVal != null ? `${kvVal.toFixed(1)}%` : "N/A"),
      escapeCsv(g5Pass),
      escapeCsv(errVal != null ? `${(errVal * 100).toFixed(1)}%` : "N/A"),
      escapeCsv(precondPass),
      ...dynamicCategories.map((c) => escapeCsv(catScore(c.id))),
      escapeCsv(card.goodAt.join("; ")),
      escapeCsv(card.badAt.join("; ")),
    ].join(",");
  });

  const csvContent = [headers.map(escapeCsv).join(","), ...rows].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  link.setAttribute("href", url);
  link.setAttribute("download", `model_production_scorecard_c${selectedConcurrency}_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

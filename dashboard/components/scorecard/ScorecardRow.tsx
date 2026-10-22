"use client";

import Link from "next/link";
import type { ApprovalEvaluation, BenchmarkRun, CategoryScoreResult, TuningConfigSummary } from "../../lib/benchmarks";
import {
  engineLabel,
  engineTagClass,
  extractTuningConfig,
  formatMetric,
  hardwareLabel,
  isLegacyOrNonComparable,
  categoryEvidenceText,
} from "../../lib/benchmarks";
import type { ModelScorecard } from "../../lib/scorecard";
import { ApprovalEvidencePanel } from "../ApprovalEvidencePanel";
import { AlertTriangle, ChevronDown, CircleHelp, XCircle } from "lucide-react";

function renderTuningChips(
  tuning?: TuningConfigSummary | null,
  variant: "qualification" | "category" = "qualification"
) {
  if (!tuning?.hasTuning) return null;

  if (variant === "category") {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "3px", flexWrap: "wrap" }}>
        {tuning.promptName && (
          <span
            className="tag tag-prompt"
            style={{
              fontSize: "0.55rem",
              padding: "1px 5px",
              lineHeight: 1.2,
            }}
            title={`System Prompt: ${tuning.promptName}`}
          >
            p: {tuning.promptName}
          </span>
        )}
        {tuning.strategy && (
          <span
            className="tag"
            style={{
              background: "rgba(41,121,255,0.12)",
              color: "var(--accent-blue)",
              border: "1px solid rgba(41,121,255,0.25)",
              fontSize: "0.55rem",
              padding: "1px 5px",
              lineHeight: 1.2,
            }}
            title={`Reasoning Strategy: ${tuning.strategy}`}
          >
            s: {tuning.strategy}
          </span>
        )}
        {tuning.outputCeiling && (
          <span
            className="tag"
            style={{
              background: "rgba(255,255,255,0.06)",
              fontSize: "0.55rem",
              padding: "1px 5px",
              lineHeight: 1.2,
            }}
          >
            {tuning.outputCeiling}
          </span>
        )}
        {tuning.topK && (
          <span
            className="tag"
            style={{
              background: "rgba(255,255,255,0.06)",
              fontSize: "0.55rem",
              padding: "1px 5px",
              lineHeight: 1.2,
            }}
          >
            {tuning.topK}
          </span>
        )}
        {tuning.reranker && (
          <span
            className="tag"
            style={{
              background: "rgba(95,224,160,0.08)",
              color: "var(--accent-emerald)",
              fontSize: "0.55rem",
              padding: "1px 5px",
              lineHeight: 1.2,
            }}
          >
            rerank
          </span>
        )}
      </div>
    );
  }

  // variant === "qualification": exact same size and padding as model and runtime tags (vLLM, L40S, AWQ-INT4, C=10)
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", justifyContent: "center" }}>
      {tuning.promptName && (
        <span
          className="tag tag-prompt"
          style={{
            fontSize: "0.62rem",
            padding: "4px 12px",
          }}
          title={`System Prompt: ${tuning.promptName}`}
        >
          p: {tuning.promptName}
        </span>
      )}
      {tuning.strategy && (
        <span
          className="tag"
          style={{
            background: "rgba(41,121,255,0.12)",
            color: "var(--accent-blue)",
            border: "1px solid rgba(41,121,255,0.3)",
            fontSize: "0.62rem",
            padding: "4px 12px",
          }}
          title={`Reasoning Strategy: ${tuning.strategy}`}
        >
          s: {tuning.strategy}
        </span>
      )}
      {tuning.outputCeiling && (
        <span
          className="tag"
          style={{
            background: "rgba(255,255,255,0.06)",
            fontSize: "0.62rem",
            padding: "4px 12px",
          }}
        >
          {tuning.outputCeiling}
        </span>
      )}
      {tuning.topK && (
        <span
          className="tag"
          style={{
            background: "rgba(255,255,255,0.06)",
            fontSize: "0.62rem",
            padding: "4px 12px",
          }}
        >
          {tuning.topK}
        </span>
      )}
      {tuning.reranker && (
        <span
          className="tag"
          style={{
            background: "rgba(95,224,160,0.08)",
            color: "var(--accent-emerald)",
            fontSize: "0.62rem",
            padding: "4px 12px",
          }}
        >
          rerank
        </span>
      )}
    </div>
  );
}

export interface ScorecardRowData {
  key: string;
  run: BenchmarkRun;
  runList: BenchmarkRun[];
  card: ModelScorecard;
  hasDataForConcurrency: boolean;
  isCandidate: boolean;
  candidateRefScore?: number;
  candidateRefConcurrency?: number;
  candidateRefRun?: BenchmarkRun;
  testedConcurrency?: number;
  approvalEvaluation?: ApprovalEvaluation;
  categoryResults: CategoryScoreResult[];
  testedMandatoryCount: number;
  totalMandatoryCount: number;
  deploymentMeanAccuracy: number | null;
}

export interface ScorecardRowProps {
  data: ScorecardRowData;
  requiredConcurrency: number;
  alternativeCount?: number;
  expanded?: boolean;
  onToggleAlternatives?: () => void;
  isAlternative?: boolean;
  alternativeIndex?: number;
  alternativeTotal?: number;
}

export function ScorecardRow({ data, requiredConcurrency, alternativeCount = 0, expanded = false, onToggleAlternatives, isAlternative = false, alternativeIndex, alternativeTotal }: ScorecardRowProps) {
  const {
    run,
    card,
    hasDataForConcurrency,
    isCandidate,
    testedConcurrency,
    approvalEvaluation,
    categoryResults,
    deploymentMeanAccuracy,
  } = data;

  const generalTuning = extractTuningConfig(run);
  const gradingLabel = run.engine_config?.automated_grading_sha256
    ? "Automated grading"
    : categoryResults.some((category) => category.evidenceStatus === "pending_review")
      ? "Grading pending" : null;

  const engine = run.framework || "unknown";
  const hw = hardwareLabel(run);
  const modelDisplay = run.model.split("/").pop()?.replace(":latest", "") ?? run.model;

  const scoreColor =
    !hasDataForConcurrency && !isCandidate
      ? "var(--text-tertiary)"
      : card.score >= 80
      ? "var(--accent-emerald)"
      : card.score >= 60
      ? "var(--accent-amber)"
      : "var(--accent-rose)";

  return (
    <tr className={`interactive-row${isAlternative ? " scorecard-alternative-row" : ""}`} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      {/* 1. Score */}
      <td style={{ verticalAlign: "top", padding: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div className="score-chip" style={{ display: "inline-flex", alignItems: "baseline", gap: "2px" }}>
            <span
              className="text-mono-data"
              style={{
                fontSize: "1.4rem",
                fontWeight: 800,
                color: hasDataForConcurrency ? scoreColor : "var(--text-tertiary)",
                lineHeight: 1,
              }}
            >
              {!hasDataForConcurrency ? "—" : (approvalEvaluation ? approvalEvaluation.verdict : run.engine_config?.quality_aggregation === "per_category" ? "Diagnostic" : card.score)}
            </span>
            {hasDataForConcurrency && !approvalEvaluation && run.engine_config?.quality_aggregation !== "per_category" && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", fontWeight: 500 }}>/100</span>
            )}
          </div>

          {!hasDataForConcurrency ? (
            isCandidate ? (
              <span
                style={{
                  fontSize: "0.55rem",
                  fontWeight: 700,
                  padding: "1px 6px",
                  alignSelf: "flex-start",
                  borderRadius: "3px",
                  background: "rgba(224, 255, 2, 0.12)",
                  color: "var(--accent-lime)",
                  border: "1px solid rgba(224, 255, 2, 0.3)",
                  letterSpacing: "0.04em",
                }}
              >
                CANDIDATE
              </span>
            ) : (
              <span
                className="tag fit-unknown"
                style={{ fontSize: "0.55rem", padding: "1px 5px", alignSelf: "flex-start", borderRadius: "3px" }}
              >
                UNTESTED
              </span>
            )
          ) : card.isPartial ? (
            <span
              className="tag fit-unknown"
              style={{ fontSize: "0.55rem", padding: "1px 5px", alignSelf: "flex-start", borderRadius: "3px" }}
            >
              {run.engine_config?.quality_aggregation === "per_category" ? "PER-CATEGORY" : "PARTIAL"}
            </span>
          ) : null}
          {hasDataForConcurrency && isLegacyOrNonComparable(run) && (
            <span
              className="tag fit-unknown"
              style={{ fontSize: "0.55rem", padding: "1px 5px", alignSelf: "flex-start", borderRadius: "3px" }}
            >
              NOT COMPARABLE
            </span>
          )}
        </div>
      </td>

      {/* 2. Model & Setup */}
      <td style={{ verticalAlign: "top", padding: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {(alternativeCount > 0 || isAlternative) && (
            <span style={{ color: isAlternative ? "var(--accent-blue)" : "var(--text-tertiary)", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              {isAlternative ? `Alternative ${alternativeIndex} of ${alternativeTotal}` : "Best observed configuration"}
            </span>
          )}
          <Link
            href={`/models/${encodeURIComponent(run.model)}?engine=${encodeURIComponent(
              run.framework ?? ""
            )}&hw=${encodeURIComponent(hardwareLabel(run))}`}
            className="link"
            style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)", wordBreak: "break-word" }}
          >
            {modelDisplay}
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <span className={`tag ${engineTagClass(engine)}`} style={{ fontSize: "0.62rem" }}>
              {engineLabel(engine)}
            </span>
            {hw !== engineLabel(engine) && (
              <span className="tag" style={{ fontSize: "0.62rem" }}>
                {hw}
              </span>
            )}
            {run.quantization && (
              <span className="tag" style={{ fontSize: "0.62rem", background: "rgba(255,255,255,0.06)" }}>
                {run.quantization.toUpperCase()}
              </span>
            )}
            {gradingLabel && <span className="tag" style={{ fontSize: "0.62rem" }}>{gradingLabel}</span>}
            {hasDataForConcurrency ? (
              <span className="tag" style={{ fontSize: "0.62rem", background: "rgba(255,255,255,0.06)" }}>
                C={testedConcurrency ?? requiredConcurrency}
              </span>
            ) : isCandidate ? (
              <span
                className="tag"
                style={{
                  fontSize: "0.62rem",
                  background: "rgba(224, 255, 2, 0.12)",
                  color: "var(--accent-lime)",
                  border: "1px solid rgba(224, 255, 2, 0.3)",
                }}
              >
                CANDIDATE @ C={requiredConcurrency}
              </span>
            ) : (
              <span
                className="tag"
                style={{ fontSize: "0.62rem", background: "rgba(255,93,93,0.12)", color: "var(--accent-rose)" }}
              >
                UNTESTED @ C={requiredConcurrency}
              </span>
            )}
            {generalTuning?.promptName && (
              <span
                className="tag tag-prompt"
                style={{
                  fontSize: "0.62rem",
                }}
                title={`System Prompt: ${generalTuning.promptName}`}
              >
                p: {generalTuning.promptName}
              </span>
            )}
            {generalTuning?.strategy && (
              <span
                className="tag"
                style={{
                  fontSize: "0.62rem",
                  background: "rgba(41, 121, 255, 0.12)",
                  color: "var(--accent-blue)",
                  border: "1px solid rgba(41, 121, 255, 0.25)",
                }}
                title={`Reasoning Strategy: ${generalTuning.strategy}`}
              >
                s: {generalTuning.strategy}
              </span>
            )}
          </div>
          {alternativeCount > 0 && onToggleAlternatives && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Hide" : "Show"} ${alternativeCount} other configurations for ${run.model}`}
              onClick={onToggleAlternatives}
              style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "6px", minHeight: "44px", padding: "6px 2px", border: 0, background: "transparent", color: "var(--accent-lime)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
              title="Configurations are ranked by complete evidence, SLA verdict, then score"
            >
              <ChevronDown size={14} aria-hidden="true" style={{ transform: expanded ? "rotate(180deg)" : undefined }} />
              {expanded ? "Hide" : "Show"} {alternativeCount} other configuration{alternativeCount === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </td>

      {/* 3. Key Metrics */}
      <td style={{ verticalAlign: "top", padding: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.8rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
            <span style={{ color: "var(--text-tertiary)" }}>Speed:</span>
            <strong className="text-mono-data-sm" style={{ color: "var(--text-primary)" }}>
              {hasDataForConcurrency ? formatMetric(run.median_decode_tps || run.aggregate_output_tps, " tok/s") : "—"}
            </strong>
          </div>
          {/* Median E2E — total request-to-last-token latency */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
            <span style={{ color: "var(--text-tertiary)" }}>Median E2E:</span>
            <strong
              className="text-mono-data-sm"
              style={{
                color: (run.median_e2e_s ?? 0) > 30
                  ? "var(--accent-rose)"
                  : (run.median_e2e_s ?? 0) > 15
                  ? "var(--accent-amber)"
                  : "var(--text-primary)",
              }}
            >
              {hasDataForConcurrency && run.median_e2e_s != null ? formatMetric(run.median_e2e_s, " s") : "—"}
            </strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
            <span style={{ color: "var(--text-tertiary)" }}>p95 TTFT:</span>
            <strong
              className="text-mono-data-sm"
              style={{
                color: (run.p95_ttft_s ?? 0) > 3.0
                  ? "var(--accent-rose)"
                  : (run.p95_ttft_s ?? 0) > 1.5
                  ? "var(--accent-amber)"
                  : "var(--text-primary)",
              }}
            >
              {hasDataForConcurrency && run.p95_ttft_s != null ? formatMetric(run.p95_ttft_s, " s") : "—"}
            </strong>
          </div>
          <div
            style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}
            title={run.engine_config?.quality_aggregation === "per_category" ? "Metrics use different grading scales. See each category; there is no combined accuracy."
              : run.engine_config?.quality_aggregation === "normalized_quality" ? "Equal-weight mean across required categories. Rating agreement uses 1 minus average absolute error divided by the rating range. Invalid or failed rating attempts score zero. Missing categories count as zero."
                : "Penalized mean accuracy across all mandatory categories. Untested categories count as 0% in qualification coverage."}
          >
            <span style={{ color: "var(--text-tertiary)" }}>{run.engine_config?.quality_aggregation === "normalized_quality" ? "Quality:" : "Accuracy:"}</span>
            <strong className="text-mono-data-sm" style={{ color: "var(--text-primary)" }}>
              {hasDataForConcurrency && run.engine_config?.quality_aggregation === "per_category" ? "Per-category" : hasDataForConcurrency && deploymentMeanAccuracy != null
                ? `${Math.round(deploymentMeanAccuracy * 100)}%`
                : "—"}
            </strong>
          </div>
        </div>
      </td>

      {/* 4. Strengths */}
      <td style={{ verticalAlign: "top", padding: "16px" }}>
        <ul className="capability-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {hasDataForConcurrency && card.goodAt.length > 0 ? (
            card.goodAt.map((item, i) => (
              <li
                key={i}
                style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "6px", fontSize: "0.8rem", color: "var(--text-primary)" }}
              >
                <span style={{ color: "var(--accent-emerald)", flexShrink: 0, marginTop: "2px" }}>✓</span>
                <span>{item}</span>
              </li>
            ))
          ) : (
            <li style={{ color: "var(--text-tertiary)", fontSize: "0.8rem" }}>—</li>
          )}
        </ul>
      </td>

      {/* 5. Complete category results */}
      <td style={{ verticalAlign: "top", padding: "16px" }}>
        <ul className="capability-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {categoryResults.map((cat) => {
            const { categoryId, label, minimumQuality, configuredTaskCount, evaluatedTaskCount } = cat;
            const score = approvalEvaluation?.category_scores?.[categoryId] ?? cat.score;
            const evidence = approvalEvaluation?.category_evidence?.[categoryId]?.[`C${requiredConcurrency}`];
            const hasCatastrophicFailure = cat.catastrophicFailureCount > 0;
            const isFailing = score == null || score < minimumQuality || hasCatastrophicFailure;
            const catTuning = cat.championTuning;

            return (
              <li
                key={categoryId}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  marginBottom: "8px",
                  fontSize: "0.8rem",
                  color: isFailing ? "var(--accent-rose)" : "var(--text-primary)",
                }}
              >
                <span
                  style={{
                    color: !isFailing ? "var(--accent-emerald)" : "var(--accent-rose)",
                    flexShrink: 0,
                    marginTop: "2px",
                  }}
                >
                  {!isFailing ? "✓" : "⚠"}
                </span>
                <div style={{ width: "100%" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", flexWrap: "wrap" }}>
                    <span>
                      {label}: <strong>{categoryEvidenceText(cat, score)}</strong>
                    </span>
                    {renderTuningChips(catTuning, "category")}
                  </div>
                  {hasCatastrophicFailure && (
                    <div style={{ marginTop: "3px", color: "var(--accent-rose)", fontSize: "0.7rem" }}>
                      {cat.catastrophicFailureCount} catastrophic failure{cat.catastrophicFailureCount === 1 ? "" : "s"}
                    </div>
                  )}
                  {approvalEvaluation && <ApprovalEvidencePanel categoryLabel={label} concurrency={requiredConcurrency} evidence={evidence} />}
                </div>
              </li>
            );
          })}
        </ul>
      </td>

      {/* 6. Gaps & Deficiencies */}
      <td style={{ verticalAlign: "top", padding: "16px" }}>
        <ul className="capability-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {card.badAt.map((item, i) => {
            const isSevereViolation =
              item.includes("Severe") ||
              item.includes("Sluggish") ||
              item.includes("hallucination") ||
              item.includes("exceeds") ||
              item.includes("Slow total");
            return (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  marginBottom: "6px",
                  fontSize: "0.8rem",
                  color: isSevereViolation ? "var(--accent-rose)" : "var(--text-secondary)",
                }}
              >
                <span
                  style={{
                    color: isSevereViolation ? "var(--accent-rose)" : "var(--accent-amber)",
                    flexShrink: 0,
                    marginTop: "2px",
                  }}
                >
                  ⚠
                </span>
                <span>{item}</span>
              </li>
            );
          })}
        </ul>
      </td>

      {/* 7. Production Qualification */}
      <td style={{ verticalAlign: "top", padding: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {approvalEvaluation ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "center" }}>
              <span
                className={`tag ${approvalEvaluation.verdict === "Qualified" ? "fit-qualified" : approvalEvaluation.verdict === "Rejected" ? "fit-rejected" : "fit-unknown"}`}
                style={{ fontSize: "0.75rem", fontWeight: 700, padding: "4px 8px", borderRadius: "4px", textAlign: "center" }}
              >
                {approvalEvaluation.verdict}
              </span>
              {approvalEvaluation.verdict === "Qualified" && renderTuningChips(generalTuning, "qualification")}
            </div>
          ) : isCandidate ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  padding: "4px 8px",
                  borderRadius: "4px",
                  textAlign: "center",
                  background: "rgba(224, 255, 2, 0.12)",
                  color: "var(--accent-lime)",
                  border: "1px solid rgba(224, 255, 2, 0.3)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                ? Candidate
              </span>
            </div>
          ) : card.verdict === "Qualified" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "center" }}>
              <span
                className="tag fit-qualified"
                style={{ fontSize: "0.75rem", fontWeight: 700, padding: "4px 8px", borderRadius: "4px", textAlign: "center" }}
              >
                ✓ Qualified
              </span>
              {renderTuningChips(generalTuning, "qualification")}
            </div>
          ) : card.verdict === "Near-Miss" ? (
            <span
              className="tag fit-near-miss"
              style={{ fontSize: "0.75rem", fontWeight: 700, padding: "4px 8px", borderRadius: "4px", textAlign: "center" }}
            >
              <AlertTriangle size={13} aria-hidden="true" /> Near-Miss (Trade-off)
            </span>
          ) : card.verdict === "Needs Evidence" ? (
            <span
              className="tag fit-unknown"
              style={{ fontSize: "0.75rem", fontWeight: 600, padding: "4px 8px", borderRadius: "4px", textAlign: "center" }}
            >
              <CircleHelp size={13} aria-hidden="true" /> Needs Evidence
            </span>
          ) : (
            <span
              className="tag fit-rejected"
              style={{ fontSize: "0.75rem", fontWeight: 700, padding: "4px 8px", borderRadius: "4px", textAlign: "center" }}
            >
              <XCircle size={13} aria-hidden="true" /> Rejected
            </span>
          )}

          <span
            style={{
              fontSize: "0.72rem",
              color: "var(--text-tertiary)",
              lineHeight: 1.4,
              wordBreak: "break-word",
            }}
          >
            {approvalEvaluation ? approvalEvaluation.reasons.join("; ") || "Approval SLA evaluated" : card.verdictReason}
          </span>
        </div>
      </td>
    </tr>
  );
}

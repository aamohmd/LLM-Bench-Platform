"use client";

import type { CategoryEvidence } from "../lib/benchmarks";

const metricLabels: Record<string, string> = {
  program_chain_3plus_pass_rate: "3+ step chains",
  answer_accuracy: "Answer accuracy",
  citation_accuracy: "Citation accuracy",
  distractor_failure_rate: "Distractor errors",
  trap_accuracy: "Trap accuracy",
  plain_accuracy: "Plain accuracy",
  false_approve_rate: "False approvals",
  field_accuracy: "Field accuracy",
  schema_validity_rate: "Schema validity",
  contradiction_balance: "Contradiction balance",
  accuracy_gap: "Language gap",
  ASR_critical: "Critical attack success",
  hard_sla_failures: "Hard SLA failures",
  over_refusal_rate: "Benign over-refusal",
  implementation_ready_count: "Ready tasks",
  pending_evidence_count: "Evidence pending",
  informational_medium_severity_count: "Medium severity · informational",
};

function statusClass(status?: CategoryEvidence["status"]) {
  if (status === "Qualified") return "approval-evidence__status--approved";
  if (status === "Rejected") return "approval-evidence__status--rejected";
  return "approval-evidence__status--pending";
}

function formatMetric(key: string, value: CategoryEvidence["metrics"][string]) {
  if (value == null) return "Not measured";
  if (typeof value === "number") {
    if (key.endsWith("_rate") || key.includes("accuracy") || key.includes("balance") || key === "ASR_critical") {
      return `${Math.round(value * 100)}%`;
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([language, score]) => `${language.toUpperCase()} ${score == null ? "—" : `${Math.round(score * 100)}%`}`)
      .join(" · ");
  }
  return value;
}

export function ApprovalEvidencePanel({
  categoryLabel,
  concurrency,
  evidence,
}: {
  categoryLabel: string;
  concurrency: number;
  evidence?: CategoryEvidence;
}) {
  if (!evidence) {
    return (
      <div className="approval-evidence approval-evidence--missing">
        <span>Evidence unavailable at C={concurrency}</span>
      </div>
    );
  }

  const metrics = Object.entries(evidence.metrics);
  return (
    <details className="approval-evidence">
      <summary aria-label={`View ${categoryLabel} approval evidence at concurrency ${concurrency}`}>
        <span className={`approval-evidence__status ${statusClass(evidence.status)}`}>{evidence.status}</span>
        <span className="approval-evidence__summary-copy">Evidence · C={concurrency}</span>
        <span className="approval-evidence__chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="approval-evidence__body">
        <div className="approval-evidence__headline">
          <span>Rubric score</span>
          <strong>{evidence.category_score == null ? "—" : `${Math.round(evidence.category_score * 100)}%`}</strong>
        </div>
        {metrics.length > 0 && (
          <dl className="approval-evidence__metrics">
            {metrics.map(([key, value]) => (
              <div key={key}>
                <dt>{metricLabels[key] ?? key.replaceAll("_", " ")}</dt>
                <dd>{formatMetric(key, value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {evidence.reasons.length > 0 && (
          <ul className="approval-evidence__reasons">
            {evidence.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
      </div>
    </details>
  );
}

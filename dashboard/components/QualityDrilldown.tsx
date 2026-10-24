"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { SettingsSectionSkeleton } from "./SkeletonState";

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export function QualityDrilldown({
  runId,
  score,
  successCount,
  totalCount,
  errorRateStr,
  taskScores,
  canViewTraces = false,
}: {
  runId: string;
  score: number;
  successCount: number | string;
  totalCount: number | string;
  errorRateStr: string;
  taskScores: Record<string, any>;
  canViewTraces?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const needsDetails = Object.keys(taskScores).length === 0;
  const { data: detail, error: detailError, isLoading: detailsLoading } = useSWR(
    isOpen && needsDetails && runId ? `/api/v1/benchmark-history/${runId}` : null,
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );
  const effectiveTaskScores: Record<string, any> = detail?.task_scores ?? taskScores;

  const { data: failedTraces, error: tracesError, isLoading: isLoadingTraces } = useSWR(
    canViewTraces && auditOpen ? `/api/v1/benchmark-history/${runId}/failed-traces` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <details onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}>
        <summary style={{ cursor: "pointer" }}>
          <strong>{Math.round(score * 100)}%</strong> · {successCount}/{totalCount}
        </summary>
        <div
          style={{
            maxHeight: "300px",
            overflowY: "auto",
            marginTop: "8px",
            fontSize: "0.75rem",
            padding: "8px",
            background: "rgba(255,255,255,0.05)",
            borderRadius: "4px",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {detailsLoading && <SettingsSectionSkeleton label="Loading task scoring evidence" rows={2} compact />}
          {detailError && <p role="alert">Task evidence could not be loaded. This is an API failure, not an all-pass result.</p>}
          {Object.entries(effectiveTaskScores)
            .sort((a, b) => {
              if (a[1].failed && !b[1].failed) return -1;
              if (!a[1].failed && b[1].failed) return 1;
              return a[0].localeCompare(b[0]);
            })
            .map(([taskId, taskScore]) => (
              <div
                key={taskId}
                style={{
                  marginBottom: "6px",
                  paddingBottom: "6px",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                  <span style={{ fontWeight: 600, wordBreak: "break-all", marginRight: "8px" }}>
                    {taskId.split("/").pop()}
                  </span>
                  <span
                    style={{
                      color: taskScore.failed ? "var(--fg-error)" : taskScore.score == null ? "var(--text-secondary)" : "var(--fg-success)",
                      fontWeight: 600,
                    }}
                  >
                    {taskScore.score == null ? (taskScore.failed ? "ERROR" : "UNSCORED") : taskScore.failed ? "FAIL" : "PASS"}
                  </span>
                </div>
                {taskScore.reason && (
                  <div style={{ color: taskScore.failed ? "var(--fg-error)" : "var(--text-secondary)", marginTop: "2px", opacity: 0.9 }}>
                    Reason: {taskScore.reason}
                  </div>
                )}
                {taskScore.failed && taskScore.extraction_path && (
                  <div style={{ color: "var(--fg-subtle)", marginTop: "2px", fontSize: "0.7rem" }}>
                    Path: {taskScore.extraction_path}
                  </div>
                )}
              </div>
            ))}
          
          {isOpen && !detailsLoading && !detailError && Object.keys(effectiveTaskScores).length === 0 && <p>No per-task scoring evidence was recorded.</p>}
          {canViewTraces && <div style={{ marginTop: "16px", paddingTop: "8px", borderTop: "1px solid var(--border-strong)" }}>
            <details onToggle={(e) => setAuditOpen((e.target as HTMLDetailsElement).open)}>
              <summary style={{ cursor: "pointer", color: "var(--text-secondary)", fontWeight: 500 }}>
                ▶ Audit Log (Raw Traces)
              </summary>
              <div style={{ marginTop: "12px" }}>
                {isLoadingTraces ? (
                  <SettingsSectionSkeleton label="Loading failed request traces" rows={3} compact />
                ) : tracesError ? (
                  <div style={{ color: "var(--fg-error)" }}>
                    Failed to load traces (status {tracesError instanceof Error ? tracesError.message : "error"}) — API failure, not an all-pass result.
                  </div>
                ) : failedTraces?.length > 0 ? (
                  failedTraces.map((trace: any) => (
                    <div key={trace.id} style={{ marginBottom: "16px", padding: "8px", background: "rgba(0,0,0,0.2)", borderRadius: "4px" }}>
                      <div style={{ fontWeight: 600, marginBottom: "8px", color: "var(--text-secondary)" }}>{trace.task_id}</div>
                      <div style={{ marginBottom: "8px" }}>
                        <span style={{ color: "var(--text-subtle)", display: "block" }}>PROMPT:</span>
                        <div style={{ whiteSpace: "pre-wrap", opacity: 0.8, fontSize: "0.7rem", maxHeight: "150px", overflowY: "auto" }}>
                          {trace.prompt}
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "8px" }}>
                        <div>
                          <span style={{ color: "var(--text-subtle)", display: "block" }}>EXPECTED:</span>
                          <div style={{ wordBreak: "break-all", color: "var(--accent-teal)" }}>{trace.expected}</div>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-subtle)", display: "block" }}>ACTUAL:</span>
                          <div style={{ wordBreak: "break-all", color: "var(--accent-red)" }}>{trace.actual}</div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : Object.values(effectiveTaskScores).some((t: any) => t.failed) ? (
                  <div style={{ color: "var(--text-subtle)", fontStyle: "italic", padding: "8px" }}>
                    No stored traces are available. They may not have been captured or may have expired.
                  </div>
                ) : (
                  <div style={{ color: "var(--text-subtle)", fontStyle: "italic", padding: "8px" }}>
                    No failed traces were recorded. Detailed traces require capture during execution and expire after retention.
                  </div>
                )}
              </div>
            </details>
          </div>}
        </div>
      </details>
      <div style={{ marginTop: "4px" }}>
        <span className="text-sub">{errorRateStr}</span>
      </div>
    </div>
  );
}

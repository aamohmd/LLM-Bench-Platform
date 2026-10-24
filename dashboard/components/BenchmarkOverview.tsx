"use client";

import Link from "next/link";
import { useMemo } from "react";
import { DeploymentScorecardTable } from "./DeploymentScorecardTable";
import {
  type BenchmarkRun,
  type ApprovalEvaluation,
  type CompositeProfilesResponse,
  newestFirst,
  runDate,
} from "../lib/benchmarks";
import { LogoutButton } from "./LogoutButton";
import { BenchmarkRunControls } from "./BenchmarkRunControls";
import { useManualRefresh } from "../lib/useManualRefresh";
import { ManualRefreshControl } from "./ManualRefreshControl";
import { SetupGuide } from "./SetupGuide";

function displayDate(run: BenchmarkRun | undefined) {
  const date = run ? new Date(runDate(run)) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toLocaleString() : "No benchmark run yet";
}

export function BenchmarkOverview({
  runs,
  history,
  compositeProfiles,
  approvalEvaluations,
  canManageSettings = false,
  registryRevision = 0,
}: {
  runs: BenchmarkRun[];
  history: BenchmarkRun[];
  compositeProfiles?: CompositeProfilesResponse | null;
  approvalEvaluations?: Record<string, ApprovalEvaluation>;
  canManageSettings?: boolean;
  registryRevision?: number;
}) {
  const sourceRuns = runs.length ? runs : history;

  const availableModels = useMemo(() => {
    const set = new Set<string>();
    sourceRuns.forEach((r) => { if (r.model) set.add(r.model); });
    return Array.from(set).map((m) => ({ id: m, label: m }));
  }, [sourceRuns]);

  const latest = newestFirst(sourceRuns)[0];

  const { isRefreshing, lastRefreshedAgo, refreshNow } = useManualRefresh();

  return (
    <main className="visualizer">
      {/* Hero Header Section */}
      <div style={{ marginBottom: "36px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <ManualRefreshControl
              isRefreshing={isRefreshing}
              lastRefreshedAgo={lastRefreshedAgo}
              refreshNow={refreshNow}
            />
          </div>
          <h1 className="text-display">
            Inference Benchmarks
          </h1>
          <p className="text-sub" style={{ maxWidth: "600px", margin: 0 }}>
            Measured throughput, latency, and capability evaluation across local inference engines and hardware.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "16px" }}>
            <p
              className="text-sub"
              style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", margin: 0 }}
              suppressHydrationWarning
            >
              Latest Run: {displayDate(latest)}
            </p>
            <Link
              href="/settings"
              className="tag"
              style={{ background: "transparent", border: "1px solid var(--border-default)", color: "var(--text-secondary)", textDecoration: "none" }}
            >
              SETTINGS
            </Link>
            <LogoutButton />
          </div>
        </div>
      </div>

      {canManageSettings && <SetupGuide refreshKey={registryRevision} />}

      {/* Full Model Scoreboard & Capability Breakdown Section */}
      {sourceRuns.length > 0 ? (
        <section style={{ marginBottom: "48px", width: "100%", maxWidth: "100%" }}>
          <DeploymentScorecardTable runs={sourceRuns} profiles={compositeProfiles ?? null} approvalEvaluations={approvalEvaluations} />
        </section>
      ) : (
        <section style={{ marginBottom: "48px" }}>
          <div
            className="panel panel-body"
            style={{ textAlign: "center", padding: "48px 24px" }}
          >
            <h2 className="text-heading" style={{ marginBottom: "12px" }}>
              No benchmark runs recorded yet.
            </h2>
            <p className="text-sub">
              {canManageSettings
                ? "Create a benchmark suite and its tasks, a prompt, and a strategy in Settings. Then choose your model below and copy the runner command."
                : "Results will appear here after an administrator submits a benchmark."}
            </p>
            {canManageSettings && <Link className="btn btn-primary" href="/settings?section=tasks" style={{ display: "inline-flex", marginTop: "20px" }}>Configure your first benchmark</Link>}
          </div>
        </section>
      )}

      {/* Benchmark command controls */}
      {canManageSettings && <section id="benchmark-runner" style={{ marginBottom: "48px", width: "100%" }}>
        <BenchmarkRunControls availableModels={availableModels} registryRevision={registryRevision} />
      </section>}

    </main>
  );
}

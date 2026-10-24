import { redirect } from "next/navigation";
import Link from "next/link";
import { fetchRunDetailWithStatus } from "../../../lib/benchmarks";
import { ApiUnavailableState } from "../../../components/ApiUnavailableState";
import { RawSamplesChart } from "../../../components/RawSamplesChart";
import {
  engineLabel,
  engineTagClass,
  errorRate,
  generationTimeoutRate,
  hardwareLabel,
  hardwareStatusLabel,
  isLegacyOrNonComparable,
  tokenSourceLabel,
  recordedRequestCount,
  type BenchmarkRunDetail,
  formatMetric,
  categoryLabel,
  formatPromptStrategy,
} from "../../../lib/benchmarks";

export const dynamic = "force-dynamic";

function displayDate(timestamp: string | undefined) {
  const date = timestamp ? new Date(timestamp) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toLocaleString() : "Unknown date";
}

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const result = await fetchRunDetailWithStatus(runId);

  if (result === null) {
    return <ApiUnavailableState />;
  }

  if (result.status === 401) redirect("/login");
  if (result.status === 403) return <ApiUnavailableState reason="forbidden" />;

  if (result.status !== 200 && result.status !== 404) {
    return (
      <main className="visualizer" style={{ padding: "48px 24px" }}>
        <div className="empty-state">
          <h2>Backend error ({result.status})</h2>
          <p>The benchmark API could not serve this run — this is an infrastructure failure, not a missing run.</p>
          <Link href="/" style={{ color: "var(--accent)" }}>&larr; Back to overview</Link>
        </div>
      </main>
    );
  }

  const run = result.data;

  if (!run) {
    return (
      <main className="visualizer" style={{ padding: "48px 24px" }}>
        <div className="empty-state">
          <h2>Run not found</h2>
          <p>This benchmark run does not exist or has been deleted.</p>
          <Link href="/" style={{ color: "var(--accent)" }}>&larr; Back to overview</Link>
        </div>
      </main>
    );
  }

  const isRemoteUnreachable = run.hw_detection_status === "remote_unreachable";
  const hasHardware = !!(run.hw_cpu_model || run.hw_gpu_name || run.hw_platform || run.hw_detection_status);
  const qualityPct = run.quality_score != null ? Math.round(run.quality_score * 100) : null;

  const promptName = run.prompt_name || run.base_prompt_name || run.engine_config?.prompt_name || "Unspecified";
  const rawStrategy = run.prompt_strategy || run.directive_name || run.engine_config?.prompt_strategy;
  const strategy = formatPromptStrategy(rawStrategy) || "Unspecified";

  return (
    <main className="visualizer run-page">
      <header className="run-hero">
        <div className="run-hero-main">
          <div>
            <Link
              href={`/models/${encodeURIComponent(run.model)}?engine=${encodeURIComponent(run.framework ?? "")}&hw=${encodeURIComponent(hardwareLabel(run))}&c=${run.concurrency ?? ""}&run=${encodeURIComponent(run.id ?? runId)}`}
              className="text-eyebrow link"
            >
              &larr; Back to model
            </Link>
            <div className="run-tag-row">
              <span className={`tag ${engineTagClass(run.framework || "")}`}>
                {engineLabel(run.framework ?? "Unknown")}
              </span>
              <span className="tag">{hardwareLabel(run)}</span>
              <span className="tag run-neutral-tag">
                C={run.concurrency ?? 1}
              </span>
              {run.experiment_tag && (
                <span className="tag run-neutral-tag">
                  {run.experiment_tag}
                </span>
              )}
              <span
                className="tag tag-prompt"
                style={{ textDecoration: "none" }}
                title={`System Prompt: ${promptName}`}
              >
                p: {promptName}
              </span>
              <span
                className="tag"
                style={{ background: "var(--accent-blue-dim)", color: "var(--accent-blue)", borderColor: "rgba(41,121,255,0.3)" }}
                title={`Reasoning Strategy: ${strategy}`}
              >
                s: {strategy}
              </span>
            </div>
            <p className="text-eyebrow run-page-kicker">Benchmark run</p>
            <h1 className="text-display run-title">{run.model.split("/").pop()?.replace(":latest", "")}</h1>
            {run.model.includes("/") && <p className="text-sub-mono" style={{ overflowWrap: "anywhere" }}>{run.model}</p>}
            <p className="text-sub-mono run-id">Run ID: {run.id}</p>
          </div>

          <div className="run-recorded-at">
            <span className="text-eyebrow">Recorded telemetry</span>
            <p className="text-sub-mono">
              {displayDate(run.created_at ?? run.timestamp)}
            </p>
          </div>
        </div>
      </header>

      {((run.error_count ?? 0) > 0 || run.hw_detection_status === "remote_unreachable" || isLegacyOrNonComparable(run)) && (
        <div className="data-warning" role="status" style={{ marginBottom: "24px" }}>
          <strong>{(run.error_count ?? 0) > 0 ? "PARTIAL RUN" : "DATA LIMITATION"}</strong>
          <span>
            {(run.error_count ?? 0) > 0 && `${run.error_count} failed request${run.error_count === 1 ? "" : "s"}; displayed performance excludes failures. `}
            {(run.generation_timeout_count ?? 0) > 0 && `${run.generation_timeout_count} timed out (${((generationTimeoutRate(run) ?? 0) * 100).toFixed(1)}% of attempted requests). `}
            {run.hw_detection_status === "remote_unreachable" && "Remote hardware telemetry was unavailable. "}
            {isLegacyOrNonComparable(run) && "This run has incomplete provenance and is not safe for cross-era comparison."}
          </span>
        </div>
      )}

      <section className="run-context" aria-label="Run provenance">
        <div className="run-context-item">
          <span className="text-eyebrow">Benchmark suite</span>
          <p className="text-mono-data-sm">
            {categoryLabel(run.prompt_category)}
          </p>
        </div>
        <div className="run-context-item">
          <span className="text-eyebrow">Concurrency load</span>
          <p className="text-mono-data-sm">
            {run.concurrency ?? 1} Simultaneous User{run.concurrency === 1 ? "" : "s"}
          </p>
        </div>
        <div className="run-context-item">
          <span className="text-eyebrow">Sample iterations</span>
          <p className="text-mono-data-sm">
            {run.num_runs ?? "—"} iterations ({recordedRequestCount(run) ?? "—"} total requests)
          </p>
        </div>
        <div className="run-context-item">
          <span className="text-eyebrow">Median tokens per request (P / O)</span>
          <p className="text-mono-data-sm">
            {run.prompt_tokens ?? "—"} prompt / {run.output_tokens ?? "—"} output
          </p>
        </div>
        <div className="run-context-item">
          <span className="text-eyebrow">System prompt</span>
          <p className="text-mono-data-sm">
            {promptName}
            <br />
            <small>{run.prompt_sha256?.slice(0, 12) ?? "Hash not recorded"}</small>
          </p>
        </div>
        <div className="run-context-item">
          <span className="text-eyebrow">Reasoning strategy</span>
          <p className="text-mono-data-sm text-blue">
            {strategy}
          </p>
        </div>
      </section>

      {/* Tuning Configuration Panel — rendered from saved engine_config JSON */}
      {run.engine_config && Object.keys(run.engine_config).length > 0 && (
        <section className="run-section">
          <h2 className="text-eyebrow run-section-label">Tuning configuration</h2>
          <p className="text-sub" style={{ marginBottom: "16px" }}>
            {run.engine_config.runtime_configuration_source === "runner_launched_vllm"
              ? "The runner launched a dedicated vLLM server. Startup settings below are process arguments; memory and timing are measured separately."
              : run.engine_config.runtime_configuration_source === "ollama_request_options"
              ? "Request settings were sent to Ollama. Requested context and engine-reported allocation are recorded separately."
              : "This run used an existing inference server. Unreported server startup settings remain unknown."}
          </p>
          <div className="panel panel-blue run-config-grid">
            <div>
              <span className="text-eyebrow">Engine-reported context</span>
              <p className="text-mono-data-sm">{run.context_len ? `${run.context_len} tokens` : "Unavailable"}</p>
            </div>
            <div>
              <span className="text-eyebrow">Recorded quantization</span>
              <p className="text-mono-data-sm">{run.quantization ?? "Unavailable"}</p>
            </div>
            <div>
              <span className="text-eyebrow" style={{ color: "var(--accent-lime)", fontSize: "0.65rem" }}>LAYER 1A · SYSTEM PROMPT</span>
              <p className="text-mono-data-sm" style={{ margin: "4px 0 0 0", color: "var(--text-primary)", fontSize: "0.85rem" }}>
                {promptName}
              </p>
            </div>
            <div>
              <span className="text-eyebrow" style={{ color: "var(--accent-blue)", fontSize: "0.65rem" }}>LAYER 1B · REASONING STRATEGY</span>
              <p className="text-mono-data-sm" style={{ margin: "4px 0 0 0", color: "var(--text-primary)", fontSize: "0.85rem" }}>
                {strategy}
              </p>
            </div>
            {run.engine_config.rag_top_k && (
              <div>
                <span className="text-eyebrow" style={{ color: "var(--accent-lime)", fontSize: "0.65rem" }}>LAYER 2 · RAG RETRIEVAL DEPTH</span>
                <p className="text-mono-data-sm" style={{ margin: "4px 0 0 0", color: "var(--text-primary)", fontSize: "0.85rem" }}>
                  Top-{run.engine_config.rag_top_k} documents
                </p>
              </div>
            )}
            {run.engine_config.rag_rerank !== undefined && (
              <div>
                <span className="text-eyebrow" style={{ color: "var(--accent-lime)", fontSize: "0.65rem" }}>LAYER 2 · CROSS-ENCODER RERANKER</span>
                <p className="text-mono-data-sm" style={{ margin: "4px 0 0 0", color: run.engine_config.rag_rerank === "true" ? "var(--accent-emerald)" : "var(--text-secondary)", fontSize: "0.85rem" }}>
                  {run.engine_config.rag_rerank === "true" ? "Enabled (BAAI/bge-reranker)" : "Disabled"}
                </p>
              </div>
            )}
            {run.engine_config.max_output_tokens && (
              <div>
                <span className="text-eyebrow" style={{ color: "var(--accent-emerald)", fontSize: "0.65rem" }}>LAYER 3 · OUTPUT TOKEN CEILING</span>
                <p className="text-mono-data-sm" style={{ margin: "4px 0 0 0", color: "var(--text-primary)", fontSize: "0.85rem" }}>
                  {run.engine_config.max_output_tokens} tokens max
                </p>
              </div>
            )}
            {Object.entries(run.engine_config)
              .filter(([k]) => !["prompt_name", "prompt_strategy", "strategy", "base_prompt", "base_version", "directive", "directive_version", "rag_top_k", "rag_rerank", "max_output_tokens", "prompt_id", "prompt_version", "prompt_sha256"].includes(k))
              .map(([k, v]) => v != null && (
                <div key={k}>
                  <span className="text-eyebrow" style={{ color: "var(--text-tertiary)", fontSize: "0.65rem" }}>{k.replace(/_/g, " ").toUpperCase()}</span>
                  <p className="text-mono-data-sm" style={{ margin: "4px 0 0 0", color: "var(--text-primary)", fontSize: "0.85rem", overflowWrap: "anywhere" }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</p>
                </div>
              ))
            }
          </div>
        </section>
      )}

      {/* Primary Metrics Summary */}
      <section className="run-section">
        <h2 className="text-eyebrow run-section-label">Core performance telemetry</h2>
        <div className="run-metric-grid">
          {/* 1. Decode Speed */}
          <div className="panel">
            <div className="panel-body metric-block" style={{ minHeight: "120px", justifyContent: "space-between", padding: "20px" }}>
              <span className="text-eyebrow">DECODE THROUGHPUT</span>
              <strong className="text-mono-data text-display-md" style={{ color: "var(--text-primary)" }}>
                {formatMetric(run.median_decode_tps ?? run.aggregate_output_tps, " tok/s")}
              </strong>
              <span className="text-sub-mono" style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                Generation speed during output stream
              </span>
            </div>
          </div>

          {/* 2. TTFT (Both Median & p95) */}
          <div className="panel">
            <div className="panel-body metric-block" style={{ minHeight: "120px", justifyContent: "space-between", padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span className="text-eyebrow">INITIAL LATENCY (TTFT)</span>
                <span className="text-sub-mono" style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>
                  p95: {formatMetric(run.p95_ttft_s, "s")}
                </span>
              </div>
              <strong
                className="text-mono-data text-display-md"
                style={{
                  color: (run.median_ttft_s ?? 0) > 3.0 ? "var(--accent-rose)" : (run.median_ttft_s ?? 0) > 1.5 ? "var(--accent-amber)" : "var(--text-primary)",
                }}
              >
                {formatMetric(run.median_ttft_s, "s")}
              </strong>
              <span className="text-sub-mono" style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                Median time to first token ({run.p95_ttft_s != null ? `p95 tail: ${formatMetric(run.p95_ttft_s, "s")}` : "Client roundtrip"})
              </span>
            </div>
          </div>

          {/* 3. Total Request Duration */}
          <div className="panel">
            <div className="panel-body metric-block" style={{ minHeight: "120px", justifyContent: "space-between", padding: "20px" }}>
              <span className="text-eyebrow">TOTAL DURATION (E2E)</span>
              <strong className="text-mono-data text-display-md" style={{ color: "var(--text-primary)" }}>
                {formatMetric(run.median_e2e_s, "s")}
              </strong>
              <span className="text-sub-mono" style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                Total end-to-end request turnaround
              </span>
            </div>
          </div>

          {/* 4. Loaded Memory */}
          <div className="panel">
            <div className="panel-body metric-block" style={{ minHeight: "120px", justifyContent: "space-between", padding: "20px" }}>
              <span className="text-eyebrow">VRAM / MODEL MEMORY</span>
              <strong className="text-mono-data text-display-md" style={{ color: "var(--text-primary)" }}>
                {run.peak_gpu_mem_mb != null ? formatMetric(run.peak_gpu_mem_mb / 1024, " GB") : formatMetric(run.median_model_memory_mb, " MB")}
              </strong>
              <span className="text-sub-mono" style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                {run.peak_gpu_mem_mb != null ? "Peak GPU VRAM allocation" : "Loaded model resident footprint"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Quality & Reasoning Evaluation Section */}
      <section className="run-section">
        <h2 className="text-eyebrow run-section-label">
          Quality &amp; reasoning evaluation ({categoryLabel(run.prompt_category)})
        </h2>

        {run.quality_score != null ? (
          <div className="panel run-quality-panel">
            {/* Header Score */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "16px",
                paddingBottom: "20px",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                <strong
                  className="text-mono-data"
                  style={{
                    fontSize: "clamp(2rem, 3.5vw, 2.3rem)",
                    fontWeight: 800,
                    lineHeight: 1,
                    color: "var(--text-primary)",
                  }}
                >
                  {qualityPct}%
                </strong>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span className="text-mono-data-sm" style={{ fontWeight: 700, color: "var(--text-primary)" }}>
                    {run.quality_success_count ?? "—"} / {run.quality_total_count ?? "—"} Tasks Succeeded
                  </span>
                  <span className="text-sub-mono" style={{ fontSize: "0.78rem", color: "var(--text-tertiary)" }}>
                    Evaluated on {categoryLabel(run.prompt_category)} Suite
                  </span>
                </div>
              </div>
            </div>

            {/* Diagnostic Failure Mode Metrics Grid */}
            {run.task_scores && Object.keys(run.task_scores).length > 0 && (() => {
              const allTasks = Object.values(run.task_scores);
              const unscored = allTasks.filter((t) => t.score == null);
              const scorerFails = allTasks.filter((t) => t.score != null && (t.failed ?? t.score < 1));
              const withReason = allTasks.filter((t) => Boolean(t.reason));

              return (
                <div style={{ marginTop: "20px" }}>
                  <div className="run-diagnostic-grid">
                    <div className="run-diagnostic-item">
                      <span className="text-eyebrow" style={{ fontSize: "0.68rem", color: "var(--text-tertiary)" }}>SCORER FAILURES</span>
                      <p className="text-mono-data-sm" style={{ margin: "6px 0 0 0", color: scorerFails.length > 0 ? "var(--accent-amber)" : "var(--accent-emerald)", fontWeight: 700 }}>
                        {scorerFails.length} tasks did not pass
                      </p>
                      <span className="text-sub-mono" style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>
                        Evaluated against each task’s configured scoring rules
                      </span>
                    </div>

                    <div className="run-diagnostic-item">
                      <span className="text-eyebrow" style={{ fontSize: "0.68rem", color: "var(--text-tertiary)" }}>UNSCORED TASKS</span>
                      <p className="text-mono-data-sm" style={{ margin: "6px 0 0 0", color: unscored.length > 0 ? "var(--accent-rose)" : "var(--accent-emerald)", fontWeight: 700 }}>
                        {unscored.length} tasks without a numeric score
                      </p>
                      <span className="text-sub-mono" style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>
                        {unscored.length === 0 ? "Every task has a recorded score" : "Inspect the task audit log for the reason"}
                      </span>
                    </div>

                    <div className="run-diagnostic-item">
                      <span className="text-eyebrow" style={{ fontSize: "0.68rem", color: "var(--text-tertiary)" }}>SCORING EVIDENCE</span>
                      <p className="text-mono-data-sm" style={{ margin: "6px 0 0 0", color: "var(--text-primary)", fontWeight: 700 }}>
                        {withReason.length} / {allTasks.length} task decisions
                      </p>
                      <span className="text-sub-mono" style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>
                        Recorded explanations are available in the task audit log
                      </span>
                    </div>
                  </div>

                  {/* Task Audit Drilldown Accordion */}
                  <details className="run-audit-log">
                    <summary>
                      Inspect task audit log ({allTasks.length} questions evaluated)
                    </summary>
                    <div style={{ padding: "16px", maxHeight: "400px", overflowY: "auto", borderTop: "1px solid var(--border-subtle)" }}>
                      {Object.entries(run.task_scores)
                        .sort((a, b) => {
                          if (a[1].failed && !b[1].failed) return -1;
                          if (!a[1].failed && b[1].failed) return 1;
                          return a[0].localeCompare(b[0]);
                        })
                        .map(([taskId, taskScore]) => (
                          <div
                            key={taskId}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              padding: "8px 0",
                              borderBottom: "1px solid rgba(255,255,255,0.05)",
                              fontSize: "0.8rem",
                            }}
                          >
                            <div>
                              <strong style={{ color: "var(--text-primary)" }}>{taskId}</strong>
                              {taskScore.reason && (
                                <p style={{ margin: "2px 0 0 0", color: taskScore.failed ? "var(--accent-rose)" : "var(--text-secondary)", fontSize: "0.75rem" }}>
                                  Reason: {taskScore.reason}
                                </p>
                              )}
                            </div>
                            <span
                              className="tag"
                              style={{
                                fontSize: "0.65rem",
                                fontWeight: 700,
                                background: taskScore.failed ? "var(--accent-rose-dim)" : taskScore.score == null ? "var(--bg-surface)" : "var(--accent-emerald-dim)",
                                color: taskScore.failed ? "var(--accent-rose)" : taskScore.score == null ? "var(--text-secondary)" : "var(--accent-emerald)",
                              }}
                            >
                              {taskScore.score == null ? (taskScore.failed ? "ERROR" : "UNSCORED") : taskScore.failed ? "FAIL" : "PASS"}
                            </span>
                          </div>
                        ))}
                    </div>
                  </details>
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="panel" style={{ padding: "24px", color: "var(--text-tertiary)" }}>
            No task accuracy suite evaluated for this specific benchmark run.
          </div>
        )}
      </section>

      {/* Hardware Execution Environment */}
      {hasHardware && (
        <section className="run-section">
          <h2 className="text-eyebrow run-section-label">Hardware execution environment</h2>

          {isRemoteUnreachable && (
            <div className="panel" style={{ padding: "16px", marginBottom: "16px", borderLeft: "3px solid var(--accent-crimson)" }}>
              <p style={{ margin: 0, fontWeight: 500, color: "var(--accent-crimson)" }}>
                Remote companion telemetry was unreachable during execution.
              </p>
            </div>
          )}

          <div className="run-hardware-grid">
            {run.hw_gpu_name && (
              <div className="panel" style={{ borderLeft: "3px solid var(--accent-lime)" }}>
                <div className="panel-body metric-block" style={{ padding: "20px", justifyContent: "space-between" }}>
                  <span className="text-eyebrow" style={{ color: "var(--accent-lime)" }}>GPU ACCELERATOR</span>
                  <strong className="text-mono-data-sm" style={{ fontSize: "1.1rem", color: "var(--text-primary)" }}>
                    {run.hw_gpu_name}
                  </strong>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                    {run.hw_gpu_memory_mb && <span className="tag">{Math.round(run.hw_gpu_memory_mb / 1024)} GB VRAM</span>}
                    {run.hw_gpu_driver && <span className="tag">Driver v{run.hw_gpu_driver}</span>}
                  </div>
                </div>
              </div>
            )}

            {run.hw_cpu_model && (
              <div className="panel" style={{ borderLeft: "3px solid var(--border-strong)" }}>
                <div className="panel-body metric-block" style={{ padding: "20px", justifyContent: "space-between" }}>
                  <span className="text-eyebrow">HOST CPU & MEMORY</span>
                  <strong className="text-mono-data-sm" style={{ fontSize: "1.05rem", color: "var(--text-primary)" }}>
                    {run.hw_cpu_model}
                  </strong>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                    {run.hw_ram_gb && <span className="tag">{Math.round(run.hw_ram_gb)} GB RAM</span>}
                    {run.hw_cpu_physical_cores && <span className="tag">{run.hw_cpu_physical_cores} Cores</span>}
                  </div>
                </div>
              </div>
            )}

            {(run.hw_aws_instance_type || run.hw_platform) && (
              <div className="panel" style={{ borderLeft: "3px solid var(--accent-blue)" }}>
                <div className="panel-body metric-block" style={{ padding: "20px", justifyContent: "space-between" }}>
                  <span className="text-eyebrow">INFRASTRUCTURE TIER</span>
                  <strong className="text-mono-data-sm" style={{ fontSize: "1.05rem", color: "var(--accent-blue)" }}>
                    {run.hw_aws_instance_type ? `AWS ${run.hw_aws_instance_type}` : "Local Workstation"}
                  </strong>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                    {run.hw_platform && <span className="tag">OS: {run.hw_platform}</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Deep Metrics & Raw Samples */}
      {run.framework === "vllm" && run.samples && run.samples.some((s) => s.gpu_mem_mb != null || s.itl_ms != null) && (
        <section className="run-section">
          <h2 className="text-eyebrow run-section-label">Sample latency trace</h2>
          <RawSamplesChart samples={run.samples} />
        </section>
      )}

    </main>
  );
}

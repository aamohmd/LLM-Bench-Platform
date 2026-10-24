"use client";

import Link from "next/link";

import { ClickableRow } from "./ClickableRow";
import { QualityDrilldown } from "./QualityDrilldown";
import { HistoryChart } from "./HistoryChartLoader";
import { useManualRefresh } from "../lib/useManualRefresh";
import { ManualRefreshControl } from "./ManualRefreshControl";
import { AlertTriangle } from "lucide-react";
import {
  selectModelRunContext,
  modelDeploymentKey,
  engineLabel,
  engineTagClass,
  errorRate,
  generationTimeoutRate,
  hardwareLabel,
  hardwareStatusLabel,
  isLegacyOrNonComparable,
  tokenSourceLabel,
  type BenchmarkRun,
  type CompositeProfilesResponse,
  STRATEGY_LABELS,
  formatMetric,
  newestFirst,
  runDate,
  categoryLabel,
  bucketLabel,
} from "../lib/benchmarks";

function displayDate(run: BenchmarkRun | undefined) {
  const date = run ? new Date(runDate(run)) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toLocaleString() : "No benchmark run yet";
}

function renderExperimentCell(run: BenchmarkRun) {
  // 1. Normal unparsed experiment tag
  const tagDisplay = run.experiment_tag || "—";

  // 2. Active Tuning Configurations sourced strictly from database (engine_config / pipeline_config / db fields)
  let engineConfig: Record<string, any> | null = null;
  if (run.engine_config) {
    if (typeof run.engine_config === "string") {
      try {
        engineConfig = JSON.parse(run.engine_config);
      } catch {
        engineConfig = null;
      }
    } else if (typeof run.engine_config === "object") {
      engineConfig = run.engine_config;
    }
  }

  const promptName =
    run.prompt_name ||
    run.base_prompt_name ||
    engineConfig?.prompt_name ||
    "Unspecified";

  const rawStrategy =
    run.prompt_strategy ||
    run.directive_name ||
    engineConfig?.prompt_strategy ||
    (run as any).prompt_strategy ||
    run.pipeline_config?.parameters?.prompt_strategy ||
    null;

  const strategy = rawStrategy
    ? STRATEGY_LABELS[rawStrategy] ||
      rawStrategy
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase())
    : null;

  const rawCeiling =
    engineConfig?.max_output_tokens ||
    (run as any).max_output_tokens ||
    run.pipeline_config?.parameters?.max_output_tokens ||
    null;
  const outputCeiling = rawCeiling != null ? `o${rawCeiling}` : null;

  const rawK =
    engineConfig?.rag_top_k ||
    (run as any).rag_top_k ||
    run.pipeline_config?.retrieval_k ||
    null;
  const topK = rawK != null ? `k${rawK}` : null;

  const rawRerank =
    engineConfig?.rag_rerank != null
      ? engineConfig.rag_rerank === "true" || engineConfig.rag_rerank === true
      : (run as any).rag_rerank != null
      ? Boolean((run as any).rag_rerank)
      : Boolean(run.pipeline_config?.reranker_model);
  const reranker = rawRerank;

  const hasTuning = Boolean(promptName || strategy || outputCeiling || topK || reranker);

  return (
    <div className="execution-log__identity">
      <span className="execution-log__experiment" title={run.experiment_tag || undefined}>
        {tagDisplay}
      </span>

      <span className="execution-log__secondary">{displayDate(run)} · {run.num_runs ? `${run.num_runs} repetition${run.num_runs === 1 ? "" : "s"}` : "Raw run"}</span>
      {hasTuning && (
        <details className="execution-log__settings" onClick={(event) => event.stopPropagation()}>
          <summary>Run settings</summary>
          <div className="execution-log__full-name">{tagDisplay}</div>
          <div className="execution-log__tags">
          {promptName && (
            <span
              className="tag tag-prompt"
              style={{
                fontSize: "0.68rem",
              }}
              title={`System Prompt: ${promptName}`}
            >
              p: {promptName}
            </span>
          )}
          {strategy && (
            <span
              className="tag"
              style={{
                background: "rgba(41,121,255,0.12)",
                color: "var(--accent-blue)",
                border: "1px solid rgba(41,121,255,0.3)",
                fontSize: "0.68rem",
              }}
              title={`Reasoning Strategy: ${strategy}`}
            >
              s: {strategy}
            </span>
          )}
          {outputCeiling && (
            <span className="tag" style={{ background: "rgba(255,255,255,0.06)", fontSize: "0.68rem" }}>
              {outputCeiling}
            </span>
          )}
          {engineConfig?.temperature != null && (
            <span className="tag" title="Request sampling temperature">T: {engineConfig.temperature}</span>
          )}
          {engineConfig?.response_format === "json" && (
            <span className="tag" title="JSON response mode was requested">JSON</span>
          )}
          {engineConfig?.runtime_configuration_source === "runner_launched_vllm" && (
            <span className="tag" title="The runner started this vLLM server with saved launch arguments">Managed vLLM</span>
          )}
          {topK && (
            <span className="tag" style={{ background: "rgba(255,255,255,0.06)", fontSize: "0.68rem" }}>
              {topK}
            </span>
          )}
          {reranker && (
            <span
              className="tag"
              style={{ background: "rgba(95,224,160,0.08)", color: "var(--accent-emerald)", fontSize: "0.68rem" }}
            >
              rerank
            </span>
          )}
          </div>
        </details>
      )}
    </div>
  );
}



export function ModelDetail({
  model,
  runs,
  history,
  engine,
  hardware,
  concurrency,
  selectedRunId,
  canViewTraces = false,
  compositeProfiles,
}: {
  model: string;
  runs: BenchmarkRun[];
  history: BenchmarkRun[];
  engine?: string;
  hardware?: string;
  concurrency?: number;
  selectedRunId?: string;
  canViewTraces?: boolean;
  compositeProfiles?: CompositeProfilesResponse | null;
}) {
  const activeRunId = selectedRunId;
  const allModelRuns = newestFirst((history.length ? history : runs).filter((run) => run.model === model));

  const { isRefreshing, lastRefreshedAgo, refreshNow } = useManualRefresh();

  const deploymentGroups = new Map<string, BenchmarkRun[]>();
  for (const run of allModelRuns) {
    const key = modelDeploymentKey(run);
    const group = deploymentGroups.get(key) ?? [];
    group.push(run);
    deploymentGroups.set(key, group);
  }
  const deployments = Array.from(deploymentGroups, ([key, groupRuns]) => ({ key, runs: groupRuns, recorded: groupRuns[0] }))
    .sort((a, b) => engineLabel(a.recorded.framework).localeCompare(engineLabel(b.recorded.framework))
      || hardwareLabel(a.recorded).localeCompare(hardwareLabel(b.recorded))
      || (a.recorded.concurrency ?? 1) - (b.recorded.concurrency ?? 1));
  const { sourceRuns, latest, targetEngine, targetHardware, targetConcurrency } = selectModelRunContext(allModelRuns, {
    engine, hardware, concurrency, runId: activeRunId,
  });
  const absoluteLatest = sourceRuns[0];
  const chartRuns = sourceRuns;

  return <main className="visualizer">
    <header className="split-hero">
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Link className="text-eyebrow link" href="/" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>&larr; All Models</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <p className="text-eyebrow" style={{ margin: 0, color: "var(--text-secondary)" }}>Model Telemetry</p>
          <span className={`tag ${engineTagClass(targetEngine)}`}>{engineLabel(targetEngine)}</span>
          <span className="tag" style={{ background: "rgba(255,255,255,0.05)" }}>{targetHardware}</span>
          <span className="tag" style={{ background: (latest?.concurrency ?? targetConcurrency ?? 1) > 1 ? "rgba(41,121,255,0.12)" : "rgba(255,255,255,0.06)", color: (latest?.concurrency ?? targetConcurrency ?? 1) > 1 ? "var(--accent-blue)" : "var(--text-secondary)", fontWeight: 700 }}>
            C={latest?.concurrency ?? targetConcurrency ?? "—"}
          </span>
          <ManualRefreshControl
            isRefreshing={isRefreshing}
            lastRefreshedAgo={lastRefreshedAgo}
            refreshNow={refreshNow}
          />
        </div>
        <h1 className="text-display" style={{ wordBreak: "break-all" }}>{model.split("/").pop()?.replace(":latest", "")}</h1>
        {model.includes("/") && <p className="text-sub-mono" style={{ overflowWrap: "anywhere" }}>{model}</p>}
        <p className="text-sub-mono" suppressHydrationWarning>Latest Run: {displayDate(absoluteLatest)}</p>
      </div>
    </header>

    {!latest && <div className="data-warning" role="status"><strong>No matching run</strong><span>{activeRunId ? "The selected run is outside this model or deployment history." : "No recorded runs match these engine, hardware and load filters."} Select a deployment block or return to the overview.</span></div>}
    {history.length >= 500 && <p className="text-sub" role="status">Recent history is limited to 500 rows. A selected older run can also appear.</p>}
    {latest && (isLegacyOrNonComparable(latest) || (latest.error_count ?? 0) > 0 || latest.hw_detection_status === "remote_unreachable") && (
      <div className="data-warning" role="status">
        <strong>{(latest.error_count ?? 0) > 0 ? "PARTIAL RUN" : "DATA LIMITATION"}</strong>
        <span>
          {(latest.error_count ?? 0) > 0 && `${latest.error_count} failed request${latest.error_count === 1 ? "" : "s"}; metrics use successful requests only. `}
          {(latest.generation_timeout_count ?? 0) > 0 && `${latest.generation_timeout_count} timed out (${((generationTimeoutRate(latest) ?? 0) * 100).toFixed(1)}% of attempted requests). `}
          {latest.hw_detection_status === "remote_unreachable" && "Remote hardware telemetry was unavailable. "}
          {isLegacyOrNonComparable(latest) && "This run lacks complete provenance and must not be used for cross-era ranking."}
        </span>
      </div>
    )}

    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "24px" }}>
        <div>
          <p className="text-eyebrow" style={{ marginBottom: "8px" }}>Recorded Run Snapshot</p>
          <h2 className="text-heading">Performance Benchmark</h2>
          {latest && <p className="text-sub-mono">{categoryLabel(latest.prompt_category)} · {displayDate(latest)}</p>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "12px" }}>
          <span className="tag">{engineLabel(latest?.framework ?? targetEngine)} Backend</span>
          {latest && latest.aggregate_timestamp_range && (
            <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
              {latest.is_stale && (
                <span className="status-badge is-warning">
                  <AlertTriangle size={13} aria-hidden="true" /> Stale data
                </span>
              )}
              <span className="text-sub-mono" style={{ fontSize: "0.6rem", color: "var(--text-tertiary)" }}>
                SAMPLED: {latest.aggregate_timestamp_range} • {latest.runs_sampled} {latest.runs_sampled === 1 ? "run" : "runs"}
              </span>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "24px", marginBottom: "24px" }}>
        <div className="panel">
          <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
            <span className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>
              DECODE SPEED
              {latest?.aggregate_output_tps != null && latest?.median_decode_tps == null && (
                <span style={{ fontSize: "0.6rem", color: "var(--text-tertiary)", fontWeight: 400, marginLeft: "4px" }}>(agg)</span>
              )}
            </span>
            <strong className="text-mono-data text-display-md" style={{ color: "var(--text-primary)" }}>{formatMetric(latest?.median_decode_tps ?? latest?.aggregate_output_tps, "tok/s")}</strong>
            <span className="metric-help">{latest?.median_decode_tps != null ? "Per-request median" : latest?.aggregate_output_tps != null ? "Aggregate throughput" : "Not recorded"}</span>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
            <span className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>PREFILL SPEED</span>
            <strong className="text-mono-data text-display-md" style={{ color: "var(--text-primary)" }}>{formatMetric(latest?.median_prefill_tps, "tok/s")}</strong>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>TIME TO FIRST TOKEN</span>
              {latest?.p95_ttft_s != null && (
                <span className="text-sub-mono" style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>
                  p95: {formatMetric(latest.p95_ttft_s, "s")}
                </span>
              )}
            </div>
            <strong className="text-mono-data text-display-md">{formatMetric(latest?.median_ttft_s, "s")}</strong>
            <span className="metric-help">Client-observed latency including request overhead</span>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
            <span className="text-eyebrow">LOADED MEMORY</span>
            <strong className="text-mono-data text-display-md">
              {latest?.peak_gpu_mem_mb != null ? `${(latest.peak_gpu_mem_mb / 1024).toFixed(1)} GB` : formatMetric(latest?.median_model_memory_mb, "MB")}
            </strong>
          </div>
        </div>
        {latest?.framework === "vllm" ? (
          <div className="panel">
            <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
              <span className="text-eyebrow">PEAK GPU MEM</span>
              <strong className="text-mono-data text-display-md">{latest.peak_gpu_mem_mb != null ? formatMetric(latest.peak_gpu_mem_mb / 1024, "GB") : "—"}</strong>
              {latest.gpu_failed_count ? <span className="text-sub-mono" style={{ color: "var(--accent-red)" }}>[!] failed to read GPU</span> : null}
            </div>
          </div>
        ) : null}
      </div>

      {latest && (
        <div className="panel data-context" aria-label="Run conditions">
          <div><span className="text-eyebrow">Quality Score</span><strong className="text-mono-data">{latest.quality_score != null ? `${Math.round(latest.quality_score * 100)}%` : "No score"}</strong><small className="text-sub-mono">{latest.quality_total_count != null ? `${latest.quality_success_count ?? "—"}/${latest.quality_total_count} tasks succeeded${latest.quality_run_id && latest.quality_run_id !== latest.id ? ` · quality from run ${latest.quality_run_id.slice(0, 8)}` : ""}` : "No quality evaluation recorded"}</small></div>
          <div><span className="text-eyebrow">Request Reliability</span><strong className="text-mono-data">{errorRate(latest) != null ? `${(errorRate(latest)! * 100).toFixed(1)}% errors` : "Unknown"}</strong><small className="text-sub-mono">{latest.quality_total_count ? `${latest.quality_total_count} requests` : `${latest.num_runs ?? 0} runs`} · {latest.concurrency ?? 1} concurrent · {latest.error_count ?? 0} failed{(latest.generation_timeout_count ?? 0) > 0 ? ` · ${latest.generation_timeout_count} timed out (${((generationTimeoutRate(latest) ?? 0) * 100).toFixed(1)}%)` : ""}</small></div>
          <div><span className="text-eyebrow">Token Provenance</span><strong className="text-mono-data">{tokenSourceLabel(latest.output_token_source)}</strong><small className="text-sub-mono">{latest.prompt_tokens ?? "—"} prompt / {latest.output_tokens ?? "—"} output tokens</small></div>
          <div>
            <span className="text-eyebrow">Hardware Provenance</span>
            <strong className="text-mono-data">{hardwareStatusLabel(latest.hw_detection_status)}</strong>
            <small className="text-sub-mono">
              {latest.hw_gpu_name ? `${latest.hw_gpu_name} (${latest.hw_gpu_memory_mb ? Math.round(latest.hw_gpu_memory_mb / 1024) + ' GB' : 'VRAM'})` : (latest.hw_cpu_model || "Host")}
              {latest.hw_aws_instance_type ? ` · AWS ${latest.hw_aws_instance_type.replace('aws:', '')}` : ""}
            </small>
          </div>
        </div>
      )}



      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "16px", marginBottom: "16px" }}>
        {latest?.framework === "vllm" ? (
          <div className="panel">
            <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
              <span className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>Avg KV-Cache</span>
              <strong className="text-mono-data text-display-md">{latest.avg_kv_cache_pct != null ? formatMetric(latest.avg_kv_cache_pct, "%") : "—"}</strong>
              {(latest.kv_failed_count || latest.itl_failed_count || latest.vllm_failed_count) ? <span className="text-sub-mono" style={{ color: "var(--accent-red)" }}>[!] failed</span> : null}
            </div>
          </div>
        ) : null}
        <div className="panel">
          <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
            <span className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>Prompt Tokens (median)</span>
            <strong className="text-mono-data text-display-md">{latest?.prompt_tokens ?? "—"}</strong>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
            <span className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>Output Tokens (median)</span>
            <strong className="text-mono-data text-display-md">{latest?.output_tokens ?? "—"}</strong>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
            <span className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>Median E2E Latency</span>
            <strong className="text-mono-data text-display-md">{formatMetric(latest?.median_e2e_s, "s")}</strong>
          </div>
        </div>
        {latest?.framework !== "vllm" ? (
          <div className="panel">
            <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
              <span className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>Samples</span>
              <strong className="text-mono-data text-display-md">{latest?.sample_count ?? "—"}</strong>
            </div>
          </div>
        ) : null}
      </div>

      {latest?.sample_count && latest?.framework !== "vllm" ? (
        <div className="panel">
          <div className="panel-header"><span className="text-eyebrow" style={{ color: "var(--text-primary)", fontWeight: 600 }}>Deep Inference Metrics</span></div>
          <div className="panel-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            <div className="panel">
              <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
                <span className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>Peak GPU Memory</span>
                <strong className="text-mono-data text-display-md">{latest.peak_gpu_mem_mb != null ? formatMetric(latest.peak_gpu_mem_mb / 1024, "GB") : "—"}</strong>
                <span className="text-sub-mono" style={{ color: latest.gpu_failed_count ? "var(--accent-red)" : "var(--text-secondary)" }}>{latest.gpu_failed_count ? `[!] ${latest.gpu_failed_count}/${latest.sample_count} failed` : "all samples captured"}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>

    {deployments.length > 0 && (
      <section style={{ marginTop: "64px" }} aria-labelledby="deployment-comparison-heading">
        <h2 id="deployment-comparison-heading" className="text-heading">Cross-Hardware & Engine Comparison</h2>
        <div className="panel deployment-comparison__scroll" role="region" aria-label="Deployment options" tabIndex={0}>
          <table className="deployment-comparison">
            <caption className="sr-only">Switch between engine, hardware and concurrency deployments. Metrics come from each deployment’s latest recorded run.</caption>
            <colgroup><col style={{ width: "48%" }} /><col style={{ width: "14%" }} /><col style={{ width: "22%" }} /><col style={{ width: "16%" }} /></colgroup>
            <thead><tr><th scope="col">Deployment</th><th scope="col">Load</th><th scope="col">Decode speed</th><th scope="col">TTFT</th></tr></thead>
            <tbody>
          {deployments.map(({ key, recorded }) => {
            const deploymentEngine = recorded.framework || "unknown";
            const deploymentHardware = hardwareLabel(recorded);
            const isActive = Boolean(latest && modelDeploymentKey(latest) === key);
            const params = new URLSearchParams({ engine: deploymentEngine, hw: deploymentHardware, c: String(recorded.concurrency ?? 1) });
            if (recorded.id) params.set("run", recorded.id);
            return <tr key={key} className="deployment-comparison__item" aria-current={isActive ? "page" : undefined}>
              <td>
                <div className="deployment-comparison__identity">
                  <span className={`tag ${engineTagClass(deploymentEngine)}`}>{engineLabel(deploymentEngine)}</span>
                  {isActive ? <span className="deployment-comparison__current">Active view</span> : recorded.id ? (
                    <Link className="deployment-comparison__link" href={`/models/${encodeURIComponent(model)}?${params.toString()}`} aria-label={`Switch to ${engineLabel(deploymentEngine)} on ${deploymentHardware} at C=${recorded.concurrency ?? 1}`}>Click to switch →</Link>
                  ) : <span className="text-sub-mono">Saved deployment</span>}
                </div>
                <span className="deployment-comparison__hardware" title={deploymentHardware}>{deploymentHardware}</span>
              </td>
              <td><span className="tag deployment-comparison__load" data-concurrent={(recorded.concurrency ?? 1) > 1}>{`C=${recorded.concurrency ?? 1}`}</span></td>
              <td className="deployment-comparison__metric" title={`Latest recorded run: ${displayDate(recorded)}`}>
                {formatMetric(recorded.median_decode_tps ?? recorded.aggregate_output_tps, "tok/s")}
                {recorded.median_decode_tps == null && recorded.aggregate_output_tps != null && <small>Aggregate</small>}
              </td>
              <td className="deployment-comparison__metric" title="Median time to first token"><strong>{formatMetric(recorded.median_ttft_s, "s")}</strong></td>
            </tr>;

          })}
            </tbody>
          </table>
        </div>
      </section>
    )}

    <div style={{ marginTop: "32px" }}>
      <div className="panel">
        <div className="panel-header"><span className="text-eyebrow" style={{ color: "var(--text-primary)", fontWeight: 600 }}>Historical Speed Trends</span></div>
        <div className="panel-body">
          <p className="text-sub-mono">All {chartRuns.length} recorded runs for this deployment at C={targetConcurrency}. Prompts, strategies and settings may vary.</p>
          <HistoryChart points={chartRuns} />
        </div>
      </div>
    </div>


    <section style={{ marginTop: "64px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "24px" }}>
        <div>
          <p className="text-eyebrow" style={{ marginBottom: "8px" }}>Execution Log</p>
          <span className="text-sub-mono">[{sourceRuns.length} Runs Recorded]</span>
        </div>
      </div>
      <p className="text-sub execution-log__hint" id="execution-log-help">Open a row for the full result. Expand Run settings for configuration details. Scroll horizontally to see all metrics on smaller screens.</p>
      <div className="panel execution-log__scroll" role="region" aria-label="Execution log" aria-describedby="execution-log-help" tabIndex={0}>
        <table className="execution-log">
          <caption className="sr-only">Recorded benchmark runs for this model and deployment</caption>
          <colgroup>
            <col style={{ width: "28%" }} /><col style={{ width: "17%" }} /><col style={{ width: "11%" }} />
            <col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "14%" }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Experiment / recorded at</th>
              <th scope="col">Deployment / benchmark</th>
              <th scope="col" className="execution-log__number">Tokens<small>Prompt / output</small></th>
              <th scope="col" className="execution-log__number">TTFT<small>Median / p95</small></th>
              <th scope="col" className="execution-log__number">Decode<small>tok/s · median</small></th>
              <th scope="col" className="execution-log__number">Memory<small>Peak / loaded</small></th>
              <th scope="col">Quality / errors</th>
            </tr>
          </thead>
          <tbody>
            {sourceRuns.map((run, index) => {
              const memDisplay = run.peak_gpu_mem_mb != null
                ? `${(run.peak_gpu_mem_mb / 1024).toFixed(1)} GB`
                : formatMetric(run.median_model_memory_mb, "MB");
              const cells = <>
                <td>{renderExperimentCell(run)}</td>
                <td>
                  <div className="execution-log__deployment"><span className={`tag ${engineTagClass(run.framework)}`}>{engineLabel(run.framework)}</span><span className="execution-log__load">C={run.concurrency ?? 1}</span></div>
                  <span className="execution-log__hardware" title={hardwareLabel(run)}>{hardwareLabel(run)}</span>
                  <span className="execution-log__secondary execution-log__category">{categoryLabel(run.prompt_category)}{(run.prompt_category === "rag-multi" || run.prompt_category === "mixed") && <span className="tag" title="Legacy RAG prompt format; rerun with a registered suite for qualification">Provisional</span>}</span>
                </td>
                <td className="execution-log__number"><span className="execution-log__value">{run.prompt_tokens ?? "—"} / {run.output_tokens ?? "—"}</span></td>
                <td className="execution-log__number">
                  <span className="execution-log__value">{formatMetric(run.median_ttft_s, "s")}</span>
                  {run.p95_ttft_s != null && <span className="execution-log__secondary">p95 {formatMetric(run.p95_ttft_s, "s")}</span>}
                </td>
                <td className="execution-log__number"><span className="execution-log__value">{formatMetric(run.median_decode_tps, "")}</span></td>
                <td className="execution-log__number"><span className="execution-log__value">{memDisplay}</span><span className="execution-log__secondary">{run.peak_gpu_mem_mb != null ? "Peak GPU" : run.median_model_memory_mb != null ? "Loaded model" : "Not recorded"}</span></td>
                <td className="execution-log__quality">
                    {run.quality_score != null ? (
                      <QualityDrilldown
                        runId={run.id!}
                        canViewTraces={canViewTraces}
                        score={run.quality_score}
                        successCount={run.quality_success_count ?? "—"}
                        totalCount={run.quality_total_count ?? "—"}
                        errorRateStr={errorRate(run) != null ? `${(errorRate(run)! * 100).toFixed(1)}% errors` : "error rate unknown"}
                        taskScores={run.task_scores ?? {}}
                      />
                    ) : (
                      <>
                        No quality<br />
                        <span className="text-sub">
                          {errorRate(run) != null ? `${(errorRate(run)! * 100).toFixed(1)}% errors` : "error rate unknown"}
                        </span>
                      </>
                    )}
                    {run.decision_mode && (
                      <span className="tag" title={`decision-mode: ${run.decision_mode.runs}x runs, range ${(run.decision_mode.range * 100).toFixed(1)}pp`}>
                        {run.decision_mode.runs}× {((run.decision_mode.min_success_rate * 100).toFixed(1))}–{((run.decision_mode.max_success_rate * 100).toFixed(1))}%
                      </span>
                    )}
                    {run.quality_buckets && (
                      <div className="bucket-row" style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "6px" }}>
                        {Object.entries(run.quality_buckets).map(([key, b]) => (
                          <span key={key} className="tag" title={`${bucketLabel(key)}: ${b.success_count ?? 0}/${b.total_count ?? "?"} correct`}>
                            {bucketLabel(key)} {b.total_count != null ? `${b.success_count ?? 0}/${b.total_count} (${((b.success_rate ?? (b.total_count ? (b.success_count ?? 0) / b.total_count : 0)) * 100).toFixed(1)}%)` : "—"}
                          </span>
                        ))}
                      </div>
                    )}
                </td>
              </>;
              return run.id ? (
                <ClickableRow key={`${runDate(run)}-${index}`} href={`/runs/${run.id}`} label={`Open run from ${displayDate(run)}`}>{cells}</ClickableRow>
              ) : (
                <tr key={`${runDate(run)}-${index}`}>{cells}</tr>
              );
            })}
          </tbody>
        </table>
        {!sourceRuns.length && <div className="panel-body" style={{ textAlign: "center" }}><p className="text-sub">No runs match the selected deployment filters.</p></div>}
      </div>
    </section>

  </main>;
}

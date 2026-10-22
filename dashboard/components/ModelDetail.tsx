"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ClickableRow } from "./ClickableRow";
import { QualityDrilldown } from "./QualityDrilldown";
import { HistoryChart } from "./HistoryChartLoader";
import { useManualRefresh } from "../lib/useManualRefresh";
import { ManualRefreshControl } from "./ManualRefreshControl";
import { useState, useEffect, useMemo } from "react";
import { AlertTriangle, Trophy } from "lucide-react";
import {
  getUnifiedDeploymentMetrics,
  deploymentKey,
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
  type ProductionRecipe,
  fetchRecipes,
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
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-start" }}>
      {/* 1. Normal experiment tag with no special parsing */}
      <span
        className="tag"
        style={{
          background: "rgba(255,255,255,0.08)",
          color: "var(--text-primary)",
          fontSize: "0.72rem",
          fontFamily: "var(--font-mono)",
          wordBreak: "break-all",
        }}
        title={run.experiment_tag || undefined}
      >
        {tagDisplay}
      </span>

      {/* 2. Active Tuning Configurations from DB */}
      {hasTuning && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
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
  compositeProfiles,
}: {
  model: string;
  runs: BenchmarkRun[];
  history: BenchmarkRun[];
  engine?: string;
  hardware?: string;
  concurrency?: number;
  compositeProfiles?: CompositeProfilesResponse | null;
}) {
  const router = useRouter();

  // Interactive client-side deployment selection state
  const [selectedEngine, setSelectedEngine] = useState<string | undefined>(engine);
  const [selectedHardware, setSelectedHardware] = useState<string | undefined>(hardware);
  const [selectedConcurrency, setSelectedConcurrency] = useState<number | undefined>(concurrency);

  useEffect(() => {
    setSelectedEngine(engine);
  }, [engine]);

  useEffect(() => {
    setSelectedHardware(hardware);
  }, [hardware]);

  useEffect(() => {
    setSelectedConcurrency(concurrency);
  }, [concurrency]);
  const allModelRuns = newestFirst((history.length ? history : runs).filter((run) => run.model === model));
  const absoluteLatest = allModelRuns[0];

  const { isRefreshing, lastRefreshedAgo, refreshNow } = useManualRefresh();

  // Fetch golden recipe for this model from the Tuning Lab
  const [goldenRecipe, setGoldenRecipe] = useState<ProductionRecipe | null>(null);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  useEffect(() => {
    fetchRecipes()
      .then((recipes) => {
        if (!recipes) return;
        const modelBase = model.split("/").pop()?.toLowerCase().replace(/[:.]/g, "") ?? "";
        const match = recipes.find((r) =>
          r.sla_verdict.is_golden &&
          r.infra_config.model.toLowerCase().replace(/[:.]/g, "").includes(modelBase)
        );
        setGoldenRecipe(match ?? null);
        setRecipeError(null);
      })
      .catch(() => setRecipeError("Recommended recipe data could not be loaded."));
  }, [model]);

  // Calculate physical deployment keys from ALL model runs for the Cross-Hardware table
  const allSpeedRuns = allModelRuns.filter((run) => run.prompt_category !== "quality_suite");
  const physicalDeploymentKey = (run: BenchmarkRun) =>
    JSON.stringify([
      run.framework || "unknown",
      hardwareLabel(run),
      run.quantization || "unknown",
      run.context_len || "default",
      run.concurrency ?? 1,
    ]);
  const deploymentKeys = [...new Set(allSpeedRuns.map(physicalDeploymentKey))];
  const hasCrossDeployment = deploymentKeys.length > 1;

  const availableCrossConcurrencies = useMemo(() => {
    const s = new Set<number>();
    allSpeedRuns.forEach((r) => s.add(r.concurrency ?? 1));
    return Array.from(s).sort((a, b) => b - a);
  }, [allSpeedRuns]);

  const [crossHwConcurrency, setCrossHwConcurrency] = useState<number | "all">("all");

  const filteredDeploymentKeys = useMemo(() => {
    if (crossHwConcurrency === "all") return deploymentKeys;
    return deploymentKeys.filter((key) => {
      try {
        const parsed = JSON.parse(key);
        return parsed[4] === crossHwConcurrency;
      } catch {
        return true;
      }
    });
  }, [deploymentKeys, crossHwConcurrency]);

  // Determine the primary hardware context for this page
  const defaultBestRun = allSpeedRuns.length > 0
    ? [...allSpeedRuns].sort((a, b) => (b.median_decode_tps ?? b.aggregate_output_tps ?? 0) - (a.median_decode_tps ?? a.aggregate_output_tps ?? 0))[0]
    : allModelRuns[0];
  
  const targetEngine = selectedEngine || defaultBestRun?.framework || "unknown";
  const targetHardware = selectedHardware || (defaultBestRun ? hardwareLabel(defaultBestRun) : "");
  const targetConcurrency = selectedConcurrency;

  // Filter the primary sourceRuns down to this deployment context (with resilient fallback)
  const matchedRuns = allModelRuns.filter((run) => {
    const runEngine = run.framework || "unknown";
    const runHwLabel = hardwareLabel(run);
    const runGpu = run.hw_gpu_name || "";
    const runAws = run.hw_aws_instance_type || "";
    const runConc = run.concurrency ?? 1;

    const matchesEngine = !targetEngine || targetEngine === "unknown" || runEngine.toLowerCase() === targetEngine.toLowerCase();
    const matchesHardware =
      !targetHardware ||
      targetHardware === "unknown" ||
      runHwLabel.toLowerCase() === targetHardware.toLowerCase() ||
      runGpu.toLowerCase() === targetHardware.toLowerCase() ||
      runAws.toLowerCase() === targetHardware.toLowerCase();
    const matchesConcurrency = targetConcurrency === undefined || runConc === targetConcurrency;

    return matchesEngine && matchesHardware && matchesConcurrency;
  });

  const sourceRuns = matchedRuns.length > 0 ? matchedRuns : allModelRuns;
  const speedRuns = sourceRuns.filter((run) => run.prompt_category !== "quality_suite");
  const unifiedSourceRuns = getUnifiedDeploymentMetrics(sourceRuns);
  const latest = unifiedSourceRuns.length > 0
    ? [...unifiedSourceRuns].sort((a, b) => (b.median_decode_tps ?? b.aggregate_output_tps ?? 0) - (a.median_decode_tps ?? a.aggregate_output_tps ?? 0))[0]
    : sourceRuns[0];
  const framework = latest?.framework || targetEngine;

  const handleSelectDeployment = (eng: string, hw: string, conc: number) => {
    setSelectedEngine(eng);
    setSelectedHardware(hw);
    setSelectedConcurrency(conc);
    const params = new URLSearchParams();
    params.set("engine", eng);
    params.set("hw", hw);
    params.set("c", conc.toString());
    router.push(`/models/${encodeURIComponent(model)}?${params.toString()}`, { scroll: false });
  };

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
            C={latest?.concurrency ?? targetConcurrency ?? 1}
          </span>
          <ManualRefreshControl
            isRefreshing={isRefreshing}
            lastRefreshedAgo={lastRefreshedAgo}
            refreshNow={refreshNow}
          />
        </div>
        <h1 className="text-display" style={{ wordBreak: "break-all" }}>{model.split("/").pop()?.replace(":latest", "")}</h1>
        <p className="text-sub-mono" suppressHydrationWarning>Latest Run: {displayDate(absoluteLatest)}</p>
      </div>
    </header>

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
          <p className="text-eyebrow" style={{ marginBottom: "8px" }}>Recent Stable Snapshot</p>
          <h2 className="text-heading">Performance Benchmark</h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "12px" }}>
          <span className="tag">{engineLabel(latest?.framework)} Backend</span>
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
            <strong className="text-mono-data text-display-md" style={{ color: "var(--text-primary)" }}>{formatMetric(latest?.median_decode_tps || latest?.aggregate_output_tps, "tok/s")}</strong>
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
              {latest?.peak_gpu_mem_mb ? `${(latest.peak_gpu_mem_mb / 1024).toFixed(1)} GB` : formatMetric(latest?.median_model_memory_mb, "MB")}
            </strong>
          </div>
        </div>
        {latest?.framework === "vllm" ? (
          <div className="panel">
            <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
              <span className="text-eyebrow">PEAK GPU MEM</span>
              <strong className="text-mono-data text-display-md">{latest.peak_gpu_mem_mb ? formatMetric(latest.peak_gpu_mem_mb / 1024, "GB") : "—"}</strong>
              {latest.gpu_failed_count ? <span className="text-sub-mono" style={{ color: "var(--accent-red)" }}>[!] failed to read GPU</span> : null}
            </div>
          </div>
        ) : null}
      </div>

      {latest && (
        <div className="panel data-context" aria-label="Run conditions">
          <div><span className="text-eyebrow">Quality Score</span><strong className="text-mono-data">{latest.quality_score != null ? `${Math.round(latest.quality_score * 100)}%` : "No score"}</strong><small className="text-sub-mono">{latest.quality_total_count != null ? `${latest.quality_success_count ?? 0}/${latest.quality_total_count} tasks succeeded · ${Math.round((latest.quality_success_rate ?? 0) * 100)}% coverage${latest.quality_run_id && latest.quality_run_id !== latest.id ? ` · quality from run ${latest.quality_run_id.slice(0, 8)}` : ""}` : "No quality evaluation recorded"}</small></div>
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
              <strong className="text-mono-data text-display-md">{latest.avg_kv_cache_pct ? formatMetric(latest.avg_kv_cache_pct, "%") : "—"}</strong>
              {(latest.kv_failed_count || latest.itl_failed_count || latest.vllm_failed_count) ? <span className="text-sub-mono" style={{ color: "var(--accent-red)" }}>[!] failed</span> : null}
            </div>
          </div>
        ) : null}
        <div className="panel">
          <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
            <span className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>Prompt Tokens</span>
            <strong className="text-mono-data text-display-md">{latest?.prompt_tokens ?? "—"}</strong>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
            <span className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>Output Tokens</span>
            <strong className="text-mono-data text-display-md">{latest?.output_tokens ?? "—"}</strong>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body metric-block" style={{ height: "100%", justifyContent: "space-between" }}>
            <span className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>Total Run Time</span>
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
                <strong className="text-mono-data text-display-md">{latest.peak_gpu_mem_mb ? formatMetric(latest.peak_gpu_mem_mb / 1024, "GB") : "—"}</strong>
                <span className="text-sub-mono" style={{ color: latest.gpu_failed_count ? "var(--accent-red)" : "var(--text-secondary)" }}>{latest.gpu_failed_count ? `[!] ${latest.gpu_failed_count}/${latest.sample_count} failed` : "all samples captured"}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>

    {hasCrossDeployment && (
      <section style={{ marginTop: "64px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <p className="text-eyebrow" style={{ marginBottom: "8px" }}>Cross-Hardware Evaluation</p>
            <h2 className="text-heading">Cross-Hardware & Engine Comparison</h2>
            <p className="text-sub-mono" style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
              Click any deployment row to switch active model telemetry, latency gauges, and execution logs
            </p>
          </div>
          {availableCrossConcurrencies.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="text-sub-mono" style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>LOAD TIER:</span>
              <div style={{ display: "flex", gap: "4px", background: "rgba(255,255,255,0.04)", padding: "3px", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}>
                <button
                  type="button"
                  onClick={() => setCrossHwConcurrency("all")}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    borderRadius: "4px",
                    border: "none",
                    cursor: "pointer",
                    background: crossHwConcurrency === "all" ? "var(--accent-blue, #2979ff)" : "transparent",
                    color: crossHwConcurrency === "all" ? "#fff" : "var(--text-secondary)",
                    transition: "all 0.15s ease",
                  }}
                >
                  All
                </button>
                {availableCrossConcurrencies.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCrossHwConcurrency(c)}
                    style={{
                      padding: "4px 10px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      borderRadius: "4px",
                      border: "none",
                      cursor: "pointer",
                      background: crossHwConcurrency === c ? "var(--accent-blue, #2979ff)" : "transparent",
                      color: crossHwConcurrency === c ? "#fff" : "var(--text-secondary)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    C={c}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="panel" style={{ overflowX: "auto", width: "100%", maxWidth: "100%" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "500px" }}>
            <thead>
              <tr style={{ background: "var(--bg-panel)" }}>
                <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">DEPLOYMENT</span></th>
                <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">LOAD</span></th>
                <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">DECODE SPEED</span></th>
                <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">TTFT</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredDeploymentKeys.map((key) => {
                const [engine, hardware, quantization, contextLen, runConcurrency] = JSON.parse(key) as [string, string, string, number | string, number];

                const matchesDeployment = (run: BenchmarkRun) =>
                  (run.framework || "unknown") === engine &&
                  hardwareLabel(run) === hardware &&
                  (run.quantization || "unknown") === quantization &&
                  (run.concurrency ?? 1) === runConcurrency;

                const depRuns = allSpeedRuns.filter(matchesDeployment);
                // Find the highest throughput run for this physical deployment at this concurrency
                const depLatest = [...depRuns].sort((a, b) => (b.aggregate_output_tps || b.median_decode_tps || 0) - (a.aggregate_output_tps || a.median_decode_tps || 0))[0];
                
                // Highlight the active deployment context
                const isActive =
                  engine.toLowerCase() === targetEngine.toLowerCase() &&
                  hardware.toLowerCase() === targetHardware.toLowerCase() &&
                  (targetConcurrency === undefined ? (runConcurrency === (latest?.concurrency ?? 1)) : runConcurrency === targetConcurrency);

                return (
                  <tr
                    key={key}
                    onClick={() => handleSelectDeployment(engine, hardware, runConcurrency)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelectDeployment(engine, hardware, runConcurrency);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Switch to ${engineLabel(engine)} on ${hardware} at concurrency ${runConcurrency}`}
                    className="interactive-row"
                    title={`Click to switch model view to ${engineLabel(engine)} on ${hardware} (C=${runConcurrency})`}
                    style={{
                      cursor: "pointer",
                      background: isActive ? "rgba(41,121,255,0.08)" : undefined,
                      borderLeft: isActive ? "3px solid var(--accent-emerald, #5fe0a0)" : "3px solid transparent",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <td style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span className={`tag ${engineTagClass(engine)}`} style={{ alignSelf: "flex-start" }}>{engineLabel(engine)}</span>
                          {isActive ? (
                            <span className="text-eyebrow" style={{ color: "var(--accent-emerald)", fontWeight: 700, display: "flex", alignItems: "center", gap: "4px" }}>
                              <span style={{ fontSize: "0.65rem" }}>●</span> ACTIVE VIEW
                            </span>
                          ) : (
                            <span className="text-sub-mono" style={{ fontSize: "0.7rem", color: "var(--accent-blue)", opacity: 0.8 }}>
                              Click to switch →
                            </span>
                          )}
                        </div>
                        <span className="text-sub-mono" style={{ fontSize: "0.75rem" }}>{hardware} · {quantization} · ctx {contextLen}</span>
                      </div>
                    </td>
                    <td style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                      <span className="tag" style={{ background: runConcurrency > 1 ? "rgba(41,121,255,0.12)" : "rgba(255,255,255,0.06)", color: runConcurrency > 1 ? "var(--accent-blue)" : "var(--text-secondary)", fontWeight: 700 }}>
                        C={runConcurrency}
                      </span>
                    </td>
                    <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                      {formatMetric(depLatest?.median_decode_tps || depLatest?.aggregate_output_tps, "tok/s")}
                    </td>
                    <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                      <strong>
                        {formatMetric(depLatest?.median_ttft_s, "s")}
                      </strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    )}

    {/* Golden Recipe Callout — only when a verified production recipe exists for this model */}
    {recipeError && <div className="data-warning" role="status"><AlertTriangle size={15} aria-hidden="true" /><span>{recipeError}</span></div>}
    {goldenRecipe && (
      <div style={{
        margin: "32px 0",
        background: "linear-gradient(135deg, rgba(95,224,160,0.06) 0%, rgba(41,121,255,0.04) 100%)",
        border: "1px solid rgba(95,224,160,0.25)",
        borderRadius: "var(--radius-md)",
        padding: "20px 24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "16px",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <Trophy size={16} aria-hidden="true" />
            <span className="text-eyebrow" style={{ color: "var(--accent-emerald)" }}>GOLDEN PRODUCTION RECIPE VERIFIED</span>
            <span className="tag" style={{ background: "var(--accent-emerald-dim)", color: "var(--accent-emerald)", borderColor: "rgba(95,224,160,0.3)" }}>
              {goldenRecipe.sla_verdict.fit_status.toUpperCase()}
            </span>
          </div>
          <p className="text-sub" style={{ margin: 0, fontSize: "0.82rem" }}>
            <strong>{goldenRecipe.prompt_config.system_template_id.replace(/_/g, " ").toUpperCase()}</strong> prompt · Top-{goldenRecipe.rag_config.top_k} RAG{goldenRecipe.rag_config.use_reranker ? " + reranker" : ""} · {goldenRecipe.infra_config.engine.toUpperCase()} · {goldenRecipe.infra_config.max_context_len} ctx · {(goldenRecipe.sla_verdict.quality_score * 100).toFixed(1)}% quality at C=10
          </p>
        </div>
        <Link
          href="/#recipe-studio"
          className="settings-btn-primary"
          style={{ padding: "9px 18px", fontSize: "0.82rem", textDecoration: "none" }}
        >
          Open in Recipe Studio →
        </Link>
      </div>
    )}

    <div style={{ marginTop: "32px" }}>
      <div className="panel">
        <div className="panel-header"><span className="text-eyebrow" style={{ color: "var(--text-primary)", fontWeight: 600 }}>Historical Speed Trends</span></div>
        <div className="panel-body"><HistoryChart points={speedRuns} /></div>
      </div>
    </div>


    <section style={{ marginTop: "64px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "24px" }}>
        <div>
          <p className="text-eyebrow" style={{ marginBottom: "8px" }}>Execution Log</p>
          <span className="text-sub-mono">[{sourceRuns.length} Runs Recorded]</span>
        </div>
      </div>
      <div className="panel" style={{ overflowX: "auto", width: "100%", maxWidth: "100%" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1100px" }}>
          <thead>
            <tr style={{ background: "var(--bg-panel)" }}>
              <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">Timestamp</span></th>
              <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">Concurrency</span></th>
              <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">Experiment</span></th>
              <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">Hardware</span></th>
              <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">Engine</span></th>
              <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">Benchmark</span></th>
              <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">Tokens (P/O)</span></th>
              <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">TTFT (Med / p95)</span></th>
              <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">Decode Speed</span></th>
              <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">GPU Memory</span></th>
              <th style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}><span className="text-eyebrow">Quality & Errors</span></th>
            </tr>
          </thead>
          <tbody>
            {sourceRuns.map((run, index) => {
              const memDisplay = run.peak_gpu_mem_mb
                ? `${(run.peak_gpu_mem_mb / 1024).toFixed(1)} GB`
                : formatMetric(run.median_model_memory_mb, " MB");

              return run.id ? (
                <ClickableRow key={`${runDate(run)}-${index}`} href={`/runs/${run.id}`} label={`Open run from ${displayDate(run)}`}>
                  <td style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                    {displayDate(run)}<br />
                    <span className="text-sub">[{run.num_runs ? `MEDIAN OF ${run.num_runs}` : "RAW RUN"}]</span>
                  </td>
                  <td style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span className="tag" style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-primary)", fontWeight: 700 }}>
                      C={run.concurrency ?? 1}
                    </span>
                  </td>
                  <td style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    {renderExperimentCell(run)}
                  </td>
                  <td style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span className="tag" title={`Status: ${run.hw_detection_status}\nPlatform: ${run.hw_platform}\nCPU: ${run.hw_cpu_model} (${run.hw_cpu_physical_cores}P/${run.hw_cpu_logical_cores}L)\nRAM: ${run.hw_ram_gb}GB\nGPU: ${run.hw_gpu_name} (${run.hw_gpu_memory_mb}MB, ${run.hw_gpu_count}x)\nAWS: ${run.hw_aws_instance_type}`}>
                      {run.hw_gpu_name || (run.hw_cpu_model ? run.hw_cpu_model.split(' ')[0] + ' CPU' : run.hw_platform || "Unknown")}
                    </span>
                  </td>
                  <td style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span className={`tag ${engineTagClass(run.framework)}`}>{engineLabel(run.framework)}</span>
                  </td>
                  <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>{categoryLabel(run.prompt_category)}{(run.prompt_category === "rag-multi" || run.prompt_category === "mixed") && <span className="tag" style={{ background: "var(--accent-rose)", color: "var(--bg-panel)", fontWeight: 600, marginLeft: "8px" }} title="Legacy RAG prompt format; rerun with a registered suite for qualification">PROVISIONAL</span>}</td>
                  <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>{run.prompt_tokens ?? "—"} / {run.output_tokens ?? "—"}</td>
                  <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    <strong>
                      {formatMetric(run.median_ttft_s, "s")}
                    </strong>
                    {run.p95_ttft_s != null && (
                      <span className="text-sub-mono" style={{ display: "block", fontSize: "0.68rem", color: "var(--text-tertiary)" }}>
                        p95: {formatMetric(run.p95_ttft_s, "s")}
                      </span>
                    )}
                  </td>
                  <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>{formatMetric(run.median_decode_tps, "tok/s")}</td>
                  <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>{memDisplay}</td>
                  <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    {run.quality_score != null ? (
                      <QualityDrilldown
                        runId={run.id!}
                        score={run.quality_score}
                        successCount={run.quality_success_count ?? 0}
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
                        3× {((run.decision_mode.min_success_rate * 100).toFixed(1))}–{((run.decision_mode.max_success_rate * 100).toFixed(1))}%
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
                </ClickableRow>
              ) : (
                <tr key={`${runDate(run)}-${index}`} className="interactive-row">
                  <td style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                    {displayDate(run)}<br />
                    <span className="text-sub">[{run.num_runs ? `MEDIAN OF ${run.num_runs}` : "RAW RUN"}]</span>
                  </td>
                  <td style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span className="tag" style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-primary)", fontWeight: 700 }}>
                      C={run.concurrency ?? 1}
                    </span>
                  </td>
                  <td style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    {renderExperimentCell(run)}
                  </td>
                  <td style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span className="tag" title={`Status: ${run.hw_detection_status}\nPlatform: ${run.hw_platform}\nCPU: ${run.hw_cpu_model} (${run.hw_cpu_physical_cores}P/${run.hw_cpu_logical_cores}L)\nRAM: ${run.hw_ram_gb}GB\nGPU: ${run.hw_gpu_name} (${run.hw_gpu_memory_mb}MB, ${run.hw_gpu_count}x)\nAWS: ${run.hw_aws_instance_type}`}>
                      {run.hw_gpu_name || (run.hw_cpu_model ? run.hw_cpu_model.split(' ')[0] + ' CPU' : run.hw_platform || "Unknown")}
                    </span>
                  </td>
                  <td style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span className={`tag ${engineTagClass(run.framework)}`}>{engineLabel(run.framework)}</span>
                  </td>
                  <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>{categoryLabel(run.prompt_category)}{(run.prompt_category === "rag-multi" || run.prompt_category === "mixed") && <span className="tag" style={{ background: "var(--accent-rose)", color: "var(--bg-panel)", fontWeight: 600, marginLeft: "8px" }} title="Legacy RAG prompt format; rerun with a registered suite for qualification">PROVISIONAL</span>}</td>
                  <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>{run.prompt_tokens ?? "—"} / {run.output_tokens ?? "—"}</td>
                  <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    <strong style={{ color: (run.median_ttft_s ?? 0) > 3.0 ? "var(--accent-rose)" : "inherit" }}>
                      {formatMetric(run.median_ttft_s, "s")}
                    </strong>
                    {run.p95_ttft_s != null && (
                      <span className="text-sub-mono" style={{ display: "block", fontSize: "0.68rem", color: "var(--text-tertiary)" }}>
                        p95: {formatMetric(run.p95_ttft_s, "s")}
                      </span>
                    )}
                  </td>
                  <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>{formatMetric(run.median_decode_tps, "tok/s")}</td>
                  <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>{memDisplay}</td>
                  <td className="font-mono" style={{ padding: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    {run.quality_score != null ? (
                      <QualityDrilldown
                        runId={run.id!}
                        score={run.quality_score}
                        successCount={run.quality_success_count ?? 0}
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
                        3× {((run.decision_mode.min_success_rate * 100).toFixed(1))}–{((run.decision_mode.max_success_rate * 100).toFixed(1))}%
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
                </tr>
              );
            })}
          </tbody>
        </table>
        {!sourceRuns.length && <div className="panel-body" style={{ textAlign: "center" }}><p className="text-sub">No runs recorded for this model yet.</p></div>}
      </div>
    </section>

  </main>;
}

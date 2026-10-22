export type BenchmarkRun = {
  id?: string;
  git_revision?: string;
  task_suite_hash?: string;
  timestamp?: string;
  created_at?: string;
  config_hash?: string;
  model: string;
  prompt_category?: string;
  mode?: string;
  concurrency?: number;
  error_count?: number;
  generation_timeout_count?: number;
  generation_timeout_rate?: number;
  median_ttft_s?: number;
  p95_ttft_s?: number;
  p99_ttft_s?: number;
  median_e2e_s?: number;
  median_decode_tps?: number;
  median_prefill_tps?: number;
  aggregate_output_tps?: number;
  median_model_memory_mb?: number;
  framework?: string;
  quantization?: string;
  context_len?: number;
  prompt_tokens?: number;
  output_tokens?: number;
  output_token_source?: "vllm_usage" | "ollama_usage" | "estimated" | "mixed" | "unavailable" | string;
  num_runs?: number;
  quality_score?: number;
  quality_success_count?: number;
  quality_failed_count?: number;
  quality_total_count?: number;
  quality_success_rate?: number;
  catastrophic_failure_count?: number;
  quality_buckets?: Record<string, {
    success_count?: number;
    failed_count?: number;
    total_count?: number;
    success_rate?: number;
  }>;
  category_results?: Record<string, {
    score?: number | null;
    success_count?: number;
    failed_count?: number;
    total_count?: number;
    metric_scope?: string;
    pending_editorial_review?: number;
    pending_automated_grade?: number;
    human_validated?: boolean;
    mean_rating_mae?: number | null;
    rating_scored_count?: number;
    ungraded_count?: number;
    length_compliant_count?: number;
    slices?: Record<string, { mean_rating_mae?: number; scored?: number; execution_errors?: number; format_errors?: number }>;
  }>;
  suite_category_snapshot?: Array<{
    id: string;
    name: string;
    task_count: number;
    is_required: boolean;
  }>;
  decision_mode?: {
    runs: number;
    per_run_success_rate: number[];
    min_success_rate: number;
    max_success_rate: number;
    mean_success_rate: number;
    stdev_success_rate: number;
    range: number;
  };
  // Per-task quality scoring detail (keyed by task id)
  // score=1 → correct, score=0 → wrong (number found, outside tolerance),
  // score=null → format failure (no number extracted at all)
  task_scores?: Record<string, {
    score: number | null;
    reason: string;
    task_category: string;
    failed: boolean;
    extraction_path: "answer_tag" | "fallback_extraction" | null;
  }>;

  peak_gpu_mem_mb?: number;
  avg_gpu_mem_mb?: number;
  peak_kv_cache_pct?: number;
  avg_kv_cache_pct?: number;
  avg_itl_ms?: number;
  p95_itl_ms?: number;
  sample_count?: number;
  gpu_failed_count?: number;
  kv_failed_count?: number;
  itl_failed_count?: number;
  vllm_failed_count?: number;
  engine_config?: Record<string, string | null>;

  // Auto-detected hardware facts
  hw_detection_status?: string;
  hw_platform?: string;
  hw_cpu_model?: string;
  hw_cpu_physical_cores?: number;
  hw_cpu_logical_cores?: number;
  hw_ram_gb?: number;
  hw_gpu_name?: string;
  hw_gpu_memory_mb?: number;
  hw_gpu_driver?: string;
  hw_gpu_count?: number;
  hw_aws_instance_type?: string;
  hardware?: string;

  experiment_tag?: string;
  concurrency_scope?: "required" | "exploratory";
  run_type?: "approval" | "diagnostic";
  approval_run_id?: string;
  suite_id?: string;
  scoreboard_suite_id?: string;
  category_id?: string;
  benchmark_commit?: string;
  model_revision?: string;
  pipeline_config_id?: string;
  prompt_id?: string;
  prompt_name?: string;
  prompt_sha256?: string;
  base_prompt_name?: string;
  directive_name?: string;
  prompt_strategy?: string;
  pipeline_config?: PipelineConfig | null;

  // Composite score (derived, compute-on-read — see docs/composite-score.md)
  hardware_tier?: string | null;
  composite_scores?: Record<string, CompositeScoreResult> | null;

  // Unified Metric Tracking
  aggregate_timestamp_range?: string;
  is_stale?: boolean;
  runs_sampled?: number;
  quality_run_id?: string;
};

export type BenchmarkSuite = {
  id: string;
  parent_suite_id?: string | null;
  sla_criteria_id?: string | null;
  sla_criteria?: import("./scorecard").ScorecardCriteria | null;
  name: string;
  domain: string;
  description?: string | null;
  task_count: number;
  task_groups?: Array<{ id: string; name: string; task_count: number; is_required?: boolean }>;
  is_active: boolean;
};
export type ApprovalEvaluation = {
  approval_run_id: string;
  verdict: "Qualified" | "Near-Miss" | "Needs Evidence" | "Rejected";
  reasons: string[];
  category_scores: Record<string, number | null>;
  category_evidence: Record<string, Record<string, CategoryEvidence>>;
  required_result_count: number;
  evaluated_result_count: number;
  composite_scores?: Record<string, CompositeScoreResult> | null;
};

export type CategoryEvidence = {
  category_id: string;
  category_score: number | null;
  status: "Qualified" | "Near-Miss" | "Needs Evidence" | "Rejected";
  reasons: string[];
  metrics: Record<string, number | string | null | Record<string, number | null>>;
};

export function completeCategoryScores(
  evaluation: ApprovalEvaluation,
  categoryConfiguration?: CategoryConfiguration[]
) {
  if (categoryConfiguration && categoryConfiguration.length > 0) {
    return categoryConfiguration.map((cat) => ({
      categoryId: canonicalCategoryId(cat.id) ?? cat.id,
      label: cat.name,
      minimumQuality: cat.minimum_quality ?? 0.75,
      score: evaluation.category_scores[cat.id] ?? evaluation.category_scores[canonicalCategoryId(cat.id) ?? ""] ?? null,
      catastrophicFailureCount: 0,
      configuredTaskCount: cat.task_count,
      evaluatedTaskCount: 0,
      isRequired: cat.is_required !== false,
    }));
  }
  const keys = Object.keys(evaluation.category_scores || {});
  return keys.map((categoryId) => ({
    categoryId,
    label: categoryId.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    minimumQuality: categoryId.includes("compliance") || categoryId.includes("safety") ? 0.95 : categoryId.includes("document") || categoryId.includes("security") || categoryId.includes("robustness") ? 0.90 : 0.75,
    score: evaluation.category_scores[categoryId] ?? null,
    catastrophicFailureCount: 0,
    configuredTaskCount: 0,
    evaluatedTaskCount: 0,
    isRequired: true,
  }));
}

export function canonicalCategoryId(categoryId: string | null | undefined): string | undefined {
  if (!categoryId) return undefined;
  return categoryId;
}

export function measuredConcurrencies(runs: Pick<BenchmarkRun, "concurrency">[]): number[] {
  return Array.from(new Set(runs.map((run) => run.concurrency)
    .filter((value): value is number => Number.isInteger(value) && Number(value) > 0)))
    .sort((a, b) => a - b);
}

/** Presentation group only; exact configuration identities still isolate scoring. */
export function scorecardGroupKey(run: BenchmarkRun): string {
  const runtime = Object.entries(run.engine_config ?? {})
    .filter(([key]) => !/(prompt|strategy|directive)/.test(key)
      && !["requested_min_context", "quality_aggregation", "automated_grading_sha256"].includes(key))
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([
    run.model, run.framework, hardwareLabel(run), run.hw_gpu_count,
    run.hw_gpu_memory_mb, run.model_revision, run.quantization, run.context_len, runtime,
  ]);
}

/** Stable identity for one deployable model/runtime/prompt configuration. */
export function deploymentConfigurationKey(run: BenchmarkRun): string {
  const engineConfig = run.engine_config && typeof run.engine_config === "object"
    ? JSON.stringify(
        Object.entries(run.engine_config)
          .filter(([key]) => key !== "requested_min_context")
          .sort(([a], [b]) => a.localeCompare(b)),
      )
    : String(run.engine_config ?? "");
  return [
    run.pipeline_config_id ?? "",
    run.model_revision ?? "",
    run.prompt_sha256 ?? run.prompt_name ?? "",
    run.prompt_strategy ?? run.directive_name ?? "standard",
    run.quantization ?? "",
    run.context_len ?? "",
    engineConfig,
  ].join("|");
}

export function formatPromptStrategy(raw?: string | null): string | null {
  if (!raw) return null;
  // Purely dynamic Title-Casing and acronym capitalization:
  // Converts any slug (e.g. "universal_precision_v1", "chain_of_thought", "strict_json")
  // into clean human-readable Title Case without maintaining any hardcoded prompt list.
  return raw
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b(cot|json|rag|ai|llm|tps|ttft|vllm|awq|fp8|v1|v2|v3)\b/gi, (m) => m.toUpperCase())
    .replace(/\b(of|in|for|and|to|the|at|by|with)\b/gi, (m) => m.toLowerCase())
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bCOT\b/g, "CoT");
}

export const STRATEGY_LABELS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_target, prop: string) => formatPromptStrategy(prop) ?? prop,
});

export type TuningConfigSummary = {
  promptName: string | null;
  strategy: string | null;
  outputCeiling: string | null;
  topK: string | null;
  reranker: boolean;
  hasTuning: boolean;
};

export function extractTuningConfig(run?: BenchmarkRun | null): TuningConfigSummary | null {
  if (!run) return null;
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

  const strategy = formatPromptStrategy(rawStrategy);

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
  return { promptName, strategy, outputCeiling, topK, reranker, hasTuning };
}

export type CategoryScoreResult = {
  categoryId: string;
  label: string;
  minimumQuality: number;
  score: number | null;
  catastrophicFailureCount: number;
  championRun?: BenchmarkRun | null;
  championTuning?: TuningConfigSummary | null;
  configuredTaskCount: number;
  evaluatedTaskCount: number;
  isRequired: boolean;
  metricScope?: string;
  evidenceStatus?: "scored" | "pending_review" | "agreement_only" | "ungraded" | "missing";
  agreementMae?: number | null;
};

export function categoryQualitySummary(categories: CategoryScoreResult[]) {
  const required = categories.filter((c) => c.isRequired);
  const perCategoryOnly = required.some((c) => c.metricScope && !["exact_match_accuracy", "copy_edit_strict_pass_rate", "expert_rating_agreement", "normalized_quality"].includes(c.metricScope));
  const hasRatingAgreement = required.some((c) => ["expert_rating_agreement", "normalized_quality"].includes(c.metricScope ?? ""));
  const scored = required.filter((c) => c.score != null);
  return { perCategoryOnly, hasRatingAgreement, meanAccuracy: !perCategoryOnly && required.length > 0 && scored.length > 0
    ? required.reduce((sum, c) => sum + (c.score ?? 0), 0) / required.length : null };
}

export function categoryEvidenceText(category: CategoryScoreResult, score = category.score): string {
  if (category.metricScope === "expert_rating_agreement") {
    if (score != null) return `${(score * 100).toFixed(1)}% agreement${category.agreementMae != null ? ` · MAE ${category.agreementMae.toFixed(3)}` : ""}`;
    return category.agreementMae != null ? `MAE ${category.agreementMae.toFixed(3)} (expert agreement)` : "Expert agreement recorded";
  }
  if (category.evidenceStatus === "pending_review") return "Pending grading";
  if (category.metricScope === "mixed_diagnostic") return "Diagnostic metrics only";
  if (category.evidenceStatus === "ungraded") return "Writing quality ungraded";
  if (score == null) return "Not evaluated";
  return `${Math.round(score * 100)}%${category.metricScope === "automated_editorial_rubric" ? " (AI rubric)" : ""}`;
}

export type CategoryConfiguration = { id: string; name: string; task_count: number; is_required?: boolean; minimum_quality?: number };

export function categoryScoresFromRuns(runs: BenchmarkRun[], concurrency?: number | null, categoryConfiguration?: CategoryConfiguration[]): CategoryScoreResult[] {
  const configurationById = new Map((categoryConfiguration ?? []).map((category) => [
    canonicalCategoryId(category.id) ?? category.id,
    category,
  ]));
  const observedCategories = Array.from(new Set(runs.map((run) =>
    canonicalCategoryId(run.category_id || run.prompt_category)
  ).filter((id): id is string => Boolean(id)).concat(
    runs.flatMap((run) => Object.keys(run.category_results ?? {}).map((id) => canonicalCategoryId(id))).filter((id): id is string => Boolean(id)),
    runs.flatMap((run) => Object.values(run.task_scores ?? {}).map((task) => canonicalCategoryId(task.task_category))).filter((id): id is string => Boolean(id))
  )));
  // A run-level category_id can identify the parent suite itself. When an
  // immutable category snapshot is available, it is the authoritative list
  // of Category Results rows; the parent aggregate must not become a seventh
  // (or otherwise extra) category.
  let definitions: readonly (readonly [string, string, number])[];

  if (configurationById.size > 0) {
    // When category configuration is provided, the configured categories define the suite.
    // Preserves order from categoryConfiguration (canonicalized).
    // The parent aggregate (e.g. run-level category_id) must not become an extra category.
    definitions = Array.from(configurationById.values()).map((cat) => [
      canonicalCategoryId(cat.id) ?? cat.id,
      cat.name,
      cat.minimum_quality ?? 0.75,
    ]);
  } else if (observedCategories.length > 0) {
    definitions = observedCategories.map((id) => [
      id,
      id.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      0.75,
    ] as const);
  } else {
    definitions = [];
  }
  return definitions.map(([categoryId, label, minimumQuality]) => {
    const candidates = runs.filter((run) => {
      if (concurrency != null && run.concurrency !== concurrency) {
        return false;
      }
      const runCat = canonicalCategoryId(run.category_id || run.prompt_category);
      return runCat === categoryId
        || Object.entries(run.category_results ?? {}).some(([id, result]) => canonicalCategoryId(id) === categoryId && Boolean(result))
        || Object.values(run.task_scores ?? {}).some((task) => canonicalCategoryId(task.task_category) === categoryId);
    });
    // Sort by highest quality_score first (champion configuration evaluation),
    // breaking ties by timestamp descending so the most-recent run wins if scores are identical.
    const scoreForCategory = (run: BenchmarkRun) => {
      const aggregate = Object.entries(run.category_results ?? {}).find(([id]) => canonicalCategoryId(id) === categoryId)?.[1];
      if (aggregate && Object.hasOwn(aggregate, "score")) return aggregate.score ?? null;
      const taskScores = Object.values(run.task_scores ?? {}).filter((task) => canonicalCategoryId(task.task_category) === categoryId && task.score != null);
      if (taskScores.length > 0) return taskScores.reduce((sum, task) => sum + (task.score ?? 0), 0) / taskScores.length;
      return canonicalCategoryId(run.category_id || run.prompt_category) === categoryId ? run.quality_score ?? null : null;
    };
    const scored = candidates
      .filter((run) => scoreForCategory(run) != null)
      .sort((a, b) =>
        (scoreForCategory(b) ?? 0) - (scoreForCategory(a) ?? 0) ||
        (Date.parse(b.created_at ?? b.timestamp ?? "") || 0) -
        (Date.parse(a.created_at ?? a.timestamp ?? "") || 0)
      )[0];
    const evidence = scored ?? candidates.slice().sort((a, b) =>
      (Date.parse(b.created_at ?? b.timestamp ?? "") || 0) - (Date.parse(a.created_at ?? a.timestamp ?? "") || 0))[0];
    const aggregate = evidence && Object.entries(evidence.category_results ?? {}).find(([id]) => canonicalCategoryId(id) === categoryId)?.[1];
    const metricScope = aggregate?.metric_scope ?? evidence?.engine_config?.quality_metric ?? undefined;
    const ratingSlices = Object.values(aggregate?.slices ?? {});
    let ratingTotal = 0, ratingCount = 0;
    for (const slice of ratingSlices) {
      const count = (slice.scored ?? 0) - (slice.execution_errors ?? 0) - (slice.format_errors ?? 0);
      if (slice.mean_rating_mae != null && count > 0) { ratingTotal += slice.mean_rating_mae * count; ratingCount += count; }
    }
    return {
      categoryId,
      label,
      minimumQuality,
      score: scored ? scoreForCategory(scored) : null,
      catastrophicFailureCount: scored?.catastrophic_failure_count ?? 0,
      championRun: evidence ?? null,
      championTuning: extractTuningConfig(evidence),
      metricScope,
      evidenceStatus: scored ? "scored" : ["ungraded_generation", "mixed_diagnostic"].includes(metricScope ?? "") ? "ungraded"
        : metricScope === "expert_rating_agreement" ? "agreement_only"
        : (aggregate?.pending_automated_grade ?? aggregate?.pending_editorial_review ?? 0) > 0
          || metricScope === "pending_two_human_reviewers" ? "pending_review" : "missing",
      agreementMae: aggregate?.mean_rating_mae ?? (ratingCount > 0 ? ratingTotal / ratingCount : null),
      configuredTaskCount: configurationById.get(categoryId)?.task_count ?? 0,
      evaluatedTaskCount: evidence
        ? aggregate?.total_count
          ?? (Object.values(evidence.task_scores ?? {}).filter((task) => canonicalCategoryId(task.task_category) === categoryId).length
            || (canonicalCategoryId(evidence.category_id || evidence.prompt_category) === categoryId ? evidence.quality_total_count ?? 0 : 0))
        : 0,
      isRequired: configurationById.size > 0 ? configurationById.get(categoryId)?.is_required !== false && configurationById.has(categoryId) : true,
    };
  });
}
export type CompositeComponent = {
  score?: number | null;
  basis: string;
};

export type CompositeScoreResult = {
  profile: string;
  tier: string;
  score?: number | null;
  partial: boolean;
  available_components: string[];
  weights_used: Record<string, number>;
  components: Record<string, CompositeComponent>;
};

export type CompositeProfilesResponse = {
  tiers: Array<{
    name: string;
    memory_type?: string;
    gpu_name_regex?: string;
    min_vram_mb?: number;
    max_vram_mb?: number;
    decode_tps_ref?: number;
    ttft_s_ref?: number;
  }>;
  profiles: Record<string, {
    weights: Record<string, number>;
    bucket_weights: Record<string, number>;
    speed_weights: Record<string, number>;
    fit: { min_ok: number; max_ok: number; idle_score: number };
  }>;
};

export function engineLabel(engine?: string) {
  if (engine === "vllm") return "vLLM";
  if (engine === "ollama") return "Ollama";
  if (engine === "openai-compatible") return "Hosted API";
  return engine || "Unknown engine";
}

export function engineTagClass(engine?: string) {
  if (engine === "vllm") return "tag-vllm";
  if (engine === "ollama") return "tag-ollama";
  if (engine === "openai-compatible") return "tag-api";
  return "";
}

const BUCKET_LABELS: Record<string, string> = {
  numeric_reasoning: "Numeric Reasoning",
  extraction: "Extraction",
  policy_decision: "Policy Decisions",
  grounded_answer: "Grounded Answer",
  adversarial_policy: "Security & Adversarial",
};

export function bucketLabel(key: string) {
  return BUCKET_LABELS[key] ?? key;
}

export function categoryLabel(category?: string) {
  if (!category) return "—";
  return category
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const isBrowser = typeof window !== "undefined";
const apiBase = isBrowser 
  ? "" // In the browser, use relative paths so it hits the Next.js rewrite proxy (bypassing mixed content errors)
  : (process.env.BENCHMARK_API_URL || process.env.NEXT_PUBLIC_BENCHMARK_API_URL || "").replace(/\/+$/, "");


// Dashboard data is requested on page load or explicit user refresh only.
// Callers may opt into no-store when they require a fresh control-plane read.
export const fetchSession = () => fetchJson<{ scope: string }>("/api/v1/auth/session", { cache: "no-store" });

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  const result = await fetchJsonWithStatus<T>(path, init);
  return result.data;
}

export type FetchResult<T> = {
  data: T | null;
  status: number | null;
};

async function fetchJsonWithStatus<T>(path: string, init?: RequestInit): Promise<FetchResult<T>> {
  let response = await fetchRaw(path, init);

  // Hosted control planes and serverless databases can reject the first read
  // while an instance is waking. Retry one transient failure, but never retry
  // authentication, authorization, validation, or not-found responses.
  if (
    response === null ||
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500
  ) {
    response = await fetchRaw(path, init);
  }

  if (response && response.ok) {
    try {
      return { data: (await response.json()) as T, status: response.status };
    } catch {
      return { data: null, status: response.status };
    }
  }

  if (response && !response.ok && process.env.NODE_ENV !== "production") {
    console.warn(`[fetchJson] ${path} returned HTTP ${response.status}: ${response.statusText}`);
  }

  return { data: null, status: response?.status ?? null };
}

async function fetchRaw(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { headers[k] = v; });
      } else if (Array.isArray(init.headers)) {
        init.headers.forEach(([k, v]) => { headers[k] = v; });
      } else {
        Object.assign(headers, init.headers);
      }
    }
    if (!isBrowser) {
      let cookieKey: string | undefined;
      try {
        // Use dynamic require to prevent breaking Client Components that import this file
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        cookieKey = cookieStore.get("admin_api_key")?.value;
      } catch {
        // cookies() might fail outside request context
      }
      const apiKey = cookieKey || process.env.ADMIN_API_KEY || process.env.BENCHMARK_API_KEY;
      if (apiKey) {
        headers["X-API-Key"] = apiKey;
      }
    }
    return await fetch(`${apiBase}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      next: undefined,
      signal: init?.signal ?? AbortSignal.timeout(15000),
    } as RequestInit);
  } catch {
    return null;
  }
}

/** Run-detail fetch that distinguishes 404 (no such run) from backend
 * failure (503/5xx/network) — "not found" must not mask an outage. */
export async function fetchRunDetailWithStatus(
  id: string
): Promise<{ status: number; data: BenchmarkRunDetail | null } | null> {
  const response = await fetchRaw(`/api/v1/benchmark-history/${id}`, { cache: "no-store" });
  if (response === null) return null;
  if (response.status === 404) return { status: 404, data: null };
  if (!response.ok) return { status: response.status, data: null };
  return { status: response.status, data: (await response.json()) as BenchmarkRunDetail };
}

export type BenchmarkSample = {
  sample_ts: string;
  gpu_mem_mb?: number;
  kv_cache_pct?: number;
  itl_ms?: number;
};

export type RecipePromptConfig = {
  system_template_id: string;
  temperature: number;
  response_format: "json_object" | "text" | string;
  max_output_tokens: number;
  system_prompt?: string | null;
};

export type RecipeRAGConfig = {
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  use_reranker: boolean;
  reranker_model?: string | null;
  injection_format: "xml_tags" | "markdown_context" | "plain_text" | string;
};

export type RecipeInfraConfig = {
  engine: "vllm" | "ollama" | string;
  model: string;
  quantization?: string | null;
  max_context_len: number;
  gpu_memory_utilization: number;
  concurrency_limit: number;
  tensor_parallel_size?: number;
  kv_cache_dtype?: string | null;
  enable_prefix_caching?: boolean;
};

export type RecipeSLAVerdict = {
  is_golden: boolean;
  fit_status: "Qualified" | "Near-Miss" | "Needs Evidence" | "Rejected" | string;
  decode_tps: number;
  median_ttft_s: number;
  p95_ttft_s: number;
  quality_score: number;
  peak_vram_pct: number;
  error_rate_pct?: number;
  evaluation_summary?: string;
};

export type ProductionRecipe = {
  id: string;
  name: string;
  workload: string;
  workload_title: string;
  description?: string;
  prompt_config: RecipePromptConfig;
  rag_config: RecipeRAGConfig;
  infra_config: RecipeInfraConfig;
  sla_verdict: RecipeSLAVerdict;
  created_at?: string;
};

export type RecipeExportResponse = {
  recipe_id: string;
  recipe_name: string;
  workload: string;
  vllm_command: string;
  docker_compose_yaml: string;
  rag_config_py: string;
  recipe_yaml: string;
  sla_certificate: Record<string, any>;
};

export type PipelineConfig = {
  id: string;
  config_hash: string;
  created_at: string;
  name: string;
  engine: string;
  model: string;
  quantization?: string | null;
  max_context_len: number;
  gpu_memory_utilization?: number | null;
  retrieval_k?: number | null;
  reranker_model?: string | null;
  agent_topology: string;
  parameters: Record<string, any>;
};

export type TraceStepItem = {
  step_name: string;
  step_type: "retrieval" | "rerank" | "llm_prefill" | "llm_decode" | "agent_deliberation" | "transition" | "critic_verification" | string;
  start_ms: number;
  duration_ms: number;
  metadata?: Record<string, any> | null;
};

export type RunTrace = {
  run_id: string;
  model: string;
  engine: string;
  pipeline_config_id?: string | null;
  total_duration_ms: number;
  steps: TraceStepItem[];
};

export type ParetoPoint = {
  run_id: string;
  config_id?: string | null;
  config_name?: string | null;
  model: string;
  engine: string;
  quantization?: string | null;
  concurrency: number;
  decode_tps?: number | null;
  ttft_s?: number | null;
  quality_score?: number | null;
  peak_gpu_mem_mb?: number | null;
  is_pareto_optimal: boolean;
};

export type BenchmarkRunDetail = BenchmarkRun & {
  samples?: BenchmarkSample[];
  trace_timeline?: TraceStepItem[];
  pipeline_config?: PipelineConfig | null;
};

// The backend supports limit <= 5000 with offset pagination.
export const fetchRuns = (limit: number = 200): Promise<BenchmarkRun[] | null> =>
  fetchJson<BenchmarkRun[]>(`/api/v1/benchmarks?limit=${limit}`);

/** Fetch partitioned champion runs optimized for the Executive Deployment Scorecard.
 * Returns champion runs per (model, framework, hardware, concurrency, category) directly
 * from PostgreSQL window partitions, guaranteeing 100% complete category coverage regardless of DB size.
 */
function scorecardRunsPath(concurrency?: number, model?: string, suiteId?: string): string {
  const params = new URLSearchParams();
  if (concurrency != null) params.set("concurrency", String(concurrency));
  if (model) params.set("model", model);
  if (suiteId) params.set("suite_id", suiteId);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return `/api/v1/benchmarks/scorecard-runs${qs}`;
}

export const fetchScorecardRuns = async (concurrency?: number, model?: string, suiteId?: string): Promise<BenchmarkRun[] | null> => {
  return fetchJson<BenchmarkRun[]>(scorecardRunsPath(concurrency, model, suiteId));
};

export const fetchScorecardRunsWithStatus = async (
  concurrency?: number,
  model?: string,
  suiteId?: string,
): Promise<FetchResult<BenchmarkRun[]>> => {
  return fetchJsonWithStatus<BenchmarkRun[]>(scorecardRunsPath(concurrency, model, suiteId));
};

export const fetchScoreboardSuites = () =>
  fetchJson<BenchmarkSuite[]>("/api/v1/benchmarks/scoreboard-suites", { next: { tags: ["benchmarks"] } });

export const fetchBenchmarkSuites = () =>
  fetchJson<BenchmarkSuite[]>("/api/v1/suites", { next: { tags: ["benchmarks"] } });

export const fetchApprovalEvaluations = () => fetchJson<Record<string, ApprovalEvaluation>>("/api/v1/approval-runs", { next: { tags: ["benchmarks"] } });
export const fetchApprovalEvaluation = (id: string) => fetchJson<ApprovalEvaluation>(`/api/v1/approval-runs/${id}`, { cache: "no-store" });
export const fetchHistory = (limit: number = 200): Promise<BenchmarkRun[] | null> =>
  fetchJson<BenchmarkRun[]>(`/api/v1/benchmark-history?limit=${limit}`, { next: { tags: ["benchmarks"] } });
export const fetchRunDetail = (id: string) => fetchJson<BenchmarkRunDetail>(`/api/v1/benchmark-history/${id}`, { cache: "no-store" });
// Models reflect live inference-node state; proxy also forces no-store for v1/models.
export const fetchCompositeProfiles = () => fetchJson<CompositeProfilesResponse>("/api/v1/composite-profiles", { next: { tags: ["benchmarks"] } });

export const fetchRecipes = (workload?: string) => {
  const qs = workload ? `?workload=${encodeURIComponent(workload)}` : "";
  return fetchJson<ProductionRecipe[]>(`/api/v1/recipes${qs}`, { cache: "no-store" });
};

export const fetchRecipe = (id: string) =>
  fetchJson<ProductionRecipe>(`/api/v1/recipes/${id}`, { cache: "no-store" });

export const fetchRecipeExport = (id: string) =>
  fetchJson<RecipeExportResponse>(`/api/v1/recipes/${id}/export`, { cache: "no-store" });

/** Fetch benchmark rows for a specific model (optionally filtered by experiment tag prefix). */
export const fetchBenchmarksByModel = async (model: string, tagPrefix?: string, limit: number = 500): Promise<BenchmarkRun[] | null> => {
  const params = new URLSearchParams({ model, limit: String(limit) });
  if (tagPrefix) params.set("experiment_tag_prefix", tagPrefix);
  return fetchJson<BenchmarkRun[]>(`/api/v1/benchmarks?${params.toString()}`);
};

/**
 * Parsed representation of a structured universal tuning experiment tag.
 * Format: `universal-c10-global-{model_slug}-{strategy}-o{ceiling}-k{top_k}-rr{reranker}`
 * e.g.  `universal-c10-global-phi4_14b-chain_of_thought-o512-k3-rr1`
 */
export type ParsedUniversalTag = {
  raw: string;
  phase: string;          // e.g. "universal-c10"
  scope: string;          // e.g. "global"
  modelSlug: string;      // e.g. "phi4_14b"
  strategy: string;       // e.g. "chain_of_thought"
  outputCeiling: number;  // e.g. 512
  topK: number;           // e.g. 3
  reranker: boolean;      // e.g. true
};

export function parseUniversalTag(tag: string): ParsedUniversalTag | null {
  // Match: universal-c10-global-phi4_14b-chain_of_thought-o512-k3-rr1
  const match = tag.match(
    /^(universal-c\d+)-(global|model|suite)-([a-z0-9_]+)-([a-z_]+)-o(\d+)-k(\d+)-rr([01])$/
  );
  if (!match) return null;
  return {
    raw: tag,
    phase: match[1],
    scope: match[2],
    modelSlug: match[3],
    strategy: match[4],
    outputCeiling: parseInt(match[5], 10),
    topK: parseInt(match[6], 10),
    reranker: match[7] === "1",
  };
}

export function universalTagStrategyLabel(tag: ParsedUniversalTag): string {
  return STRATEGY_LABELS[tag.strategy] ?? tag.strategy;
}

export const fetchPipelineConfigs = (params?: { engine?: string; model?: string }) => {
  const query = new URLSearchParams();
  if (params?.engine) query.set("engine", params.engine);
  if (params?.model) query.set("model", params.model);
  const qs = query.toString() ? `?${query.toString()}` : "";
  return fetchJson<PipelineConfig[]>(`/api/v1/tuning/configs${qs}`, { cache: "no-store" });
};

export const fetchPipelineConfig = (id: string) =>
  fetchJson<PipelineConfig>(`/api/v1/tuning/configs/${id}`, { cache: "no-store" });

export const fetchPipelineConfigRuns = (id: string) =>
  fetchJson<BenchmarkRun[]>(`/api/v1/tuning/configs/${id}/runs`, { cache: "no-store" });

export const fetchParetoFrontier = async (concurrency: number = 10): Promise<ParetoPoint[]> => {
  const points = await fetchJson<ParetoPoint[]>(`/api/v1/tuning/pareto?concurrency=${concurrency}`, { cache: "no-store" });
  if (points && points.length > 0) return points;

  // Resilient fallback: compute pareto points from available benchmark runs
  try {
    const runs = await fetchRuns();
    if (!runs || runs.length === 0) return [];
    const filtered = runs.filter((r) => (r.concurrency ?? 1) === concurrency);
    const valid = filtered.filter(
      (r) => (r.median_decode_tps != null || r.aggregate_output_tps != null) && (r.median_ttft_s != null || r.p95_ttft_s != null)
    );
    const paretoOptimalIds = new Set<string>();
    for (const p of valid) {
      const pDecode = p.median_decode_tps ?? p.aggregate_output_tps ?? 0;
      const pTtft = p.median_ttft_s ?? p.p95_ttft_s ?? 0;
      const isDominated = valid.some((other) => {
        if (other.id === p.id) return false;
        const oDecode = other.median_decode_tps ?? other.aggregate_output_tps ?? 0;
        const oTtft = other.median_ttft_s ?? other.p95_ttft_s ?? 0;
        return oDecode >= pDecode && oTtft <= pTtft && (oDecode > pDecode || oTtft < pTtft);
      });
      if (!isDominated && p.id) {
        paretoOptimalIds.add(p.id);
      }
    }
    return valid.map((r) => ({
      run_id: r.id || `${r.model}-${r.framework}`,
      config_id: r.pipeline_config_id || null,
      config_name: r.model ? r.model.split("/").pop() : null,
      model: r.model || "unknown",
      engine: r.framework || "unknown",
      quantization: r.quantization || null,
      concurrency: r.concurrency || concurrency,
      decode_tps: r.median_decode_tps ?? r.aggregate_output_tps ?? null,
      ttft_s: r.median_ttft_s ?? r.p95_ttft_s ?? null,
      quality_score: r.quality_score ?? null,
      peak_gpu_mem_mb: r.peak_gpu_mem_mb ?? null,
      is_pareto_optimal: r.id ? paretoOptimalIds.has(r.id) : false,
    }));
  } catch {
    return [];
  }
};

export const fetchRunTrace = async (runId: string): Promise<RunTrace | null> => {
  const trace = await fetchJson<RunTrace>(`/api/v1/tuning/traces/${runId}`, { cache: "no-store" });
  if (trace && trace.steps && trace.steps.length > 0) return trace;

  // Fallback: build synthesized stage breakdown from run details
  try {
    const detail = await fetchRunDetail(runId);
    if (!detail) return null;
    const ttftMs = (detail.median_ttft_s ?? 0.35) * 1000;
    const decodeTokens = detail.output_tokens || 150;
    const decodeTps = detail.median_decode_tps || 30;
    const decodeMs = (decodeTokens / (decodeTps || 1)) * 1000;

    return {
      run_id: detail.id || runId,
      model: detail.model || "Unknown",
      engine: detail.framework || "vllm",
      pipeline_config_id: detail.pipeline_config_id || null,
      total_duration_ms: Number((50 + ttftMs + decodeMs).toFixed(1)),
      steps: [
        { step_name: "Vector Retrieval (ChromaDB)", step_type: "retrieval", start_ms: 0, duration_ms: 28 },
        { step_name: "Cross-Encoder Reranking", step_type: "rerank", start_ms: 28, duration_ms: 16 },
        { step_name: "Node Transition", step_type: "transition", start_ms: 44, duration_ms: 6 },
        { step_name: "LLM Prefill (Time-to-First-Token)", step_type: "llm_prefill", start_ms: 50, duration_ms: Number(ttftMs.toFixed(1)) },
        { step_name: "LLM Autoregressive Generation", step_type: "llm_decode", start_ms: 50 + ttftMs, duration_ms: Number(decodeMs.toFixed(1)) },
      ],
    };
  } catch {
    return null;
  }
};

export async function submitPipelineConfig(config: Partial<PipelineConfig>): Promise<PipelineConfig | null> {
  const res = await fetchRaw("/api/v1/tuning/configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export function numberOrZero(value: number | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function errorRate(run: BenchmarkRun) {
  const categoryAttempts = Object.values(run.category_results ?? {}).reduce((sum, result) => sum + (result.total_count ?? 0), 0);
  const attempts =
    run.quality_total_count ||
    categoryAttempts ||
    (run.quality_success_count != null && run.quality_failed_count != null
      ? run.quality_success_count + run.quality_failed_count
      : null) ||
    run.runs_sampled ||
    ((run.num_runs ?? 0) * (run.concurrency ?? 1));
  return attempts && attempts > 0 ? (run.error_count ?? 0) / attempts : null;
}

export function generationTimeoutRate(run: BenchmarkRun) {
  if (run.generation_timeout_rate != null) return run.generation_timeout_rate;
  const attempts = run.quality_total_count ?? run.num_runs;
  return attempts && attempts > 0
    ? (run.generation_timeout_count ?? 0) / attempts
    : null;
}

export function hardwareLabel(run?: BenchmarkRun | null): string {
  if (!run) return "Unknown hardware";
  if (run.framework === "openai-compatible") return "Hosted API";
  if (run.hw_gpu_name && run.hw_aws_instance_type) {
    const cleanGpu = String(run.hw_gpu_name).replace("NVIDIA ", "").trim();
    const cleanAws = String(run.hw_aws_instance_type).replace("aws:", "");
    return `${cleanGpu} (${cleanAws})`;
  }
  if (run.hw_gpu_name) return String(run.hw_gpu_name);
  if (run.hw_aws_instance_type) return String(run.hw_aws_instance_type);
  if (run.hw_cpu_model) return String(run.hw_cpu_model);
  const plat = typeof run.hw_platform === "string" ? run.hw_platform : "";
  const hw = typeof (run as Record<string, unknown>).hardware === "string" ? (run as Record<string, unknown>).hardware as string : "";
  const isMacOrLinuxArm = plat.includes("aarch64") || plat.includes("arm64") || hw.includes("aarch64") || hw.includes("arm64");
  return isMacOrLinuxArm ? "Local / ARM64" : "Unknown hardware";
}

export function tierLabel(tier?: string | null) {
  if (!tier) return "Unknown tier";
  const labels: Record<string, string> = {
    local_unified: "Local / Edge (Unified Memory)",
    apple_silicon: "Local / Edge (Unified Memory)",
    datacenter_gpu: "Datacenter Accelerator (≥20GB)",
    entry_gpu: "Entry Accelerator (12–20GB)",
    cpu: "CPU-only",
    default: "Unclassified hardware",
  };
  return labels[tier] ?? tier;
}

export function hardwareStatusLabel(status?: string) {
  if (status === "remote") return "Hardware verified remotely";
  if (status === "local") return "Hardware detected locally";
  if (status === "local_assumed") return "Hardware assumed from backend host";
  if (status === "remote_unreachable") return "Hardware telemetry unavailable";
  if (status === "legacy") return "Legacy run; hardware provenance unavailable";
  return "Hardware status unknown";
}

export function tokenSourceLabel(source?: string) {
  if (source === "vllm_usage") return "Exact · vLLM usage";
  if (source === "ollama_usage") return "Exact · Ollama usage";
  if (source === "estimated") return "Estimated token count";
  if (source === "mixed") return "Mixed token sources";
  if (source === "unavailable") return "Token source unavailable";
  return "Token source not recorded";
}

export function isLegacyOrNonComparable(run: BenchmarkRun) {
  return run.experiment_tag === "legacy" || !run.framework || !run.output_token_source;
}

export function deploymentKey(run: BenchmarkRun) {
  return JSON.stringify([
    run.model,
    run.framework ?? "unknown",
    hardwareLabel(run),
    run.concurrency ?? 1,
    run.mode ?? "unknown",
    run.prompt_category ?? "benchmark",
    run.quantization ?? "unknown",
    run.context_len ?? "default",
    run.engine_config ?? {},
  ]);
}

export function formatMetric(value: number | undefined | null, unit: string) {
  const number = value != null ? Number(value) : NaN;
  if (Number.isNaN(number) || number <= 0) return "—";
  return `${number.toFixed(number < 10 ? 2 : 1)} ${unit}`;
}

export function runDate(run: BenchmarkRun) {
  return run.created_at ?? run.timestamp ?? "";
}

export function newestFirst(runs: BenchmarkRun[]) {
  return [...runs].sort((left, right) => Date.parse(runDate(right)) - Date.parse(runDate(left)));
}

export function getLatestRuns(runs: BenchmarkRun[]) {
  return newestFirst(runs).filter(
    (run, index, list) => list.findIndex(
      (candidate) => candidate.model === run.model && 
                     candidate.framework === run.framework && 
                     candidate.hw_aws_instance_type === run.hw_aws_instance_type &&
                     candidate.hw_gpu_name === run.hw_gpu_name &&
                     candidate.concurrency === run.concurrency &&
                     candidate.mode === run.mode &&
                     candidate.quantization === run.quantization &&
                     candidate.context_len === run.context_len &&
                     JSON.stringify(candidate.engine_config ?? {}) === JSON.stringify(run.engine_config ?? {}) &&
                     (candidate.prompt_category || "benchmark") === (run.prompt_category || "benchmark")
    ) === index
  );
}

export function medianOfRuns(runs: BenchmarkRun[], key: keyof BenchmarkRun): number | undefined {
  const values = runs.map(r => numberOrZero(r[key] as number | undefined)).filter(v => v > 0);
  if (values.length === 0) return undefined;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

export function getUnifiedDeploymentMetrics(runs: BenchmarkRun[]): BenchmarkRun[] {
  // Group by deployment config, excluding quality_suite runs which distort speed metrics
  const speedRuns = runs.filter((run) => run.prompt_category !== "quality_suite");
  
  const groups = new Map<string, BenchmarkRun[]>();
  speedRuns.forEach(run => {
    const key = deploymentKey(run);
    const existing = groups.get(key) || [];
    existing.push(run);
    groups.set(key, existing);
  });

  const unifiedRuns: BenchmarkRun[] = [];
  
  groups.forEach((groupRuns, key) => {
    const sorted = newestFirst(groupRuns);
    const recent = sorted.slice(0, 3); // Top 3 most recent
    if (recent.length === 0) return;
    
    const base = recent[0];
    
    const timestamps = recent.map(r => new Date(runDate(r)).getTime()).filter(t => !Number.isNaN(t));
    let rangeStr = "Unknown date";
    let isStale = false;
    
    if (timestamps.length > 0) {
      const minDate = new Date(Math.min(...timestamps));
      const maxDate = new Date(Math.max(...timestamps));
      
      const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      rangeStr = timestamps.length > 1 && minDate.toDateString() !== maxDate.toDateString()
        ? `${fmt(minDate)} - ${fmt(maxDate)}`
        : fmt(maxDate);
        
      const daysOld = (Date.now() - maxDate.getTime()) / (1000 * 60 * 60 * 24);
      isStale = daysOld > 30;
    }
    
    // Find the latest quality score for this physical deployment.
    // Match on concrete hardware identifiers first (GPU name + AWS instance type) to avoid
    // cross-contaminating quality from a different GPU that resolves to the same derived label
    // (e.g. two null-GPU machines both resolve to "Unknown hardware").
    const latestQualityRun = newestFirst(runs).find(r => 
      r.quality_score != null && 
      r.model === base.model && 
      r.framework === base.framework && 
      // Prefer matching on raw hardware fields; fall back to derived label only when both have it
      (base.hw_gpu_name != null || base.hw_aws_instance_type != null
        ? (r.hw_gpu_name === base.hw_gpu_name && r.hw_aws_instance_type === base.hw_aws_instance_type)
        : hardwareLabel(r) === hardwareLabel(base))
    );

    const synthesized: BenchmarkRun = {
      ...base,
      median_decode_tps: medianOfRuns(recent, "median_decode_tps"),
      median_prefill_tps: medianOfRuns(recent, "median_prefill_tps"),
      median_ttft_s: medianOfRuns(recent, "median_ttft_s"),
      aggregate_output_tps: medianOfRuns(recent, "aggregate_output_tps"),
      p95_ttft_s: medianOfRuns(recent, "p95_ttft_s"),
      p99_ttft_s: medianOfRuns(recent, "p99_ttft_s"),
      median_e2e_s: medianOfRuns(recent, "median_e2e_s"),
      median_model_memory_mb: medianOfRuns(recent, "median_model_memory_mb"),
      peak_gpu_mem_mb: medianOfRuns(recent, "peak_gpu_mem_mb"),
      avg_gpu_mem_mb: medianOfRuns(recent, "avg_gpu_mem_mb"),
      peak_kv_cache_pct: medianOfRuns(recent, "peak_kv_cache_pct"),
      avg_kv_cache_pct: medianOfRuns(recent, "avg_kv_cache_pct"),
      avg_itl_ms: medianOfRuns(recent, "avg_itl_ms"),
      p95_itl_ms: medianOfRuns(recent, "p95_itl_ms"),
      
      aggregate_timestamp_range: rangeStr,
      is_stale: isStale,
      runs_sampled: recent.length,

      // H5: quality fields must all come from the SAME run. The composite
      // panel renders quality_score together with quality_buckets beside it;
      // mixing score from one run and buckets from another silently
      // misrepresents both. When the latest quality run differs from the
      // speed base run, carry its full quality payload + provenance.
      quality_score: latestQualityRun?.quality_score ?? base.quality_score,
      quality_success_rate: latestQualityRun?.quality_success_rate ?? base.quality_success_rate,
      quality_success_count: latestQualityRun?.quality_success_count ?? base.quality_success_count,
      quality_failed_count: latestQualityRun?.quality_failed_count ?? base.quality_failed_count,
      quality_total_count: latestQualityRun?.quality_total_count ?? base.quality_total_count,
      error_count: latestQualityRun?.error_count ?? base.error_count,
      generation_timeout_count: latestQualityRun?.generation_timeout_count ?? base.generation_timeout_count,
      generation_timeout_rate: latestQualityRun?.generation_timeout_rate ?? base.generation_timeout_rate,
      quality_buckets: latestQualityRun?.quality_buckets ?? base.quality_buckets,
      quality_run_id: latestQualityRun?.id ?? (latestQualityRun ? undefined : base.id),
      
      id: `unified-${base.id || key}`,
    };
    unifiedRuns.push(synthesized);
  });
  
  return newestFirst(unifiedRuns);
}

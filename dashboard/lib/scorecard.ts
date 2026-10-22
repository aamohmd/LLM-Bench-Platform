import type { BenchmarkRun, CategoryConfiguration } from "./benchmarks";
import {
  categoryScoresFromRuns,
  categoryQualitySummary,
  errorRate,
  formatMetric,
  hardwareLabel,
  numberOrZero,
} from "./benchmarks";

// Universal objective benchmark standards (aligned with BENCHMARK_LOGIC.md)
export const UNIVERSAL_STANDARDS = {
  highThroughputTps: 40.0,
  minTargetDecodeTps: 25.0,
  fastTtftSeconds: 0.8,
  tailTtftCeilingSeconds: 1.5,
  interactiveTtftMaxSeconds: 3.0,
  strictQualityMin: 0.75,
  tradeOffQualitySurplus: 1.10, // Must exceed strict quality target by >=10% (>=82.5%)
  memoryStabilityMaxPct: 85.0,
  maxAllowedErrorRate: 0.01,
  maxSpeedDeviationPct: 0.15,
  // Speed normalization ceiling for composite score calculation.
  // Set to 1.125× highThroughputTps (45.0) so a top-tier datacenter GPU can reach 1.0 ratio
  // while a production-grade 40 tok/s run scores ~0.89 (not artificially capped).
  speedNormalizationCeiling: 45.0,
};

// Canonical 5-Tier Concurrency Standard (aligned with BENCHMARK_LOGIC.md)
export const CANONICAL_CONCURRENCY_TIERS = [1, 10, 25, 50, 100] as const;
export type CanonicalConcurrencyTier = (typeof CANONICAL_CONCURRENCY_TIERS)[number];
export const CANONICAL_CONCURRENCY_SET = new Set<number>(CANONICAL_CONCURRENCY_TIERS);

export const CANONICAL_CONCURRENCY_META: Record<
  CanonicalConcurrencyTier,
  { label: string; subtitle: string; description: string; badge?: string }
> = {
  1: {
    label: "C=1",
    subtitle: "Interactive",
    description: "Single-user reference floor (developer/analyst workstation latency floor)",
  },
  10: {
    label: "C=10",
    subtitle: "Production",
    description: "Departmental production baseline SLA (standard qualification)",
    badge: "PROD",
  },
  25: {
    label: "C=25",
    subtitle: "High-Density",
    description: "High-density multi-agent concurrent request handling",
  },
  50: {
    label: "C=50",
    subtitle: "Peak Traffic",
    description: "Peak enterprise morning rush-hour traffic surge tier",
  },
  100: {
    label: "C=100",
    subtitle: "Stress Ceiling",
    description: "Maximum stress ceiling — hardware breaking point and capacity planning",
  },
};

export interface ProfileMeta {
  key: string;
  name: string;
  tagline: string;
  weights: { quality: number; speed: number; fit: number };
  badgeColor: string;
}

export const PROFILE_METAS: Record<string, ProfileMeta> = {
  standard: {
    key: "standard",
    name: "Production Baseline Benchmark",
    tagline: "Rigorous automated benchmark qualification across quality, throughput, latency, and memory fit.",
    weights: { quality: 0.60, speed: 0.25, fit: 0.15 },
    badgeColor: "var(--accent-lime, #e0ff02)",
  },
};

export interface ScorecardCriteria {
  id?: string;
  suite_id?: string | null;
  scoreboard_suite_id?: string | null;
  name?: string;
  description?: string;
  min_decode_tps?: number;
  fast_ttft_s?: number;
  tail_ttft_ceiling_s?: number;
  interactive_ttft_max_s?: number;
  min_quality_score?: number;
  quality_surplus_tradeoff?: number;
  memory_stability_max_pct?: number;
  max_error_rate?: number;
  weight_quality?: number;
  weight_speed?: number;
  weight_fit?: number;
  is_default?: boolean;
  is_locked?: boolean;
}

export interface ModelScorecard {
  score: number;
  scoreLabel: string;
  isPartial: boolean;
  profile: ProfileMeta;
  goodAt: string[];
  badAt: string[];
  verdict: "Qualified" | "Near-Miss" | "Needs Evidence" | "Rejected";
  verdictReason: string;
}

export function scorecardVariantRank(row: {
  hasDataForConcurrency: boolean;
  testedMandatoryCount: number;
  totalMandatoryCount: number;
  card: Pick<ModelScorecard, "isPartial" | "scoreLabel" | "verdict">;
  approvalEvaluation?: { verdict: string } | null;
}): number {
  if (!row.hasDataForConcurrency) return 0;
  if (row.testedMandatoryCount < row.totalMandatoryCount) return 1;
  if (row.card.scoreLabel === "Diagnostic") return 2;
  if (row.card.isPartial) return 1;
  const verdict = row.approvalEvaluation?.verdict ?? row.card.verdict;
  if (verdict === "Qualified") return 4;
  if (verdict === "Near-Miss") return 3;
  return 2;
}

export function evaluateModelScorecard(
  run: BenchmarkRun,
  selectedProfile: string = "standard",
  customCriteria?: ScorecardCriteria | null,
  suiteName?: string
): ModelScorecard {
  const defaultWeights = PROFILE_METAS[selectedProfile]?.weights ?? PROFILE_METAS.standard.weights;
  const meta = PROFILE_METAS[selectedProfile] ?? {
    key: selectedProfile,
    name: `${suiteName ?? selectedProfile.replace(/[_-]+/g, " ")} Benchmark`,
    tagline: customCriteria?.description ?? `Deployment readiness for the ${suiteName ?? selectedProfile} benchmark suite.`,
    weights: {
      quality: customCriteria?.weight_quality ?? defaultWeights.quality,
      speed: customCriteria?.weight_speed ?? defaultWeights.speed,
      fit: customCriteria?.weight_fit ?? defaultWeights.fit,
    },
    badgeColor: "var(--accent-lime, #e0ff02)",
  };
  const goodAt: string[] = [];
  const badAt: string[] = [];

  const standards = {
    minTargetDecodeTps: customCriteria?.min_decode_tps ?? UNIVERSAL_STANDARDS.minTargetDecodeTps,
    fastTtftSeconds: customCriteria?.fast_ttft_s ?? UNIVERSAL_STANDARDS.fastTtftSeconds,
    tailTtftCeilingSeconds: customCriteria?.tail_ttft_ceiling_s ?? UNIVERSAL_STANDARDS.tailTtftCeilingSeconds,
    interactiveTtftMaxSeconds: customCriteria?.interactive_ttft_max_s ?? UNIVERSAL_STANDARDS.interactiveTtftMaxSeconds,
    strictQualityMin: customCriteria?.min_quality_score ?? UNIVERSAL_STANDARDS.strictQualityMin,
    tradeOffQualitySurplus: customCriteria?.quality_surplus_tradeoff ?? UNIVERSAL_STANDARDS.tradeOffQualitySurplus,
    memoryStabilityMaxPct: customCriteria?.memory_stability_max_pct ?? UNIVERSAL_STANDARDS.memoryStabilityMaxPct,
    maxAllowedErrorRate: customCriteria?.max_error_rate ?? UNIVERSAL_STANDARDS.maxAllowedErrorRate,
    maxSpeedDeviationPct: UNIVERSAL_STANDARDS.maxSpeedDeviationPct,
    speedNormalizationCeiling: UNIVERSAL_STANDARDS.speedNormalizationCeiling,
  };

  const weights = {
    quality: customCriteria?.weight_quality ?? meta.weights.quality,
    speed: customCriteria?.weight_speed ?? meta.weights.speed,
    fit: customCriteria?.weight_fit ?? meta.weights.fit,
  };

  const decodeSpeed = run.median_decode_tps ?? run.aggregate_output_tps ?? 0;
  const p95Ttft = run.p95_ttft_s ?? null;
  const medTtft = run.median_ttft_s ?? null;
  const ttft = p95Ttft ?? medTtft ?? 0;
  const perCategoryOnly = run.engine_config?.quality_aggregation === "per_category";
  const qualityName = run.engine_config?.quality_aggregation === "normalized_quality" ? "benchmark quality" : "mean accuracy";
  const quality = perCategoryOnly ? null : run.quality_score ?? null;
  const measuredErrorRate = errorRate(run);
  const err = measuredErrorRate ?? 0;
  const concurrency = run.concurrency ?? 1;

  // Memory Stability evaluation
  const measuredMemoryMb = run.peak_gpu_mem_mb ?? null;
  const totalMemoryMb = run.hw_gpu_memory_mb
    ?? (run.hw_ram_gb != null ? run.hw_ram_gb * 1024 : null);
  const vramPct = (measuredMemoryMb != null && totalMemoryMb != null && totalMemoryMb > 0)
    ? (measuredMemoryMb / totalMemoryMb) * 100
    : null;
  const kvCachePct = run.peak_kv_cache_pct != null
    ? (run.peak_kv_cache_pct <= 1.0 ? run.peak_kv_cache_pct * 100 : run.peak_kv_cache_pct)
    : null;

  const isVllm = run.framework === "vllm";
  const isHostedApi = run.framework === "openai-compatible";
  const memSaturationPct = isVllm
    ? (kvCachePct ?? vramPct)
    : vramPct;
  const memoryStable = memSaturationPct != null
    ? memSaturationPct <= standards.memoryStabilityMaxPct
    : null;

  // 1. Dynamic Composite Score Calculation
  const compScoreObj = run.composite_scores?.[selectedProfile];
  let score = 50;
  let isPartial = false;

  if (compScoreObj && compScoreObj.score != null && !customCriteria && !isHostedApi) {
    score = Math.round(numberOrZero(compScoreObj.score) * 100);
    isPartial = !!compScoreObj.partial;
  } else {
    // Continuous objective component derivation matching canonical backend formula
    // Strict missing evidence penalty: missing quality receives 0.0 credit
    const qualityComp = quality ?? 0.0;
    const speedRatio = decodeSpeed > 0 ? Math.min(1.0, decodeSpeed / standards.speedNormalizationCeiling) : 0.0;
    const ttftRatio = medTtft != null && medTtft > 0
      ? Math.min(1.0, 0.50 / medTtft)
      : (ttft > 0 ? Math.min(1.0, 0.50 / ttft) : 0.0);
    const speedComp = decodeSpeed > 0 || ttft > 0 ? (0.70 * speedRatio + 0.30 * ttftRatio) : 0.0;

    let fitComp: number | null = null;
    if (measuredMemoryMb != null && totalMemoryMb != null && totalMemoryMb > 0) {
      const util = measuredMemoryMb / totalMemoryMb;
      if (util <= 0.50) {
        fitComp = 0.50 + 0.50 * (util / 0.50);
      } else if (util <= 0.80) {
        fitComp = 1.0;
      } else if (util <= 1.00) {
        fitComp = 1.0 - (util - 0.80) / 0.20;
      } else {
        fitComp = 0.0;
      }
    } else if (kvCachePct != null) {
      const util = kvCachePct / 100;
      if (util <= 0.50) fitComp = 0.50 + 0.50 * (util / 0.50);
      else if (util <= 0.80) fitComp = 1.0;
      else if (util <= 1.00) fitComp = 1.0 - (util - 0.80) / 0.20;
      else fitComp = 0.0;
    }

    const overloadMultiplier = ttft > 10.0 ? 0.65 : 1.0;
    isPartial = quality == null
      || decodeSpeed <= 0
      || medTtft == null
      || p95Ttft == null
      || measuredErrorRate == null
      || (fitComp == null && !isHostedApi);
    const missingEvidenceMultiplier = isPartial ? 0.50 : 1.0;

    const fitWeight = fitComp !== null ? weights.fit : 0.0;
    const presentWeightSum = weights.quality + weights.speed + fitWeight;
    const calculated = (
      qualityComp * (weights.quality / presentWeightSum) +
      speedComp * (weights.speed / presentWeightSum) +
      (fitComp !== null ? fitComp * (fitWeight / presentWeightSum) : 0)
    ) * 100 * overloadMultiplier * missingEvidenceMultiplier;

    score = Math.max(1, Math.min(100, Math.round(calculated)));
  }

  // 2. Strengths & Deficiencies Generation
  if (quality != null) {
    const qualPct = Math.round(quality * 100);
    if (quality >= standards.strictQualityMin * standards.tradeOffQualitySurplus) {
      goodAt.push(`Superior ${qualityName} (${qualPct}%) across ${suiteName ?? "benchmark"} suite`);
    } else if (quality >= standards.strictQualityMin) {
      goodAt.push(`Meets production quality standard (${qualPct}% ${qualityName})`);
    } else {
      badAt.push(`${qualityName === "mean accuracy" ? "Mean accuracy" : "Benchmark quality"} ${qualPct}% falls below ${(standards.strictQualityMin * 100).toFixed(0)}% production standard${qualityName === "mean accuracy" ? " (hallucination risk)" : ""}`);
    }
  } else if (perCategoryOnly) {
    badAt.push("Quality is reported per category; no overall accuracy or publication approval is established");
  } else {
    badAt.push("Missing accuracy evaluation suite");
  }

  if (ttft > 0) {
    if (ttft > 10.0) {
      badAt.push(`Severe queue delay under concurrent load (${formatMetric(ttft, "s")} TTFT)`);
    } else if (ttft > standards.interactiveTtftMaxSeconds) {
      badAt.push(`Sluggish response latency (${formatMetric(ttft, "s")} TTFT)`);
    } else if (ttft <= standards.fastTtftSeconds && ttft < 1 && concurrency >= 5) {
      goodAt.push(`Sub-second TTFT under concurrent load (${formatMetric(ttft, "s")})`);
    } else if (ttft <= standards.fastTtftSeconds && ttft < 1) {
      goodAt.push(`Fast initial response (${formatMetric(ttft, "s")} TTFT)`);
    } else if (ttft <= standards.fastTtftSeconds) {
      goodAt.push(`Within first-token latency target (${formatMetric(ttft, "s")} TTFT)`);
    }
  }

  const e2e = run.median_e2e_s ?? 0;
  if (e2e > 30) {
      badAt.push(`Slow total response time (${formatMetric(e2e, "s")} median E2E) — exceeds the interactive threshold for ${suiteName ?? "benchmark"}`);
  } else if (e2e > 15) {
    badAt.push(`High total response time (${formatMetric(e2e, "s")} median E2E) — noticeable latency for end users`);
  }

  if (decodeSpeed >= standards.minTargetDecodeTps) {
    goodAt.push(`${run.run_type === "diagnostic" ? "Measured decode throughput" : "Meets production decode target"} (${formatMetric(decodeSpeed, "tok/s")})`);
  } else if (decodeSpeed > 0 && decodeSpeed < standards.minTargetDecodeTps) {
    const dev = ((standards.minTargetDecodeTps - decodeSpeed) / standards.minTargetDecodeTps) * 100;
    badAt.push(`Below ${standards.minTargetDecodeTps} tok/s target (${formatMetric(decodeSpeed, "tok/s")}, -${dev.toFixed(1)}%)`);
  }

  if (err === 0 && (run.num_runs ?? 0) > 0) {
    goodAt.push("100% request reliability (0 errors)");
  } else if (err > standards.maxAllowedErrorRate) {
    badAt.push(`${run.run_type === "diagnostic" ? "Measured run request failures" : "Non-zero transaction failure"} (${(err * 100).toFixed(1)}% error rate)`);
  }

  if (run.run_type === "diagnostic") {
    goodAt.push(`Measured exploratory load (C=${concurrency}); not production qualification`);
  } else if (concurrency >= 10) {
    goodAt.push("Verified at peak concurrent load (C=10)");
  } else if (concurrency >= 5) {
    goodAt.push(`Verified under concurrent load (C=${concurrency})`);
  }

  if (memSaturationPct != null && memoryStable === false) {
    badAt.push(`Memory saturation ${memSaturationPct.toFixed(1)}% exceeds ${standards.memoryStabilityMaxPct}% safety budget`);
  }

  // 3. 5-Point Production Gate Evaluation
  const gDecode = decodeSpeed >= standards.minTargetDecodeTps;
  const gMedTtft = medTtft != null && medTtft <= standards.fastTtftSeconds;
  const gP95Ttft = p95Ttft != null && p95Ttft <= standards.tailTtftCeilingSeconds;
  const gQualityStrict = quality != null && quality >= standards.strictQualityMin;
  const requiredQualityForTradeOff = standards.strictQualityMin * standards.tradeOffQualitySurplus;
  const hasQualitySurplus = quality != null && quality >= requiredQualityForTradeOff;
  const gError = err <= standards.maxAllowedErrorRate;
  const gMem = isHostedApi || memoryStable === true;

  let verdict: "Qualified" | "Near-Miss" | "Needs Evidence" | "Rejected" = "Qualified";
  let verdictReason = "Satisfies all production criteria";

  const missingEvidence: string[] = [];
  if (quality == null) missingEvidence.push("quality");
  if (decodeSpeed <= 0) missingEvidence.push("decode throughput");
  if (medTtft == null) missingEvidence.push("median TTFT");
  if (p95Ttft == null) missingEvidence.push("p95 TTFT");
  if (measuredErrorRate == null) missingEvidence.push("request reliability");
  if (memoryStable == null && !isHostedApi) missingEvidence.push("memory utilization");

  if ((run.catastrophic_failure_count ?? 0) > 0) {
    verdict = "Rejected";
    verdictReason = `Contains ${run.catastrophic_failure_count} catastrophic benchmark failure${run.catastrophic_failure_count === 1 ? "" : "s"}`;
  } else if (missingEvidence.length > 0) {
    verdict = "Needs Evidence";
    verdictReason = `Missing required evidence: ${missingEvidence.join(", ")}`;
  } else if (ttft > 10.0) {
    verdict = "Rejected";
    verdictReason = `Catastrophic queue latency (${formatMetric(ttft, "s")} TTFT) under load`;
  } else if (ttft > standards.interactiveTtftMaxSeconds) {
    verdict = "Rejected";
    verdictReason = `Response latency (${formatMetric(ttft, "s")} TTFT) exceeds ${standards.interactiveTtftMaxSeconds}s ceiling`;
  } else if (!gError) {
    verdict = "Rejected";
    verdictReason = `Contains ${(err * 100).toFixed(1)}% transaction failures`;
  } else if (memoryStable === false && memSaturationPct != null) {
    verdict = "Rejected";
    verdictReason = `Memory saturation ${memSaturationPct.toFixed(1)}% exceeds ${standards.memoryStabilityMaxPct}% stability ceiling`;
  } else if (!gQualityStrict) {
    verdict = "Rejected";
    verdictReason = `${qualityName === "mean accuracy" ? "Mean accuracy" : "Benchmark quality"} ${Math.round((quality ?? 0) * 100)}% falls below ${(standards.strictQualityMin * 100).toFixed(0)}% production requirement`;
  } else if (gDecode && gMedTtft && gP95Ttft && gQualityStrict && gMem && gError) {
    verdict = "Qualified";
    verdictReason = isHostedApi
      ? "Meets all applicable production gates; provider-managed memory is not measured"
      : "Meets all 5 production gates";
  } else {
    const speedDeviations: number[] = [];
    if (!gDecode) {
      speedDeviations.push((standards.minTargetDecodeTps - decodeSpeed) / standards.minTargetDecodeTps);
    }
    if (!gMedTtft && medTtft != null) {
      speedDeviations.push((medTtft - standards.fastTtftSeconds) / standards.fastTtftSeconds);
    }
    if (!gP95Ttft && p95Ttft != null) {
      speedDeviations.push((p95Ttft - standards.tailTtftCeilingSeconds) / standards.tailTtftCeilingSeconds);
    }

    const fatalSpeedMisses = speedDeviations.filter(d => d > standards.maxSpeedDeviationPct);
    const minorSpeedMisses = speedDeviations.filter(d => d <= standards.maxSpeedDeviationPct);

    if (hasQualitySurplus && fatalSpeedMisses.length === 0 && minorSpeedMisses.length === 1) {
      verdict = "Near-Miss";
      verdictReason = `Superior mean quality (${Math.round((quality ?? 0) * 100)}%) justifies minor speed trade-off (≤15% deviation)`;
    } else {
      verdict = "Rejected";
      verdictReason = hasQualitySurplus
        ? "Speed deviations exceed 15% trade-off tolerance"
        : "Mean quality does not exceed target by ≥10% to earn speed trade-off";
    }
  }

  return {
    score,
    scoreLabel: `${score}/100`,
    isPartial,
    profile: meta,
    goodAt: goodAt.length ? goodAt : ["Baseline execution"],
    badAt: badAt.length ? badAt : ["No major defects detected"],
    verdict,
    verdictReason,
  };
}

export interface CandidateEvaluation {
  isCandidate: boolean;
  concurrency: number;
  score: number;
  isGeneralQualified: boolean;
  refRun: BenchmarkRun;
  verdictReason: string;
}

/**
 * Applies the category-coverage gate to a scorecard. A scorecard with missing
 * required categories is incomplete evidence, so it must not be presented as
 * a definitive rejection/qualification based on the partial aggregate.
 */
export function applyCategoryCoverageEvidence(
  card: ModelScorecard,
  missingCategoryLabels: string[],
  totalMandatoryCount: number,
  testedMandatoryCount: number,
  suiteName: string,
  concurrency: number,
): ModelScorecard {
  if (missingCategoryLabels.length === 0 || totalMandatoryCount <= 0) return card;

  const coverageRatio = testedMandatoryCount / totalMandatoryCount;
  const scaledScore = Math.round(card.score * coverageRatio);
  return {
    ...card,
    score: scaledScore,
    scoreLabel: `${scaledScore}/100`,
    isPartial: true,
    verdict: "Needs Evidence",
    verdictReason: `Missing ${missingCategoryLabels.length} of ${totalMandatoryCount} required ${suiteName} categories at C=${concurrency} (${missingCategoryLabels.join(", ")})`,
    badAt: [
      ...card.badAt.filter((item) => !item.includes("No major defects")),
      `Missing ${missingCategoryLabels.length} mandatory categories: ${missingCategoryLabels.join(", ")}`,
    ],
  };
}

/**
 * Evaluates whether an unmeasured deployment qualifies as a "? Candidate" from other concurrencies.
 * Canonical rule: Only deployments with complete required-category coverage, no category failures,
 * an overall score >= 80, and foundational stability at another concurrency qualify as Candidates.
 */
export function evaluateDeploymentCandidate(
  runList: BenchmarkRun[],
  requiredConcurrency: number,
  categoryConfiguration?: CategoryConfiguration[],
  suiteId?: string,
  criteria?: ScorecardCriteria | null,
  suiteName?: string
): CandidateEvaluation | null {
  const otherConcurrencies = Array.from(
    new Set(
      runList
        .map((r) => r.concurrency)
        .filter((c): c is number => c != null && c !== requiredConcurrency && CANONICAL_CONCURRENCY_SET.has(c))
    )
  );

  if (otherConcurrencies.length === 0) {
    return null;
  }

  // Prioritize single-user baseline C=1 first, then other concurrencies
  otherConcurrencies.sort((a, b) => (a === 1 ? -1 : b === 1 ? 1 : b - a));

  const evaluations: CandidateEvaluation[] = [];

  for (const c of otherConcurrencies) {
    const runsAtC = runList.filter((r) => r.concurrency === c);
    if (runsAtC.length === 0) continue;

    const baseRun = runsAtC.slice().sort((a, b) => {
      const aTps = a.median_decode_tps || a.aggregate_output_tps || 0;
      const bTps = b.median_decode_tps || b.aggregate_output_tps || 0;
      return bTps - aTps;
    })[0];

    const catResults = categoryScoresFromRuns(runList, c, categoryConfiguration);
    const mandatoryResults = catResults.filter((cat) => cat.isRequired);
    const qualificationResults = mandatoryResults.length > 0 ? mandatoryResults : catResults;
    const totalMandatoryCount = mandatoryResults.length > 0 ? mandatoryResults.length : catResults.length;
    const testedCount = mandatoryResults.length > 0
      ? mandatoryResults.filter((cat) => cat.score != null).length
      : catResults.filter((cat) => cat.score != null).length;
    const missingCount = totalMandatoryCount - testedCount;
    const qualitySummary = categoryQualitySummary(catResults);
    const meanAccuracy = testedCount > 0 ? qualitySummary.meanAccuracy : null;

    const repRun: BenchmarkRun = {
      ...baseRun,
      concurrency: c,
      quality_score: qualitySummary.perCategoryOnly ? undefined : meanAccuracy ?? baseRun.quality_score,
      engine_config: { ...baseRun.engine_config, ...(qualitySummary.perCategoryOnly ? { quality_aggregation: "per_category" }
        : qualitySummary.hasRatingAgreement ? { quality_aggregation: "normalized_quality" } : {}) },
    };

    let card = evaluateModelScorecard(repRun, suiteId || "standard", criteria, suiteName);
    if (missingCount > 0) {
      card = applyCategoryCoverageEvidence(
        card,
        qualificationResults.filter((cat) => cat.score == null).map((cat) => cat.label),
        totalMandatoryCount,
        testedCount,
        suiteName || "selected",
        c,
      );
    }

    // Foundational Layer 1 Checks
    const safetyCat = qualificationResults.find((cat) => cat.categoryId.includes("safety") || cat.categoryId.includes("compliance"));
    const securityCat = qualificationResults.find((cat) => cat.categoryId.includes("security") || cat.categoryId.includes("robustness"));
    const ttft = repRun.p95_ttft_s ?? null;
    const err = errorRate(repRun);

    const passesSafetyBaseline = !safetyCat || (safetyCat.score != null && safetyCat.score >= 0.90);
    const passesSecurityBaseline = !securityCat || (securityCat.score != null && securityCat.score >= 0.90);
    const passesReliability = err != null && err <= UNIVERSAL_STANDARDS.maxAllowedErrorRate;
    const passesLatencyCeiling = ttft != null && ttft <= UNIVERSAL_STANDARDS.interactiveTtftMaxSeconds;
    const hasNoCatastrophicFailures = qualificationResults.every((cat) => cat.catastrophicFailureCount === 0);

    const passesFoundational = passesSafetyBaseline
      && passesSecurityBaseline
      && passesReliability
      && passesLatencyCeiling
      && hasNoCatastrophicFailures;

    const failingCategories = catResults.filter(
      (cat) => cat.score != null && cat.score < cat.minimumQuality
    );
    const isGeneralQualified = passesFoundational && missingCount === 0 && failingCategories.length === 0 && card.verdict === "Qualified";
    const isCandidate = passesFoundational && missingCount === 0 && failingCategories.length === 0 && card.score >= 80;

    let verdictReason = "";
    if (isCandidate) {
      verdictReason = `Top candidate from C=${c} evaluation: Score ${card.score}/100 with all required categories passing — unmeasured at load C=${requiredConcurrency}`;
    } else {
      verdictReason = `Sub-threshold or incomplete at C=${c} (Score: ${card.score}/100) — unmeasured at load C=${requiredConcurrency}`;
    }

    evaluations.push({
      isCandidate,
      concurrency: c,
      score: card.score,
      isGeneralQualified,
      refRun: baseRun,
      verdictReason,
    });
  }

  // Return the best candidate if any concurrency qualified, or highest score evaluation
  const candidates = evaluations.filter((e) => e.isCandidate);
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  evaluations.sort((a, b) => b.score - a.score);
  return evaluations[0] || null;
}

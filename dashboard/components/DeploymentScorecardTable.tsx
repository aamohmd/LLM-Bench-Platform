"use client";

import { Fragment, useState, useMemo, useEffect } from "react";
import { fetchScoreboardSuites, fetchScorecardRuns, type ApprovalEvaluation, type BenchmarkRun, type BenchmarkSuite, type CompositeProfilesResponse } from "../lib/benchmarks";
import {
  categoryScoresFromRuns,
  hardwareLabel,
  errorRate,
  canonicalCategoryId,
  deploymentConfigurationKey,
  measuredConcurrencies,
  categoryQualitySummary,
  scorecardGroupKey,
} from "../lib/benchmarks";
import {
  evaluateModelScorecard,
  evaluateDeploymentCandidate,
  applyCategoryCoverageEvidence,
  scorecardVariantRank,
  PROFILE_METAS,
  type ModelScorecard,
  CANONICAL_CONCURRENCY_SET,
} from "../lib/scorecard";
import { ScorecardFilters } from "./scorecard/ScorecardFilters";
import { CandidateRecommendation } from "./scorecard/CandidateRecommendation";
import { ScorecardRow, type ScorecardRowData } from "./scorecard/ScorecardRow";
import { exportScorecardCsv } from "./scorecard/ScorecardExport";
import { ArrowUpDown, ArrowUp, ArrowDown, SearchX, ShieldCheck } from "lucide-react";
import { ScoreboardSkeleton } from "./SkeletonState";

type ScorecardGroup = { key: string; best: ScorecardRowData; alternatives: ScorecardRowData[] };

function scorecardVerdict(row: ScorecardRowData): string {
  return row.approvalEvaluation?.verdict ?? row.card.verdict;
}

function matchesScorecardSearch(row: ScorecardRowData, query: string): boolean {
  return [
    row.run.model, row.run.framework, hardwareLabel(row.run), scorecardVerdict(row),
    row.card.verdictReason, row.run.prompt_name, row.run.prompt_strategy, row.run.directive_name,
  ].some((value) => (value ?? "").toLowerCase().includes(query));
}

export function DeploymentScorecardTable({
  runs: inputRuns,
  profiles,
  approvalEvaluations,
}: {
  runs: BenchmarkRun[];
  profiles: CompositeProfilesResponse | null;
  approvalEvaluations?: Record<string, ApprovalEvaluation>;
}) {
  const [scoreboardSuites, setScoreboardSuites] = useState<BenchmarkSuite[]>([]);
  const [suiteCatalogLoaded, setSuiteCatalogLoaded] = useState(false);
  const [suiteRuns, setSuiteRuns] = useState<BenchmarkRun[] | null>(null);
  const [suiteCatalogError, setSuiteCatalogError] = useState<string | null>(null);
  const [suiteRunsError, setSuiteRunsError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Map<string, boolean>>(new Map());
  const suiteOptions = useMemo(() => Array.from(new Set([
    ...scoreboardSuites.map((suite) => suite.id),
    ...inputRuns.map((run) => run.scoreboard_suite_id ?? run.suite_id).filter((id): id is string => Boolean(id)),
  ])).sort(), [inputRuns, scoreboardSuites]);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null);
  const activeSuiteId = selectedSuiteId && suiteOptions.includes(selectedSuiteId) ? selectedSuiteId : "";
  const activeSuite = scoreboardSuites.find((suite) => suite.id === activeSuiteId);
  const suiteName = activeSuite?.name
    ?? activeSuiteId.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  useEffect(() => {
    if (!suiteCatalogLoaded || suiteOptions.length === 0 || selectedSuiteId !== null) return;
    const storedSuiteId = window.localStorage.getItem("benchmark-scoreboard-suite");
    setSelectedSuiteId(storedSuiteId && suiteOptions.includes(storedSuiteId) ? storedSuiteId : suiteOptions[0]);
  }, [selectedSuiteId, suiteCatalogLoaded, suiteOptions]);

  useEffect(() => {
    if (activeSuiteId) window.localStorage.setItem("benchmark-scoreboard-suite", activeSuiteId);
  }, [activeSuiteId]);
  const sourceRuns = useMemo(() => {
    if (suiteRuns === null) return inputRuns;
    // Merge rather than replace: the SSR/global payload may contain valid
    // category champions that a bounded or cached suite response omits.
    const merged = new Map<string, BenchmarkRun>();
    [...inputRuns, ...suiteRuns].forEach((run, index) => {
      const key = run.id ?? `${run.model}|${run.framework ?? ""}|${run.scoreboard_suite_id ?? run.suite_id ?? ""}|${run.category_id ?? run.prompt_category ?? ""}|${run.concurrency ?? ""}|${index}`;
      merged.set(key, run);
    });
    return Array.from(merged.values());
  }, [inputRuns, suiteRuns]);
  const runs = useMemo(() => {
    if (!activeSuiteId) return sourceRuns;
    const suiteCategoryIds = new Set(
      (activeSuite?.task_groups ?? []).map((g) => canonicalCategoryId(g.id) ?? g.id)
    );
    return sourceRuns.filter((run) => {
      if ((run.scoreboard_suite_id ?? run.suite_id) !== activeSuiteId) return false;
      if (suiteCategoryIds.size > 0) {
        const runCat = canonicalCategoryId(run.category_id || run.prompt_category);
        if (runCat && suiteCategoryIds.has(runCat)) return true;
        if (run.category_results && Object.keys(run.category_results).some((k) => suiteCategoryIds.has(canonicalCategoryId(k) ?? k))) {
          return true;
        }
        if (run.task_scores && Object.values(run.task_scores).some((t) => suiteCategoryIds.has(canonicalCategoryId(t.task_category) ?? t.task_category))) {
          return true;
        }
        return false;
      }
      return true;
    });
  }, [sourceRuns, activeSuiteId, activeSuite]);

  useEffect(() => {
    let cancelled = false;
    fetchScoreboardSuites().then((data) => {
      if (!cancelled && Array.isArray(data)) {
        setScoreboardSuites(data);
        setSuiteCatalogError(null);
      }
      if (!cancelled) setSuiteCatalogLoaded(true);
    }).catch(() => {
      if (!cancelled) {
        setSuiteCatalogError("The suite catalog could not be refreshed. Showing suites found in the loaded benchmark data.");
        setSuiteCatalogLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeSuiteId) return;
    // Always hydrate the selected suite from its partitioned endpoint. The
    // SSR/global payload can be bounded or partial and must not mask missing
    // category champions by being treated as complete suite data.
    let cancelled = false;
    setSuiteRuns(null);
    setSuiteRunsError(null);
    fetchScorecardRuns(undefined, undefined, activeSuiteId).then((data) => {
      if (!cancelled) {
        setSuiteRuns(data ?? []);
        setSuiteRunsError(null);
      }
    }).catch(() => {
      if (!cancelled) {
        setSuiteRuns(null);
        setSuiteRunsError("Fresh suite results could not be loaded. Showing the benchmark data already available on this page.");
      }
    });
    return () => { cancelled = true; };
  }, [activeSuiteId, inputRuns]);
  const isCompositeSuite = useMemo(
    () => new Set(runs.map((run) => run.category_id).filter(Boolean)).size > 1
      || (scoreboardSuites.find((suite) => suite.id === activeSuiteId)?.task_groups?.length ?? 0) > 0,
    [runs, scoreboardSuites, activeSuiteId],
  );
  const availableConcurrencies = useMemo(() => measuredConcurrencies(runs), [runs]);

  // Filters include every measured load, including diagnostic API runs.
  const availableEngines = useMemo(() => {
    const set = new Set<string>();
    runs.forEach((r) => {
      if (r.framework && Number.isInteger(r.concurrency) && Number(r.concurrency) > 0) {
        set.add(r.framework.toLowerCase());
      }
    });
    return Array.from(set).sort();
  }, [runs]);

  // Available hardware platforms at measured loads.
  const availableHardwares = useMemo(() => {
    const set = new Set<string>();
    runs.forEach((r) => {
      if (Number.isInteger(r.concurrency) && Number(r.concurrency) > 0) {
        const hw = hardwareLabel(r);
        if (hw && hw !== "Default / Local CPU") set.add(hw);
      }
    });
    return Array.from(set).sort();
  }, [runs]);

  const activeCriteria = activeSuite?.sla_criteria ?? null;
  const criteriaStatus = activeCriteria ? "assigned" : "universal";

  // Default to C=10 (Production SLA)
  const defaultConcurrency = availableConcurrencies.includes(10)
    ? 10
    : availableConcurrencies[0] ?? 10;
  const [selectedConcurrency, setSelectedConcurrency] = useState<number>(defaultConcurrency);
  const REQUIRED_CONCURRENCY = selectedConcurrency;

  useEffect(() => {
    if (availableConcurrencies.length > 0 && !availableConcurrencies.includes(selectedConcurrency)) {
      setSelectedConcurrency(defaultConcurrency);
    }
  }, [availableConcurrencies, defaultConcurrency, selectedConcurrency]);

  // Multi-dimensional filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [engineFilter, setEngineFilter] = useState<string>("all");
  const [hardwareFilter, setHardwareFilter] = useState<string>("all");
  const [verdictFilter, setVerdictFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("score");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (engineFilter !== "all" && !availableEngines.includes(engineFilter)) {
      setEngineFilter("all");
    }
  }, [availableEngines, engineFilter]);

  useEffect(() => {
    if (hardwareFilter !== "all" && !availableHardwares.includes(hardwareFilter)) {
      setHardwareFilter("all");
    }
  }, [availableHardwares, hardwareFilter]);

  const INITIAL_ROWS = 8;
  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_ROWS);

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
    engineFilter !== "all" ||
    hardwareFilter !== "all" ||
    verdictFilter !== "all" ||
    sortBy !== "score" ||
    sortOrder !== "desc"
  );

  const handleResetFilters = () => {
    setSearchQuery("");
    setEngineFilter("all");
    setHardwareFilter("all");
    setVerdictFilter("all");
    setSortBy("score");
    setSortOrder("desc");
  };

  const toggleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortOrder(column === "name" || column === "ttft" ? "asc" : "desc");
    }
  };

  const handleSortByChange = (column: string) => {
    setSortBy(column);
    setSortOrder(column === "name" || column === "ttft" ? "asc" : "desc");
  };

  useEffect(() => {
    setVisibleCount(INITIAL_ROWS);
  }, [activeSuiteId, selectedConcurrency, searchQuery, engineFilter, hardwareFilter, verdictFilter, sortBy, sortOrder]);

  useEffect(() => {
    setExpandedGroups(new Map());
  }, [activeSuiteId, selectedConcurrency, searchQuery]);

  const {
    allConsolidated,
    statusCounts,
    rankedDeployments,
    totalDeploymentsCount,
    filteredDeploymentsCount,
  } = useMemo(() => {
    const deploymentMap = new Map<string, BenchmarkRun[]>();
    runs.forEach((r) => {
      if (!Number.isInteger(r.concurrency) || Number(r.concurrency) <= 0) {
        return;
      }
      const hw = hardwareLabel(r);
      const key = `${r.model}__${r.framework || "unknown"}__${hw}__${deploymentConfigurationKey(r)}`;
      const list = deploymentMap.get(key) || [];
      list.push(r);
      deploymentMap.set(key, list);
    });

    const consolidated: ScorecardRowData[] = Array.from(deploymentMap.entries()).map(([key, runList]) => {
      // Filter runs measured at REQUIRED_CONCURRENCY
      const runsAtConcurrency = runList.filter((r) => r.concurrency === REQUIRED_CONCURRENCY);

      // Select Champion Run at REQUIRED_CONCURRENCY (highest composite score configuration)
      let exactRun: BenchmarkRun | undefined;
      if (runsAtConcurrency.length > 0) {
        const candidatesAtC = runsAtConcurrency;

        const scoredCandidates = candidatesAtC.map((run) => {
          const evalCard = evaluateModelScorecard(run, activeSuiteId || "general", activeCriteria, suiteName);
          const tps = run.median_decode_tps || run.aggregate_output_tps || 0;
          const ttft = run.p95_ttft_s ?? run.median_ttft_s ?? 999;
          const ts = Date.parse(run.created_at ?? run.timestamp ?? "") || 0;
          return { run, score: evalCard.score, tps, ttft, ts };
        });

        scoredCandidates.sort((a, b) =>
          b.score - a.score ||
          b.tps - a.tps ||
          a.ttft - b.ttft ||
          b.ts - a.ts
        );

        exactRun = scoredCandidates[0]?.run;
      }
      const hasDataForConcurrency = Boolean(exactRun);

      const baseRun = exactRun || runList[0];
      const categoryConfiguration = (activeSuite?.task_groups && activeSuite.task_groups.length > 0)
        ? activeSuite.task_groups
        : exactRun?.suite_category_snapshot ?? baseRun?.suite_category_snapshot ?? [];

      // Evaluate candidate status from other concurrencies if unmeasured at REQUIRED_CONCURRENCY
      const candidateEval = !hasDataForConcurrency && isCompositeSuite
        ? evaluateDeploymentCandidate(
            runList,
            REQUIRED_CONCURRENCY,
            categoryConfiguration,
            activeSuiteId,
            activeCriteria,
            suiteName
          )
        : null;
      const isCandidate = Boolean(candidateEval?.isCandidate);

      // Sourcing category results strictly at REQUIRED_CONCURRENCY (no cross-splicing)
      const categoryResults = !isCompositeSuite
        ? [{
            categoryId: activeSuiteId || "selected_suite",
            label: `${suiteName || "Selected suite"} (whole suite)`,
            minimumQuality: activeCriteria?.min_quality_score ?? 0.75,
            score: exactRun?.quality_score ?? null,
            catastrophicFailureCount: exactRun?.catastrophic_failure_count ?? 0,
            championRun: exactRun ?? null,
            championTuning: null,
            configuredTaskCount: activeSuite?.task_count ?? exactRun?.quality_total_count ?? 0,
            evaluatedTaskCount: exactRun?.quality_total_count ?? 0,
            isRequired: false,
          }]
        : categoryScoresFromRuns(runList, REQUIRED_CONCURRENCY, categoryConfiguration)
            .filter((category) => category.categoryId !== activeSuiteId);
      const mandatoryResults = categoryResults.filter((c) => c.isRequired);
      const testedMandatoryCount = mandatoryResults.filter((c) => c.evaluatedTaskCount > 0).length;
      const totalMandatoryCount = mandatoryResults.length;
      const missingCategoryResults = mandatoryResults.filter((c) => c.score == null);
      const qualitySummary = categoryQualitySummary(categoryResults);
      const deploymentMeanAccuracy = (hasDataForConcurrency && testedMandatoryCount > 0)
        ? qualitySummary.meanAccuracy
        : null;

      const representativeRun: BenchmarkRun = {
        ...baseRun,
        ...(exactRun ? {
          id: exactRun.id,
          experiment_tag: exactRun.experiment_tag,
          pipeline_config: exactRun.pipeline_config,
          pipeline_config_id: exactRun.pipeline_config_id,
          engine_config: exactRun.engine_config,
          quantization: exactRun.quantization ?? baseRun?.quantization,
          context_len: exactRun.context_len ?? baseRun?.context_len,
          prompt_name: exactRun.prompt_name ?? baseRun?.prompt_name,
          prompt_strategy: exactRun.prompt_strategy ?? baseRun?.prompt_strategy,
          directive_name: exactRun.directive_name ?? baseRun?.directive_name,
        } : {}),
        median_decode_tps: exactRun?.median_decode_tps,
        aggregate_output_tps: exactRun?.aggregate_output_tps,
        median_ttft_s: exactRun?.median_ttft_s,
        p95_ttft_s: exactRun?.p95_ttft_s,
        p99_ttft_s: exactRun?.p99_ttft_s,
        median_e2e_s: exactRun?.median_e2e_s,
        concurrency: exactRun?.concurrency ?? REQUIRED_CONCURRENCY,
        quality_score: (isCompositeSuite ? deploymentMeanAccuracy : exactRun?.quality_score) ?? undefined,
        engine_config: { ...exactRun?.engine_config,
          ...(qualitySummary.perCategoryOnly ? { quality_aggregation: "per_category" }
            : qualitySummary.hasRatingAgreement ? { quality_aggregation: "normalized_quality" } : {}) },
        // Gate 5 memory fields must come from exactRun (the run at REQUIRED_CONCURRENCY),
        // not baseRun (highest-throughput run which may be at a different concurrency).
        peak_gpu_mem_mb: exactRun?.peak_gpu_mem_mb,
        avg_gpu_mem_mb: exactRun?.avg_gpu_mem_mb,
        hw_gpu_memory_mb: exactRun?.hw_gpu_memory_mb ?? baseRun?.hw_gpu_memory_mb,
        peak_kv_cache_pct: exactRun?.peak_kv_cache_pct,
        avg_kv_cache_pct: exactRun?.avg_kv_cache_pct,
      };

      let card: ModelScorecard = hasDataForConcurrency
        ? evaluateModelScorecard(representativeRun, activeSuiteId || "general", activeCriteria, suiteName)
        : {
            score: 0,
            scoreLabel: "0/100",
            isPartial: true,
            profile: PROFILE_METAS[activeSuiteId] ?? {
              key: activeSuiteId || "general",
              name: `${suiteName} Benchmark`,
              tagline: activeCriteria?.description ?? `Deployment readiness for the ${suiteName} benchmark suite.`,
              weights: {
                quality: activeCriteria?.weight_quality ?? PROFILE_METAS.standard?.weights.quality ?? 0.60,
                speed: activeCriteria?.weight_speed ?? PROFILE_METAS.standard?.weights.speed ?? 0.25,
                fit: activeCriteria?.weight_fit ?? PROFILE_METAS.standard?.weights.fit ?? 0.15,
              },
              badgeColor: "var(--accent-lime)",
            },
            goodAt: [],
            badAt: [
              `Unmeasured at peak load C=${REQUIRED_CONCURRENCY}`,
              ...(isCandidate ? [`Candidate pending C=${REQUIRED_CONCURRENCY} load verification`] : []),
            ],
            verdict: "Needs Evidence",
            verdictReason: candidateEval
              ? candidateEval.verdictReason
              : `No benchmark runs recorded at peak concurrent load C=${REQUIRED_CONCURRENCY}`,
          };

      if (hasDataForConcurrency && qualitySummary.perCategoryOnly) {
        card = { ...card, isPartial: true, scoreLabel: "Diagnostic", verdict: card.verdict === "Rejected" ? "Rejected" : "Needs Evidence",
          verdictReason: card.verdict === "Rejected" ? card.verdictReason : `${testedMandatoryCount}/${totalMandatoryCount} categories executed; metrics are reported separately and do not establish production approval`,
          badAt: [...card.badAt, ...missingCategoryResults.map((category) => `${category.label}: ${category.evidenceStatus === "ungraded" ? "writing quality ungraded" : category.evidenceStatus === "pending_review" ? "pending editorial review" : category.evidenceStatus === "agreement_only" ? "expert agreement metric recorded" : "not evaluated"}`)] };
      } else if (hasDataForConcurrency && isCompositeSuite && totalMandatoryCount === 0) {
        card = {
          ...card,
          isPartial: true,
          verdict: "Needs Evidence",
          verdictReason: `No required categories are configured for ${suiteName}`,
          badAt: [...card.badAt.filter((item) => !item.includes("No major defects")), "No required categories configured"],
        };
      } else if (hasDataForConcurrency && missingCategoryResults.length > 0) {
        card = applyCategoryCoverageEvidence(
          card,
          missingCategoryResults.map((category) => category.label),
          totalMandatoryCount,
          testedMandatoryCount,
          suiteName,
          REQUIRED_CONCURRENCY,
        );
      } else if (hasDataForConcurrency && missingCategoryResults.length === 0 && isCompositeSuite) {
        // Multi-Tier Qualification Standard
        const safetyCategory = mandatoryResults.find((c) => c.categoryId.includes("safety") || c.categoryId.includes("compliance"));
        const securityCategory = mandatoryResults.find((c) => c.categoryId.includes("security") || c.categoryId.includes("robustness"));
        const ttft = representativeRun.p95_ttft_s ?? 0;
        const err = errorRate(representativeRun) ?? 0;

        const passesSafetyBaseline = !safetyCategory || (safetyCategory.score ?? 0) >= 0.90;
        const passesSecurityBaseline = !securityCategory || (securityCategory.score ?? 0) >= 0.90;
        const passesReliability = err <= 0.01;
        const passesLatencyCeiling = ttft <= 3.0;
        const catastrophicFailureCount = mandatoryResults.reduce(
          (count, category) => count + category.catastrophicFailureCount,
          0,
        );

        const failingCategories = mandatoryResults.filter(
          (c) => c.score != null && (c.score < c.minimumQuality || c.catastrophicFailureCount > 0)
        );

        if (catastrophicFailureCount > 0) {
          card = {
            ...card,
            verdict: "Rejected",
            verdictReason: `Fails foundational security/stability gates: ${catastrophicFailureCount} catastrophic benchmark failure${catastrophicFailureCount === 1 ? "" : "s"}`,
            badAt: [
              ...card.badAt.filter((b) => !b.includes("No major defects")),
              `${catastrophicFailureCount} catastrophic benchmark failure${catastrophicFailureCount === 1 ? "" : "s"}`,
            ],
          };
        } else if (card.verdict === "Needs Evidence") {
          // Missing performance or reliability evidence, or applicable local
          // memory telemetry, must never be upgraded by passing quality alone.
        } else if (!passesSafetyBaseline || !passesSecurityBaseline || !passesReliability || !passesLatencyCeiling) {
          const fatalReasons: string[] = [];
          if (!passesSafetyBaseline && safetyCategory) fatalReasons.push(`Safety breach (${Math.round((safetyCategory.score ?? 0) * 100)}% < 90%)`);
          if (!passesSecurityBaseline && securityCategory) fatalReasons.push(`Security vulnerability (${Math.round((securityCategory.score ?? 0) * 100)}% < 90%)`);
          if (!passesReliability) fatalReasons.push(`Error rate ${(err * 100).toFixed(1)}% > 1%`);
          if (!passesLatencyCeiling) fatalReasons.push(`Latency ${ttft.toFixed(2)}s > 3.0s ceiling`);

          card = {
            ...card,
            verdict: "Rejected",
            verdictReason: `Fails foundational security/stability gates: ${fatalReasons.join("; ")}`,
            badAt: [
              ...card.badAt.filter((b) => !b.includes("No major defects")),
              ...fatalReasons,
            ],
          };
        } else if (failingCategories.length === 0 && card.verdict !== "Rejected") {
          const catCount = categoryResults.length;
          if (card.verdict === "Near-Miss") {
            card = {
              ...card,
              verdictReason: `${card.verdictReason} — All ${catCount} ${suiteName} categories cleared`,
              goodAt: [
                ...card.goodAt.filter((g) => !g.includes("Baseline execution")),
                `Full ${catCount}/${catCount} ${suiteName} Category Approval`,
              ],
            };
          } else {
            card = {
              ...card,
              verdict: "Qualified",
              verdictReason: `General Enterprise Qualified: Clears all ${catCount} capability suites & production SLA gates`,
              goodAt: [
                ...card.goodAt.filter((g) => !g.includes("Baseline execution")),
                `Full ${catCount}/${catCount} Category Approval`,
              ],
            };
          }
        } else {
          const failSummary = failingCategories
            .map((c) => c.catastrophicFailureCount > 0
              ? `${c.label} (${c.catastrophicFailureCount} catastrophic failure${c.catastrophicFailureCount === 1 ? "" : "s"})`
              : `${c.label} (${Math.round((c.score ?? 0) * 100)}% < ${Math.round(c.minimumQuality * 100)}%)`)
            .join(", ");
          card = {
            ...card,
            verdict: "Rejected",
            verdictReason: `Fails required benchmark categories (${failSummary})`,
            badAt: [
              ...card.badAt.filter((b) => !b.includes("No major defects")),
              ...failingCategories.map(
                (c) => `${c.label} (${Math.round((c.score ?? 0) * 100)}%) below ${Math.round(c.minimumQuality * 100)}% requirement`
              ),
            ],
          };
        }
      }

      if (hasDataForConcurrency && !CANONICAL_CONCURRENCY_SET.has(REQUIRED_CONCURRENCY)) {
        card = {
          ...card,
          verdict: card.verdict === "Rejected" ? "Rejected" : "Needs Evidence",
          verdictReason: `Diagnostic measurements at C=${REQUIRED_CONCURRENCY}; standard-tier qualification is still required. ${card.verdictReason}`,
        };
      }

      return {
        key,
        run: representativeRun,
        runList,
        card,
        hasDataForConcurrency,
        isCandidate,
        candidateRefScore: candidateEval?.score,
        candidateRefConcurrency: candidateEval?.concurrency,
        candidateRefRun: candidateEval?.refRun,
        testedConcurrency: exactRun ? exactRun.concurrency : undefined,
        categoryResults,
        testedMandatoryCount,
        totalMandatoryCount,
        deploymentMeanAccuracy,
        approvalEvaluation: CANONICAL_CONCURRENCY_SET.has(REQUIRED_CONCURRENCY) && exactRun?.approval_run_id
          ? approvalEvaluations?.[exactRun.approval_run_id]
          : undefined,
      };
    });

    // Restrict executive scoreboard population to eligible deployments:
    // 1. Models with verified telemetry at REQUIRED_CONCURRENCY
    // 2. High-potential Candidate deployments with complete passing evidence and score >= 80 at a reference tier
    const eligibleDeployments = consolidated.filter(
      (row) => row.hasDataForConcurrency || row.isCandidate
    );

    const groupMap = new Map<string, ScorecardRowData[]>();
    eligibleDeployments.forEach((row) => {
      const key = scorecardGroupKey(row.run);
      const variants = groupMap.get(key) ?? [];
      variants.push(row);
      groupMap.set(key, variants);
    });
    const groups: ScorecardGroup[] = Array.from(groupMap, ([key, variants]) => {
      variants.sort((a, b) =>
        scorecardVariantRank(b) - scorecardVariantRank(a) ||
        b.card.score - a.card.score ||
        (b.run.median_decode_tps ?? 0) - (a.run.median_decode_tps ?? 0) ||
        (Date.parse(b.run.created_at ?? b.run.timestamp ?? "") || 0) -
          (Date.parse(a.run.created_at ?? a.run.timestamp ?? "") || 0)
      );
      return { key, best: variants[0], alternatives: variants.slice(1) };
    });

    // Status and filters describe the visible model/runtime groups.
    const counts = {
      all: groups.length,
      qualified: 0,
      candidates: 0,
      needs_evidence: 0,
      rejected: 0,
    };

    groups.forEach(({ best: row }) => {
      if (row.hasDataForConcurrency) {
        if (scorecardVerdict(row) === "Qualified") {
          counts.qualified++;
        } else if (scorecardVerdict(row) === "Needs Evidence") {
          counts.needs_evidence++;
        } else if (scorecardVerdict(row) === "Rejected") {
          counts.rejected++;
        }
      } else if (row.isCandidate) {
        counts.candidates++;
      }
    });

    // Filter eligible deployments
    const filtered = groups.filter((group) => {
      const row = group.best;
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        if (![row, ...group.alternatives].some((variant) => matchesScorecardSearch(variant, q))) {
          return false;
        }
      }

      // 2. Engine Filter
      if (engineFilter !== "all") {
        if ((row.run.framework || "").toLowerCase() !== engineFilter.toLowerCase()) {
          return false;
        }
      }

      // 3. Hardware Filter
      if (hardwareFilter !== "all") {
        const hw = hardwareLabel(row.run);
        if (hw.toLowerCase() !== hardwareFilter.toLowerCase()) {
          return false;
        }
      }

      // 4. Verdict Filter
      if (verdictFilter !== "all") {
        if (verdictFilter === "qualified") {
          if (!row.hasDataForConcurrency || scorecardVerdict(row) !== "Qualified") {
            return false;
          }
        } else if (verdictFilter === "candidates") {
          if (!row.isCandidate) return false;
        } else if (verdictFilter === "needs_evidence") {
          if (!row.hasDataForConcurrency || scorecardVerdict(row) !== "Needs Evidence") return false;
        } else if (verdictFilter === "rejected") {
          if (!row.hasDataForConcurrency || scorecardVerdict(row) !== "Rejected") return false;
        }
      }

      return true;
    });

    // Partition
    const verified = filtered.filter((d) => d.best.hasDataForConcurrency);
    const bestCandidates = filtered.filter((d) => !d.best.hasDataForConcurrency && d.best.isCandidate);

    // Apply custom sort
    const sortList = (list: ScorecardGroup[]) => {
      return [...list].sort((aGroup, bGroup) => {
        const a = aGroup.best;
        const b = bGroup.best;
        let cmp = 0;
        if (sortBy === "accuracy") {
          const aAcc = a.deploymentMeanAccuracy ?? (a.card.score / 100);
          const bAcc = b.deploymentMeanAccuracy ?? (b.card.score / 100);
          cmp = aAcc - bAcc;
        } else if (sortBy === "speed") {
          // Sort by per-request median TPS first (fair cross-engine comparison); fall back to aggregate
          const aSpeed = a.run.median_decode_tps ?? a.run.aggregate_output_tps ?? 0;
          const bSpeed = b.run.median_decode_tps ?? b.run.aggregate_output_tps ?? 0;
          cmp = aSpeed - bSpeed;
        } else if (sortBy === "ttft") {
          const aTtft = a.run.p95_ttft_s ?? Number.POSITIVE_INFINITY;
          const bTtft = b.run.p95_ttft_s ?? Number.POSITIVE_INFINITY;
          cmp = aTtft - bTtft;
        } else if (sortBy === "name") {
          cmp = a.run.model.localeCompare(b.run.model);
        } else {
          // Default: score
          const aScore = a.hasDataForConcurrency ? a.card.score : (a.candidateRefScore ?? a.card.score);
          const bScore = b.hasDataForConcurrency ? b.card.score : (b.candidateRefScore ?? b.card.score);
          if (bScore !== aScore) {
            cmp = aScore - bScore;
          } else {
            const aTps = a.run.median_decode_tps ?? a.run.aggregate_output_tps ?? a.candidateRefRun?.median_decode_tps ?? 0;
            const bTps = b.run.median_decode_tps ?? b.run.aggregate_output_tps ?? b.candidateRefRun?.median_decode_tps ?? 0;
            cmp = aTps - bTps;
          }
        }
        return sortOrder === "asc" ? cmp : -cmp;
      });
    };

    const sortedVerified = sortList(verified);
    const sortedBestCandidates = sortList(bestCandidates);
    const primaryRows = [...sortedVerified, ...sortedBestCandidates];

    return {
      allConsolidated: eligibleDeployments,
      statusCounts: counts,
      rankedDeployments: {
        verified: sortedVerified,
        bestCandidates: sortedBestCandidates,
        otherUntested: [],
        primaryRows,
      },
      totalDeploymentsCount: groups.length,
      filteredDeploymentsCount: primaryRows.length,
    };
  }, [
    runs,
    selectedConcurrency,
    approvalEvaluations,
    REQUIRED_CONCURRENCY,
    searchQuery,
    engineFilter,
    hardwareFilter,
    verdictFilter,
    sortBy,
    sortOrder,
    activeCriteria,
    activeSuiteId,
    scoreboardSuites,
    suiteName,
    isCompositeSuite,
  ]);

  const handleExportCsv = () => {
    setExportMessage(null);
    exportScorecardCsv(rankedDeployments.primaryRows.flatMap((group) => [group.best, ...group.alternatives]), selectedConcurrency);
  };

  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    setExportMessage("Preparing PDF…");
    try {
      const { createScorecardReportPdf } = await import("./scorecard/ScientificScorecardReport");
      const blob = await createScorecardReportPdf(rankedDeployments.primaryRows.flatMap((group) => [group.best, ...group.alternatives]), {
        suiteName,
        suiteId: activeSuiteId,
        criteria: activeCriteria,
        concurrency: selectedConcurrency,
        filters: [
          searchQuery && `Search: ${searchQuery}`,
          engineFilter !== "all" && `Engine: ${engineFilter}`,
          hardwareFilter !== "all" && `Hardware: ${hardwareFilter}`,
          verdictFilter !== "all" && `Verdict: ${verdictFilter}`,
        ].filter((filter): filter is string => Boolean(filter)),
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeSuite = (suiteName || "benchmark").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `scorecard-report-${safeSuite || "benchmark"}-c${selectedConcurrency}-${date}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage("PDF report downloaded.");
    } catch (error) {
      console.error("Failed to generate scorecard PDF", error);
      setExportMessage("PDF generation failed. Please try again.");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const allAvailableRows = rankedDeployments.primaryRows;
  const hasMoreRows = visibleCount < allAvailableRows.length;
  const displayedCount = Math.min(visibleCount, allAvailableRows.length);

  const renderSortIndicator = (column: string) => {
    if (sortBy !== column) {
      return <ArrowUpDown size={11} style={{ opacity: 0.3, marginLeft: "4px" }} />;
    }
    return sortOrder === "asc" ? (
      <ArrowUp size={11} style={{ color: "var(--accent-lime)", marginLeft: "4px" }} />
    ) : (
      <ArrowDown size={11} style={{ color: "var(--accent-lime)", marginLeft: "4px" }} />
    );
  };

  if (!suiteCatalogLoaded) {
    return <ScoreboardSkeleton label="Loading production readiness scoreboard" />;
  }

  return (
    <section className="panel" style={{ marginBottom: "48px", width: "100%", maxWidth: "100%" }}>
      {/* Header & Filter Controls */}
      <div
        style={{
          padding: "20px 24px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "var(--accent-lime)",
                  display: "inline-block",
                  boxShadow: "0 0 10px rgba(224, 255, 2, 0.5)",
                }}
              />
              <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", fontWeight: 600 }}>
                ENTERPRISE DEPLOYMENT MATRIX
              </span>
            </div>
            <h2 style={{ fontSize: "1.28rem", fontWeight: 700, margin: 0, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
              Production Readiness Scorecard
            </h2>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Suite:</span>
            {suiteOptions.length > 0 ? (
              <select
                aria-label="Benchmark scoreboard suite"
                value={activeSuiteId}
                onChange={(event) => setSelectedSuiteId(event.target.value)}
                style={{ padding: "5px 10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px", color: "var(--accent-lime)", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}
              >
                {suiteOptions.map((id) => {
                  const label = scoreboardSuites.find((suite) => suite.id === id)?.name
                    ?? id.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
                  return <option key={id} value={id} style={{ background: "#18181b", color: "#fff" }}>{label}</option>;
                })}
              </select>
            ) : (
              <span style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>No suites available</span>
            )}
          </div>
          {activeCriteria && (
            <div className="scorecard-sla-context" aria-label={`${suiteName} assigned SLA`}>
              <ShieldCheck size={15} aria-hidden="true" />
              <span>Assigned SLA</span>
              <strong>{activeCriteria.name}</strong>
            </div>
          )}
        </div>

        {(suiteCatalogError || suiteRunsError || criteriaStatus === "universal") && (
          <div
            role="status"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px 16px",
              padding: "8px 10px",
              borderRadius: "7px",
              border: "1px solid rgba(245, 166, 35, 0.25)",
              background: "rgba(245, 166, 35, 0.07)",
              color: "var(--text-secondary)",
              fontSize: "0.74rem",
            }}
          >
            {suiteCatalogError && <span>{suiteCatalogError}</span>}
            {suiteRunsError && <span>{suiteRunsError}</span>}
            {criteriaStatus === "universal" && (
              <span>No SLA is assigned to this suite. Scores use the documented universal baseline until an administrator assigns one in Settings.</span>
            )}
          </div>
        )}

        <ScorecardFilters
          availableConcurrencies={availableConcurrencies}
          selectedConcurrency={selectedConcurrency}
          onSelectConcurrency={(c) => setSelectedConcurrency(c)}
          onExportCsv={handleExportCsv}
          onExportPdf={handleExportPdf}
          isExportingPdf={isExportingPdf}
          exportMessage={exportMessage}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          engineFilter={engineFilter}
          onEngineChange={setEngineFilter}
          availableEngines={availableEngines}
          hardwareFilter={hardwareFilter}
          onHardwareChange={setHardwareFilter}
          availableHardwares={availableHardwares}
          verdictFilter={verdictFilter}
          onVerdictChange={setVerdictFilter}
          sortBy={sortBy}
          onSortByChange={handleSortByChange}
          statusCounts={statusCounts}
          totalCount={totalDeploymentsCount}
          filteredCount={filteredDeploymentsCount}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={handleResetFilters}
        />
      </div>

      <CandidateRecommendation
        selectedConcurrency={selectedConcurrency}
        verifiedCount={rankedDeployments.verified.length}
        candidatesCount={rankedDeployments.bestCandidates.length}
      />

      {/* Unified Scorecard Table */}
      <p className="scorecard-scroll-hint">On smaller screens, scroll horizontally to compare every metric.</p>
      <div className="scorecard-table-scroll" role="region" aria-label="Deployment scorecard comparison" tabIndex={0} style={{ overflowX: "auto", width: "100%", maxWidth: "100%", display: "block" }}>
        {rankedDeployments.primaryRows.length === 0 ? (
          <div
            style={{
              padding: "64px 24px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "rgba(255, 255, 255, 0.04)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-tertiary)",
              }}
            >
              <SearchX size={24} />
            </div>
            <div>
              <p style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text-primary)", margin: "0 0 4px 0" }}>
                {hasActiveFilters
                  ? "No deployments match the active filters"
                  : runs.length === 0
                  ? `No benchmark evidence for ${suiteName || "this suite"}`
                  : `No eligible deployments at C=${REQUIRED_CONCURRENCY}`}
              </p>
              <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", margin: 0 }}>
                {hasActiveFilters
                  ? "Clear the filters to restore all eligible deployments for this suite and concurrency tier."
                  : runs.length === 0
                  ? "No canonical benchmark runs are available for the selected suite."
                  : `No model has verified telemetry or complete candidate evidence for C=${REQUIRED_CONCURRENCY}. Choose another available concurrency tier or run the missing benchmark.`}
              </p>
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                style={{
                  marginTop: "6px",
                  fontSize: "0.78rem",
                  color: "var(--accent-lime)",
                  background: "rgba(224, 255, 2, 0.1)",
                  border: "1px solid rgba(224, 255, 2, 0.25)",
                  padding: "7px 16px",
                  borderRadius: "7px",
                  cursor: "pointer",
                  fontWeight: 600,
                  transition: "all 0.15s ease",
                }}
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <table className="fit-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  background: "rgba(18, 18, 18, 0.95)",
                  backdropFilter: "blur(12px)",
                  borderBottom: "1px solid var(--border-default)",
                }}
              >
                {/* Overall Score */}
                <th
                  aria-sort={sortBy === "score" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
                  style={{
                    width: "110px",
                    padding: "13px 16px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("score")}
                    aria-label="Sort by overall score"
                    title="Sort by overall score"
                    style={{ display: "inline-flex", alignItems: "center", padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", fontWeight: "inherit", cursor: "pointer" }}
                  >
                    <span>SCORE</span>
                    {renderSortIndicator("score")}
                  </button>
                </th>

                {/* Model & Runtime */}
                <th
                  aria-sort={sortBy === "name" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
                  style={{
                    minWidth: "220px",
                    padding: "13px 16px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    aria-label="Sort by model name"
                    title="Sort by model name"
                    style={{ display: "inline-flex", alignItems: "center", padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", fontWeight: "inherit", cursor: "pointer" }}
                  >
                    <span>MODEL & RUNTIME</span>
                    {renderSortIndicator("name")}
                  </button>
                </th>

                {/* Key Metrics */}
                <th
                  aria-sort={sortBy === "speed" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
                  style={{
                    width: "185px",
                    padding: "13px 16px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("speed")}
                    aria-label="Sort by throughput speed"
                    title="Sort by throughput speed"
                    style={{ display: "inline-flex", alignItems: "center", padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", fontWeight: "inherit", cursor: "pointer" }}
                  >
                    <span>KEY METRICS</span>
                    {renderSortIndicator("speed")}
                  </button>
                </th>

                {/* Key Strengths */}
                <th style={{ minWidth: "220px", padding: "13px 16px" }}>KEY STRENGTHS</th>

                {/* Category Results */}
                <th
                  aria-sort={sortBy === "accuracy" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
                  style={{
                    minWidth: "280px",
                    padding: "13px 16px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("accuracy")}
                    aria-label="Sort by category accuracy"
                    title="Sort by category accuracy. Untested categories count as 0% in the mean."
                    style={{ display: "inline-flex", alignItems: "center", padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", fontWeight: "inherit", cursor: "pointer" }}
                  >
                    <span>CATEGORY RESULTS</span>
                    {renderSortIndicator("accuracy")}
                  </button>
                </th>

                {/* Gaps & Deficiencies */}
                <th style={{ minWidth: "250px", padding: "13px 16px" }}>GAPS & DEFICIENCIES</th>

                {/* Qualification */}
                <th style={{ width: "200px", padding: "13px 16px" }}>QUALIFICATION</th>
              </tr>
            </thead>
            <tbody>
              {allAvailableRows.slice(0, visibleCount).map((group) => {
                const query = searchQuery.toLowerCase().trim();
                const revealSearchMatch = query && !matchesScorecardSearch(group.best, query)
                  && group.alternatives.some((row) => matchesScorecardSearch(row, query));
                const expanded = expandedGroups.get(group.key) ?? Boolean(revealSearchMatch);
                return (
                  <Fragment key={group.key}>
                    <ScorecardRow
                      data={group.best}
                      requiredConcurrency={REQUIRED_CONCURRENCY}
                      alternativeCount={group.alternatives.length}
                      expanded={expanded}
                      onToggleAlternatives={() => setExpandedGroups((previous) => {
                        const next = new Map(previous);
                        next.set(group.key, !expanded);
                        return next;
                      })}
                    />
                    {expanded && group.alternatives.map((row, index) => (
                      <ScorecardRow key={row.key} data={row} requiredConcurrency={REQUIRED_CONCURRENCY} isAlternative alternativeIndex={index + 1} alternativeTotal={group.alternatives.length} />
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer Actions: Load More */}
      {hasMoreRows && (
        <div
          style={{
            padding: "18px 24px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            borderTop: "1px solid var(--border-subtle)",
            background: "rgba(255,255,255,0.01)",
          }}
        >
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => prev + INITIAL_ROWS)}
            style={{
              fontSize: "0.82rem",
              fontWeight: 600,
              padding: "9px 24px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "8px",
              color: "var(--text-primary)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--border-strong)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-default)")}
          >
            <span>Load More Models</span>
            <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", fontWeight: 500 }}>
              ({displayedCount} of {allAvailableRows.length})
            </span>
          </button>
        </div>
      )}
    </section>
  );
}

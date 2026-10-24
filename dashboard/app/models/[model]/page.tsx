import { notFound, redirect } from "next/navigation";
import { ModelDetail } from "../../../components/BenchmarkConsole";
import { ApiUnavailableState } from "../../../components/ApiUnavailableState";
import { fetchBenchmarksByModel, fetchCompositeProfiles, fetchScorecardRunsWithStatus, fetchRunDetailWithStatus, fetchSession } from "../../../lib/benchmarks";

export const dynamic = "force-dynamic";

export default async function ModelPage({ params, searchParams }: { params: Promise<{ model: string }>, searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ model: encodedModel }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  let modelName = encodedModel;
  try { modelName = decodeURIComponent(encodedModel); } catch { /* Preserve literal percent characters in malformed legacy paths. */ }
  const [modelRuns, scorecardResult, compositeProfiles, session] = await Promise.all([
    fetchBenchmarksByModel(modelName, undefined, 500),
    fetchScorecardRunsWithStatus(undefined, modelName),
    fetchCompositeProfiles(),
    fetchSession(),
  ]);
  if (scorecardResult.status === 401) redirect("/login");
  if (scorecardResult.status === 403) return <ApiUnavailableState reason="forbidden" />;
  const scorecardRuns = scorecardResult.data;
  if (!modelRuns || !scorecardRuns) return <ApiUnavailableState />;
  const runs = scorecardRuns.length > 0 ? scorecardRuns : modelRuns;

  let history = modelRuns;
  const engine = typeof resolvedSearchParams.engine === "string" ? resolvedSearchParams.engine : undefined;
  const hw = typeof resolvedSearchParams.hw === "string" ? resolvedSearchParams.hw : undefined;
  const rawC = typeof resolvedSearchParams.c === "string" ? Number(resolvedSearchParams.c) : undefined;
  const concurrency = rawC != null && Number.isInteger(rawC) && rawC > 0 ? rawC : undefined;
  const selectedRunId = typeof resolvedSearchParams.run === "string" ? resolvedSearchParams.run : undefined;
  if (selectedRunId && !history.some((run) => run.id === selectedRunId)) {
    const selected = await fetchRunDetailWithStatus(selectedRunId);
    if (selected?.status === 401) redirect("/login");
    if (selected?.status === 403) return <ApiUnavailableState reason="forbidden" />;
    if (!selected || ![200, 404].includes(selected.status)) return <ApiUnavailableState />;
    if (selected.data?.model === modelName) history = [...history, selected.data];
  }

  // Guard: the model must actually exist in the database (runs or history).
  const modelExists = [...runs, ...history].some((r) => r.model === modelName);
  if (!modelExists) notFound();

  return <ModelDetail model={modelName} runs={runs} history={history} engine={engine} hardware={hw} concurrency={concurrency} selectedRunId={selectedRunId} canViewTraces={session?.scope === "admin"} compositeProfiles={compositeProfiles} />;
}

import { notFound, redirect } from "next/navigation";
import { ModelDetail } from "../../../components/BenchmarkConsole";
import { ApiUnavailableState } from "../../../components/ApiUnavailableState";
import { fetchBenchmarksByModel, fetchCompositeProfiles, fetchScorecardRunsWithStatus } from "../../../lib/benchmarks";

export const dynamic = "force-dynamic";

export default async function ModelPage({ params, searchParams }: { params: Promise<{ model: string }>, searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ model: encodedModel }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const modelName = decodeURIComponent(encodedModel);
  const [modelRuns, scorecardResult, compositeProfiles] = await Promise.all([
    fetchBenchmarksByModel(modelName, undefined, 500),
    fetchScorecardRunsWithStatus(undefined, modelName),
    fetchCompositeProfiles(),
  ]);
  if (scorecardResult.status === 401) redirect("/login");
  if (scorecardResult.status === 403) return <ApiUnavailableState reason="forbidden" />;
  const scorecardRuns = scorecardResult.data;
  if (!modelRuns || !scorecardRuns) return <ApiUnavailableState />;
  const runs = scorecardRuns.length > 0 ? scorecardRuns : modelRuns;

  const history = modelRuns;
  const engine = typeof resolvedSearchParams.engine === "string" ? resolvedSearchParams.engine : undefined;
  const hw = typeof resolvedSearchParams.hw === "string" ? resolvedSearchParams.hw : undefined;
  const rawC = typeof resolvedSearchParams.c === "string" ? parseInt(resolvedSearchParams.c, 10) : undefined;
  const concurrency = rawC && !Number.isNaN(rawC) ? rawC : undefined;

  // Guard: the model must actually exist in the database (runs or history).
  const modelExists = runs.some((r) => r.model === modelName);
  if (!modelExists && runs.length > 0) notFound();

  return <ModelDetail model={modelName} runs={runs} history={history} engine={engine} hardware={hw} concurrency={concurrency} compositeProfiles={compositeProfiles} />;
}

import { BenchmarkOverview } from "../components/BenchmarkConsole";
import { ApiUnavailableState } from "../components/ApiUnavailableState";
import { redirect } from "next/navigation";
import {
  fetchScorecardRunsWithStatus,
  fetchCompositeProfiles,
  fetchApprovalEvaluations,
  fetchApprovalEvaluation,
  fetchSession,
  type ApprovalEvaluation,
} from "../lib/benchmarks";


export default async function Page() {
  const [runsResult, compositeProfiles, batchApprovals, session] = await Promise.all([
    fetchScorecardRunsWithStatus(),
    fetchCompositeProfiles(),
    fetchApprovalEvaluations(),
    fetchSession(),
  ]);

  if (runsResult.status === 401) redirect("/login");
  if (runsResult.status === 403) return <ApiUnavailableState reason="forbidden" />;

  const runs = runsResult.data;
  if (!runs) return <ApiUnavailableState />;

  const history = runs;
  let approvalEvaluations: Record<string, ApprovalEvaluation> = batchApprovals ?? {};

  // If batch endpoint is not available on older backends, perform bounded fallback
  if (!batchApprovals) {
    const approvalRunIds = Array.from(
      new Set(runs.map((run) => run.approval_run_id).filter((id): id is string => Boolean(id)))
    );
    if (approvalRunIds.length > 0) {
      const approvalEvaluationEntries = await Promise.all(
        approvalRunIds.slice(0, 10).map(async (id) => [id, await fetchApprovalEvaluation(id)] as const)
      );
      approvalEvaluations = Object.fromEntries(
        approvalEvaluationEntries.filter((entry): entry is [string, ApprovalEvaluation] => entry[1] != null)
      );
    }
  }

  return (
    <BenchmarkOverview
      runs={runs}
      history={history}
      compositeProfiles={compositeProfiles}
      approvalEvaluations={approvalEvaluations}
      canManageSettings={session?.scope === "admin"}
      registryRevision={Date.now()}
    />
  );
}

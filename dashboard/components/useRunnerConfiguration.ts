"use client";

import { useEffect, useState } from "react";

type RegistryRecord = { id: string; name: string };

export function useRunnerRegistry(enabled: boolean) {
  const [registry, setRegistry] = useState<{ suites: RegistryRecord[]; prompts: RegistryRecord[]; strategies: RegistryRecord[] }>({ suites: [], prompts: [], strategies: [] });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void Promise.all(["suites", "prompts", "strategies"].map(async (name) => {
      const response = await fetch(`/api/${name}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Unable to load ${name} (HTTP ${response.status})`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error(`Invalid ${name} registry`);
      const active = rows.filter((row) => row && !row.is_archived && row.is_active !== false);
      if (!active.length || active.some((row) => typeof row.id !== "string" || typeof row.name !== "string")) {
        throw new Error(`No valid active ${name} available. Configure them in Settings.`);
      }
      return active as RegistryRecord[];
    })).then(([suites, prompts, strategies]) => {
      if (!controller.signal.aborted) { setRegistry({ suites, prompts, strategies }); setError(null); }
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load runner configuration");
    });
    return () => controller.abort();
  }, [enabled]);
  return { ...registry, error };
}

export function useSuiteExecution(suiteId: string, enabled: boolean, refreshKey: string | number = 0) {
  const [state, setState] = useState<{ suiteId: string; runnable: boolean; reason: string } | null>(null);
  useEffect(() => {
    if (!enabled || !suiteId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/suites/${encodeURIComponent(suiteId)}/execution`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Suite compatibility check failed (HTTP ${response.status})${response.status === 404 ? ". Update the backend or select an existing suite." : ""}`);
        const result = await response.json();
        if (result.suite_id !== suiteId || typeof result.runnable !== "boolean" || !Array.isArray(result.unsupported_task_types)) throw new Error("Invalid suite compatibility response");
        if (!controller.signal.aborted) setState({ suiteId, runnable: result.runnable,
          reason: result.runnable ? "" : result.task_count === 0 ? "This suite has no tasks."
            : result.invalid_tasks?.length ? result.invalid_tasks.map((task: { id: string; error: string }) => `${task.id}: ${task.error}`).join("; ")
            : `Unsupported scorers: ${result.unsupported_task_types.join(", ")}. This suite cannot run with the shared scorers; its stored tasks are unchanged.` });
      } catch (cause) {
        if (!controller.signal.aborted) setState({ suiteId, runnable: false, reason: cause instanceof Error ? cause.message : "Unable to check suite compatibility" });
      }
    })();
    return () => controller.abort();
  }, [suiteId, enabled, refreshKey]);
  return state?.suiteId === suiteId ? state : { suiteId, runnable: false, reason: suiteId ? "Checking suite compatibility…" : "Select a benchmark suite." };
}

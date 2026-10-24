"use client";

import { apiErrorMessage } from "../../lib/apiErrors";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";

type Impact = { run_count: number; task_count: number; category_count: number };

export function RegistryDeleteDialog({ resource, entry, label, onCancel, onDeleted }: {
  resource: "suites" | "prompts" | "strategies";
  entry: { id: string; name: string } | null;
  label: string;
  onCancel: () => void;
  onDeleted: (impact: Impact) => void;
}) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const entryId = entry?.id;
  const path = `/api/${resource}/${encodeURIComponent(entryId ?? "")}`;

  useEffect(() => {
    setImpact(null);
    setError("");
    if (!entryId) return;
    const controller = new AbortController();
    fetch(path + "/deletion-impact", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(apiErrorMessage(data, "Unable to check associated runs"));
        if (!controller.signal.aborted) setImpact(data);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to check associated runs"); });
    return () => controller.abort();
  }, [entryId, path]);

  const remove = async () => {
    if (!impact || impact.run_count > 0 || deleting) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`${path}?expected_run_count=${impact.run_count}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(data, "Unable to delete configuration"));
      onDeleted(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete configuration");
      // A changed count must receive a new warning and a fresh confirmation.
      setImpact(null);
    } finally {
      setDeleting(false);
    }
  };

  return <ConfirmDialog
    open={Boolean(entry)}
    title={impact && impact.run_count > 0 ? `Cannot delete ${label}` : `Delete ${label}?`}
    description={error ? `${error} Close this dialog and try again.` : impact
      ? impact.run_count > 0
        ? `“${entry?.name}” is used by ${impact.run_count} recorded benchmark run${impact.run_count === 1 ? "" : "s"}. Deletion is unavailable to preserve those results. You can continue using this configuration or create another one.`
        : `Permanently delete “${entry?.name}”?${resource === "suites" ? ` This also deletes ${impact.task_count} task${impact.task_count === 1 ? "" : "s"} and ${impact.category_count} categor${impact.category_count === 1 ? "y" : "ies"}.` : ""} No recorded benchmark runs will be removed. This cannot be undone.`
      : "Checking associated benchmark runs…"}
    confirmLabel={impact && impact.run_count > 0 ? "In use by recorded runs" : `Delete ${label}`}
    confirmDisabled={!impact || impact.run_count > 0 || Boolean(error)}
    busy={deleting}
    onCancel={() => { if (!deleting) onCancel(); }}
    onConfirm={() => void remove()}
  />;
}

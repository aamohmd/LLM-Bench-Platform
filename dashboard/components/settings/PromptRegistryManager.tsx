"use client";

import { apiErrorMessage } from "../../lib/apiErrors";

import { FormEvent, useEffect, useState } from "react";
import { SettingsSectionSkeleton } from "../SkeletonState";
import { RegistryDeleteDialog } from "./RegistryDeleteDialog";
import { useDialogAccessibility } from "../useDialogAccessibility";

type Prompt = {
  id: string;
  name: string;
  description?: string | null;
  is_builtin: boolean;
  system_prompt: string;
  content_hash: string;
  usage_count: number;
};

export function PromptRegistryManager({ onNotify }: { onNotify: (message: string) => void }) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");

  // Edit State
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Prompt | null>(null);
  const editDialogRef = useDialogAccessibility<HTMLFormElement>(Boolean(editing), () => setEditing(null));

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/prompts", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(data, "Unable to load prompts"));
      setPrompts(data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load prompts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          system_prompt: systemPrompt,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(data, "Unable to create prompt"));
      setName("");
      setDescription("");
      setSystemPrompt("");
      onNotify(`Prompt '${data.name}' created.`);
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create prompt");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/prompts/${editing.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: editing.description || null,
          system_prompt: editing.system_prompt,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(data, "Unable to update prompt"));
      setEditing(null);
      onNotify(`Prompt '${data.name}' updated.`);
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update prompt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-section-card prompt-registry">
      <div className="settings-section-card-header prompt-registry__header">
        <div>
          <h2>Prompts</h2>
          <p>
            Foundational system prompts with immutable provenance for every benchmark run.
          </p>
        </div>
        <div className="prompt-registry__summary"><strong>{prompts.length}</strong><span>prompts</span></div>
      </div>

      {error && !editing && (
        <div className="settings-error-banner" role="alert">
          <strong>Action Error</strong>: {error}
        </div>
      )}

      {/* Creation Form */}
      <form className="settings-create-form-panel prompt-registry__create" onSubmit={create}>
        <div className="prompt-registry__create-heading">
          <div>
            <strong>New system prompt</strong>
            <span>Create a distinct foundational system prompt for your workloads.</span>
          </div>
        </div>

        <div className="settings-form-grid">
          <label className="settings-form-field">
            <span className="settings-field-label">Prompt name</span>
            <input
              required
              pattern={"[a-z0-9][a-z0-9_\\-]*"}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="e.g. evidence_grounded"
            />
          </label>

          <label className="settings-form-field">
            <span className="settings-field-label">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When and how to use this prompt"
            />
          </label>
        </div>

        <label className="settings-form-field" style={{ marginTop: "12px" }}>
          <span className="settings-field-label">System prompt</span>
          <textarea
            required
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={6}
            placeholder="You are a precise, evidence-grounded assistant..."
          />
        </label>

        <div className="settings-form-footer">
          <button className="settings-btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Create prompt"}
          </button>
        </div>
      </form>

      {/* Inventory Section */}
      {loading ? (
        <SettingsSectionSkeleton label="Loading prompt registry" rows={4} compact />
      ) : (
        <div className="settings-inventory-card prompt-registry__inventory">
          <div className="prompt-registry__inventory-heading">
            <span>Registered prompts</span>
            <span>{prompts.length} total</span>
          </div>

          <div className="settings-inventory-table-wrap">
            <table className="settings-key-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Usage</th>
                  <th>System prompt</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {prompts.map((prompt) => (
                  <tr key={prompt.id}>
                    <td className="settings-key-col-main">
                      <div className="settings-key-title-cell">
                        <strong>{prompt.name}</strong>
                        {prompt.is_builtin && <span className="settings-env-badge">Built-in</span>}
                      </div>
                      {prompt.description && <small>{prompt.description}</small>}
                    </td>
                    <td>
                      <span className="prompt-registry__usage">
                        {prompt.usage_count} <small>{prompt.usage_count === 1 ? "run" : "runs"}</small>
                      </span>
                    </td>
                    <td>
                      <code className="prompt-registry__excerpt">
                        {prompt.system_prompt.slice(0, 100)}
                        {prompt.system_prompt.length > 100 ? "…" : ""}
                      </code>
                    </td>
                    <td>
                      <div className="prompt-registry__actions">
                        <button
                          type="button"
                          className="settings-btn-ghost"
                          onClick={() => {
                            setError(null);
                            setEditing({ ...prompt });
                          }}
                        >
                          Edit
                        </button>
                        {!prompt.is_builtin && (
                          <button
                            type="button"
                            className="settings-btn-danger-sm"
                            onClick={() => setPendingDelete(prompt)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="settings-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}>
          <form ref={editDialogRef} className="settings-modal-card prompt-registry__modal" onSubmit={saveEdit} role="dialog" aria-modal="true" aria-labelledby="prompt-editor-title" tabIndex={-1}>
            <span className="text-eyebrow">Prompt editor</span>
            <h3 id="prompt-editor-title" className="settings-modal-title">Edit {editing.name}</h3>
            {error && <p className="settings-error-banner" role="alert">{error}</p>}
            <label className="settings-form-field">
              <span className="settings-field-label">Description</span>
              <input
                value={editing.description || ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </label>
            <label className="settings-form-field">
              <span className="settings-field-label">System prompt</span>
              <textarea
                required
                rows={10}
                value={editing.system_prompt}
                onChange={(e) => setEditing({ ...editing, system_prompt: e.target.value })}
              />
            </label>
            <div className="settings-modal-actions">
              <button type="button" className="settings-btn-secondary" onClick={() => setEditing(null)}>
                Close
              </button>
              <button className="settings-btn-primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      )}
      <RegistryDeleteDialog
        resource="prompts" entry={pendingDelete} label="prompt"
        onCancel={() => setPendingDelete(null)}
        onDeleted={() => {
          onNotify(`Prompt '${pendingDelete?.name}' deleted. Recorded results are unchanged.`);
          setPendingDelete(null);
          void load();
        }}
      />
    </section>
  );
}

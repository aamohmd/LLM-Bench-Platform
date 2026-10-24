"use client";

import { apiErrorMessage } from "../../lib/apiErrors";

import { FormEvent, useEffect, useState } from "react";
import { SettingsSectionSkeleton } from "../SkeletonState";
import { RegistryDeleteDialog } from "./RegistryDeleteDialog";
import { useDialogAccessibility } from "../useDialogAccessibility";

type Strategy = {
  id: string;
  name: string;
  label: string;
  description?: string | null;
  directive_text?: string | null;
  is_builtin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export function StrategyRegistryManager({ onNotify }: { onNotify: (message: string) => void }) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [directiveText, setDirectiveText] = useState("");
  const [editing, setEditing] = useState<Strategy | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDirectiveText, setEditDirectiveText] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<Strategy | null>(null);
  const editDialogRef = useDialogAccessibility<HTMLFormElement>(Boolean(editing), () => setEditing(null));

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/strategies?include_inactive=true", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(data, "Unable to load strategies"));
      setStrategies(Array.isArray(data) ? data : []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load strategies");
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
      const response = await fetch("/api/strategies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim().toLowerCase(),
          label: label.trim(),
          description: description.trim() || null,
          directive_text: directiveText.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(data, "Unable to create strategy"));
      setName("");
      setLabel("");
      setDescription("");
      setDirectiveText("");
      onNotify(`Strategy '${data.label || data.name}' created.`);
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create strategy");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (strategy: Strategy) => {
    setError(null);
    setEditing(strategy);
    setEditLabel(strategy.label);
    setEditDescription(strategy.description || "");
    setEditDirectiveText(strategy.directive_text || "");
    setEditIsActive(strategy.is_active);
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/strategies/${editing.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: editLabel.trim(),
          description: editDescription.trim() || null,
          directive_text: editDirectiveText.trim() || null,
          is_active: editIsActive,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(data, "Unable to update strategy"));
      setEditing(null);
      onNotify(`Strategy '${data.label}' updated.`);
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update strategy");
    } finally {
      setSaving(false);
    }
  };

  const activeCount = strategies.filter((strategy) => strategy.is_active).length;

  return (
    <section className="settings-section-card prompt-registry strategy-registry">
      <div className="settings-section-card-header prompt-registry__header">
        <div>
          <h2>Strategies</h2>
          <p>Reusable reasoning and output directives composed with a foundational system prompt at runtime.</p>
        </div>
        <div className="prompt-registry__summary"><strong>{activeCount}</strong><span>active strategies</span></div>
      </div>

      {error && !editing && (
        <div className="settings-error-banner" role="alert">
          <strong>Action Error</strong>: {error}
        </div>
      )}

      <form onSubmit={(event) => void create(event)} className="settings-create-form-panel prompt-registry__create">
        <div className="prompt-registry__create-heading">
          <div>
            <strong>New reasoning strategy</strong>
            <span>Create a focused directive that can be paired with any registered system prompt.</span>
          </div>
          <span className="prompt-registry__version-note">Runtime layer</span>
        </div>

        <div className="settings-form-grid">
          <label className="settings-form-field">
            <span className="settings-field-label">Strategy slug</span>
            <input required pattern={"[a-z0-9][a-z0-9_\\-]*"} placeholder="e.g. compliance_review" value={name} onChange={(event) => setName(event.target.value.toLowerCase())} />
            <span className="settings-field-hint">CLI: --strategy {name || "strategy_name"}</span>
          </label>
          <label className="settings-form-field">
            <span className="settings-field-label">Display label</span>
            <input required placeholder="e.g. Compliance Review" value={label} onChange={(event) => setLabel(event.target.value)} />
            <span className="settings-field-hint">Shown in controls and benchmark provenance</span>
          </label>
        </div>

        <label className="settings-form-field" style={{ marginTop: "12px" }}>
          <span className="settings-field-label">Description</span>
          <input placeholder="When this strategy should be used" value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label className="settings-form-field" style={{ marginTop: "12px" }}>
          <span className="settings-field-label">Directive text</span>
          <textarea rows={6} placeholder="Add concise reasoning or response-format instructions…" value={directiveText} onChange={(event) => setDirectiveText(event.target.value)} />
          <span className="settings-field-hint">Appended to the selected system prompt during composition</span>
        </label>
        <div className="settings-form-footer">
          <button type="submit" className="settings-btn-primary" disabled={saving}>{saving ? "Saving…" : "Create strategy"}</button>
        </div>
      </form>

      {loading ? (
        <SettingsSectionSkeleton label="Loading reasoning strategies" rows={4} compact />
      ) : (
        <div className="settings-inventory-card prompt-registry__inventory">
          <div className="prompt-registry__inventory-heading">
            <span>Registered strategies</span>
            <span>{strategies.length} total</span>
          </div>
          {strategies.length === 0 ? (
            <p className="settings-table-empty">No strategies registered.</p>
          ) : (
            <div className="settings-inventory-table-wrap">
              <table className="settings-key-table">
                <thead>
                  <tr><th>Strategy</th><th>Status</th><th>Directive</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {strategies.map((strategy) => (
                    <tr key={strategy.id}>
                      <td className="settings-key-col-main">
                        <div className="settings-key-title-cell">
                          <strong>{strategy.label}</strong>
                          {strategy.is_builtin && <span className="settings-env-badge">Built-in</span>}
                        </div>
                        <code className="strategy-registry__slug">--strategy {strategy.name}</code>
                        {strategy.description && <small>{strategy.description}</small>}
                      </td>
                      <td>
                        <span className={`settings-status-pill ${strategy.is_active ? "is-active" : "is-expired"}`}>
                          <span className="settings-status-dot" />
                          {strategy.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        {strategy.directive_text ? (
                          <code className="prompt-registry__excerpt" title={strategy.directive_text}>{strategy.directive_text}</code>
                        ) : (
                          <span className="strategy-registry__empty-directive">No additional directive</span>
                        )}
                      </td>
                      <td>
                        <div className="prompt-registry__actions">
                          <button type="button" className="settings-btn-ghost" onClick={() => startEdit(strategy)}>Edit</button>
                          {!strategy.is_builtin && <button type="button" className="settings-btn-danger-sm" onClick={() => setPendingDelete(strategy)}>Delete</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="settings-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}>
          <form ref={editDialogRef} className="settings-modal-card prompt-registry__modal" onSubmit={(event) => void saveEdit(event)} role="dialog" aria-modal="true" aria-labelledby="strategy-editor-title" tabIndex={-1}>
            <span className="text-eyebrow">Strategy editor</span>
            <h3 id="strategy-editor-title" className="settings-modal-title">Edit {editing.label}</h3>
            {error && <p className="settings-error-banner" role="alert">{error}</p>}
            <p className="strategy-registry__modal-slug">--strategy {editing.name}</p>
            <div className="settings-form-grid strategy-registry__modal-grid">
              <label className="settings-form-field">
                <span className="settings-field-label">Display label</span>
                <input required value={editLabel} onChange={(event) => setEditLabel(event.target.value)} />
              </label>
              <label className="settings-form-field">
                <span className="settings-field-label">Availability</span>
                <select value={editIsActive ? "active" : "inactive"} onChange={(event) => setEditIsActive(event.target.value === "active")}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>
            <label className="settings-form-field">
              <span className="settings-field-label">Description</span>
              <input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
            </label>
            <label className="settings-form-field">
              <span className="settings-field-label">Directive text</span>
              <textarea rows={8} value={editDirectiveText} onChange={(event) => setEditDirectiveText(event.target.value)} />
            </label>
            <div className="settings-modal-actions">
              <button type="button" className="settings-btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="settings-btn-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
            </div>
          </form>
        </div>
      )}
      <RegistryDeleteDialog
        resource="strategies" entry={pendingDelete} label="strategy"
        onCancel={() => setPendingDelete(null)}
        onDeleted={() => {
          onNotify(`Strategy '${pendingDelete?.label}' deleted. Recorded results are unchanged.`);
          setPendingDelete(null);
          void load();
        }}
      />
    </section>
  );
}

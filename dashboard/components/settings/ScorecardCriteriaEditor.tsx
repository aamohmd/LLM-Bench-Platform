"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import {
  Award,
  Layers3,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { ScorecardCriteria } from "../../lib/scorecard";
import { BenchmarkSuite } from "../../lib/taskParser";
import { ConfirmDialog } from "../ConfirmDialog";
import { SettingsSectionSkeleton } from "../SkeletonState";
import { useDialogAccessibility } from "../useDialogAccessibility";

type CriteriaNumberField =
  | "min_decode_tps"
  | "fast_ttft_s"
  | "tail_ttft_ceiling_s"
  | "min_quality_score"
  | "memory_stability_max_pct"
  | "max_error_rate";

type WeightField = "weight_quality" | "weight_speed" | "weight_fit";

type GateControlProps = {
  help: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix: string;
  value: number;
  valueLabel: string;
};

function GateControl({ help, label, max, min, onChange, step, suffix, value, valueLabel }: GateControlProps) {
  const fieldId = useId();
  const [draft, setDraft] = useState(String(value));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) setDraft(String(value));
  }, [isEditing, value]);

  const handleNumberChange = (nextValue: string) => {
    setDraft(nextValue);
    if (!nextValue.trim()) return;
    const parsed = Number(nextValue);
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
  };

  const finishNumberEdit = () => {
    setIsEditing(false);
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const bounded = Math.max(min, Math.min(max, parsed));
    onChange(bounded);
    setDraft(String(bounded));
  };

  return (
    <div className="criteria-editor__gate">
      <div className="criteria-editor__gate-heading">
        <strong>{label}</strong>
        <span>{valueLabel}</span>
      </div>
      <div className="criteria-editor__gate-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={`${label} slider`}
          aria-describedby={`${fieldId}-help`}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <label className="criteria-editor__number-control" htmlFor={`${fieldId}-number`}>
          <span className="sr-only">{label} exact value</span>
          <input
            id={`${fieldId}-number`}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={draft}
            aria-describedby={`${fieldId}-help`}
            onFocus={() => setIsEditing(true)}
            onChange={(event) => handleNumberChange(event.target.value)}
            onBlur={finishNumberEdit}
          />
          <span aria-hidden="true">{suffix}</span>
        </label>
      </div>
      <span className="criteria-editor__gate-help">{help}</span>
      <span className="sr-only" id={`${fieldId}-help`}>Allowed range: {min} to {max} {suffix}. Use arrow keys or type a value.</span>
    </div>
  );
}

type WeightControlProps = {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
};

function WeightControl({ label, max, min, onChange, value }: WeightControlProps) {
  const [draft, setDraft] = useState(String(Math.round(value * 100)));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) setDraft(String(Math.round(value * 100)));
  }, [isEditing, value]);

  const handleChange = (nextValue: string) => {
    setDraft(nextValue);
    if (!nextValue.trim()) return;
    const parsed = Number(nextValue);
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed / 100);
  };

  const finishEdit = () => {
    setIsEditing(false);
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(Math.round(value * 100)));
      return;
    }
    const bounded = Math.max(min, Math.min(max, parsed));
    onChange(bounded / 100);
    setDraft(String(bounded));
  };

  return (
    <label className="criteria-editor__number-control criteria-editor__weight-number">
      <span className="sr-only">{label} weight exact value</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={1}
        value={draft}
        aria-label={`${label} weight percent`}
        onFocus={() => setIsEditing(true)}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={finishEdit}
      />
      <span aria-hidden="true">%</span>
    </label>
  );
}

export function ScorecardCriteriaEditor({ onNotify }: { onNotify: (msg: string) => void }) {
  const [profiles, setProfiles] = useState<ScorecardCriteria[]>([]);
  const [suites, setSuites] = useState<BenchmarkSuite[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeForm, setActiveForm] = useState<ScorecardCriteria | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assigningSuiteId, setAssigningSuiteId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const closeEditor = () => {
    if (saving) return;
    setActiveForm(null);
    setEditorError(null);
  };
  const closeCreator = () => {
    if (saving) return;
    setIsCreatingNew(false);
    setCreateError(null);
  };
  const editDialogRef = useDialogAccessibility<HTMLFormElement>(Boolean(activeForm) && !confirmDelete, closeEditor);
  const createDialogRef = useDialogAccessibility<HTMLFormElement>(isCreatingNew, closeCreator);

  const loadData = async () => {
    setLoading(true);
    try {
      const [criteriaRes, suitesRes] = await Promise.all([
        fetch("/api/scorecard/criteria"),
        fetch("/api/suites"),
      ]);
      if (!criteriaRes.ok) throw new Error(`Unable to load SLA policies (HTTP ${criteriaRes.status})`);
      if (!suitesRes.ok) throw new Error(`Unable to load benchmark suites (HTTP ${suitesRes.status})`);
      const [criteriaData, suiteData] = await Promise.all([criteriaRes.json(), suitesRes.json()]);
      setProfiles(Array.isArray(criteriaData) ? criteriaData : []);
      setSuites(Array.isArray(suiteData) ? suiteData : []);
      setLoadError(null);
      setPageError(null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Unable to load SLA settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const openEditor = (profile: ScorecardCriteria) => {
    setEditorError(null);
    setActiveForm({ ...profile });
  };

  const updateCriteriaNumber = (field: CriteriaNumberField, value: number) => {
    setActiveForm((current) => current ? { ...current, [field]: value } : current);
  };

  const updateWeight = (field: WeightField, value: number) => {
    const min = field === "weight_fit" ? 0.05 : 0.1;
    const max = field === "weight_fit" ? 0.5 : 0.8;
    const clamped = Math.max(min, Math.min(max, value));
    setActiveForm((current) => current ? { ...current, [field]: clamped } : current);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeForm?.id) return;
    const name = activeForm.name?.trim() ?? "";
    if (!name) {
      setEditorError("SLA name is required.");
      return;
    }
    const duplicate = profiles.some(
      (profile) => profile.id !== activeForm.id && profile.name?.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      setEditorError(`An SLA named “${name}” already exists.`);
      return;
    }

    setEditorError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/scorecard/criteria/${encodeURIComponent(activeForm.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...activeForm, name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "The SLA policy could not be saved.");
      setProfiles((current) => current.map((profile) => profile.id === data.id ? data : profile));
      setActiveForm(null);
      onNotify(`SLA policy '${name}' saved.`);
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : "The SLA policy could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateNew = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      setCreateError("SLA name is required.");
      return;
    }
    if (profiles.some((profile) => profile.name?.trim().toLowerCase() === name.toLowerCase())) {
      setCreateError(`An SLA named “${name}” already exists.`);
      return;
    }

    setSaving(true);
    setCreateError(null);
    try {
      const payload: ScorecardCriteria = {
        id: `sla_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        name,
        description: newDesc.trim() || "Custom SLA criteria",
        is_default: false,
        is_locked: false,
      };
      const response = await fetch("/api/scorecard/criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "The SLA policy could not be created.");
      setProfiles((current) => [...current, data]);
      setIsCreatingNew(false);
      setNewName("");
      setNewDesc("");
      onNotify(`SLA policy '${name}' created.`);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "The SLA policy could not be created.");
    } finally {
      setSaving(false);
    }
  };

  const handleAssignment = async (suite: BenchmarkSuite, criteriaId: string) => {
    const previousId = suite.sla_criteria_id ?? null;
    setAssigningSuiteId(suite.id);
    setPageError(null);
    setSuites((current) => current.map(
      (item) => item.id === suite.id ? { ...item, sla_criteria_id: criteriaId } : item,
    ));
    try {
      const response = await fetch(`/api/suites/${encodeURIComponent(suite.id)}/sla`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criteria_id: criteriaId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "The SLA assignment could not be saved.");
      setSuites((current) => current.map((item) => item.id === suite.id ? { ...item, ...data } : item));
      const policyName = profiles.find((profile) => profile.id === criteriaId)?.name ?? criteriaId;
      onNotify(`${suite.name} now uses ${policyName}.`);
    } catch (cause) {
      setSuites((current) => current.map(
        (item) => item.id === suite.id ? { ...item, sla_criteria_id: previousId } : item,
      ));
      setPageError(cause instanceof Error ? cause.message : "The SLA assignment could not be saved.");
    } finally {
      setAssigningSuiteId(null);
    }
  };

  const handleDelete = async () => {
    if (!activeForm?.id || activeForm.is_locked) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/scorecard/criteria/${encodeURIComponent(activeForm.id)}`, {
        method: "DELETE",
      });
      const data = response.status === 204 ? null : await response.json();
      if (!response.ok) throw new Error(data?.detail || "The SLA policy could not be deleted.");
      setProfiles((current) => current.filter((profile) => profile.id !== activeForm.id));
      onNotify(`SLA policy '${activeForm.name}' deleted.`);
      setConfirmDelete(false);
      setActiveForm(null);
    } catch (cause) {
      setConfirmDelete(false);
      setEditorError(cause instanceof Error ? cause.message : "The SLA policy could not be deleted.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SettingsSectionSkeleton label="Loading SLA settings" />;

  if (loadError) {
    return (
      <section className="settings-section-card settings-state-card" role="alert">
        <div>
          <h3>SLA settings could not be loaded</h3>
          <p>{loadError}</p>
        </div>
        <button type="button" className="settings-btn-secondary" onClick={() => void loadData()}>Retry</button>
      </section>
    );
  }

  const assignedCount = suites.filter((suite) => suite.sla_criteria_id).length;
  const activeAssignmentCount = activeForm
    ? suites.filter((suite) => suite.sla_criteria_id === activeForm.id).length
    : 0;
  const wQ = activeForm?.weight_quality ?? 0.6;
  const wS = activeForm?.weight_speed ?? 0.25;
  const wF = activeForm?.weight_fit ?? 0.15;
  const weightTotal = wQ + wS + wF;
  const pctQ = Math.round((wQ / weightTotal) * 100);
  const pctS = Math.round((wS / weightTotal) * 100);
  const pctF = 100 - pctQ - pctS;

  return (
    <section className="settings-section-card criteria-editor">
      <div className="settings-section-card-header criteria-editor__header">
        <div>
          <h2>SLA policies</h2>
          <p>Assign one reusable SLA policy to each benchmark suite. The scoreboard uses that assignment automatically.</p>
        </div>
        <div className="criteria-editor__summary" aria-label="SLA registry summary">
          <span><strong>{profiles.length}</strong> policies</span>
          <span><strong>{suites.length}</strong> suites</span>
          <button
            type="button"
            onClick={() => { setCreateError(null); setIsCreatingNew(true); }}
            className="settings-btn-primary"
          >
            <Plus size={14} aria-hidden="true" /> New SLA
          </button>
        </div>
      </div>

      {pageError && <p className="settings-inline-error" role="alert">{pageError}</p>}

      <div className="criteria-editor__section" aria-labelledby="suite-assignment-title">
        <div className="criteria-editor__subheading">
          <div>
            <h4 id="suite-assignment-title"><Link2 size={16} aria-hidden="true" /> Suite assignments</h4>
            <p>Choose the SLA that should evaluate each existing benchmark suite.</p>
          </div>
          <span className="criteria-editor__assigned-count">{assignedCount}/{suites.length} assigned</span>
        </div>

        {suites.length === 0 ? (
          <p className="criteria-editor__empty">No benchmark suites are available.</p>
        ) : (
          <div className="criteria-editor__assignment-list">
            {suites.map((suite) => (
              <div className="criteria-editor__assignment-row" key={suite.id}>
                <div className="criteria-editor__suite-name">
                  <Layers3 size={16} aria-hidden="true" />
                  <span>
                    <strong>{suite.name}</strong>
                    <small>{suite.domain} · {suite.task_count} tasks</small>
                  </span>
                </div>
                <label>
                  <span className="sr-only">SLA for {suite.name}</span>
                  <select
                    value={suite.sla_criteria_id ?? ""}
                    disabled={profiles.length === 0 || assigningSuiteId === suite.id}
                    aria-busy={assigningSuiteId === suite.id}
                    onChange={(event) => void handleAssignment(suite, event.target.value)}
                  >
                    <option value="" disabled>{profiles.length === 0 ? "Create an SLA first" : "Choose an SLA"}</option>
                    {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select>
                </label>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="criteria-editor__section" aria-labelledby="sla-policy-list-title">
        <div className="criteria-editor__subheading">
          <div>
            <h4 id="sla-policy-list-title"><ShieldCheck size={16} aria-hidden="true" /> SLA policies</h4>
            <p>Review policy thresholds at a glance, or use Edit to change a policy.</p>
          </div>
        </div>

        {profiles.length === 0 ? (
          <div className="criteria-editor__empty criteria-editor__empty--action">
            <span>No SLA policies have been created yet.</span>
            <button type="button" className="settings-btn-secondary" onClick={() => setIsCreatingNew(true)}>
              <Plus size={14} aria-hidden="true" /> Create the first SLA
            </button>
          </div>
        ) : (
          <div className="criteria-editor__policy-list">
            {profiles.map((profile) => {
              const assignmentCount = suites.filter((suite) => suite.sla_criteria_id === profile.id).length;
              return (
                <article className="criteria-editor__policy-row" key={profile.id}>
                  <div className="criteria-editor__policy-identity">
                    <span>
                      <strong>{profile.name}</strong>
                      {profile.is_locked && <span className="criteria-editor__locked-badge">System baseline</span>}
                    </span>
                    <p>{profile.description || "No description provided."}</p>
                  </div>
                  <div className="criteria-editor__policy-thresholds" aria-label={`${profile.name} key thresholds`}>
                    <span><strong>{Math.round((profile.min_quality_score ?? 0.75) * 100)}%</strong> quality</span>
                    <span><strong>{Math.round((profile.tail_ttft_ceiling_s ?? 1.5) * 1000)} ms</strong> p95</span>
                    <span><strong>{profile.min_decode_tps ?? 25}</strong> tok/s</span>
                  </div>
                  <span className="criteria-editor__policy-usage">
                    {assignmentCount} {assignmentCount === 1 ? "suite" : "suites"}
                  </span>
                  <button type="button" className="settings-btn-secondary criteria-editor__edit-button" onClick={() => openEditor(profile)}>
                    <Pencil size={14} aria-hidden="true" /> Edit
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {isCreatingNew && (
        <div className="settings-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeCreator()}>
          <form
            ref={createDialogRef}
            className="settings-modal-card criteria-editor__create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="criteria-create-title"
            tabIndex={-1}
            onSubmit={(event) => void handleCreateNew(event)}
          >
            <div className="criteria-editor__modal-heading">
              <div>
                <span className="text-eyebrow">New policy</span>
                <h3 id="criteria-create-title" className="settings-modal-title">Create an SLA policy</h3>
              </div>
              <button type="button" className="settings-icon-button" aria-label="Close create SLA dialog" onClick={closeCreator}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {createError && <p className="settings-inline-error" role="alert">{createError}</p>}
            <label className="settings-form-field">
              <span className="settings-field-label">SLA name</span>
              <input data-autofocus type="text" placeholder="e.g. Customer support production" value={newName} onChange={(event) => setNewName(event.target.value)} />
            </label>
            <label className="settings-form-field">
              <span className="settings-field-label">Description</span>
              <textarea placeholder="Explain when this SLA should be used." value={newDesc} onChange={(event) => setNewDesc(event.target.value)} rows={3} />
            </label>
            <div className="settings-modal-actions">
              <button type="button" onClick={closeCreator} className="settings-btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="settings-btn-primary">{saving ? "Creating..." : "Create SLA"}</button>
            </div>
          </form>
        </div>
      )}

      {activeForm && (
        <div className="settings-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeEditor()}>
          <form
            ref={editDialogRef}
            className="settings-modal-card criteria-editor__editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="criteria-edit-title"
            tabIndex={-1}
            onSubmit={(event) => void handleSave(event)}
          >
            <div className="criteria-editor__modal-heading criteria-editor__editor-heading">
              <div>
                <span className="text-eyebrow">SLA policy</span>
                <h3 id="criteria-edit-title" className="settings-modal-title">Edit {activeForm.name}</h3>
                <p>{activeAssignmentCount === 0 ? "Not assigned to a suite" : `Used by ${activeAssignmentCount} ${activeAssignmentCount === 1 ? "suite" : "suites"}`}</p>
              </div>
              <button type="button" className="settings-icon-button" aria-label="Close SLA editor" onClick={closeEditor}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="criteria-editor__editor-scroll">
              {editorError && <p className="settings-inline-error" role="alert">{editorError}</p>}

              <div className="criteria-editor__identity-fields">
                <label className="settings-form-field">
                  <span className="settings-field-label">SLA name</span>
                  <input
                    data-autofocus
                    value={activeForm.name ?? ""}
                    disabled={activeForm.is_locked}
                    onChange={(event) => setActiveForm({ ...activeForm, name: event.target.value })}
                  />
                </label>
                <label className="settings-form-field">
                  <span className="settings-field-label">Description</span>
                  <textarea
                    rows={2}
                    value={activeForm.description ?? ""}
                    disabled={activeForm.is_locked}
                    onChange={(event) => setActiveForm({ ...activeForm, description: event.target.value })}
                  />
                </label>
              </div>

              <section className="criteria-editor__editor-section" aria-labelledby="criteria-gates-title">
                <div className="criteria-editor__editor-section-heading">
                  <ShieldCheck size={16} aria-hidden="true" />
                  <div>
                    <h4 id="criteria-gates-title">Production gates</h4>
                    <p>A benchmark must satisfy these minimum operating thresholds.</p>
                  </div>
                </div>
                <div className="criteria-editor__gates-grid">
                  <GateControl
                    label="Minimum decode throughput"
                    value={activeForm.min_decode_tps ?? 25}
                    valueLabel={`${activeForm.min_decode_tps ?? 25} tok/s`}
                    suffix="tok/s"
                    min={10} max={80} step={1}
                    help="Minimum sustained generation rate under target concurrency."
                    onChange={(value) => updateCriteriaNumber("min_decode_tps", value)}
                  />
                  <GateControl
                    label="Target median TTFT"
                    value={(activeForm.fast_ttft_s ?? 0.8) * 1000}
                    valueLabel={`${Math.round((activeForm.fast_ttft_s ?? 0.8) * 1000)} ms`}
                    suffix="ms"
                    min={200} max={2500} step={50}
                    help="Interactive response median threshold for prefill."
                    onChange={(value) => updateCriteriaNumber("fast_ttft_s", value / 1000)}
                  />
                  <GateControl
                    label="Tail p95 latency ceiling"
                    value={(activeForm.tail_ttft_ceiling_s ?? 1.5) * 1000}
                    valueLabel={`${Math.round((activeForm.tail_ttft_ceiling_s ?? 1.5) * 1000)} ms`}
                    suffix="ms"
                    min={500} max={4000} step={100}
                    help="Maximum acceptable p95 latency under surge load."
                    onChange={(value) => updateCriteriaNumber("tail_ttft_ceiling_s", value / 1000)}
                  />
                  <GateControl
                    label="Minimum task accuracy"
                    value={(activeForm.min_quality_score ?? 0.75) * 100}
                    valueLabel={`${Math.round((activeForm.min_quality_score ?? 0.75) * 100)}%`}
                    suffix="%"
                    min={50} max={95} step={1}
                    help="Non-negotiable accuracy threshold across required tasks."
                    onChange={(value) => updateCriteriaNumber("min_quality_score", value / 100)}
                  />
                  <GateControl
                    label="Peak VRAM / KV budget"
                    value={activeForm.memory_stability_max_pct ?? 85}
                    valueLabel={`${activeForm.memory_stability_max_pct ?? 85}%`}
                    suffix="%"
                    min={60} max={95} step={1}
                    help="Maximum saturation before rejection due to OOM risk."
                    onChange={(value) => updateCriteriaNumber("memory_stability_max_pct", value)}
                  />
                  <GateControl
                    label="Maximum error rate"
                    value={(activeForm.max_error_rate ?? 0.01) * 100}
                    valueLabel={`${((activeForm.max_error_rate ?? 0.01) * 100).toFixed(1)}%`}
                    suffix="%"
                    min={0} max={5} step={0.5}
                    help="Strict reliability precondition for transaction failures."
                    onChange={(value) => updateCriteriaNumber("max_error_rate", value / 100)}
                  />
                </div>
              </section>

              <section className="criteria-editor__editor-section" aria-labelledby="criteria-weights-title">
                <div className="criteria-editor__editor-section-heading">
                  <Award size={16} aria-hidden="true" />
                  <div>
                    <h4 id="criteria-weights-title">Composite score balance</h4>
                    <p>Set each weight coefficient as a percentage; the score normalizes coefficients to their combined total.</p>
                  </div>
                </div>
                <div className="criteria-editor__weight-bar" aria-label={`Quality ${pctQ}%, speed ${pctS}%, hardware fit ${pctF}%`}>
                  <span style={{ width: `${pctQ}%` }} />
                  <span style={{ width: `${pctS}%` }} />
                  <span style={{ width: `${pctF}%` }} />
                </div>
                <div className="criteria-editor__weights-grid">
                  {([
                    ["weight_quality", "Quality", wQ, pctQ],
                    ["weight_speed", "Speed", wS, pctS],
                    ["weight_fit", "Hardware fit", wF, pctF],
                  ] as const).map(([field, label, value, percent]) => (
                    <div className={`criteria-editor__weight criteria-editor__weight--${field}`} key={field}>
                      <span><strong>{label}</strong><span>{percent}% of total</span></span>
                      <div className="criteria-editor__weight-control">
                        <input type="range" min={field === "weight_fit" ? 0.05 : 0.1} max={field === "weight_fit" ? 0.5 : 0.8} step={0.05} value={value} aria-label={`${label} weight slider`} onChange={(event) => updateWeight(field, Number(event.target.value))} />
                        <WeightControl
                          label={label}
                          min={field === "weight_fit" ? 5 : 10}
                          max={field === "weight_fit" ? 50 : 80}
                          value={value}
                          onChange={(nextValue) => updateWeight(field, nextValue)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="criteria-editor__editor-actions">
              <div>
                {!activeForm.is_locked && (
                  <button
                    type="button"
                    className="settings-btn-danger-sm"
                    onClick={() => setConfirmDelete(true)}
                    disabled={activeAssignmentCount > 0}
                    title={activeAssignmentCount > 0 ? `Reassign ${activeAssignmentCount} suite${activeAssignmentCount === 1 ? "" : "s"} before deleting this SLA` : undefined}
                  >
                    <Trash2 size={13} aria-hidden="true" /> Delete
                  </button>
                )}
              </div>
              <div>
                <button type="button" className="settings-btn-secondary" onClick={() => {
                  const original = profiles.find((profile) => profile.id === activeForm.id);
                  if (original) setActiveForm({ ...original });
                  setEditorError(null);
                }}>
                  <RotateCcw size={13} aria-hidden="true" /> Reset
                </button>
                <button type="button" className="settings-btn-secondary" onClick={closeEditor}>Cancel</button>
                <button type="submit" className="settings-btn-primary" disabled={saving}>{saving ? "Saving..." : "Save policy"}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete SLA policy?"
        description={`Delete “${activeForm?.name ?? "this policy"}”? Existing benchmark results will remain available.`}
        confirmLabel="Delete SLA"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
      />
    </section>
  );
}

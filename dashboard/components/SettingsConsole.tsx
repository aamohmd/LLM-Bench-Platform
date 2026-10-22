"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, KeyRound, Layers3, ListChecks, MessagesSquare, Search, Workflow, X } from "lucide-react";
import { LogoutButton } from "./LogoutButton";
import { TaskSuiteManager } from "./settings/TaskSuiteManager";
import { ScorecardCriteriaEditor } from "./settings/ScorecardCriteriaEditor";
import { PromptRegistryManager } from "./settings/PromptRegistryManager";
import { StrategyRegistryManager } from "./settings/StrategyRegistryManager";
import { SettingsSectionSkeleton } from "./SkeletonState";
import { ConfirmDialog } from "./ConfirmDialog";
import { shellQuote } from "../lib/runnerCommand";
import { SetupGuide } from "./SetupGuide";

type KeyScope = "admin" | "visitor";
type KeyStatus = "active" | "revoked" | "expired";
type SettingsTab = "api_keys" | "tasks" | "criteria" | "prompts" | "strategies";

const SETTINGS_SECTIONS: Array<{ id: SettingsTab; label: string; description: string; icon: typeof KeyRound }> = [
  { id: "tasks", label: "Suites & tasks", description: "Organize benchmark work", icon: Layers3 },
  { id: "criteria", label: "SLA policies", description: "Set qualification rules", icon: ListChecks },
  { id: "prompts", label: "Prompts", description: "Manage base instructions", icon: MessagesSquare },
  { id: "strategies", label: "Strategies", description: "Manage reasoning methods", icon: Workflow },
  { id: "api_keys", label: "API access", description: "Manage runner credentials", icon: KeyRound },
];

type ApiKey = {
  id: number;
  name: string;
  scope: KeyScope;
  environment: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  status: KeyStatus;
};

type CreatedKey = ApiKey & { key: string };

type BackendHealth = {
  status: string;
  latency_ms?: number;
  checked_at?: string;
  error?: string | null;
};

function formatDate(value: string | null, fallback: string = "Never") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? fallback
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function SettingsConsole({ canManageSettings, initialSection }: { canManageSettings: boolean; initialSection?: string }) {
  const activeTab: SettingsTab = SETTINGS_SECTIONS.some((section) => section.id === initialSection) ? initialSection as SettingsTab : "tasks";
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Key creation form state
  const [isCreating, setIsCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("");
  const [scope, setScope] = useState<KeyScope>("admin");
  const [expiry, setExpiry] = useState<"never" | "30" | "90" | "365">("never");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedQuickstart, setCopiedQuickstart] = useState(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterScope, setFilterScope] = useState<"all" | "active" | "admin" | "visitor" | "inactive">("all");

  // Revocation Modal state
  const [revokingKey, setRevokingKey] = useState<ApiKey | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  // Live Ping / Backend Health state
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  // Toast notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function showToast(msg: string) {
    setToastMessage(msg);
    window.dispatchEvent(new Event("setup-progress-changed"));
    setTimeout(() => setToastMessage(null), 3500);
  }

  async function loadKeys() {
    setLoading(true);
    try {
      const response = await fetch("/api/api-keys", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Unable to load API keys");
      setKeys(data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load API keys");
    } finally {
      setLoading(false);
    }
  }

  async function checkPing() {
    setIsCheckingHealth(true);
    const start = performance.now();
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const latency = Math.round(performance.now() - start);
      const data = await response.json();
      if (!response.ok) {
        setHealth({
          status: "error",
          error: data.detail || "Backend error",
          latency_ms: latency,
          checked_at: new Date().toISOString(),
        });
      } else {
        setHealth({
          ...data,
          latency_ms: latency,
          checked_at: new Date().toISOString(),
        });
      }
    } catch (cause) {
      setHealth({
        status: "offline",
        error: cause instanceof Error ? cause.message : "Unreachable",
        latency_ms: 0,
        checked_at: new Date().toISOString(),
      });
    } finally {
      setIsCheckingHealth(false);
    }
  }

  useEffect(() => {
    if (!canManageSettings) return;
    if (activeTab === "api_keys") void loadKeys();
    void checkPing();
  }, [canManageSettings, activeTab]);

  async function handleCreateKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("A key identifier or name is required");
      return;
    }
    setSubmitting(true);
    try {
      const expiresAt =
        expiry === "never"
          ? null
          : new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000).toISOString();

      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          environment: environment.trim() || null,
          scope,
          expires_at: expiresAt,
        }),
      });

      const data = (await response.json()) as CreatedKey | { detail?: string };
      if (!response.ok || !("key" in data)) {
        throw new Error("detail" in data ? data.detail || "Unable to create API key" : "Unable to create API key");
      }

      setCreatedSecret(data.key);
      setName("");
      setEnvironment("");
      setScope("admin");
      setExpiry("never");
      setIsCreating(false);
      await loadKeys();
      showToast("API Key created successfully");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create API key");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevokeConfirm() {
    if (!revokingKey) return;
    setIsRevoking(true);
    try {
      const response = await fetch(`/api/api-keys/${revokingKey.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Unable to revoke API key");

      setKeys((prev) =>
        prev.map((k) =>
          k.id === revokingKey.id
            ? { ...k, status: "revoked", revoked_at: new Date().toISOString() }
            : k
        )
      );
      setRevokingKey(null);
      showToast(`Key “${revokingKey.name}” revoked`);
      await loadKeys();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke API key");
    } finally {
      setIsRevoking(false);
    }
  }

  async function handleCopyText(text: string, isSnippet = false) {
    try {
      await navigator.clipboard.writeText(text);
      if (isSnippet) {
        setCopiedQuickstart(true);
        setTimeout(() => setCopiedQuickstart(false), 2500);
      } else {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2500);
      }
    } catch {
      showToast("Failed to copy to clipboard");
    }
  }

  const stats = useMemo(() => {
    const total = keys.length;
    const active = keys.filter((k) => k.status === "active").length;
    const admins = keys.filter((k) => k.scope === "admin" && k.status === "active").length;
    const inactive = keys.filter((k) => k.status === "revoked" || k.status === "expired").length;
    return { total, active, admins, inactive };
  }, [keys]);

  const filteredKeys = useMemo(() => {
    return keys.filter((k) => {
      const matchesSearch =
        k.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (k.environment && k.environment.toLowerCase().includes(searchQuery.toLowerCase()));
      if (!matchesSearch) return false;

      if (filterScope === "active") return k.status === "active";
      if (filterScope === "admin") return k.scope === "admin" && k.status === "active";
      if (filterScope === "visitor") return k.scope === "visitor" && k.status === "active";
      if (filterScope === "inactive") return k.status === "revoked" || k.status === "expired";
      return true;
    });
  }, [keys, searchQuery, filterScope]);

  const quickstartCommand = useMemo(() => {
    if (!createdSecret) return "";
    const backendUrl =
      typeof window !== "undefined" && window.location.origin
        ? window.location.origin
        : (process.env.NEXT_PUBLIC_BENCHMARK_API_URL || "<BACKEND_URL>");
    return `# Set MODEL_ID, ENGINE, SUITE_ID, PROMPT_NAME and STRATEGY_NAME to your registered configuration.\npython3 scripts/run_remote_benchmark.py "\${MODEL_ID:?Set MODEL_ID}" --backend-url ${shellQuote(backendUrl)} --api-key ${shellQuote(createdSecret)} --engine "\${ENGINE:?Set ENGINE}" --suite "\${SUITE_ID:?Set SUITE_ID}" --prompt "\${PROMPT_NAME:?Set PROMPT_NAME}" --strategy "\${STRATEGY_NAME:?Set STRATEGY_NAME}" --concurrency 1 --mode warm --runs 1 --experiment-tag "api-onboarding-$(date -u +%Y%m%dT%H%M%SZ)"`;
  }, [createdSecret]);

  if (!canManageSettings) {
    return (
      <main className="visualizer settings-page">
        <header className="settings-page-header">
          <div className="settings-page-heading">
            <Link className="text-eyebrow link settings-back-link" href="/">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span>All models</span>
            </Link>
            <p className="text-eyebrow settings-page-kicker">Control plane configuration</p>
            <h1 className="text-display">Settings</h1>
            <p className="text-sub settings-page-intro">Protected configuration for benchmark runners, evaluation suites, prompts, and production gates.</p>
          </div>
          <div className="settings-nav-actions"><LogoutButton /></div>
        </header>

        <div className="settings-error-banner" role="alert" aria-live="assertive">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div><strong>Action Error</strong>: Insufficient permissions</div>
        </div>

        <p className="text-sub" style={{ maxWidth: "680px", marginTop: "24px" }}>
          This account does not have administrator access. No settings data was requested or displayed.
        </p>
      </main>
    );
  }

  return (
    <main className="visualizer settings-page">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="settings-toast" role="status">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page header aligned with the model telemetry view. */}
      <header className="settings-page-header">
        <div className="settings-page-heading">
          <Link className="text-eyebrow link settings-back-link" href="/">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>All models</span>
          </Link>
          <p className="text-eyebrow settings-page-kicker">Control plane configuration</p>
          <h1 className="text-display">Settings</h1>
          <p className="text-sub settings-page-intro">
            Manage suites, qualification policies, prompts, strategies, and access.
          </p>
        </div>

        <div className="settings-nav-actions">
          <button
            type="button"
            className={`settings-connection-badge ${health?.status === "ok" ? "is-online" : "is-offline"}`}
            title="Click to test backend ping latency"
            onClick={() => void checkPing()}
            disabled={isCheckingHealth}
            aria-label="Test backend connection"
          >
            <span className="settings-ping-dot" aria-hidden="true" />
            <span>
              {isCheckingHealth
                ? "Pinging..."
                : health?.status === "ok"
                ? `${health.latency_ms}ms · API Online`
                : "Backend Offline"}
            </span>
          </button>
          <LogoutButton />
        </div>
      </header>

      <SetupGuide refreshKey={activeTab} section={activeTab} />

      {/* Alert banner if error exists */}
      {error && (
        <div className="settings-error-banner" role="alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div style={{ flex: 1 }}>
            <strong>Action Error</strong>: {error}
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}
            aria-label="Dismiss error"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="settings-workspace">
        <nav className="settings-section-nav" aria-label="Settings sections">
          <p>Sections</p>
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon;
            return <Link key={section.id} href={section.id === "tasks" ? "/settings" : `/settings?section=${section.id}`} className={`settings-section-nav__link${activeTab === section.id ? " is-active" : ""}`} aria-current={activeTab === section.id ? "page" : undefined}>
              <Icon size={18} aria-hidden="true" /><span><strong>{section.label}</strong><small>{section.description}</small></span>
            </Link>;
          })}
        </nav>
        <div className="settings-workspace__content" id={`settings-panel-${activeTab}`}>

      {activeTab === "tasks" && (
        <TaskSuiteManager onNotify={showToast} />
      )}

      {activeTab === "criteria" && (
        <ScorecardCriteriaEditor onNotify={showToast} />
      )}

      {activeTab === "prompts" && <PromptRegistryManager onNotify={showToast} />}

      {activeTab === "strategies" && <StrategyRegistryManager onNotify={showToast} />}

      {activeTab === "api_keys" && (
        <section className="settings-access-panel" aria-labelledby="settings-access-heading">
      <div className="settings-access-panel__heading"><h2 id="settings-access-heading">API access</h2><p>Credentials for dashboard administrators and benchmark runners.</p></div>
      {/* Stat Summary Cards */}
      <div className="settings-stats-grid">
        <div className="settings-stat-card">
          <span className="text-eyebrow">Total Provisioned</span>
          <strong className="text-mono-data" style={{ fontSize: "2rem", color: "var(--text-primary)" }}>
            {loading ? "…" : stats.total}
          </strong>
          <span className="text-sub-mono">All API credentials</span>
        </div>

        <div className="settings-stat-card">
          <span className="text-eyebrow" style={{ color: "var(--accent-emerald)" }}>Active Keys</span>
          <strong className="text-mono-data" style={{ fontSize: "2rem", color: "var(--accent-emerald)" }}>
            {loading ? "…" : stats.active}
          </strong>
          <span className="text-sub-mono">Usable for inference & sync</span>
        </div>

        <div className="settings-stat-card">
          <span className="text-eyebrow" style={{ color: "var(--accent-blue)" }}>Admin / Runners</span>
          <strong className="text-mono-data" style={{ fontSize: "2rem", color: "var(--accent-blue)" }}>
            {loading ? "…" : stats.admins}
          </strong>
          <span className="text-sub-mono">Authorized benchmark contributors</span>
        </div>

        <div className="settings-stat-card">
          <span className="text-eyebrow" style={{ color: "var(--text-tertiary)" }}>Inactive / Expired</span>
          <strong className="text-mono-data" style={{ fontSize: "2rem", color: "var(--text-secondary)" }}>
            {loading ? "…" : stats.inactive}
          </strong>
          <span className="text-sub-mono">Revoked or lapsed keys</span>
        </div>
      </div>

      {/* One-Time Secret Reveal Banner */}
      {createdSecret && (
        <div className="settings-secret-reveal-card" role="region" aria-label="Created API Key Secret">
          <div className="settings-secret-header">
            <div className="settings-secret-title-group">
              <span className="settings-secret-badge">SECRET GENERATED</span>
              <h3>Save Your Secret Key</h3>
            </div>
            <button
              type="button"
              className="settings-btn-ghost"
              onClick={() => setCreatedSecret(null)}
              title="Dismiss secret panel"
            >
              <X size={15} aria-hidden="true" /> Done
            </button>
          </div>

          <p className="settings-secret-warning">
            Make sure to copy your API key now. It will not be shown again.
          </p>

          <div className="settings-secret-display-box">
            <code>{createdSecret}</code>
            <button
              type="button"
              className="settings-copy-btn"
              onClick={() => void handleCopyText(createdSecret)}
            >
              {copiedKey ? (
                <>
                  <Check size={14} aria-hidden="true" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  <span>Copy Secret</span>
                </>
              )}
            </button>
          </div>

          {/* Runner CLI snippet generator */}
          <div className="settings-quickstart-box">
            <div className="settings-quickstart-header">
              <strong>Runner CLI Quickstart</strong>
              <button
                type="button"
                className="settings-btn-link"
                onClick={() => void handleCopyText(quickstartCommand, true)}
              >
                {copiedQuickstart ? "✓ Copied Command" : "Copy Command"}
              </button>
            </div>
            <p className="text-sub" style={{ fontSize: "0.8rem", marginBottom: "8px" }}>
              Run this command on your GPU runner host to benchmark local models and submit results:
            </p>
            <pre className="settings-cli-code">
              <code>{quickstartCommand}</code>
            </pre>
          </div>
        </div>
      )}

      {/* Action Bar (Search, Filter, Create Trigger) */}
      <div className="settings-action-bar">
        <div className="settings-search-box">
          <Search size={16} aria-hidden="true" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search keys by name or environment..."
          />
          {searchQuery && (
            <button
              type="button"
              className="settings-clear-search"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="settings-filter-pills">
          {(
            [
              ["all", "All Keys"],
              ["active", "Active"],
              ["admin", "Admin / Runner"],
              ["visitor", "Read-Only"],
              ["inactive", "Revoked / Expired"],
            ] as const
          ).map(([fKey, fLabel]) => (
            <button
              key={fKey}
              type="button"
              className={`settings-filter-pill ${filterScope === fKey ? "is-selected" : ""}`}
              onClick={() => setFilterScope(fKey)}
            >
              {fLabel}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="settings-btn-primary"
          onClick={() => setIsCreating(!isCreating)}
          aria-expanded={isCreating}
          aria-controls="settings-create-key-form"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            {isCreating ? (
              <path d="M18 6 6 18M6 6l12 12" />
            ) : (
              <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>
            )}
          </svg>
          <span>{isCreating ? "Cancel" : "Generate API Key"}</span>
        </button>
      </div>

      {/* Key Creation Form Panel */}
      {isCreating && (
        <form id="settings-create-key-form" className="settings-create-form-panel" onSubmit={handleCreateKey}>
          <div className="settings-create-form-header">
            <div>
              <h3>Generate New API Key</h3>
              <p className="text-sub" style={{ fontSize: "0.85rem", marginTop: "4px" }}>
                Create a scoped credential to authenticate remote benchmark nodes or query results.
              </p>
            </div>
            <button type="button" className="settings-btn-ghost" onClick={() => setIsCreating(false)} aria-label="Close key creation form">
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="settings-form-grid">
            <label className="settings-form-field">
              <span className="settings-field-label">Key Identifier / Name *</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. AWS G6 Remote Runner (L4 GPU)"
                maxLength={100}
                required
                autoFocus
              />
              <span className="settings-field-hint">Human-readable label for this runner or integration.</span>
            </label>

            <label className="settings-form-field">
              <span className="settings-field-label">Environment / Hardware Label (Optional)</span>
              <input
                type="text"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                placeholder="e.g. AWS us-east-1 / NVIDIA L4"
                maxLength={100}
              />
              <span className="settings-field-hint">Hardware specification tag displayed in leaderboard results.</span>
            </label>

            <label className="settings-form-field">
              <span className="settings-field-label">Scope & Permissions</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as KeyScope)}>
                <option value="admin">Admin / Runner (Submit benchmark runs, query data, manage keys)</option>
                <option value="visitor">Read-Only (Query benchmark results only)</option>
              </select>
              <span className="settings-field-hint">
                Admin scope is required to submit runs with <code>run_remote_benchmark.py</code>.
              </span>
            </label>

            <label className="settings-form-field">
              <span className="settings-field-label">Key Expiration</span>
              <select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value as "never" | "30" | "90" | "365")}
              >
                <option value="never">Never expires</option>
                <option value="30">30 Days</option>
                <option value="90">90 Days</option>
                <option value="365">1 Year</option>
              </select>
              <span className="settings-field-hint">Automatic expiry after which requests will be rejected.</span>
            </label>
          </div>

          <div className="settings-form-footer">
            <button
              type="button"
              className="settings-btn-secondary"
              onClick={() => setIsCreating(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="settings-btn-primary"
              disabled={submitting || !name.trim()}
            >
              {submitting ? "Generating..." : "Generate API Key"}
            </button>
          </div>
        </form>
      )}

      {/* Key Inventory Table */}
      <div className="settings-inventory-card">
        <div className="settings-inventory-table-wrap">
          <table className="settings-key-table">
            <thead>
              <tr>
                <th>Key Identifier</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Created</th>
                <th>Last Used</th>
                <th>Expires</th>
                <th style={{ textAlign: "end" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="settings-table-loading">
                    <SettingsSectionSkeleton label="Loading API keys inventory" rows={4} compact />
                  </td>
                </tr>
              ) : filteredKeys.length === 0 ? (
                <tr>
                  <td colSpan={7} className="settings-table-empty">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="10" r="8" />
                      <line x1="8" y1="12" x2="16" y2="12" />
                    </svg>
                    <p>No API keys found matching the selected criteria.</p>
                  </td>
                </tr>
              ) : (
                filteredKeys.map((key) => (
                  <tr key={key.id} className={key.status !== "active" ? "is-inactive-row" : ""}>
                    <td className="settings-key-col-main">
                      <div className="settings-key-title-cell">
                        <strong>{key.name}</strong>
                        {key.environment && (
                          <span className="settings-env-badge">{key.environment}</span>
                        )}
                      </div>
                      <span className="settings-key-id-hint">ID #{key.id}</span>
                    </td>
                    <td>
                      <span className={`settings-scope-badge ${key.scope === "admin" ? "is-admin" : "is-visitor"}`}>
                        {key.scope === "admin" ? "ADMIN / RUNNER" : "READ-ONLY"}
                      </span>
                    </td>
                    <td>
                      <span className={`settings-status-pill is-${key.status}`}>
                        <span className="settings-status-dot" />
                        {key.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-sub-mono">
                      {formatDate(key.created_at)}
                    </td>
                    <td className="text-sub-mono">
                      {formatDate(key.last_used_at)}
                    </td>
                    <td className="text-sub-mono">
                      {formatDate(key.expires_at)}
                    </td>
                    <td style={{ textAlign: "end" }}>
                      {key.status === "active" ? (
                        <button
                          type="button"
                          className="settings-btn-danger-sm"
                          onClick={() => setRevokingKey(key)}
                        >
                          Revoke
                        </button>
                      ) : (
                        <span className="text-sub-mono" style={{ color: "var(--text-tertiary)" }}>
                          {key.revoked_at ? "Revoked" : "Expired"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </section>
      )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(revokingKey)}
        title="Revoke API key?"
        description={`Revoke “${revokingKey?.name ?? "this API key"}”? Connected runners will immediately lose access. This action cannot be undone.`}
        confirmLabel="Revoke key"
        busy={isRevoking}
        onCancel={() => setRevokingKey(null)}
        onConfirm={() => void handleRevokeConfirm()}
      />
    </main>
  );
}

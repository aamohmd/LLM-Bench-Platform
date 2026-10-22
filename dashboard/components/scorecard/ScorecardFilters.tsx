"use client";

import React, { useRef, useEffect, useState } from "react";
import {
  Download,
  FileText,
  Search,
  X,
  RotateCcw,
  ChevronDown,
  CheckCircle2,
  HelpCircle,
  AlertTriangle,
  XCircle,
  Cpu,
  Layers,
  ArrowUpDown,
  Sparkles,
  Flame,
  Zap,
  Table2,
} from "lucide-react";
import {
  CANONICAL_CONCURRENCY_META,
  type CanonicalConcurrencyTier,
} from "../../lib/scorecard";

export interface ScorecardFiltersProps {
  availableConcurrencies: number[];
  selectedConcurrency: number;
  onSelectConcurrency: (concurrency: number) => void;
  onExportCsv: () => void;
  onExportPdf: () => void;
  isExportingPdf: boolean;
  exportMessage: string | null;
  // Multi-dimensional filters
  searchQuery: string;
  onSearchChange: (query: string) => void;
  engineFilter: string;
  onEngineChange: (engine: string) => void;
  availableEngines: string[];
  hardwareFilter: string;
  onHardwareChange: (hw: string) => void;
  availableHardwares: string[];
  verdictFilter: string;
  onVerdictChange: (verdict: string) => void;
  sortBy: string;
  onSortByChange: (sort: string) => void;
  // Live counts for status tabs
  statusCounts: {
    all: number;
    qualified: number;
    candidates: number;
    needs_evidence: number;
    rejected: number;
  };
  totalCount: number;
  filteredCount: number;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
}

export function ScorecardFilters({
  availableConcurrencies,
  selectedConcurrency,
  onSelectConcurrency,
  onExportCsv,
  onExportPdf,
  isExportingPdf,
  exportMessage,
  searchQuery,
  onSearchChange,
  engineFilter,
  onEngineChange,
  availableEngines,
  hardwareFilter,
  onHardwareChange,
  availableHardwares,
  verdictFilter,
  onVerdictChange,
  sortBy,
  onSortByChange,
  statusCounts,
  totalCount,
  filteredCount,
  hasActiveFilters,
  onResetFilters,
}: ScorecardFiltersProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Keyboard shortcut: '/' focuses the search box
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !exportMenuRef.current?.contains(event.target)) setExportMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExportMenuOpen(false);
        exportTriggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [exportMenuOpen]);

  const statusTabs = [
    { id: "all", label: "All Models", count: statusCounts.all, icon: null },
    {
      id: "qualified",
      label: "Qualified",
      count: statusCounts.qualified,
      icon: <CheckCircle2 size={13} style={{ color: "var(--accent-emerald)" }} />,
      activeColor: "var(--accent-emerald)",
      activeBg: "rgba(95, 224, 160, 0.12)",
    },
    {
      id: "candidates",
      label: "Candidates",
      count: statusCounts.candidates,
      icon: <Sparkles size={13} style={{ color: "var(--accent-lime)" }} />,
      activeColor: "var(--accent-lime)",
      activeBg: "rgba(224, 255, 2, 0.12)",
    },
    {
      id: "needs_evidence",
      label: "Needs Evidence",
      count: statusCounts.needs_evidence,
      icon: <AlertTriangle size={13} style={{ color: "var(--accent-amber)" }} />,
      activeColor: "var(--accent-amber)",
      activeBg: "rgba(245, 166, 35, 0.12)",
    },
    {
      id: "rejected",
      label: "Rejected",
      count: statusCounts.rejected,
      icon: <XCircle size={13} style={{ color: "var(--accent-rose)" }} />,
      activeColor: "var(--accent-rose)",
      activeBg: "rgba(255, 93, 93, 0.12)",
    },
  ];

  return (
    <div className="scorecard-filters" style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%" }}>
      {/* ── Top Bar: Title / Actions & Concurrency Toggle ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "14px",
        }}
      >
        {/* Left Section: Export & Quick Stats */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div ref={exportMenuRef} style={{ position: "relative" }}>
            <button
              type="button"
              ref={exportTriggerRef}
              aria-expanded={exportMenuOpen}
              aria-controls="scorecard-export-options"
              aria-label="Export scoreboard"
              onClick={() => setExportMenuOpen((open) => !open)}
              style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "7px", border: "1px solid var(--border-default)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: "0.78rem", fontWeight: 650, cursor: "pointer" }}
            >
              <Download size={14} />
              <span>Export report</span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {exportMenuOpen && (
              <div id="scorecard-export-options" role="group" aria-label="Export format" style={{ position: "absolute", zIndex: 20, top: "calc(100% + 6px)", left: 0, width: "248px", padding: "5px", border: "1px solid var(--border-default)", borderRadius: "9px", background: "var(--bg-elevated, var(--bg-surface))", boxShadow: "0 12px 32px rgba(0,0,0,0.32)" }}>
                <button type="button" disabled={isExportingPdf} onClick={() => { onExportPdf(); setExportMenuOpen(false); exportTriggerRef.current?.focus(); }} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px", border: 0, borderRadius: "6px", background: "transparent", color: "var(--text-primary)", textAlign: "left", cursor: isExportingPdf ? "wait" : "pointer" }}>
                  <FileText size={16} style={{ marginTop: "1px", color: "#71a8e3" }} />
                  <span><strong style={{ display: "block", fontSize: "0.78rem" }}>Scientific report · PDF</strong><small style={{ display: "block", marginTop: "3px", color: "var(--text-tertiary)", fontSize: "0.69rem" }}>Paper-style summary with colored charts</small></span>
                </button>
                <button type="button" onClick={() => { onExportCsv(); setExportMenuOpen(false); exportTriggerRef.current?.focus(); }} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px", border: 0, borderRadius: "6px", background: "transparent", color: "var(--text-primary)", textAlign: "left", cursor: "pointer" }}>
                  <Table2 size={16} style={{ marginTop: "1px", color: "var(--accent-lime)" }} />
                  <span><strong style={{ display: "block", fontSize: "0.78rem" }}>Data table · CSV</strong><small style={{ display: "block", marginTop: "3px", color: "var(--text-tertiary)", fontSize: "0.69rem" }}>Row-level metrics for analysis</small></span>
                </button>
              </div>
            )}
          </div>
          {exportMessage && <span role="status" aria-live="polite" style={{ fontSize: "0.73rem", color: "var(--text-secondary)" }}>{exportMessage}</span>}

          {hasActiveFilters && (
            <div
              role="group"
              aria-label="Benchmark concurrency tier"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "4px 10px",
                borderRadius: "6px",
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <span style={{ fontSize: "0.74rem", color: "var(--accent-lime)", fontWeight: 600 }}>
                {filteredCount} of {totalCount} displayed
              </span>
              <button
                type="button"
                onClick={onResetFilters}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "0.72rem",
                  color: "var(--text-secondary)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 4px",
                  borderRadius: "4px",
                  transition: "color 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
              >
                <RotateCcw size={11} />
                <span>Reset</span>
              </button>
            </div>
          )}
        </div>

        <span className="sr-only" aria-live="polite">{isExportingPdf ? "Generating scientific report PDF" : ""}</span>

        {/* Right Section: Concurrency Toggle */}
        {availableConcurrencies.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
            <div
              style={{
                display: "inline-flex",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                borderRadius: "10px",
                padding: "3px",
                gap: "2px",
              }}
            >
              {availableConcurrencies.map((lvl) => {
                const active = selectedConcurrency === lvl;
                const isProduction = lvl === 10;
                const meta = CANONICAL_CONCURRENCY_META[lvl as CanonicalConcurrencyTier];
                const subtitle = meta?.subtitle ?? "Diagnostic";
                const badge = meta?.badge;
                const description = meta?.description ?? `Measured diagnostic load C=${lvl}; standard-tier qualification is still required`;

                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => onSelectConcurrency(lvl)}
                    title={description}
                    aria-pressed={active}
                    aria-label={`${description}${active ? ", selected" : ""}`}
                    style={{
                      display: "inline-flex",
                      flexDirection: "column",
                      alignItems: "center",
                      padding: "6px 14px",
                      borderRadius: "8px",
                      border: "none",
                      cursor: "pointer",
                      background: active
                        ? isProduction
                          ? "linear-gradient(135deg, rgba(224, 255, 2, 0.18), rgba(224, 255, 2, 0.08))"
                          : lvl === 100
                          ? "linear-gradient(135deg, rgba(255, 93, 93, 0.18), rgba(255, 93, 93, 0.08))"
                          : lvl === 50
                          ? "linear-gradient(135deg, rgba(245, 166, 35, 0.18), rgba(245, 166, 35, 0.08))"
                          : lvl === 25
                          ? "linear-gradient(135deg, rgba(95, 224, 160, 0.18), rgba(95, 224, 160, 0.08))"
                          : "var(--bg-panel)"
                        : "transparent",
                      color: active ? "var(--text-primary)" : "var(--text-tertiary)",
                      boxShadow: active
                        ? isProduction
                          ? "0 0 14px rgba(224, 255, 2, 0.22)"
                          : lvl === 100
                          ? "0 0 14px rgba(255, 93, 93, 0.22)"
                          : "none"
                        : "none",
                      outline: active
                        ? isProduction
                          ? "1px solid var(--accent-lime)"
                          : lvl === 100
                          ? "1px solid var(--accent-rose)"
                          : lvl === 50
                          ? "1px solid var(--accent-amber)"
                          : lvl === 25
                          ? "1px solid var(--accent-emerald)"
                          : "1px solid var(--border-default)"
                        : "none",
                      transition: "all 0.15s ease",
                      minWidth: "80px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                      <span
                        style={{
                          fontSize: "0.85rem",
                          fontWeight: active ? 700 : 500,
                          letterSpacing: "-0.01em",
                        }}
                      >
                        C={lvl}
                      </span>
                      {badge && (
                        <span
                          style={{
                            fontSize: "0.58rem",
                            fontWeight: 700,
                            padding: "1px 5px",
                            borderRadius: "4px",
                            background: active ? "var(--accent-lime)" : "rgba(224, 255, 2, 0.15)",
                            color: active ? "#000" : "var(--accent-lime)",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {badge}
                        </span>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: "0.62rem",
                        color: active ? "var(--text-secondary)" : "var(--text-tertiary)",
                        marginTop: "1px",
                      }}
                    >
                      {subtitle}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedConcurrency === 1 && (
              <p
                style={{
                  fontSize: "0.68rem",
                  color: "var(--accent-amber)",
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span>⚠</span>
                <span>C=1 is single-user reference only — not production-grade</span>
              </p>
            )}
            {selectedConcurrency === 10 && (
              <p
                style={{
                  fontSize: "0.68rem",
                  color: "var(--text-tertiary)",
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span style={{ color: "var(--accent-lime)" }}>●</span>
                <span>Production baseline SLA (standard qualification)</span>
              </p>
            )}
            {selectedConcurrency === 25 && (
              <p
                style={{
                  fontSize: "0.68rem",
                  color: "var(--text-tertiary)",
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span style={{ color: "var(--accent-emerald)" }}>●</span>
                <span>High-density multi-agent concurrent request handling</span>
              </p>
            )}
            {selectedConcurrency === 50 && (
              <p
                style={{
                  fontSize: "0.68rem",
                  color: "var(--accent-amber)",
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Zap size={14} aria-hidden="true" />
                <span>Peak enterprise traffic tier (morning rush-hour surge)</span>
              </p>
            )}
            {selectedConcurrency === 100 && (
              <p
                style={{
                  fontSize: "0.68rem",
                  color: "var(--accent-rose)",
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Flame size={14} aria-hidden="true" />
                <span>Maximum stress ceiling — hardware breaking point &amp; capacity limits</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Status Segmented Filter Pills ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          overflowX: "auto",
          paddingBottom: "2px",
          scrollbarWidth: "none",
        }}
      >
        {statusTabs.map((tab) => {
          const active = verdictFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onVerdictChange(tab.id)}
              aria-pressed={active}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "5px 12px",
                borderRadius: "20px",
                fontSize: "0.76rem",
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                border: active
                  ? `1px solid ${tab.activeColor || "var(--accent-lime)"}`
                  : "1px solid var(--border-subtle)",
                background: active
                  ? tab.activeBg || "rgba(224, 255, 2, 0.12)"
                  : "var(--bg-surface)",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                transition: "all 0.15s ease",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.borderColor = "var(--border-default)";
                  e.currentTarget.style.color = "var(--text-primary)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.borderColor = "var(--border-subtle)";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span
                style={{
                  fontSize: "0.68rem",
                  padding: "1px 6px",
                  borderRadius: "10px",
                  background: active ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.06)",
                  color: active ? "var(--text-primary)" : "var(--text-tertiary)",
                  fontWeight: 600,
                }}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Secondary Filter Bar: Search, Engine, Hardware, Sort ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          padding: "10px 14px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border-default)",
          borderRadius: "10px",
        }}
      >
        {/* Instant Search Input with Keyboard Shortcut */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            flex: "1 1 240px",
            minWidth: "200px",
          }}
        >
          <Search
            size={14}
            style={{
              position: "absolute",
              left: "11px",
              color: "var(--text-tertiary)",
              pointerEvents: "none",
            }}
          />
          <input
            ref={searchInputRef}
            type="text"
            aria-label="Search scoreboard deployments"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search model, architecture, quantization..."
            style={{
              width: "100%",
              padding: "7px 32px 7px 32px",
              fontSize: "0.8rem",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "7px",
              color: "var(--text-primary)",
              transition: "all 0.15s ease",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "var(--accent-lime)";
              e.target.style.boxShadow = "0 0 8px rgba(224, 255, 2, 0.15)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "var(--border-subtle)";
              e.target.style.boxShadow = "none";
            }}
          />
          {searchQuery ? (
            <button
              type="button"
              aria-label="Clear scoreboard search"
              className="scorecard-filter-remove"
              onClick={() => {
                onSearchChange("");
                searchInputRef.current?.focus();
              }}
              style={{
                position: "absolute",
                right: "8px",
                background: "transparent",
                border: "none",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                padding: "2px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="Clear search"
            >
              <X size={13} />
            </button>
          ) : (
            <span
              style={{
                position: "absolute",
                right: "9px",
                fontSize: "0.62rem",
                color: "var(--text-tertiary)",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "4px",
                padding: "1px 5px",
                fontFamily: "var(--font-mono)",
                pointerEvents: "none",
              }}
            >
              /
            </span>
          )}
        </div>

        {/* Engine Dropdown */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Layers size={13} style={{ color: "var(--text-tertiary)" }} />
          <div style={{ position: "relative" }}>
            <select
              aria-label="Filter scoreboard by inference engine"
              value={engineFilter}
              onChange={(e) => onEngineChange(e.target.value)}
              style={{
                appearance: "none",
                padding: "6px 28px 6px 10px",
                fontSize: "0.76rem",
                fontWeight: 500,
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "7px",
                color: engineFilter !== "all" ? "var(--accent-lime)" : "var(--text-primary)",
                cursor: "pointer",
              }}
            >
              <option value="all">All Engines</option>
              {availableEngines.map((eng) => (
                <option key={eng} value={eng}>
                  {eng.toUpperCase()}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              style={{
                position: "absolute",
                right: "8px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-tertiary)",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>

        {/* Hardware Dropdown */}
        {availableHardwares.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Cpu size={13} style={{ color: "var(--text-tertiary)" }} />
            <div style={{ position: "relative" }}>
            <select
              aria-label="Filter scoreboard by hardware"
              value={hardwareFilter}
                onChange={(e) => onHardwareChange(e.target.value)}
                style={{
                  appearance: "none",
                  padding: "6px 28px 6px 10px",
                  fontSize: "0.76rem",
                  fontWeight: 500,
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "7px",
                  color: hardwareFilter !== "all" ? "var(--accent-lime)" : "var(--text-primary)",
                  cursor: "pointer",
                  maxWidth: "180px",
                }}
              >
                <option value="all">All Hardware</option>
                {availableHardwares.map((hw) => (
                  <option key={hw} value={hw}>
                    {hw}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-tertiary)",
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>
        )}

        {/* Sort By Dropdown */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" }}>
          <ArrowUpDown size={13} style={{ color: "var(--text-tertiary)" }} />
          <div style={{ position: "relative" }}>
            <select
              aria-label="Sort scoreboard deployments"
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value)}
              style={{
                appearance: "none",
                padding: "6px 28px 6px 10px",
                fontSize: "0.76rem",
                fontWeight: 500,
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "7px",
                color: "var(--text-primary)",
                cursor: "pointer",
              }}
            >
              <option value="score">Sort: Overall Score</option>
              <option value="accuracy">Sort: Mean Accuracy</option>
              <option value="speed">Sort: Throughput (TPS)</option>
              <option value="ttft">Sort: TTFT (Lowest)</option>
              <option value="name">Sort: Model Name (A-Z)</option>
            </select>
            <ChevronDown
              size={12}
              style={{
                position: "absolute",
                right: "8px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-tertiary)",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Active Filter Tags Row (if filters are active) ── */}
      {hasActiveFilters && (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", paddingTop: "2px" }}>
          <span style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", fontWeight: 600, textTransform: "uppercase" }}>
            Active:
          </span>

          {searchQuery && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 8px",
                borderRadius: "12px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid var(--border-subtle)",
                fontSize: "0.7rem",
                color: "var(--text-primary)",
              }}
            >
              Query: &ldquo;{searchQuery}&rdquo;
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="scorecard-filter-remove"
                aria-label="Remove search filter"
                style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: "0 2px" }}
              >
                <X size={10} />
              </button>
            </span>
          )}

          {verdictFilter !== "all" && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 8px",
                borderRadius: "12px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid var(--border-subtle)",
                fontSize: "0.7rem",
                color: "var(--text-primary)",
              }}
            >
              Status: {verdictFilter}
              <button
                type="button"
                onClick={() => onVerdictChange("all")}
                className="scorecard-filter-remove"
                aria-label="Remove status filter"
                style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: "0 2px" }}
              >
                <X size={10} />
              </button>
            </span>
          )}

          {engineFilter !== "all" && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 8px",
                borderRadius: "12px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid var(--border-subtle)",
                fontSize: "0.7rem",
                color: "var(--text-primary)",
              }}
            >
              Engine: {engineFilter.toUpperCase()}
              <button
                type="button"
                onClick={() => onEngineChange("all")}
                className="scorecard-filter-remove"
                aria-label="Remove engine filter"
                style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: "0 2px" }}
              >
                <X size={10} />
              </button>
            </span>
          )}

          {hardwareFilter !== "all" && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 8px",
                borderRadius: "12px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid var(--border-subtle)",
                fontSize: "0.7rem",
                color: "var(--text-primary)",
              }}
            >
              Hardware: {hardwareFilter}
              <button
                type="button"
                onClick={() => onHardwareChange("all")}
                className="scorecard-filter-remove"
                aria-label="Remove hardware filter"
                style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: "0 2px" }}
              >
                <X size={10} />
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={onResetFilters}
            style={{
              fontSize: "0.68rem",
              color: "var(--accent-lime)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "2px 6px",
              fontWeight: 600,
            }}
          >
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}

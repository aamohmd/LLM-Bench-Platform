"use client";

import React, { useState } from "react";
import { RecipeExportResponse } from "../../lib/benchmarks";
import { useDialogAccessibility } from "../useDialogAccessibility";
import {
  TerminalIcon,
  LayersIcon,
  CodeIcon,
  DocumentIcon,
  ShieldCheckIcon,
  CopyIcon,
  DownloadIcon,
  CheckIcon,
  XIcon,
} from "./RecipeIcons";

interface ProductionBlueprintModalProps {
  blueprint: RecipeExportResponse | null;
  onClose: () => void;
}

type TabType = "vllm" | "docker" | "rag" | "yaml" | "sla";

export function ProductionBlueprintModal({ blueprint, onClose }: ProductionBlueprintModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("vllm");
  const [copied, setCopied] = useState<boolean>(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const dialogRef = useDialogAccessibility<HTMLDivElement>(Boolean(blueprint), onClose);

  if (!blueprint) return null;

  const getActiveContent = () => {
    switch (activeTab) {
      case "vllm":
        return blueprint.vllm_command;
      case "docker":
        return blueprint.docker_compose_yaml;
      case "rag":
        return blueprint.rag_config_py;
      case "yaml":
        return blueprint.recipe_yaml;
      case "sla":
        return JSON.stringify(blueprint.sla_certificate, null, 2);
    }
  };

  const content = getActiveContent();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyError(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Clipboard access was blocked. Select the code and copy it manually.");
    }
  };

  const handleDownload = () => {
    const filenameMap: Record<TabType, string> = {
      vllm: "vllm_serve.sh",
      docker: "infrastructure/docker-compose.prod.yml",
      rag: "rag_pipeline_config.py",
      yaml: "production_recipe.yaml",
      sla: "recipe_sla_snapshot.json",
    };
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filenameMap[activeTab];
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="settings-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="production-blueprint-title"
        tabIndex={-1}
        style={{
          maxWidth: "880px",
          width: "100%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-default)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.85)",
          overflow: "hidden",
          background: "var(--bg-panel)",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span className="recipe-badge-golden">PRODUCTION BLUEPRINT</span>
              <span className="tag">{blueprint.workload.toUpperCase()}</span>
            </div>
            <h3 id="production-blueprint-title" className="text-heading" style={{ margin: 0, fontSize: "1.2rem" }}>
              {blueprint.recipe_name}
            </h3>
          </div>

          <button
            onClick={onClose}
            className="settings-icon-button"
            aria-label="Close modal"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--border-subtle)", background: "rgba(0,0,0,0.2)" }}>
          <div className="segmented-control" role="tablist" aria-label="Blueprint file formats" style={{ flexWrap: "wrap" }}>
            {[
              { id: "vllm", label: "vLLM Serve Script", Icon: TerminalIcon },
              { id: "docker", label: "Docker Compose", Icon: LayersIcon },
              { id: "rag", label: "RAG Config (Python)", Icon: CodeIcon },
              { id: "yaml", label: "Recipe Spec (YAML)", Icon: DocumentIcon },
              { id: "sla", label: "SLA Snapshot", Icon: ShieldCheckIcon },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as TabType)}
                role="tab"
                aria-selected={activeTab === t.id}
                className={`segmented-btn ${activeTab === t.id ? "active" : ""}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "5px 12px",
                  fontSize: "0.78rem",
                }}
              >
                <t.Icon size={13} style={{ color: activeTab === t.id ? "var(--text-primary)" : "var(--text-tertiary)" }} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Code View Area */}
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>
          {copyError && <p className="settings-inline-error" role="alert">{copyError}</p>}
          <div style={{ position: "relative" }}>
            <pre
              className="settings-cli-code"
              style={{
                padding: "16px 20px",
                fontSize: "0.82rem",
                maxHeight: "360px",
                overflowY: "auto",
                lineHeight: 1.5,
              }}
            >
              <code>{content}</code>
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="blueprint-modal-footer">
          <div className="text-sub-mono" style={{ fontSize: "0.76rem", color: "var(--text-tertiary)" }}>
            Recipe ID: {blueprint.recipe_id}
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => void handleCopy()} className="settings-copy-btn">
              {copied ? (
                <>
                  <CheckIcon size={12} />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <CopyIcon size={12} />
                  <span>Copy to Clipboard</span>
                </>
              )}
            </button>
            <button
              onClick={handleDownload}
              className="settings-btn-primary"
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <DownloadIcon size={13} />
              <span>Download File</span>
            </button>
            <button onClick={onClose} className="settings-btn-secondary">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

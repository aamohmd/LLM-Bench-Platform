"use client";

import { RefreshCw } from "lucide-react";

export function ManualRefreshControl({
  isRefreshing,
  lastRefreshedAgo,
  refreshNow,
}: {
  isRefreshing: boolean;
  lastRefreshedAgo: string;
  refreshNow: () => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "10px",
        padding: "6px 12px",
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid var(--border-default)",
        borderRadius: "20px",
        fontSize: "0.8rem",
        fontFamily: "var(--font-mono)",
        color: "var(--text-secondary)",
      }}
    >
      <span style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: "0.78rem" }}>
        Manual refresh
      </span>
      <span aria-hidden="true" style={{ color: "var(--border-default)" }}>|</span>
      <span aria-live="polite" style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
        {isRefreshing ? "Refreshing…" : lastRefreshedAgo}
      </span>
      <button
        aria-label="Refresh benchmark data"
        onClick={refreshNow}
        disabled={isRefreshing}
        type="button"
        title="Refresh benchmark data"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "5px",
          background: "rgba(255, 255, 255, 0.05)",
          border: "1px solid var(--border-default)",
          borderRadius: "12px",
          color: isRefreshing ? "var(--accent-lime)" : "var(--text-primary)",
          cursor: isRefreshing ? "default" : "pointer",
          padding: "2px 8px",
          fontSize: "0.7rem",
          fontWeight: 600,
        }}
      >
        <RefreshCw
          aria-hidden="true"
          size={12}
          style={{ animation: isRefreshing ? "spin 1s linear infinite" : "none" }}
        />
        REFRESH
      </button>
    </div>
  );
}

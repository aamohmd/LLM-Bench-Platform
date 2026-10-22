"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction } from "../actions/auth";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button 
      type="submit"
      disabled={pending}
      style={{
        background: "var(--text-primary)",
        color: "var(--bg-base)",
        border: "none",
        padding: "12px 16px",
        cursor: pending ? "not-allowed" : "pointer",
        fontFamily: "var(--font-outfit)",
        fontWeight: 600,
        fontSize: "14px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: "8px",
        opacity: pending ? 0.7 : 1,
        transition: "opacity 0.2s"
      }}
    >
      {pending && (
        <svg 
          style={{
            animation: "spin 1s linear infinite",
            width: "14px",
            height: "14px"
          }}
          xmlns="http://www.w3.org/2000/svg" 
          fill="none" 
          viewBox="0 0 24 24"
        >
          <circle 
            style={{ opacity: 0.25 }} 
            cx="12" cy="12" r="10" 
            stroke="currentColor" 
            strokeWidth="4"
          />
          <path 
            style={{ opacity: 0.75 }} 
            fill="currentColor" 
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {pending ? "PROCESSING..." : "LOGIN"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useActionState(loginAction, null);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100dvh",
      background: "var(--bg-base)",
      padding: "24px"
    }}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={{ 
        width: "100%", 
        maxWidth: "400px", 
        display: "flex", 
        flexDirection: "column", 
        gap: "32px",
        background: "var(--bg-panel)",
        border: "1px solid var(--border-strong)",
        padding: "40px"
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h1 className="text-display" style={{ fontSize: "24px" }}>Dashboard sign in</h1>
          <p className="text-body" style={{ color: "var(--text-secondary)" }}>
            Enter your API key to access the dashboard.
          </p>
          <p className="text-sub">First installation? Run <code>bash scripts/setup.sh</code> from the platform directory to create your first administrator key. Existing installations can use <code>docker compose exec backend python scripts/create_api_key.py --bootstrap</code>.</p>
        </div>

        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <input className="sr-only" type="text" name="username" value="api-key" autoComplete="username" readOnly tabIndex={-1} aria-hidden="true" />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label htmlFor="api_key" className="text-eyebrow" style={{ color: "var(--text-secondary)" }}>
              API KEY
            </label>
            <input 
              id="api_key"
              name="api_key" 
              type="password" 
              placeholder="Enter API key" 
              autoComplete="current-password"
              aria-invalid={Boolean(state?.error)}
              aria-describedby={state?.error ? "api-key-error" : undefined}
              required
              style={{
                width: "100%",
                background: "var(--bg-base)",
                border: "1px solid var(--border-strong)",
                color: "var(--text-primary)",
                padding: "12px 16px",
                fontFamily: "var(--font-mono)",
                fontSize: "14px"
              }}
            />
          </div>

          {state?.error && (
            <div id="api-key-error" role="alert" aria-live="assertive" style={{ color: "var(--accent-red)", fontSize: "14px" }}>
              {state.error}
            </div>
          )}

          <SubmitButton />
        </form>
      </div>
    </div>
  );
}

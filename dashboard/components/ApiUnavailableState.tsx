import { logoutAction } from "../app/actions/auth";
import { AlertTriangle, LogIn, RotateCw } from "lucide-react";

export function ApiUnavailableState({ reason = "unavailable" }: { reason?: "unavailable" | "forbidden" }) {
  const forbidden = reason === "forbidden";
  return (
    <main className="visualizer">
      <section className="panel route-state-card" role="alert">
        <AlertTriangle size={28} aria-hidden="true" />
        <div className="panel-body">
          <p className="text-eyebrow">Benchmark data unavailable</p>
          <h2 className="text-heading" style={{ marginBottom: "16px", color: "var(--accent-gray)" }}>
            {forbidden ? "Insufficient permissions" : "Cannot reach the benchmark API"}
          </h2>
          <p className="text-sub" style={{ marginBottom: "24px" }}>
            {forbidden
              ? "This API key cannot access benchmark results. Sign in with a visitor or admin key that has scoreboard access."
              : "Benchmark history and model discovery are unavailable. Check that the backend and PostgreSQL are running, then retry."}
          </p>
          {forbidden ? (
            <form action={logoutAction}>
              <button type="submit" className="settings-btn-primary"><LogIn size={15} aria-hidden="true" /> Return to sign in</button>
            </form>
          ) : (
            <a href="/" className="settings-btn-primary" style={{ textDecoration: "none" }}><RotateCw size={15} aria-hidden="true" /> Retry connection</a>
          )}
        </div>
      </section>
    </main>
  );
}

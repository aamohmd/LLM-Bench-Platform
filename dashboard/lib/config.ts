/**
 * Canonical configuration and dynamic URL resolution for the dashboard.
 * Strictly adheres to repository anti-hardcoding rules:
 * - No hardcoded hostnames, IPs, or ports.
 * - Dynamically derives backend URLs from environment variables or browser context.
 */

/**
 * Resolves the backend control-plane base URL.
 * Server-side: checks BENCHMARK_API_URL or NEXT_PUBLIC_BENCHMARK_API_URL.
 * Client-side: returns configured public URL or empty string (to route via Next.js API proxy).
 */
export function secureSessionCookies(): boolean {
  const configured = process.env.SESSION_COOKIE_SECURE;
  return configured === undefined ? process.env.NODE_ENV === "production" : configured !== "false";
}

export function getBackendApiUrl(): string {
  if (typeof window !== "undefined") {
    return (process.env.NEXT_PUBLIC_BENCHMARK_API_URL || "").replace(/\/+$/, "");
  }
  return (
    process.env.BENCHMARK_API_URL ||
    process.env.NEXT_PUBLIC_BENCHMARK_API_URL ||
    ""
  ).replace(/\/+$/, "");
}

/**
 * Resolves a dynamic backend URL for display in generated CLI commands and code snippets.
 * Uses the window origin when in browser, or environment variable, falling back to a placeholder.
 */
export function getCliBackendUrl(): string {
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  return (
    process.env.NEXT_PUBLIC_BENCHMARK_API_URL ||
    process.env.BENCHMARK_API_URL ||
    "<BACKEND_URL>"
  ).replace(/\/+$/, "");
}

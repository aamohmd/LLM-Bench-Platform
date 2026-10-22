import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getBackendApiUrl, secureSessionCookies } from "./lib/config";

async function keyIsValid(apiKey: string): Promise<boolean> {
  const apiBase = getBackendApiUrl();
  if (!apiBase) return true;
  try {
    const res = await fetch(`${apiBase}/api/v1/auth/session`, {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401 || res.status === 403) return false;
    return true;
  } catch {
    // Backend unreachable: don't block navigation on a transient outage.
    return true;
  }
}

async function resolveSessionScope(apiKey: string): Promise<string | null> {
  const apiBase = getBackendApiUrl();
  if (!apiBase) return null;
  try {
    const res = await fetch(`${apiBase}/api/v1/auth/session`, {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { scope?: string };
      return data.scope || null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const apiKey = request.cookies.get("admin_api_key")?.value;
  const accessScope = request.cookies.get("access_scope")?.value;
  
  // Exclude _next, api, and static files (paths ending in a file extension)
  // from middleware — but NOT page routes, even ones whose segments contain
  // dots (e.g. /models/qwen2.5:7b-instruct — model names contain dots).
  if (
    request.nextUrl.pathname.startsWith("/_next") ||
    request.nextUrl.pathname.startsWith("/api") ||
    /\.\w+$/.test(request.nextUrl.pathname)
  ) {
    return NextResponse.next();
  }

  // If user is trying to access a protected page without an API key, redirect to login
  if (!apiKey && request.nextUrl.pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // If user has an API key and is trying to access login, redirect to home —
  // UNLESS the key no longer verifies server-side (revoked/rotated).
  // Without this check a revoked key leaves the user locked out: the cookie
  // keeps them off /login while every protected page 401s.
  if (apiKey && request.nextUrl.pathname === "/login") {
    if (await keyIsValid(apiKey)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    const response = NextResponse.next();
    response.cookies.delete("admin_api_key");
    response.cookies.delete("access_scope");
    return response;
  }

  // Backfill missing access_scope cookie for existing valid sessions
  if (apiKey && !accessScope) {
    const scope = await resolveSessionScope(apiKey);
    if (scope) {
      const response = NextResponse.next();
      response.cookies.set("access_scope", scope, {
        httpOnly: true,
        secure: secureSessionCookies(),
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

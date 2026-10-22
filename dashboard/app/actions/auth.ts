"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getBackendApiUrl, secureSessionCookies } from "../../lib/config";

export async function loginAction(prevState: any, formData: FormData) {
  const apiKey = String(formData.get("api_key") || "").trim();
  if (!apiKey) return { error: "API key is required" };
  
  const apiBase = getBackendApiUrl();
  if (!apiBase) {
    return { error: "Backend API URL is not configured. Set BENCHMARK_API_URL in environment." };
  }
  try {
    const res = await fetch(`${apiBase}/api/v1/auth/session`, {
      headers: { "X-API-Key": apiKey },
      cache: "no-store"
    });
    
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { error: "Invalid API key" };
      }
      return { error: `Backend error: ${res.status}` };
    }
    const session = await res.json() as { scope?: string };
    if (session.scope !== "admin" && session.scope !== "visitor") {
      return { error: "Unable to determine API key permissions" };
    }

    const cookieStore = await cookies();
    cookieStore.set("access_scope", session.scope, {
      httpOnly: true,
        secure: secureSessionCookies(),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } catch (err) {
    return { error: "Failed to connect to backend" };
  }
  
  const cookieStore = await cookies();
  cookieStore.set("admin_api_key", apiKey, {
    httpOnly: true,
    secure: secureSessionCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  redirect("/");
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete("admin_api_key");
  cookieStore.delete("access_scope");
  redirect("/login");
}

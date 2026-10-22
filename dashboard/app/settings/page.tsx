import { SettingsConsole } from "../../components/SettingsConsole";
import { cookies } from "next/headers";

import { getBackendApiUrl } from "../../lib/config";

export const dynamic = "force-dynamic";

async function verifyAdminScope(apiKey: string): Promise<boolean> {
  const apiBase = getBackendApiUrl();
  if (!apiBase) return false;

  try {
    const res = await fetch(`${apiBase}/api/v1/auth/session`, {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const session = (await res.json()) as { scope?: string };
    return session.scope === "admin";
  } catch {
    return false;
  }
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const cookieStore = await cookies();
  const { section } = await searchParams;
  const apiKey = cookieStore.get("admin_api_key")?.value;
  const canManage = apiKey ? await verifyAdminScope(apiKey) : false;

  return <SettingsConsole canManageSettings={canManage} initialSection={section} />;
}

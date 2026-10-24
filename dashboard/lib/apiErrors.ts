/** Describe validation failures without exposing submitted values or server objects. */
export function apiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown; error?: unknown }).detail
    ?? (payload as { error?: unknown }).error;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (!Array.isArray(detail)) return fallback;
  const messages = detail.flatMap((issue) => {
    if (!issue || typeof issue.msg !== "string") return [];
    const location = Array.isArray(issue.loc)
      ? issue.loc.filter((part: unknown) => part !== "body" && part !== "query").join(" · ")
      : "";
    return [location ? `${location}: ${issue.msg}` : issue.msg];
  });
  return messages.join("; ") || fallback;
}

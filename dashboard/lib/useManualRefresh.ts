"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function useManualRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lastRefreshedAgo, setLastRefreshedAgo] = useState("Not refreshed yet");

  const refreshNow = useCallback(() => {
    startTransition(() => {
      router.refresh();
      setLastRefreshedAgo(`Refreshed at ${new Date().toLocaleTimeString()}`);
    });
  }, [router]);

  return {
    isRefreshing: isPending,
    lastRefreshedAgo,
    refreshNow,
  };
}

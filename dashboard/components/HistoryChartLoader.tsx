"use client";

import dynamic from "next/dynamic";
import { SettingsSectionSkeleton } from "./SkeletonState";

export const HistoryChart = dynamic(
  () => import("./HistoryChart").then((mod) => mod.HistoryChart),
  {
    ssr: false,
    loading: () => <SettingsSectionSkeleton label="Loading performance history chart" rows={3} />,
  },
);

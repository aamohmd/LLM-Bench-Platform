"use client";

import React, { useState, useEffect, useRef } from "react";
import type { BenchmarkSample } from "../lib/benchmarks";
import { formatMetric } from "../lib/benchmarks";

export function RawSamplesChart({ samples }: { samples: BenchmarkSample[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [samples]);

  if (!samples || samples.length === 0) return null;

  const measured = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const validGpuSamples = samples.filter((sample) => measured(sample.gpu_mem_mb));
  const validItlSamples = samples.filter((sample) => measured(sample.itl_ms));
  if (!validGpuSamples.length && !validItlSamples.length) return null;
  const maxGpu = Math.max(...validGpuSamples.map((sample) => sample.gpu_mem_mb as number), 100);
  const maxItl = Math.max(...validItlSamples.map((sample) => sample.itl_ms as number), 10);
  const height = 240, paddingX = 50, paddingY = 30;
  const chartWidth = Math.max(width - paddingX * 2, 10);
  const chartHeight = height - paddingY * 2;
  const getX = (index: number) => paddingX + index / Math.max(samples.length - 1, 1) * chartWidth;
  const getY = (value: number, max: number) => height - paddingY - value / max * chartHeight;
  // Both series share original sample positions; missing readings break a line.
  const segments = (key: "gpu_mem_mb" | "itl_ms", max: number) => {
    const groups: string[][] = [];
    let current: string[] = [];
    samples.forEach((sample, index) => {
      const value = sample[key];
      if (measured(value)) current.push(`${getX(index)},${getY(value as number, max)}`);
      else if (current.length) { groups.push(current); current = []; }
    });
    if (current.length) groups.push(current);
    return groups;
  };

  return (
    <div className="panel" style={{ marginTop: "24px", overflow: "hidden" }}>
      <div className="panel-header" style={{ padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="text-eyebrow">INFERENCE TELEMETRY SAMPLES</span>
        <div style={{ display: "flex", gap: "16px", fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          {validGpuSamples.length > 0 && <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "8px", height: "8px", background: "var(--accent-white)", display: "inline-block" }} />GPU Memory</span>}
          {validItlSamples.length > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "8px", height: "8px", background: "var(--accent-lime)", display: "inline-block" }} /> 
              Inter-Token Latency
            </span>
          )}
        </div>
      </div>
      
      <div ref={containerRef} style={{ width: "100%", overflowX: "hidden", borderTop: "1px solid var(--border-subtle)", background: "rgba(0,0,0,0.15)" }}>
        <svg width={width} height={height} aria-hidden="true" focusable="false" style={{ display: "block" }}>
          <defs>
            <linearGradient id="gpuGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-white)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--accent-white)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="itlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-lime)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--accent-lime)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
            <line key={i} x1={paddingX} y1={paddingY + chartHeight * ratio} x2={width - paddingX} y2={paddingY + chartHeight * ratio} stroke="var(--border-subtle)" strokeWidth="1" strokeDasharray="4 4" />
          ))}

          {[
            { key: "gpu_mem_mb" as const, max: maxGpu, color: "var(--accent-white)" },
            { key: "itl_ms" as const, max: maxItl, color: "var(--accent-lime)" },
          ].map((series) => segments(series.key, series.max).map((points, index) => (
            <g key={`${series.key}-${index}`}>
              {points.length > 1 && <polygon points={`${points[0].split(",")[0]},${height - paddingY} ${points.join(" ")} ${points[points.length - 1].split(",")[0]},${height - paddingY}`} fill={`url(#${series.key === "gpu_mem_mb" ? "gpuGradient" : "itlGradient"})`} />}
              <polyline fill="none" stroke={series.color} strokeWidth="2" strokeLinejoin="round" points={points.join(" ")} />
              {points.map((point, pointIndex) => { const [cx, cy] = point.split(","); return <circle key={pointIndex} cx={cx} cy={cy} r="2" fill={series.color} />; })}
            </g>
          )))}

          {/* Y Axis Labels (Left for GPU) */}
          {validGpuSamples.length > 0 && [0, 0.5, 1].map((ratio, i) => (
            <text key={`gpu-${i}`} x={paddingX - 10} y={paddingY + chartHeight * (1 - ratio)} fontSize="11" fill="var(--text-secondary)" fontFamily="var(--font-mono)" textAnchor="end" alignmentBaseline="middle">
              {((maxGpu * ratio) / 1024).toFixed(1)}GB
            </text>
          ))}

          {/* Y Axis Labels (Right for ITL) */}
          {validItlSamples.length > 0 && [0, 0.5, 1].map((ratio, i) => (
            <text key={`itl-${i}`} x={width - paddingX + 10} y={paddingY + chartHeight * (1 - ratio)} fontSize="11" fill="var(--text-secondary)" fontFamily="var(--font-mono)" textAnchor="start" alignmentBaseline="middle">
              {Math.round(maxItl * ratio)}ms
            </text>
          ))}
        </svg>
        <table className="sr-only">
          <caption>Inference telemetry in recorded sample order; gaps mean missing readings</caption>
          <thead><tr><th>Sample</th><th>GPU memory</th><th>Inter-token latency</th></tr></thead>
          <tbody>
            {samples.map((sample, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td>{sample.gpu_mem_mb == null ? "Not recorded" : formatMetric(sample.gpu_mem_mb, "MB")}</td>
                <td>{sample.itl_ms == null ? "Not recorded" : formatMetric(sample.itl_ms, "ms")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

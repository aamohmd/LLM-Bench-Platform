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
  }, []);

  if (!samples || samples.length === 0) return null;

  // Find min/max for scaling
  const validGpuSamples = samples.filter(s => s.gpu_mem_mb != null);
  const validItlSamples = samples.filter(s => s.itl_ms != null);
  
  if (validGpuSamples.length === 0 && validItlSamples.length === 0) return null;

  const maxGpu = Math.max(...validGpuSamples.map((s) => s.gpu_mem_mb as number), 100);
  const maxItl = Math.max(...validItlSamples.map((s) => s.itl_ms as number), 10);

  const height = 240;
  const paddingX = 50;
  const paddingY = 30;

  const chartWidth = Math.max(width - paddingX * 2, 10);
  const chartHeight = height - paddingY * 2;

  // Scale functions
  const getX = (index: number, total: number) => paddingX + (index / (total - 1 || 1)) * chartWidth;
  const getY = (value: number, max: number) => height - paddingY - (value / max) * chartHeight;

  const gpuPoints = validGpuSamples.map((s, i) => `${getX(i, validGpuSamples.length)},${getY(s.gpu_mem_mb as number, maxGpu)}`).join(" ");
  const itlPoints = validItlSamples.map((s, i) => `${getX(i, validItlSamples.length)},${getY(s.itl_ms as number, maxItl)}`).join(" ");

  // Path for fill (closing the shape to the bottom)
  const gpuFillPath = validGpuSamples.length > 0 ? `${getX(0, validGpuSamples.length)},${height - paddingY} ${gpuPoints} ${getX(validGpuSamples.length - 1, validGpuSamples.length)},${height - paddingY}` : "";
  const itlFillPath = validItlSamples.length > 0 ? `${getX(0, validItlSamples.length)},${height - paddingY} ${itlPoints} ${getX(validItlSamples.length - 1, validItlSamples.length)},${height - paddingY}` : "";

  return (
    <div className="panel" style={{ marginTop: "24px", overflow: "hidden" }}>
      <div className="panel-header" style={{ padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="text-eyebrow">INFERENCE TELEMETRY OVER TIME</span>
        <div style={{ display: "flex", gap: "16px", fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "8px", height: "8px", background: "var(--accent-white)", display: "inline-block" }} /> 
            GPU Memory
          </span>
          {samples.some(s => s.itl_ms !== undefined) && (
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

          {/* ITL Area & Line */}
          {validItlSamples.length > 0 && (
            <>
              <polygon points={itlFillPath} fill="url(#itlGradient)" />
              <polyline fill="none" stroke="var(--accent-lime)" strokeWidth="2" strokeLinejoin="round" points={itlPoints} />
            </>
          )}

          {/* GPU Area & Line */}
          {validGpuSamples.length > 0 && (
            <>
              <polygon points={gpuFillPath} fill="url(#gpuGradient)" />
              <polyline fill="none" stroke="var(--accent-white)" strokeWidth="2" strokeLinejoin="round" points={gpuPoints} />
            </>
          )}

          {/* Y Axis Labels (Left for GPU) */}
          {[0, 0.5, 1].map((ratio, i) => (
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
          <caption>Inference telemetry samples over time</caption>
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

"use client";

import { useMemo, useCallback } from "react";
import type { BenchmarkRun } from "../lib/benchmarks";
import { LinePath, Line } from "@visx/shape";
import { scaleTime, scaleLinear } from "@visx/scale";
import { AxisLeft, AxisRight, AxisBottom } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { useTooltip, Tooltip } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { bisector, extent, max } from "d3-array";
import { timeFormat } from "d3-time-format";

function numeric(value: number | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function format(value: number, unit: string) {
  return value ? `${value.toFixed(value < 10 ? 2 : 1)} ${unit}` : "—";
}

const formatDate = timeFormat("%b %d");

type TooltipData = {
  run: BenchmarkRun;
  metricLabel: string;
  metricValue: string;
  metricColor: string;
};

export function HistoryChart({ points }: { points: BenchmarkRun[] }) {
  const usable = useMemo(() => {
    return points
      .filter((p) => (p.created_at ?? p.timestamp))
      .sort((a, b) => Date.parse(a.created_at ?? a.timestamp ?? "") - Date.parse(b.created_at ?? b.timestamp ?? ""));
  }, [points]);

  if (usable.length < 3) {
    return (
      <div className="panel" style={{ border: "none", boxShadow: "none", background: "transparent" }}>
        <div className="panel-body" style={{ textAlign: "center", padding: "64px 24px" }}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true" style={{ margin: "0 auto 24px auto", display: "block" }}>
            <path d="M6 32 L14 20 L22 26 L30 10 L34 16" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4"/>
            <circle cx="14" cy="20" r="2" fill="var(--text-tertiary)" opacity="0.4"/>
            <circle cx="22" cy="26" r="2" fill="var(--text-tertiary)" opacity="0.4"/>
            <circle cx="30" cy="10" r="2" fill="var(--text-tertiary)" opacity="0.4"/>
          </svg>
          <h2 className="text-heading" style={{ marginBottom: "8px" }}>Not enough data</h2>
          <p className="text-sub">Run this benchmark a few more times to see trends.</p>
        </div>
      </div>
    );
  }

  return (
    <figure style={{ margin: 0 }} aria-labelledby="history-chart-caption">
      <figcaption id="history-chart-caption" className="sr-only">
        Historical decode speed, prefill speed, and time to first token by benchmark date. A complete data table follows the chart.
      </figcaption>
      <div style={{ width: "100%", height: "308px", overflow: "hidden", position: "relative", borderTop: "1px solid var(--border-subtle)" }}>
        <ParentSize>
          {({ width, height }) => <VisxChart width={width} height={height} usable={usable} />}
        </ParentSize>
      </div>
      <table className="sr-only">
        <caption>Historical performance values</caption>
        <thead><tr><th>Date</th><th>Decode speed</th><th>Prefill speed</th><th>Time to first token</th></tr></thead>
        <tbody>
          {usable.map((run, index) => (
            <tr key={`${getDate(run).valueOf()}-${index}`}>
              <td>{getDate(run).toLocaleString()}</td>
              <td>{format(getDecode(run) ?? 0, "tok/s")}</td>
              <td>{format(getPrefill(run) ?? 0, "tok/s")}</td>
              <td>{format(getTTFT(run) ?? 0, "s")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const getDate = (d: BenchmarkRun) => new Date(d.created_at ?? d.timestamp ?? "");
// Returns the decode TPS value, preferring per-request median over concurrent aggregate.
// Callers that need to know which field was used should check d.median_decode_tps first.
const getDecode = (d: BenchmarkRun) => numeric(d.median_decode_tps ?? d.aggregate_output_tps);
const getDecodeSource = (d: BenchmarkRun) =>
  d.median_decode_tps != null ? "median" : d.aggregate_output_tps != null ? "agg" : null;
const getPrefill = (d: BenchmarkRun) => numeric(d.median_prefill_tps);
const getTTFT = (d: BenchmarkRun) => numeric(d.median_ttft_s);
const bisectDate = bisector(getDate).left;

function VisxChart({ width, height, usable }: { width: number; height: number; usable: BenchmarkRun[] }) {
  const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } = useTooltip<TooltipData>();

  // Add 48px to PAD_BOTTOM to leave room for the legend at the bottom
  const PAD_LEFT = 56, PAD_RIGHT = 56, PAD_TOP = 24, PAD_BOTTOM = 64;
  const innerWidth = Math.max(width - PAD_LEFT - PAD_RIGHT, 10);
  const innerHeight = Math.max(height - PAD_TOP - PAD_BOTTOM, 10);

  // Scales
  const xScale = useMemo(() => {
    return scaleTime({
      range: [0, innerWidth],
      domain: extent(usable, getDate) as [Date, Date],
    });
  }, [innerWidth, usable]);

  const speedValues = usable.flatMap((p) => [getDecode(p), getPrefill(p)]).filter((v): v is number => v != null);
  const timeValues = usable.map(getTTFT).filter((v): v is number => v != null);
  const speedCeiling = Math.ceil(max(speedValues) || 1) * 1.1;
  const speedScale = useMemo(() => {
    return scaleLinear({
      range: [innerHeight, 0],
      domain: [0, speedCeiling],
    });
  }, [innerHeight, speedCeiling]);

  const timeCeiling = (max(timeValues) || 0.1) * 1.1;
  const timeScale = useMemo(() => {
    return scaleLinear({
      range: [innerHeight, 0],
      domain: [0, timeCeiling],
    });
  }, [innerHeight, timeCeiling]);

  const metrics = [
    { key: "decode", label: "Decode Speed", stroke: "var(--accent-lime)", dash: undefined, unit: "tok/s", getVal: getDecode, scale: speedScale },
    { key: "prefill", label: "Prefill Speed", stroke: "var(--accent-cyan)", dash: "7 4", unit: "tok/s", getVal: getPrefill, scale: speedScale },
    { key: "ttft", label: "TTFT", stroke: "var(--accent-amber)", dash: "2 4", unit: "s", getVal: getTTFT, scale: timeScale },
  ];

  const handlePointerMove = useCallback((event: React.PointerEvent<SVGRectElement>) => {
    const coords = localPoint(event.currentTarget.ownerSVGElement!, event);
    if (!coords) return;
    const x0 = xScale.invert(coords.x - PAD_LEFT);
    const index = bisectDate(usable, x0, 1);
    const d0 = usable[index - 1];
    const d1 = usable[index];
    let d = d0;
    if (d1 && getDate(d1)) {
      d = x0.valueOf() - getDate(d0).valueOf() > getDate(d1).valueOf() - x0.valueOf() ? d1 : d0;
    }

    // Determine which metric is closest to the mouse Y
    const yVal = coords.y - PAD_TOP;
    let closestMetric = metrics[0];
    let minDistance = Infinity;

    for (const m of metrics) {
      const value = m.getVal(d);
      if (value == null) continue;
      const cy = m.scale(value);
      const dist = Math.abs(cy - yVal);
      if (dist < minDistance) {
        minDistance = dist;
        closestMetric = m;
      }
    }

    const closestValue = closestMetric.getVal(d);
    if (closestValue == null) return;
    showTooltip({
      tooltipData: {
        run: d,
        metricLabel: closestMetric.label,
        metricValue: format(closestValue, closestMetric.unit),
        metricColor: closestMetric.stroke,
      },
      tooltipLeft: xScale(getDate(d)) + PAD_LEFT,
      tooltipTop: closestMetric.scale(closestValue) + PAD_TOP,
    });
  }, [xScale, speedScale, timeScale, usable, metrics, showTooltip]);

  if (width < 10) return null;

  return (
    <div style={{ position: "relative", width, height }}>
      <svg width={width} height={height} aria-hidden="true" focusable="false" style={{ display: "block", background: "rgba(0,0,0,0.15)" }}>
        <Group left={PAD_LEFT} top={PAD_TOP}>
          {/* Grid */}
          <GridRows scale={speedScale} width={innerWidth} stroke="var(--border-subtle)" strokeDasharray="4 4" numTicks={4} />

          {/* Left Y Axis (Speed) */}
          <AxisLeft
            scale={speedScale}
            numTicks={4}
            stroke="transparent"
            tickStroke="transparent"
            tickLabelProps={() => ({
              fill: "var(--text-secondary)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              textAnchor: "end",
              dx: -8,
              dy: 4,
            })}
          />
          <text x={0} y={-10} fill="var(--text-tertiary)" fontSize="10px" fontFamily="var(--font-mono)" letterSpacing="0.05em">SPEED · tok/s</text>

          {/* Right Y Axis (Time) */}
          <AxisRight
            scale={timeScale}
            left={innerWidth}
            numTicks={4}
            stroke="transparent"
            tickStroke="transparent"
            tickFormat={(val) => Number(val).toFixed(1)}
            tickLabelProps={() => ({
              fill: "var(--text-secondary)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              textAnchor: "start",
              dx: 8,
              dy: 4,
            })}
          />
          <text x={innerWidth} y={-10} textAnchor="end" fill="var(--text-tertiary)" fontSize="10px" fontFamily="var(--font-mono)" letterSpacing="0.05em">TTFT · s</text>

          {/* Bottom X Axis (Dates) */}
          <AxisBottom
            scale={xScale}
            top={innerHeight}
            numTicks={2}
            stroke="transparent"
            tickStroke="transparent"
            tickFormat={(d) => formatDate(d as Date)}
            tickLabelProps={(d, i, ticks) => ({
              fill: "var(--text-secondary)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              textAnchor: i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle",
              dx: i === 0 ? -PAD_LEFT : i === ticks.length - 1 ? PAD_RIGHT : 0,
              dy: 8,
            })}
          />

          {/* Lines and Hover Points */}
          {metrics.map((metric) => (
            <g key={metric.key}>
              <LinePath<BenchmarkRun>
                data={usable}
                x={(d) => xScale(getDate(d)) ?? 0}
                y={(d) => metric.scale(metric.getVal(d) ?? 0) ?? 0}
                defined={(d) => metric.getVal(d) != null}
                stroke={metric.stroke}
                strokeDasharray={metric.dash}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {usable.map((d, i) => {
                const cx = xScale(getDate(d));
                const value = metric.getVal(d);
                if (value == null) return null;
                const cy = metric.scale(value);
                const isHovered = tooltipData?.run === d && tooltipData?.metricLabel === metric.label;
                return (
                  <circle
                    key={`${getDate(d).valueOf()}-${i}`}
                    cx={cx}
                    cy={cy}
                    r={isHovered ? 5 : 4}
                    fill={metric.stroke}
                    stroke="var(--bg-panel)"
                    strokeWidth={2}
                  />
                );
              })}
            </g>
          ))}

          {/* Crosshair Line */}
          {tooltipData && tooltipLeft != null && (
            <Line
              from={{ x: tooltipLeft - PAD_LEFT, y: 0 }}
              to={{ x: tooltipLeft - PAD_LEFT, y: innerHeight }}
              stroke="var(--text-tertiary)"
              strokeWidth={1}
              strokeDasharray="4 4"
              pointerEvents="none"
            />
          )}

          {/* Hitbox for tooltip */}
          <rect
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onPointerMove={handlePointerMove}
            onPointerLeave={hideTooltip}
          />
        </Group>
      </svg>

      {/* Tooltip HTML */}
      {tooltipData && (
        <Tooltip
          top={(tooltipTop || 0) - 20}
          left={tooltipLeft}
          style={{
            position: "absolute",
            pointerEvents: "none",
            backgroundColor: "rgba(0, 0, 0, 0.85)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-primary)",
            padding: "8px 12px",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            borderRadius: "4px",
            transform: "translate(-50%, -100%)",
            zIndex: 10,
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}
        >
          <span style={{ color: "var(--text-secondary)" }}>
            {tooltipData.metricLabel}
            {tooltipData.metricLabel === "Decode Speed" && (() => {
              const src = getDecodeSource(tooltipData.run);
              return src === "agg"
                ? <span style={{ fontSize: "10px", opacity: 0.65, marginLeft: "3px" }}>(agg)</span>
                : null;
            })()}
          </span>
          <span style={{ color: tooltipData.metricColor, fontWeight: 700 }}>
            {tooltipData.metricValue}
          </span>
        </Tooltip>
      )}

      {/* Legend */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", gap: "16px", padding: "16px 24px", borderTop: "1px solid var(--border-subtle)", background: "var(--bg-panel)" }}>
        {metrics.map((item) => (
          <span key={item.key} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            <span style={{ width: "18px", height: "2px", borderTop: `2px ${item.dash ? "dashed" : "solid"} ${item.stroke}`, display: "inline-block" }} aria-hidden="true" />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

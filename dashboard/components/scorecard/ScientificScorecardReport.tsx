import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import type { ScorecardExportRow } from "./ScorecardExport";
import type { ScorecardCriteria } from "../../lib/scorecard";
import { UNIVERSAL_STANDARDS } from "../../lib/scorecard";
import { errorRate, engineLabel, extractTuningConfig, hardwareLabel } from "../../lib/benchmarks";

export interface ScorecardReportContext {
  suiteName: string;
  suiteId: string;
  criteria: ScorecardCriteria | null;
  concurrency: number;
  filters: string[];
}

const colors = {
  paper: "#FFFFFF", ink: "#0F172A", body: "#334155", muted: "#64748B",
  faint: "#94A3B8", navy: "#14233B", blue: "#2563EB", blueLight: "#EFF6FF",
  teal: "#0F766E", tealLight: "#F0FDFA", amber: "#B45309", amberLight: "#FFFBEB",
  rose: "#BE123C", roseLight: "#FFF1F2", gray: "#64748B", grayLight: "#F1F5F9",
  rule: "#CBD5E1", stripe: "#F8FAFC",
};

const styles = StyleSheet.create({
  page: { paddingTop: 26, paddingBottom: 42, paddingHorizontal: 32, backgroundColor: colors.paper, color: colors.body, fontFamily: "Helvetica", fontSize: 7, lineHeight: 1.25 },
  landscapePage: { paddingTop: 34, paddingBottom: 42, paddingHorizontal: 32, backgroundColor: colors.paper, color: colors.body, fontFamily: "Helvetica", fontSize: 7, lineHeight: 1.25 },
  footerText: { fontSize: 6.5, color: colors.faint }, footerPage: { fontFamily: "Helvetica-Bold", fontSize: 6.5, color: colors.muted },
  hero: { backgroundColor: colors.navy, paddingTop: 18, paddingBottom: 13, paddingHorizontal: 24, marginBottom: 9 },
  kicker: { fontFamily: "Helvetica-Bold", fontSize: 6.5, color: "#93C5FD", letterSpacing: 1.5, marginBottom: 5 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 19, lineHeight: 1.15, color: "#F8FAFC", marginBottom: 4 },
  subtitle: { fontSize: 8, color: "#CBD5E1" },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: 20, borderTopWidth: 0.5, borderTopColor: "#334155", paddingTop: 7, marginTop: 9 },
  metaItem: { minWidth: 100 }, metaLabel: { fontSize: 5.8, color: colors.faint, letterSpacing: 0.6, marginBottom: 2 },
  metaValue: { fontFamily: "Helvetica-Bold", fontSize: 7, color: "#F8FAFC" },
  content: {}, section: { marginBottom: 8 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 9, color: colors.ink, borderBottomWidth: 0.7, borderBottomColor: colors.rule, paddingBottom: 4, marginBottom: 5 },
  abstract: { fontSize: 8, color: colors.body, lineHeight: 1.45 },
  metrics: { flexDirection: "row", gap: 8 }, metric: { flexGrow: 1, flexBasis: 0, backgroundColor: colors.stripe, borderWidth: 0.5, borderColor: colors.rule, borderRadius: 4, padding: 7 },
  metricValue: { fontFamily: "Helvetica-Bold", fontSize: 13, color: colors.ink, marginBottom: 8 }, metricLabel: { fontSize: 6.2, color: colors.muted },
  split: { flexDirection: "row", gap: 14 }, half: { width: "50%" },
  distRow: { flexDirection: "row", alignItems: "center", marginBottom: 5 }, distLabel: { width: "42%", fontSize: 7, color: colors.body }, distTrack: { width: "40%", height: 7, backgroundColor: colors.grayLight, borderRadius: 2 }, distBar: { height: 7, borderRadius: 2 }, distCount: { width: "18%", textAlign: "right", fontSize: 7, color: colors.muted },
  throughputRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 }, throughputName: { width: "39%", fontSize: 6.5, color: colors.body }, throughputTrack: { width: "45%", height: 7, backgroundColor: colors.grayLight, borderRadius: 2 }, throughputBar: { height: 7, borderRadius: 2, backgroundColor: colors.blue }, throughputValue: { width: "16%", textAlign: "right", fontSize: 6.5, color: colors.muted },
  thresholdGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, threshold: { width: "32%", flexDirection: "row", justifyContent: "space-between", borderWidth: 0.5, borderColor: colors.rule, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 7 }, thresholdLabel: { fontSize: 6.5, color: colors.muted }, thresholdValue: { fontFamily: "Helvetica-Bold", fontSize: 6.5, color: colors.ink },
  filterText: { fontSize: 6.5, color: colors.muted, marginTop: 5 },
  pageTitle: { fontFamily: "Helvetica-Bold", fontSize: 15, color: colors.ink, marginBottom: 7 }, pageSubtitle: { fontSize: 7, color: colors.muted, marginBottom: 12 },
  table: { borderWidth: 0.5, borderColor: colors.rule }, tableHead: { flexDirection: "row", backgroundColor: colors.navy, paddingVertical: 7, paddingHorizontal: 5 }, tableHeadCell: { fontFamily: "Helvetica-Bold", fontSize: 5.8, color: "#F8FAFC", paddingHorizontal: 2 },
  tableRow: { flexDirection: "row", alignItems: "center", minHeight: 25, paddingVertical: 5, paddingHorizontal: 5, borderBottomWidth: 0.4, borderBottomColor: colors.rule }, tableRowAlt: { backgroundColor: colors.stripe }, tableCell: { fontSize: 6.2, color: colors.body, paddingHorizontal: 2 }, tableCellStrong: { fontFamily: "Helvetica-Bold", color: colors.ink },
  note: { fontSize: 6.5, color: colors.muted, marginTop: 7 }, empty: { fontSize: 8, color: colors.muted, fontStyle: "italic", paddingVertical: 9 },
});

type Metric = { value: number | null; label: string; display: string };
type EvidenceCategory = { id: string; label: string; required: boolean };

const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const pct = (value: number | null, digits = 1): string => value == null ? "N/A" : `${(value * 100).toFixed(digits)}%`;
const numberText = (value: number | null, digits = 2): string => value == null ? "N/A" : value.toFixed(digits);
const shortText = (value: unknown, max = 30): string => {
  const text = String(value ?? "N/A").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 3)).trimEnd()}...` : text || "N/A";
};
const compactIdentity = (value: unknown, max = 24): string => {
  const raw = String(value ?? "N/A").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  const text = raw.includes("/") ? raw.split("/").pop() || raw : raw;
  if (text.length <= max || !raw.includes("/")) return shortText(text, max);
  const head = Math.ceil((max - 3) / 2);
  const tail = max - 3 - head;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
};
const displayTime = (seconds: number | null): string => seconds == null ? "N/A" : `${(seconds * 1000).toFixed(0)} ms`;

function getMetrics(row: ScorecardExportRow): { metrics: Metric[]; memory: number | null; memoryLabel: string; error: number | null } {
  if (!row.hasDataForConcurrency) return { metrics: [], memory: null, memoryLabel: "Memory / KV", error: null };
  const run = row.run;
  const decode = finite(run.median_decode_tps ?? run.aggregate_output_tps);
  const medianTtft = finite(run.median_ttft_s);
  const p95Ttft = finite(run.p95_ttft_s);
  const quality = finite(row.deploymentMeanAccuracy ?? run.quality_score);
  const kvCache = finite(run.peak_kv_cache_pct == null ? null : run.peak_kv_cache_pct <= 1 ? run.peak_kv_cache_pct * 100 : run.peak_kv_cache_pct);
  const used = finite(run.peak_gpu_mem_mb ?? run.median_model_memory_mb);
  const gpuTotal = finite(run.hw_gpu_memory_mb);
  const total = gpuTotal ?? finite(run.hw_ram_gb == null ? null : run.hw_ram_gb * 1024);
  const vram = used != null && total != null && total > 0 ? (used / total) * 100 : null;
  const memory = run.framework === "vllm" ? kvCache ?? vram : vram;
  const memoryLabel = run.framework === "vllm" && kvCache != null ? "KV" : gpuTotal != null ? "VRAM" : "RAM";
  const error = finite(errorRate(run));
  return {
    metrics: [
      { value: decode, label: "Decode throughput", display: decode == null ? "N/A" : `${decode.toFixed(1)} tok/s` },
      { value: medianTtft, label: "Median TTFT", display: displayTime(medianTtft) },
      { value: p95Ttft, label: "p95 TTFT", display: displayTime(p95Ttft) },
      { value: quality, label: "Quality", display: pct(quality) },
      { value: memory, label: memoryLabel, display: pct(memory) },
      { value: error, label: "Error rate", display: pct(error) },
    ],
    memory, memoryLabel,
    error,
  };
}

function thresholds(criteria: ScorecardCriteria | null) {
  return {
    decode: finite(criteria?.min_decode_tps) ?? UNIVERSAL_STANDARDS.minTargetDecodeTps,
    median: finite(criteria?.fast_ttft_s) ?? UNIVERSAL_STANDARDS.fastTtftSeconds,
    p95: finite(criteria?.tail_ttft_ceiling_s) ?? UNIVERSAL_STANDARDS.tailTtftCeilingSeconds,
    quality: finite(criteria?.min_quality_score) ?? UNIVERSAL_STANDARDS.strictQualityMin,
    memory: finite(criteria?.memory_stability_max_pct) ?? UNIVERSAL_STANDARDS.memoryStabilityMaxPct,
    error: finite(criteria?.max_error_rate) ?? UNIVERSAL_STANDARDS.maxAllowedErrorRate,
  };
}

function verdictColor(verdict: string) {
  if (verdict === "Qualified") return { fg: colors.teal, bg: colors.tealLight };
  if (verdict === "Near-Miss") return { fg: colors.amber, bg: colors.amberLight };
  if (verdict === "Rejected") return { fg: colors.rose, bg: colors.roseLight };
  return { fg: colors.gray, bg: colors.grayLight };
}

function SummaryPage({ rows, detailRows, context, generatedAt }: { rows: ScorecardExportRow[]; detailRows: ScorecardExportRow[]; context: ScorecardReportContext; generatedAt: string }) {
  const { totalPages } = reportPageCounts(detailRows, rows.length > 0);
  const measured = rows.filter((row) => row.hasDataForConcurrency);
  const verdicts = ["Qualified", "Near-Miss", "Needs Evidence", "Rejected"];
  const counts = Object.fromEntries(verdicts.map((verdict) => [verdict, measured.filter((row) => (row.approvalEvaluation?.verdict ?? row.card.verdict) === verdict).length]));
  const unclassifiedCount = measured.filter((row) => !verdicts.includes(row.approvalEvaluation?.verdict ?? row.card.verdict)).length;
  if (unclassifiedCount > 0) {
    verdicts.push("Other");
    counts.Other = unclassifiedCount;
  }
  const qualified = counts.Qualified ?? 0;
  const best = measured.reduce<ScorecardExportRow | null>((current, row) => current == null || (finite(row.card.score) ?? -1) > (finite(current.card.score) ?? -1) ? row : current, null);
  const maxDecode = measured.reduce((max, row) => Math.max(max, finite(row.run.median_decode_tps ?? row.run.aggregate_output_tps) ?? 0), 0);
  const fastest = measured.filter((row) => finite(row.run.median_decode_tps ?? row.run.aggregate_output_tps) != null)
    .sort((a, b) => (finite(b.run.median_decode_tps ?? b.run.aggregate_output_tps) ?? 0) - (finite(a.run.median_decode_tps ?? a.run.aggregate_output_tps) ?? 0))
    .slice(0, 5);
  const limits = thresholds(context.criteria);
  const title = `${shortText(context.suiteName || context.suiteId || "Benchmark", 60)} Report`;
  const abstract = rows.length === 0
    ? "No deployments match the selected suite, concurrency, and filters. This report records the empty view and its active selection."
    : `${measured.length} of ${rows.length} deployments have measurements at concurrency ${context.concurrency}. ${qualified} of ${measured.length} measured deployments are qualified under the selected suite criteria. ${best ? `${getConfigurationLabel(best)} has the highest composite score (${numberText(finite(best.card.score), 1)} / 100).` : "No composite score is available."} Summary metrics cover all deployments in view; detailed comparison and category evidence show the top ${detailRows.length} scored configurations.`;

  return <Page size="A4" orientation="landscape" style={styles.page}>
    <View fixed style={{ position: "absolute", bottom: 29, left: 32, right: 32, height: 0.5, backgroundColor: colors.rule }} />
    <Text fixed style={[styles.footerText, { position: "absolute", bottom: 14, left: 32 }]}>Scorecard snapshot | {generatedAt} | C={context.concurrency}</Text>
    <Text fixed style={[styles.footerPage, { position: "absolute", bottom: 14, right: 32, width: 60, textAlign: "right" }]}>1 / {totalPages}</Text>
    <View style={styles.hero}>
      <Text style={styles.kicker}>DEPLOYMENT SCORECARD</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>Scientific comparison of deployment evidence at the selected workload.</Text>
      <View style={styles.meta}>
        <View style={styles.metaItem}><Text style={styles.metaLabel}>SUITE</Text><Text style={styles.metaValue}>{shortText(context.suiteName || context.suiteId, 42)}</Text></View>
        <View style={styles.metaItem}><Text style={styles.metaLabel}>CONCURRENCY</Text><Text style={styles.metaValue}>C = {context.concurrency}</Text></View>
        <View style={styles.metaItem}><Text style={styles.metaLabel}>GENERATED (UTC)</Text><Text style={styles.metaValue}>{generatedAt}</Text></View>
        <View style={styles.metaItem}><Text style={styles.metaLabel}>IN VIEW</Text><Text style={styles.metaValue}>{rows.length} deployments | {measured.length} measured</Text></View>
      </View>
      {context.filters.length > 0 && <Text style={styles.filterText}>Active filters: {context.filters.map((item) => shortText(item, 64)).join(" | ")}</Text>}
    </View>
    <View style={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Executive summary</Text>
        <Text style={styles.abstract}>{abstract}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>At a glance</Text>
        <View style={styles.metrics}>
          <View style={styles.metric}><Text style={styles.metricValue}>{rows.length}</Text><Text style={styles.metricLabel}>Deployments in view</Text></View>
          <View style={styles.metric}><Text style={styles.metricValue}>{qualified}/{measured.length}</Text><Text style={styles.metricLabel}>Qualified / measured</Text></View>
          <View style={styles.metric}><Text style={styles.metricValue}>{detailRows.length}</Text><Text style={styles.metricLabel}>Scored configurations in detail (top 5)</Text></View>
          <View style={styles.metric}><Text style={styles.metricValue}>{best ? `${numberText(finite(best.card.score), 1)} / 100` : "N/A"}</Text><Text style={styles.metricLabel}>Highest composite score in view</Text></View>
        </View>
      </View>
      <View style={styles.section}>
        <View style={styles.split}>
          <View style={styles.half}>
            <Text style={styles.sectionTitle}>Qualification distribution</Text>
            {verdicts.map((verdict) => {
              const value = counts[verdict] ?? 0;
              const share = measured.length ? value / measured.length : 0;
              const tone = verdictColor(verdict);
              return <View key={verdict} style={styles.distRow}><Text style={styles.distLabel}>{verdict}</Text><View style={styles.distTrack}><View style={[styles.distBar, { width: `${share * 100}%`, backgroundColor: tone.fg }]} /></View><Text style={styles.distCount}>{value} | {pct(share, 0)}</Text></View>;
            })}
            <Text style={styles.note}>Distribution uses measured deployments only; candidates without target-concurrency evidence are excluded.</Text>
          </View>
          <View style={styles.half}>
            <Text style={styles.sectionTitle}>Decode throughput leaders</Text>
            {fastest.length === 0 ? <Text style={styles.empty}>No measured throughput is available.</Text> : fastest.map((row) => {
              const value = finite(row.run.median_decode_tps ?? row.run.aggregate_output_tps);
              const tone = verdictColor(row.approvalEvaluation?.verdict ?? row.card.verdict);
              return <View key={row.key} style={styles.throughputRow}><Text style={styles.throughputName}>{getConfigurationLabel(row, 48)}</Text><View style={styles.throughputTrack}><View style={[styles.throughputBar, { width: `${maxDecode > 0 && value != null ? (value / maxDecode) * 100 : 0}%`, backgroundColor: tone.fg }]} /></View><Text style={styles.throughputValue}>{value == null ? "N/A" : `${value.toFixed(1)} tok/s`}</Text></View>;
            })}
            <Text style={styles.note}>Shared scale across the five highest measured decode-throughput rows.</Text>
          </View>
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Qualification thresholds</Text>
        {context.criteria?.name && <Text style={styles.filterText}>Assigned policy: {shortText(context.criteria.name, 90)}</Text>}
        <View style={styles.thresholdGrid}>
          {[["Decode throughput >=", `${numberText(limits.decode, 1)} tok/s`], ["Median TTFT <=", `${(limits.median * 1000).toFixed(0)} ms`], ["p95 TTFT <=", `${(limits.p95 * 1000).toFixed(0)} ms`], ["Quality >=", pct(limits.quality)], ["Memory / KV <=", pct(limits.memory / 100)], ["Error rate <=", pct(limits.error)]].map(([label, value]) => <View key={label} style={styles.threshold}><Text style={styles.thresholdLabel}>{label}</Text><Text style={styles.thresholdValue}>{value}</Text></View>)}
        </View>
        <Text style={styles.note}>Thresholds use the selected suite policy when configured; otherwise the universal baseline is shown. Unavailable telemetry is reported as N/A and is not inferred.</Text>
      </View>
    </View>
  </Page>;
}

const comparisonColumns = [5, 10, 10, 8, 6, 10, 6, 6, 6, 6, 6, 7, 5, 9];
const comparisonHeaders = ["RANK", "MODEL", "PROMPT", "STRATEGY", "ENGINE", "HARDWARE", "SCORE /100", "DECODE tok/s", "MED TTFT ms", "P95 TTFT ms", "QUALITY %", "MEM/KV %", "ERROR %", "VERDICT"];
const PAGE_ROWS = 13;

function getReportConfiguration(row: ScorecardExportRow) {
  const tuning = extractTuningConfig(row.run);
  const explicitPromptName = row.run.prompt_name || row.run.base_prompt_name;
  const promptIdentity = explicitPromptName
    || (row.run.prompt_id ? `Prompt ${row.run.prompt_id.slice(0, 8)}` : row.run.prompt_sha256 ? `SHA ${row.run.prompt_sha256.slice(0, 8)}` : "Unspecified");
  return {
    model: compactIdentity(row.run.model, 24),
    prompt: compactIdentity(promptIdentity, 24),
    strategy: shortText(tuning?.strategy || "Unspecified", 18),
  };
}

function getConfigurationLabel(row: ScorecardExportRow, max = 90): string {
  const config = getReportConfiguration(row);
  return shortText(`${config.model} / ${config.prompt} / ${config.strategy}`, max);
}

export function getTopScoredReportRows(rows: ScorecardExportRow[]): ScorecardExportRow[] {
  return rows
    .filter((row) => row.hasDataForConcurrency && finite(row.card.score) != null)
    .slice()
    .sort((a, b) => (finite(b.card.score) ?? 0) - (finite(a.card.score) ?? 0))
    .slice(0, 5);
}

function reportPageCounts(rows: ScorecardExportRow[], includeEmptyComparison = false) {
  const comparisonPages = rows.length > 0 ? Math.ceil(rows.length / PAGE_ROWS) : includeEmptyComparison ? 1 : 0;
  const categoryCount = new Set(rows.flatMap((row) => row.categoryResults?.map((category) => category.categoryId) ?? [])).size;
  const evidencePages = rows.length > 0 ? Math.max(1, Math.ceil(categoryCount / EVIDENCE_PAGE_CATEGORIES)) : 0;
  return { comparisonPages, evidencePages, totalPages: 1 + comparisonPages + evidencePages };
}

function ComparisonPages({ rows, context, generatedAt }: { rows: ScorecardExportRow[]; context: ScorecardReportContext; generatedAt: string }) {
  const chunks = rows.length === 0 ? [[]] : Array.from({ length: Math.ceil(rows.length / PAGE_ROWS) }, (_, index) => rows.slice(index * PAGE_ROWS, (index + 1) * PAGE_ROWS));
  const { totalPages } = reportPageCounts(rows, rows.length === 0);
  const limits = thresholds(context.criteria);
  return <>{chunks.map((chunk, pageIndex) => <Page key={`comparison-${pageIndex}`} size="A4" orientation="landscape" style={styles.landscapePage}>
    <View fixed style={{ position: "absolute", bottom: 29, left: 32, right: 32, height: 0.5, backgroundColor: colors.rule }} />
    <Text fixed style={[styles.footerText, { position: "absolute", bottom: 14, left: 32 }]}>Scorecard comparison | C={context.concurrency} | {generatedAt}</Text>
    <Text fixed style={[styles.footerPage, { position: "absolute", bottom: 14, right: 32, width: 60, textAlign: "right" }]}>{pageIndex + 2} / {totalPages}</Text>
    <Text style={styles.pageTitle}>Deployment comparison{chunks.length > 1 ? ` | ${pageIndex + 1} of ${chunks.length}` : ""}</Text>
    <Text style={styles.pageSubtitle}>Top five measured configurations, ordered by composite score (highest first) at C={context.concurrency}. Scores use a 0-100 scale; latency is milliseconds. N/A means the value was not measured.</Text>
    <View style={styles.table}>
      <View style={styles.tableHead}>{comparisonHeaders.map((header, index) => <Text key={header} style={[styles.tableHeadCell, { width: `${comparisonColumns[index]}%`, textAlign: index > 5 && index < 13 ? "right" : index === 0 ? "center" : "left" }]}>{header}</Text>)}</View>
      {chunk.length === 0 ? <Text style={styles.empty}>No measured configurations with a composite score are available in this view.</Text> : chunk.map((row, rowIndex) => {
        const measured = getMetrics(row);
        const configuration = getReportConfiguration(row);
        const values = [
          String(pageIndex * PAGE_ROWS + rowIndex + 1), configuration.model, configuration.prompt, configuration.strategy, engineLabel(row.run.framework), hardwareLabel(row.run),
          row.hasDataForConcurrency ? numberText(finite(row.card.score), 1) : "N/A",
          measured.metrics[0]?.value == null ? "N/A" : measured.metrics[0].value.toFixed(1), measured.metrics[1]?.value == null ? "N/A" : (measured.metrics[1].value * 1000).toFixed(0), measured.metrics[2]?.value == null ? "N/A" : (measured.metrics[2].value * 1000).toFixed(0), measured.metrics[3]?.value == null ? "N/A" : (measured.metrics[3].value * 100).toFixed(1),
          measured.memory == null ? "N/A" : `${measured.memoryLabel} ${measured.memory.toFixed(1)}%`, measured.error == null ? "N/A" : pct(measured.error),
          row.approvalEvaluation?.verdict ?? row.card.verdict,
        ];
        const verdict = row.approvalEvaluation?.verdict ?? row.card.verdict;
        const tone = verdictColor(verdict);
        return <View key={row.key} style={[styles.tableRow, rowIndex % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
          {values.map((value, index) => <Text key={`${row.key}-${index}`} style={[styles.tableCell, index === 1 ? styles.tableCellStrong : {}, { width: `${comparisonColumns[index]}%`, textAlign: index > 5 && index < 13 ? "right" : index === 0 ? "center" : "left", color: index === 13 ? tone.fg : undefined }]}>{index > 0 && index < 4 ? value : shortText(value, index === 5 ? 18 : 12)}</Text>)}
        </View>;
      })}
    </View>
    <Text style={styles.note}>Threshold references: decode target {numberText(limits.decode, 1)} tok/s | median TTFT limit {(limits.median * 1000).toFixed(0)} ms | p95 TTFT limit {(limits.p95 * 1000).toFixed(0)} ms | quality target {pct(limits.quality)} | memory / KV limit {numberText(limits.memory, 1)}% | error limit {pct(limits.error)}.</Text>
  </Page>)}</>;
}

const EVIDENCE_PAGE_CATEGORIES = 8;

function getEvidenceCategories(rows: ScorecardExportRow[]): EvidenceCategory[] {
  const categories = new Map<string, EvidenceCategory>();
  rows.forEach((row) => row.categoryResults?.forEach((category) => {
    const existing = categories.get(category.categoryId);
    categories.set(category.categoryId, {
      id: category.categoryId,
      label: category.label || category.categoryId,
      required: category.isRequired !== false || existing?.required === true,
    });
  }));
  return [...categories.values()];
}

function EvidencePages({ rows, generatedAt, context }: { rows: ScorecardExportRow[]; generatedAt: string; context: ScorecardReportContext }) {
  const { comparisonPages, totalPages } = reportPageCounts(rows, rows.length === 0);
  const allCategories = getEvidenceCategories(rows);
  const categories = allCategories.length > 0 ? allCategories : [{ id: "__none__", label: "Category evidence", required: false }];
  const chunks = Array.from({ length: Math.max(1, Math.ceil(categories.length / EVIDENCE_PAGE_CATEGORIES)) }, (_, index) => categories.slice(index * EVIDENCE_PAGE_CATEGORIES, (index + 1) * EVIDENCE_PAGE_CATEGORIES));
  return <>{chunks.map((chunk, pageIndex) => <Page key={`evidence-${pageIndex}`} size="A4" orientation="landscape" style={styles.landscapePage}>
    <View fixed style={{ position: "absolute", bottom: 29, left: 32, right: 32, height: 0.5, backgroundColor: colors.rule }} />
    <Text fixed style={[styles.footerText, { position: "absolute", bottom: 14, left: 32 }]}>Category evidence | C={context.concurrency} | {generatedAt}</Text>
    <Text fixed style={[styles.footerPage, { position: "absolute", bottom: 14, right: 32, width: 60, textAlign: "right" }]}>{pageIndex + 2 + comparisonPages} / {totalPages}</Text>
    <Text style={styles.pageTitle}>Category evidence{chunks.length > 1 ? ` | categories ${pageIndex * EVIDENCE_PAGE_CATEGORIES + 1}-${Math.min((pageIndex + 1) * EVIDENCE_PAGE_CATEGORIES, allCategories.length)} of ${allCategories.length}` : ""}</Text>
    <Text style={styles.pageSubtitle}>Top-scoring configurations by category. Cells show measured / target quality (%); green meets target, red is below, gray has no evidence. * marks a required category.</Text>
    <View style={styles.table}>
      <View style={styles.tableHead}>
        <Text style={[styles.tableHeadCell, { width: "28%" }]}>MODEL / PROMPT / STRATEGY</Text>
        <Text style={[styles.tableHeadCell, { width: "7%", textAlign: "right" }]}>SCORE /100</Text>
        <Text style={[styles.tableHeadCell, { width: "9%" }]}>VERDICT</Text>
        {chunk.map((category) => <Text key={category.id} style={[styles.tableHeadCell, { width: `${56 / chunk.length}%`, textAlign: "center" }]}>{shortText(category.label, 20)}{category.required ? " *" : ""}</Text>)}
      </View>
      {rows.length === 0 ? <Text style={styles.empty}>No category evidence is available in this view.</Text> : rows.map((row, rowIndex) => {
        const verdict = row.approvalEvaluation?.verdict ?? row.card.verdict;
        const tone = verdictColor(verdict);
        const rowCategories = new Map((row.categoryResults ?? []).map((category) => [category.categoryId, category]));
        return <View key={row.key} style={[styles.tableRow, { minHeight: 34 }, rowIndex % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
          <Text style={[styles.tableCell, styles.tableCellStrong, { width: "28%" }]}>{getConfigurationLabel(row)}</Text>
          <Text style={[styles.tableCell, { width: "7%", textAlign: "right" }]}>{row.hasDataForConcurrency ? numberText(finite(row.card.score), 1) : "N/A"}</Text>
          <Text style={[styles.tableCell, { width: "9%", color: tone.fg }]}>{shortText(verdict, 14)}</Text>
          {chunk.map((category) => {
            const item = rowCategories.get(category.id);
            const score = row.hasDataForConcurrency ? finite(item?.score) : null;
            const target = finite(item?.minimumQuality);
            const passed = score != null && target != null ? score >= target : null;
            const value = category.id === "__none__" ? "No category data"
              : item == null ? "—"
                : `${score == null ? "N/A" : (score * 100).toFixed(1)} / ${target == null ? "N/A" : (target * 100).toFixed(1)}`;
            return <Text key={`${row.key}-${category.id}`} style={[styles.tableCell, { width: `${56 / chunk.length}%`, textAlign: "center", color: passed === true ? colors.teal : passed === false ? colors.rose : colors.gray }]}>{value}</Text>;
          })}
        </View>;
      })}
    </View>
  </Page>)}</>;
}

function PaperReport({ rows, context, generatedAt }: { rows: ScorecardExportRow[]; context: ScorecardReportContext; generatedAt: string }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeContext: ScorecardReportContext = {
    suiteName: context?.suiteName ?? "", suiteId: context?.suiteId ?? "", criteria: context?.criteria ?? null,
    concurrency: finite(context?.concurrency) ?? 1, filters: Array.isArray(context?.filters) ? context.filters : [],
  };
  const detailRows = getTopScoredReportRows(safeRows);
  return <Document title={`${shortText(safeContext.suiteName || safeContext.suiteId || "Benchmark", 60)} scorecard report`} author="Benchmark evaluation system" subject="Deployment scorecard report">
    <SummaryPage rows={safeRows} detailRows={detailRows} context={safeContext} generatedAt={generatedAt} />
    {safeRows.length > 0 && <ComparisonPages rows={detailRows} context={safeContext} generatedAt={generatedAt} />}
    {detailRows.length > 0 && <EvidencePages rows={detailRows} generatedAt={generatedAt} context={safeContext} />}
  </Document>;
}

export async function createScorecardReportPdf(rows: ScorecardExportRow[], context: ScorecardReportContext): Promise<Blob> {
  const now = new Date();
  const generatedAt = Number.isNaN(now.getTime()) ? "Unknown time" : now.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return pdf(<PaperReport rows={rows} context={context} generatedAt={generatedAt} />).toBlob();
}

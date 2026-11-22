require("./register-typescript.cjs");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { execFileSync } = require("node:child_process");
const { shellQuote, platformUrlError, runtimeSettingsError, buildRunnerCommand } = require("../lib/runnerCommand.ts");
const { parseGlobalTaskSuite } = require("../lib/taskParser.ts");
const { evaluateModelScorecard } = require("../lib/scorecard.ts");

test("runner arguments preserve shell metacharacters literally", () => {
  const value = "model's name $(printf expanded); `printf expanded`\nsecond line";
  assert.equal(execFileSync("sh", ["-c", `printf '%s' ${shellQuote(value)}`], { encoding: "utf8" }), value);
});

test("invalid platform URLs cannot produce a runnable command", () => {
  for (const value of ["javascript:alert(1)", "https://user:password@example.com", "https://example.com?key=secret"]) {
    assert.ok(platformUrlError(value));
    assert.equal(buildRunnerCommand({ model: "demo", engine: "ollama", suite: "demo", prompt: "demo",
      strategy: "plain", backendUrl: value, experimentTag: "synthetic", concurrency: 1 }), "");
  }
});

test("managed vLLM requires an explicit local port", () => {
  const settings = { maxOutputTokens: 128, temperature: 0, seed: 42, responseFormat: "text", launchVllm: true };
  assert.ok(runtimeSettingsError("vllm", { ...settings, endpoint: "http://remote.invalid:8000/v1" }));
  assert.equal(runtimeSettingsError("vllm", { ...settings, endpoint: "http://localhost:8001/v1" }), null);
});

test("invalid numeric references are not coerced into valid answers", () => {
  for (const expected_answer of [true, false, [], [1], "", "  "]) {
    const parsed = parseGlobalTaskSuite({ tasks: [{ id: "synthetic", prompt: "Return a number.",
      task_type: "numeric_exact", expected_answer }] }, new Set(["numeric_exact"]));
    assert.equal(parsed.is_valid, false, JSON.stringify(expected_answer));
  }
});

test("KV cache values below one remain percentage points", () => {
  const card = evaluateModelScorecard({ model: "synthetic", framework: "vllm", num_runs: 1,
    quality_score: 1, quality_total_count: 1, error_count: 0,
    median_decode_tps: 50, median_ttft_s: 0.1, p95_ttft_s: 0.2, peak_kv_cache_pct: 0.5,
  }, "standard", { memory_stability_max_pct: 1 });
  assert.equal(card.verdict, "Qualified");
});

test("missing performance and memory evidence cannot qualify a run", () => {
  const card = evaluateModelScorecard({ model: "synthetic", quality_score: 1, num_runs: 1 });
  assert.equal(card.verdict, "Needs Evidence");
  assert.ok(card.isPartial);
});

test("CSV preserves missing evidence, custom policy and literal category labels", async () => {
  const { exportScorecardCsv } = require("../components/scorecard/ScorecardExport.ts");
  let saved;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalDocument = global.document;
  URL.createObjectURL = (blob) => { saved = blob; return "blob:synthetic"; };
  URL.revokeObjectURL = () => {};
  global.document = { createElement: () => ({ setAttribute() {}, click() {} }), body: { appendChild() {}, removeChild() {} } };
  try {
    const run = { model: "=1+1", framework: "vllm", median_decode_tps: 50 };
    exportScorecardCsv([{ run, card: evaluateModelScorecard(run), hasDataForConcurrency: true,
      categoryResults: [{ categoryId: "demo", label: 'Category, "quoted"', score: 1 }], deploymentMeanAccuracy: null,
    }], 1, { min_decode_tps: 100 });
    const csv = await saved.text();
    assert.ok(csv.includes('"\'=1+1"'));
    assert.ok(csv.includes('"Category, ""quoted"" (%)"'));
    assert.ok(csv.includes('"50.0 tok/s","FAIL","N/A","UNTESTED","N/A","UNTESTED"'));
    assert.ok(csv.includes('"N/A","UNTESTED","N/A","UNTESTED","N/A","UNTESTED"'));
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    global.document = originalDocument;
  }
});

test("anonymous proxy requests cannot inherit deployment credentials", async () => {
  const { NextRequest } = require("next/server");
  const { GET } = require("../app/api/[...path]/route.ts");
  const saved = process.env.ADMIN_API_KEY;
  const originalFetch = global.fetch;
  process.env.ADMIN_API_KEY = "synthetic-deployment-key";
  global.fetch = () => { throw new Error("Anonymous requests must not reach the backend"); };
  try {
    const response = await GET(new NextRequest("http://localhost/api/v1/suites"), { params: Promise.resolve({ path: ["v1", "suites"] }) });
    assert.equal(response.status, 401);
  } finally {
    global.fetch = originalFetch;
    if (saved === undefined) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY = saved;
  }
});

test("proxy forwards the caller's explicit API key", async () => {
  const { NextRequest } = require("next/server");
  const { GET } = require("../app/api/[...path]/route.ts");
  const originalFetch = global.fetch;
  let forwarded;
  global.fetch = async (_, options) => {
    forwarded = options.headers.get("X-API-Key");
    return new Response("[]", { headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await GET(new NextRequest("http://localhost/api/v1/suites", { headers: { "X-API-Key": "synthetic-caller-key" } }), { params: Promise.resolve({ path: ["v1", "suites"] }) });
    assert.equal(response.status, 200);
    assert.equal(forwarded, "synthetic-caller-key");
  } finally { global.fetch = originalFetch; }
});

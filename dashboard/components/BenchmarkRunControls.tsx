"use client";

import React, { useState, useEffect } from "react";
import { PenLine as PenIcon, Cpu as CpuIcon, Copy as CopyIcon, Check as CheckIcon, Terminal as TerminalIcon } from "lucide-react";
import { buildRunnerCommand, platformUrlError, runtimeSettingsError, type RuntimeSettings } from "../lib/runnerCommand";
import { useSuiteExecution } from "./useRunnerConfiguration";

interface BenchmarkRunControlsProps {
  availableModels?: Array<{ id: string; label: string }>;
  registryRevision?: number;
}

type StudioTab = "prompt" | "infra";
type RegisteredPrompt = {
  id: string;
  name: string;
  description?: string | null;
  system_prompt: string;
  content_hash: string;
};

type RegisteredStrategy = {
  id: string;
  name: string;
  label: string;
  description?: string | null;
  directive_text?: string | null;
  is_builtin: boolean;
  is_active: boolean;
};

export function BenchmarkRunControls({ availableModels, registryRevision = 0 }: BenchmarkRunControlsProps) {
  const [activeTab, setActiveTab] = useState<StudioTab>("prompt");

  const [basePrompt, setBasePrompt] = useState<string>("");
  const [promptStrategy, setPromptStrategy] = useState<string>("");
  const [maxTokens, setMaxTokens] = useState<number>(512);
  const [engine, setEngine] = useState<string>("vllm");
  const [runtime, setRuntime] = useState({
    temperature: "0", seed: "42", responseFormat: "text" as "text" | "json", endpoint: "", contextLength: "",
    launchVllm: false, maxModelLen: "", gpuMemoryUtilization: "", quantization: "", kvCacheDtype: "", prefixCaching: "",
    reasoningEffort: "",
  });
  const optionalNumber = (value: string) => value.trim() ? Number(value) : undefined;
  const runtimeSettings: RuntimeSettings = {
    maxOutputTokens: maxTokens, temperature: Number(runtime.temperature || "NaN"), seed: Number(runtime.seed || "NaN"),
    responseFormat: runtime.responseFormat, endpoint: runtime.endpoint.trim() || undefined,
    ...(engine === "openai-compatible" ? { reasoningEffort: runtime.reasoningEffort } : {}),
    ...(engine === "ollama" ? { contextLength: optionalNumber(runtime.contextLength) } : {}),
    ...(engine === "vllm" && runtime.launchVllm ? {
      launchVllm: true, maxModelLen: optionalNumber(runtime.maxModelLen),
      gpuMemoryUtilization: optionalNumber(runtime.gpuMemoryUtilization), quantization: runtime.quantization.trim(),
      kvCacheDtype: runtime.kvCacheDtype.trim(), prefixCaching: runtime.prefixCaching,
    } : {}),
  };
  const [selectedModelKey, setSelectedModelKey] = useState<string>("custom");
  const [customModelId, setCustomModelId] = useState<string>("");
  const [concurrency, setConcurrency] = useState<number>(1);
  const [targetSuite, setTargetSuite] = useState<string>("");
  const suiteExecution = useSuiteExecution(targetSuite, Boolean(targetSuite), registryRevision);
  const [commandTagSuffix, setCommandTagSuffix] = useState(() => String(Date.now()));

  // Dynamic Model and Suite discovery (Anti-Hardcoding)
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; label: string }>>(
    availableModels && availableModels.length > 0
      ? [...availableModels, { id: "custom", label: "Custom Model (Specify Model ID)" }]
      : []
  );
  const [suiteOptions, setSuiteOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [registeredPrompts, setRegisteredPrompts] = useState<RegisteredPrompt[]>([]);
  const [registeredStrategies, setRegisteredStrategies] = useState<RegisteredStrategy[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);

  useEffect(() => {
    setRegistryError(null);
    // Dynamically fetch benchmark suites from API registry
    fetch("/api/suites")
      .then((res) => {
        if (!res.ok) throw new Error(`Suites could not be loaded (HTTP ${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setSuiteOptions(data.map((s: any) => ({ id: s.id, label: `${s.name || s.id}` })));
          setTargetSuite((previous) => data.some((s: any) => s.id === previous) ? previous : "");
        }
      })
      .catch((cause) => setRegistryError(cause instanceof Error ? cause.message : "Suites could not be loaded"));

    fetch("/api/prompts")
      .then((res) => {
        if (!res.ok) throw new Error(`Prompts could not be loaded (HTTP ${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setRegisteredPrompts(data);
          setBasePrompt((prev) => data.some((row: RegisteredPrompt) => row.name === prev) ? prev : data[0]?.name || "");
        }
      })
      .catch((cause) => setRegistryError(cause instanceof Error ? cause.message : "Prompts could not be loaded"));

    fetch("/api/strategies")
      .then((res) => {
        if (!res.ok) throw new Error(`Strategies could not be loaded (HTTP ${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setRegisteredStrategies(data);
          setPromptStrategy((previous) => data.some((row: RegisteredStrategy) => row.name === previous) ? previous : data[0]?.name || "");
        }
      })
      .catch((cause) => setRegistryError(cause instanceof Error ? cause.message : "Strategies could not be loaded"));

    // Dynamically discover models from benchmarks API if none provided
    if (!availableModels || availableModels.length === 0) {
      fetch("/api/v1/benchmarks")
        .then((res) => {
          if (!res.ok) throw new Error(`Models could not be discovered (HTTP ${res.status})`);
          return res.json();
        })
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            const discovered = Array.from(new Set(data.map((r: any) => r.model).filter(Boolean)));
            if (discovered.length > 0) {
              setModelOptions([
                ...discovered.map((m: any) => ({ id: m, label: m })),
                { id: "custom", label: "Custom Model (Specify Model ID)" },
              ]);
            }
          }
        })
        .catch((cause) => setRegistryError(cause instanceof Error ? cause.message : "Models could not be discovered"));
    }
  }, [availableModels, registryRevision]);

  const effectiveModelOptions = modelOptions.length > 0
    ? modelOptions
    : [{ id: "custom", label: "Custom Model (Specify Model ID)" }];

  const effectiveSuiteOptions = suiteOptions;

  const [copiedCli, setCopiedCli] = useState<boolean>(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [runnerBackendUrl, setRunnerBackendUrl] = useState("");
  const [platformOrigin, setPlatformOrigin] = useState("");
  useEffect(() => setPlatformOrigin(window.location.origin), []);
  const [cliMode, setCliMode] = useState<"single" | "sweep">("single");

  const effectiveModel = selectedModelKey === "custom" && customModelId.trim()
    ? customModelId.trim()
    : selectedModelKey;
  const selectedPromptRecord = registeredPrompts.find((p) => p.name === basePrompt);
  const selectedStrategyRecord = registeredStrategies.find((s) => s.name === promptStrategy);
  const backendUrl =
    runnerBackendUrl.trim() ||
    process.env.NEXT_PUBLIC_BENCHMARK_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    platformOrigin;

  const cleanModelTag = effectiveModel.replace(/[\/:]/g, "__");

  const backendUrlError = backendUrl ? platformUrlError(backendUrl) : null;
  const configurationError = backendUrlError || runtimeSettingsError(engine, runtimeSettings);

  const getCliCommand = (tagSuffix = commandTagSuffix) => {
    if (configurationError || registryError || !suiteExecution.runnable || !selectedPromptRecord || !selectedStrategyRecord
      || !effectiveModel || effectiveModel === "custom") return "";
    const levels = cliMode === "sweep" ? [1, 2, 5, 10] : [concurrency];
    if (levels.some((level) => !Number.isInteger(level) || level < 1)) return "";
    return levels.map((level) => buildRunnerCommand({
      model: effectiveModel, engine, suite: targetSuite, prompt: basePrompt,
      strategy: promptStrategy, backendUrl, concurrency: level,
      experimentTag: `benchmark-${targetSuite}-${engine}-${cleanModelTag}-c${level}-${tagSuffix}`,
      settings: runtimeSettings,
    })).join("\n\n");
  };

  const cliCommand = getCliCommand();

  const handleCopyCli = async () => {
    if (!cliCommand) return;
    try {
      const tagSuffix = String(Date.now());
      await navigator.clipboard.writeText(getCliCommand(tagSuffix));
      setCommandTagSuffix(tagSuffix);
      setCopyError(null);
      setCopiedCli(true);
      setTimeout(() => setCopiedCli(false), 2000);
    } catch {
      setCopyError("Clipboard access was blocked. Select the command and copy it manually.");
    }
  };

  return (
    <section id="benchmark-controls" className="panel" style={{ width: "100%", overflow: "hidden" }}>
      {/* 1. Clean Studio Header */}
      <div
        style={{
          padding: "20px 24px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "14px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: "var(--accent-emerald)",
                display: "inline-block",
                boxShadow: "0 0 8px rgba(95, 224, 160, 0.6)",
                animation: "live-dot-pulse 2.2s infinite",
              }}
            />
            <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", fontWeight: 600 }}>
              BENCHMARK RUNNER
            </span>
          </div>
          <h2 style={{ fontSize: "1.28rem", fontWeight: 700, margin: 0, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
            Run a benchmark
          </h2>
          <p className="text-sub" style={{ margin: "4px 0 0", fontSize: "0.82rem" }}>
            Select a suite, registered prompt and strategy, then generate a command for your inference host.
          </p>
        </div>

      </div>
      {registryError && <div className="settings-error-banner" role="alert" style={{ margin: "16px 24px 0" }}>{registryError}. Some benchmark options may be unavailable.</div>}
      {configurationError && <p className="settings-error-banner" role="alert" style={{ margin: "16px 24px" }}>{configurationError}</p>}
      {!suiteExecution.runnable && <p role="status" style={{ margin: "16px 24px" }}>{suiteExecution.reason}</p>}

      {/* 2. Layer Navigation Tabs */}
      <div
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div className="segmented-control" style={{ flexWrap: "wrap" }}>
          {[
            { id: "prompt", label: "1. Prompt & output", count: promptStrategy.replace(/_/g, " "), Icon: PenIcon, accentColor: "var(--accent-blue)" },
            { id: "infra", label: "2. Engine & load", count: engine.toUpperCase(), Icon: CpuIcon, accentColor: "var(--accent-amber)" },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as StudioTab)}
                className={`segmented-btn ${active ? "active" : ""}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 14px",
                  fontSize: "0.8rem",
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  borderBottom: active ? `2px solid ${tab.accentColor}` : "2px solid transparent",
                  borderRadius: "4px 4px 0 0",
                }}
              >
                <tab.Icon size={13} style={{ color: active ? tab.accentColor : "var(--text-tertiary)" }} />
                <span>{tab.label}</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.72rem",
                    padding: "1px 6px",
                    borderRadius: "4px",
                    background: active ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.03)",
                    color: active ? "var(--text-primary)" : "var(--text-tertiary)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: active ? tab.accentColor : "var(--text-quaternary)",
                    }}
                  />
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Controls Body (Layers 1, 2, 3 Form Fields) */}
      <div style={{ padding: "20px 24px", background: "var(--bg-panel)" }}>
        {/* Tab 1: Prompt Strategy */}
        {activeTab === "prompt" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}>
            <div className="settings-form-field">
              <label className="settings-field-label" htmlFor="runner-prompt">System Prompt (--prompt, required)</label>
              <select
                id="runner-prompt"
                value={basePrompt}
                onChange={(e) => setBasePrompt(e.target.value)}
                className="recipe-select"
              >
                <option value="" disabled>{registeredPrompts.length ? "Select a registered prompt" : "Create a prompt in Settings"}</option>
                {registeredPrompts.map((prompt) => (
                  <option key={prompt.name} value={prompt.name}>
                    {prompt.name.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              {selectedPromptRecord?.description ? (
                <span className="settings-field-hint">{selectedPromptRecord.description}</span>
              ) : (
                <span className="settings-field-hint">Foundational system persona from prompt registry</span>
              )}
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label" htmlFor="runner-strategy">Registered strategy (--strategy)</label>
              <select
                id="runner-strategy"
                value={promptStrategy}
                onChange={(e) => setPromptStrategy(e.target.value)}
                className="recipe-select"
              >
                <option value="" disabled>{registeredStrategies.length ? "Select a registered strategy" : "Create a strategy in Settings"}</option>
                {registeredStrategies.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.label || s.name}
                    </option>
                  ))}
              </select>
              {selectedStrategyRecord?.description ? (
                <span className="settings-field-hint">{selectedStrategyRecord.description}</span>
              ) : (
                <span className="settings-field-hint">Optional reasoning directive applied during inference</span>
              )}
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label" htmlFor="runner-output-limit">Token Ceiling</label>
              <select
                id="runner-output-limit"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                className="recipe-select"
              >
                <option value="128">128 tokens</option>
                <option value="256">256 tokens</option>
                <option value="512">512 tokens</option>
              </select>
            </div>
            {engine !== "openai-compatible" && [{ key: "temperature", label: "Temperature", min: 0, max: 2, step: "0.05", hint: "0 uses greedy sampling. Higher values explore more varied answers." },
              { key: "seed", label: "Sampling seed", min: 0, max: undefined, step: "1", hint: "Saved with results; a seed does not guarantee identical GPU outputs." }].map((field) => (
              <div className="settings-form-field" key={field.key}>
                <label className="settings-field-label" htmlFor={`runtime-${field.key}`}>{field.label}</label>
                <input id={`runtime-${field.key}`} type="number" className="recipe-input" min={field.min} max={field.max} step={field.step}
                  value={runtime[field.key as "temperature" | "seed"]}
                  onChange={(event) => setRuntime((previous) => ({ ...previous, [field.key]: event.target.value }))} />
                <span className="settings-field-hint">{field.hint}</span>
              </div>
            ))}
            {engine !== "openai-compatible" && <div className="settings-form-field">
              <label className="settings-field-label" htmlFor="runtime-response-format">Response format</label>
              <select id="runtime-response-format" className="recipe-select" value={runtime.responseFormat}
                onChange={(event) => setRuntime((previous) => ({ ...previous, responseFormat: event.target.value as "text" | "json" }))}>
                <option value="text">Task-defined text</option><option value="json">JSON object</option>
              </select>
              <span className="settings-field-hint">JSON mode requires tasks and scoring references designed for JSON answers.</span>
            </div>}
          </div>
        )}

        {/* Tab 2: Engine & load */}
        {activeTab === "infra" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}>
            <div className="settings-form-field">
              <label className="settings-field-label" htmlFor="runner-engine">Inference engine / API</label>
              <select
                id="runner-engine"
                value={engine}
                onChange={(e) => { setEngine(e.target.value); setRuntime((previous) => ({ ...previous, endpoint: "" })); }}
                className="recipe-select"
              >
                <option value="vllm">vLLM (PagedAttention)</option>
                <option value="ollama">Ollama (GGUF)</option>
                <option value="openai-compatible">Hosted API (OpenAI-compatible)</option>
              </select>
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label" htmlFor="runner-model">{engine === "openai-compatible" ? "Provider model ID" : "Model Weights"}</label>
              <select
                id="runner-model"
                value={selectedModelKey}
                onChange={(e) => setSelectedModelKey(e.target.value)}
                className="recipe-select"
              >
                <option value="" disabled>Select a model</option>
                {effectiveModelOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              {selectedModelKey === "custom" && (
                <input
                  aria-label="Model ID"
                  type="text"
                  value={customModelId}
                  onChange={(e) => setCustomModelId(e.target.value)}
                  placeholder="Registry model ID"
                  className="recipe-input"
                  style={{ marginTop: "6px" }}
                />
              )}
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label" htmlFor="runner-concurrency">Concurrency Load Tier</label>
              <select
                id="runner-concurrency"
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value))}
                className="recipe-select"
              >
                <option value="1">C=1 (Single-User Latency)</option>
                <option value="2">C=2 (Light Concurrent Load)</option>
                <option value="5">C=5 (Mid-Range Office Load)</option>
                <option value="10">C=10 (Production Gate Load)</option>
              </select>
            </div>
            <div className="settings-form-field">
              <label className="settings-field-label" htmlFor="runtime-endpoint">{engine === "openai-compatible" ? "Provider API base URL" : "Inference server URL"}</label>
              <input id="runtime-endpoint" type="url" className="recipe-input" value={runtime.endpoint}
                placeholder={engine === "openai-compatible" ? "https://<provider-host>/v1" : engine === "vllm" ? "http://<inference-host>:<port>/v1" : "http://<inference-host>:<port>"}
                onChange={(event) => setRuntime((previous) => ({ ...previous, endpoint: event.target.value }))} />
              <span className="settings-field-hint">{engine === "openai-compatible" ? "Use the API base, not /chat/completions. Leave empty to use OPENAI_BASE_URL from the runner environment, or the OpenAI API default." : "Reachable from the runner machine. Leave empty to use its engine environment/default."}</span>
            </div>
            {engine === "openai-compatible" && <>
              <div className="settings-form-field">
                <label className="settings-field-label" htmlFor="runtime-reasoning">Reasoning effort</label>
                <select id="runtime-reasoning" className="recipe-select" value={runtime.reasoningEffort}
                  onChange={(event) => setRuntime((previous) => ({ ...previous, reasoningEffort: event.target.value }))}>
                  <option value="">Omit (standard request)</option>
                  {["none", "low", "medium", "high", "xhigh", "max"].map((effort) => <option key={effort} value={effort}>{effort}</option>)}
                </select>
                <span className="settings-field-hint">Choose only an effort supported by your provider and model. Explicit effort omits sampling controls; otherwise the adapter requests temperature 0.</span>
              </div>
              <p className="settings-field-hint" style={{ gridColumn: "1 / -1" }}>Set <code>OPENAI_API_KEY</code> in the runner's <code>.env</code> for provider authentication. This is separate from <code>API_KEY</code>, which authenticates to this platform. Keep both keys out of the generated command. Hosted requests may incur charges; concurrency uses your provider's rate limits. Hardware, memory, and prefill speed are unavailable; latency includes the network round trip.</p>
            </>}
            {engine === "ollama" && <div className="settings-form-field">
              <label className="settings-field-label" htmlFor="runtime-context">Context window (tokens)</label>
              <input id="runtime-context" type="number" min="1" step="1" className="recipe-input" value={runtime.contextLength} placeholder="Automatic task budget"
                onChange={(event) => setRuntime((previous) => ({ ...previous, contextLength: event.target.value }))} />
              <span className="settings-field-hint">Sent as Ollama num_ctx. Larger windows can use more memory; recorded results distinguish requested and observed context.</span>
            </div>}
            {engine === "vllm" && <div className="settings-form-field">
              <label className="settings-field-label" htmlFor="runtime-launch">vLLM server setup</label>
              <select id="runtime-launch" className="recipe-select" value={runtime.launchVllm ? "managed" : "existing"}
                onChange={(event) => setRuntime((previous) => ({ ...previous, launchVllm: event.target.value === "managed" }))}>
                <option value="existing">Use an existing server (recommended)</option><option value="managed">Start a temporary server on the runner machine (advanced)</option>
              </select>
              <span className="settings-field-hint">Dedicated mode runs on the runner's GPU machine, waits for readiness, benchmarks, then stops only its own server. Install vLLM there first.</span>
            </div>}
            {engine === "vllm" && runtime.launchVllm && <fieldset style={{ gridColumn: "1 / -1", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "16px", minWidth: 0 }}>
              <legend className="settings-field-label">vLLM startup configuration</legend>
              <p className="settings-field-hint" style={{ marginBottom: "16px" }}>Choose an unused localhost port above. Blank fields use your installed engine's defaults. Model and GPU support are checked by vLLM at startup; invalid settings stop the run. Launch arguments are saved separately from measured memory and reported context.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                {[
                  { key: "maxModelLen", label: "Maximum context tokens", type: "number", hint: "Prompt + output capacity (--max-model-len)." },
                  { key: "gpuMemoryUtilization", label: "GPU memory fraction", type: "number", hint: "Fraction > 0 and ≤ 1. Higher budgets can increase KV capacity and OOM risk." },
                  { key: "quantization", label: "Weight quantization method", type: "text", hint: "Exact method supported by your installed vLLM and model; blank uses model metadata." },
                  { key: "kvCacheDtype", label: "KV cache dtype", type: "text", hint: "Exact dtype supported by your version and GPU; blank uses the engine default." },
                ].map((field) => <div className="settings-form-field" key={field.key}>
                  <label htmlFor={`startup-${field.key}`} className="settings-field-label">{field.label}</label>
                  <input id={`startup-${field.key}`} type={field.type} step={field.key === "gpuMemoryUtilization" ? "0.01" : "1"} className="recipe-input" placeholder="Engine default"
                    value={runtime[field.key as "maxModelLen" | "gpuMemoryUtilization" | "quantization" | "kvCacheDtype"]}
                    onChange={(event) => setRuntime((previous) => ({ ...previous, [field.key]: event.target.value }))} />
                  <span className="settings-field-hint">{field.hint}</span>
                </div>)}
                <div className="settings-form-field">
                  <label htmlFor="startup-prefix" className="settings-field-label">Prefix caching</label>
                  <select id="startup-prefix" className="recipe-select" value={runtime.prefixCaching}
                    onChange={(event) => setRuntime((previous) => ({ ...previous, prefixCaching: event.target.value }))}>
                    <option value="">Engine default</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option>
                  </select>
                  <span className="settings-field-hint">Reuses shared prompt computation. Compare like-for-like cache conditions.</span>
                </div>
              </div>
            </fieldset>}
          </div>
        )}
      </div>

      {/* 4. CLI Command Generator Box */}
      <div
        style={{
          borderTop: "1px solid var(--border-subtle)",
          padding: "18px 24px",
          background: "var(--bg-panel)",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <details>
          <summary className="text-sub" style={{ cursor: "pointer" }}>First time? Set up the runner on your inference machine</summary>
          <div style={{ marginTop: "12px" }}>
            <p className="text-sub">Run this once in a Bash terminal on the machine that will execute the benchmark. Hosted APIs need no local inference server:</p>
            <pre style={{ overflowX: "auto", fontSize: "0.78rem", lineHeight: 1.6 }}><code>{`git clone https://github.com/aamohmd/LLM-Bench-Runner.git &&
  cd LLM-Bench-Runner &&
  bash scripts/setup.sh`}</code></pre>
            <p className="text-sub">Open <code>LLM-Bench-Runner/.env</code> and set <code>API_KEY</code> to an admin key from Settings → API access. For hosted APIs, also set <code>OPENAI_API_KEY</code> to your provider key; for Ollama or vLLM, start your model server. Run the benchmark command below from the runner folder.</p>
            <p className="text-sub">Already installed? Skip the clone step. If the platform is on another machine, enter its address below instead of localhost.</p>
          </div>
        </details>
        <div className="settings-form-field">
          <label className="settings-field-label" htmlFor="runner-backend-url">Platform URL reachable from the runner</label>
          <input id="runner-backend-url" type="url" className="recipe-input" value={runnerBackendUrl} placeholder={backendUrl}
            aria-invalid={Boolean(backendUrlError)} aria-describedby={backendUrlError ? "runner-backend-error" : undefined}
            onChange={(event) => setRunnerBackendUrl(event.target.value)} />
          {backendUrlError && <span id="runner-backend-error" className="settings-inline-error" role="alert">{backendUrlError}</span>}
          <span className="settings-field-hint">Use the dashboard URL or a directly reachable API base URL. For a separate GPU machine, replace localhost with your secured platform address.</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <TerminalIcon size={14} style={{ color: "var(--text-secondary)" }} />
              <span className="text-eyebrow" style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                CLI Runner Command
              </span>
            </div>

            <div className="segmented-control">
              <button
                type="button"
                onClick={() => setCliMode("single")}
                className={`segmented-btn ${cliMode === "single" ? "active" : ""}`}
              >
                Single Run (C={concurrency})
              </button>
              <button
                type="button"
                onClick={() => setCliMode("sweep")}
                className={`segmented-btn ${cliMode === "sweep" ? "active" : ""}`}
              >
                Concurrency Sweep
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span className="text-sub-mono" style={{ fontSize: "0.74rem", color: "var(--text-tertiary)" }}>Suite:</span>
              <select
                aria-label="Benchmark suite"
                value={targetSuite}
                onChange={(e) => setTargetSuite(e.target.value)}
                className="recipe-select"
                style={{ maxWidth: "240px", padding: "5px 28px 5px 10px", fontSize: "0.76rem", minHeight: "32px" }}
              >
                <option value="" disabled>Select a suite</option>
                {effectiveSuiteOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyCli()}
              disabled={!cliCommand}
              className={`segmented-btn ${copiedCli ? "active" : ""}`}
              style={{
                padding: "5px 14px",
                fontSize: "0.76rem",
                color: "var(--text-primary)",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {copiedCli ? (
                <>
                  <CheckIcon size={12} style={{ color: "var(--accent-emerald)" }} />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <CopyIcon size={12} style={{ color: "var(--text-secondary)" }} />
                  <span>Copy Command</span>
                </>
              )}
            </button>
          </div>
          {copyError && <p className="settings-inline-error" role="alert">{copyError}</p>}
        </div>

        {/* Terminal Window Container */}
        <div
          style={{
            background: "#08080a",
            border: "1px solid var(--border-strong)",
            borderRadius: "8px",
            overflow: "hidden",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
          }}
        >
          {/* macOS Terminal Chrome Header Bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
              background: "rgba(255, 255, 255, 0.03)",
              borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            }}
          >
            {/* macOS Window Control Dots */}
            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f56", display: "inline-block", border: "1px solid rgba(0,0,0,0.3)" }} />
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ffbd2e", display: "inline-block", border: "1px solid rgba(0,0,0,0.3)" }} />
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#27c93f", display: "inline-block", border: "1px solid rgba(0,0,0,0.3)" }} />
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "0.72rem",
                  color: "var(--text-tertiary)",
                  marginLeft: "8px",
                }}
              >
                runner.sh
              </span>
            </div>

            {/* Live Streaming Telemetry Beacon */}
            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--accent-emerald)",
                  boxShadow: "0 0 8px rgba(95, 224, 160, 0.8)",
                  animation: "live-dot-pulse 2s infinite",
                  display: "inline-block",
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "0.68rem",
                  color: "var(--text-secondary)",
                  letterSpacing: "0.06em",
                  fontWeight: 600,
                }}
              >
                REGISTERED CONFIGURATION
              </span>
            </div>
          </div>

          {/* Terminal Code Body */}
          <div style={{ padding: "14px 18px", overflowX: "auto" }}>
            <pre
              style={{
                margin: 0,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "0.78rem",
                color: "#ededed",
                lineHeight: 1.55,
                whiteSpace: "pre",
              }}
            >
              <code>{cliCommand || "Choose a supported suite, model, registered prompt and strategy to generate a command."}</code>
            </pre>
          </div>
        </div>

        {/* Terminal Info Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", fontSize: "0.72rem", color: "var(--text-tertiary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: engine === "vllm" ? "var(--accent-cyan)" : "var(--accent-amber)",
                boxShadow: engine === "vllm" ? "0 0 6px rgba(56, 189, 248, 0.6)" : "0 0 6px rgba(245, 158, 11, 0.6)",
                display: "inline-block",
              }}
            />
            <span>
              Direct remote ingestion to backend control plane
            </span>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent-blue)", display: "inline-block" }} />
              <span>Prompt hashes and run provenance</span>
          </div>
        </div>
      </div>

    </section>
  );
}

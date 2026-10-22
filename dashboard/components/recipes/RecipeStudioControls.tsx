"use client";

import React, { useState, useEffect } from "react";
import { ProductionRecipe, RecipeExportResponse } from "../../lib/benchmarks";
import { PenIcon, DatabaseIcon, CpuIcon, PackageIcon, CopyIcon, CheckIcon, TerminalIcon } from "./RecipeIcons";
import { ProductionBlueprintModal } from "./ProductionBlueprintModal";
import { buildRunnerCommand } from "../../lib/runnerCommand";
import { useSuiteExecution } from "../useRunnerConfiguration";

interface RecipeStudioControlsProps {
  initialRecipe?: ProductionRecipe | null;
  availableModels?: Array<{ id: string; label: string }>;
  registryRevision?: number;
}

type StudioTab = "prompt" | "rag" | "infra";
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

export function RecipeStudioControls({ initialRecipe, availableModels, registryRevision = 0 }: RecipeStudioControlsProps) {
  const [activeTab, setActiveTab] = useState<StudioTab>("prompt");

  // Layer 1: Prompt State
  const [basePrompt, setBasePrompt] = useState<string>("");
  const [promptStrategy, setPromptStrategy] = useState<string>(
    initialRecipe?.prompt_config.system_template_id || ""
  );
  const [temperature, setTemperature] = useState<number>(initialRecipe?.prompt_config.temperature ?? 0.0);
  const [isCustomTemp, setIsCustomTemp] = useState<boolean>(
    ![0.0, 0.1, 0.2, 0.5, 0.7].some((v) => Math.abs(v - (initialRecipe?.prompt_config.temperature ?? 0.0)) < 0.001)
  );
  const [responseFormat, setResponseFormat] = useState<string>(
    initialRecipe?.prompt_config.response_format || "json_object"
  );
  const [maxTokens, setMaxTokens] = useState<number>(initialRecipe?.prompt_config.max_output_tokens || 512);

  // Layer 2: RAG State
  const [chunkSize, setChunkSize] = useState<number>(initialRecipe?.rag_config.chunk_size || 384);
  const [chunkOverlap, setChunkOverlap] = useState<number>(initialRecipe?.rag_config.chunk_overlap || 50);
  const [topK, setTopK] = useState<number>(initialRecipe?.rag_config.top_k || 3);
  const [useReranker, setUseReranker] = useState<boolean>(initialRecipe?.rag_config.use_reranker ?? true);
  const [injectionFormat, setInjectionFormat] = useState<string>(
    initialRecipe?.rag_config.injection_format || "xml_tags"
  );

  // Layer 3: Infra State
  const [engine, setEngine] = useState<string>(initialRecipe?.infra_config.engine || "vllm");
  const [selectedModelKey, setSelectedModelKey] = useState<string>(
    initialRecipe?.infra_config.model || "custom"
  );
  const [customModelId, setCustomModelId] = useState<string>("");
  const [quantization, setQuantization] = useState<string>(initialRecipe?.infra_config.quantization || "fp8");
  const [kvCacheDtype, setKvCacheDtype] = useState<string>(initialRecipe?.infra_config.kv_cache_dtype || "auto");
  const [enablePrefixCaching, setEnablePrefixCaching] = useState<boolean>(
    initialRecipe?.infra_config.enable_prefix_caching ?? true
  );
  const [maxContextLen, setMaxContextLen] = useState<number>(initialRecipe?.infra_config.max_context_len || 8192);
  const [gpuMemoryUtil, setGpuMemoryUtil] = useState<number>(
    initialRecipe?.infra_config.gpu_memory_utilization || 0.90
  );
  const [concurrency, setConcurrency] = useState<number>(initialRecipe?.infra_config.concurrency_limit || 1);
  const [targetSuite, setTargetSuite] = useState<string>("");
  const suiteExecution = useSuiteExecution(targetSuite, Boolean(targetSuite), registryRevision);
  const [commandTagSuffix] = useState(() => String(Date.now()));

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
  const [blueprintModal, setBlueprintModal] = useState<RecipeExportResponse | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [cliMode, setCliMode] = useState<"recipe" | "sweep">("recipe");

  const effectiveModel = selectedModelKey === "custom" && customModelId.trim()
    ? customModelId.trim()
    : selectedModelKey;
  const selectedPromptRecord = registeredPrompts.find((p) => p.name === basePrompt);
  const selectedStrategyRecord = registeredStrategies.find((s) => s.name === promptStrategy);
  const composedSystemPrompt = selectedPromptRecord
    ? (selectedStrategyRecord?.directive_text
        ? `${selectedPromptRecord.system_prompt}\n\n${selectedStrategyRecord.directive_text}`
        : selectedPromptRecord.system_prompt)
    : null;


  const buildCurrentRecipe = (): ProductionRecipe => {
    const cleanModelName = effectiveModel.split("/").pop() || effectiveModel;
    return {
      id: `custom-recipe-${Date.now()}`,
      name: `Custom Recipe (${cleanModelName} + ${promptStrategy})`,
      workload: targetSuite,
      workload_title: effectiveSuiteOptions.find((suite) => suite.id === targetSuite)?.label || targetSuite,
      description: "Custom 3-layer recipe configured via the Recipe Studio.",
      prompt_config: {
        system_template_id: promptStrategy,
        temperature,
        response_format: responseFormat,
        max_output_tokens: maxTokens,
        system_prompt: composedSystemPrompt,
      },
      rag_config: {
        chunk_size: chunkSize,
        chunk_overlap: chunkOverlap,
        top_k: topK,
        use_reranker: useReranker,
        reranker_model: useReranker ? "BAAI/bge-reranker-v2-m3" : null,
        injection_format: injectionFormat,
      },
      infra_config: {
        engine,
        model: effectiveModel,
        quantization: quantization === "none" ? null : quantization,
        max_context_len: maxContextLen,
        gpu_memory_utilization: gpuMemoryUtil,
        concurrency_limit: concurrency,
        tensor_parallel_size: 1,
        kv_cache_dtype: kvCacheDtype === "auto" ? null : kvCacheDtype,
        enable_prefix_caching: enablePrefixCaching,
      },
      sla_verdict: {
        is_golden: false,
        fit_status: "Needs Evidence",
        decode_tps: 0,
        median_ttft_s: 0,
        p95_ttft_s: 0,
        quality_score: 0,
        peak_vram_pct: 0,
        error_rate_pct: 0.0,
        evaluation_summary: "Custom 3-layer recipe blueprint generated from Recipe Studio.",
      },
    };
  };

  const handleExportClick = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch("/api/recipes/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCurrentRecipe()),
      });
      if (!response.ok) {
        throw new Error(`Blueprint export failed (HTTP ${response.status})`);
      }
      setBlueprintModal(await response.json());
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Blueprint export failed");
    } finally {
      setExporting(false);
    }
  };

  const backendUrl =
    process.env.NEXT_PUBLIC_BENCHMARK_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    (typeof window !== "undefined" ? window.location.origin : "<BACKEND_URL>");

  const cleanModelTag = effectiveModel.replace(/[\/:]/g, "__");

  const getCliCommand = () => {
    if (registryError || !suiteExecution.runnable || !selectedPromptRecord || !selectedStrategyRecord
      || !effectiveModel || effectiveModel === "custom") return "";
    const levels = cliMode === "sweep" ? [1, 2, 5, 10] : [concurrency];
    if (levels.some((level) => !Number.isInteger(level) || level < 1)) return "";
    return levels.map((level) => buildRunnerCommand({
      model: effectiveModel, engine, suite: targetSuite, prompt: basePrompt,
      strategy: promptStrategy, backendUrl, concurrency: level,
      experimentTag: `recipe-${engine}-${cleanModelTag}-c${level}-${commandTagSuffix}`,
    }) + ` \\\n  --max-output-tokens ${maxTokens}`).join("\n\n");
  };

  const cliCommand = getCliCommand();

  const handleCopyCli = async () => {
    if (!cliCommand) return;
    try {
      await navigator.clipboard.writeText(cliCommand);
      setCopyError(null);
      setCopiedCli(true);
      setTimeout(() => setCopiedCli(false), 2000);
    } catch {
      setCopyError("Clipboard access was blocked. Select the command and copy it manually.");
    }
  };

  return (
    <section id="recipe-studio" className="panel" style={{ width: "100%", overflow: "hidden" }}>
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
              PRODUCTION RECIPES
            </span>
          </div>
          <h2 style={{ fontSize: "1.28rem", fontWeight: 700, margin: 0, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
            3-Layer Recipe Studio
          </h2>
          <p className="text-sub" style={{ margin: "4px 0 0", fontSize: "0.82rem" }}>
            Select registered prompts and strategies, configure your engine, and generate a runner command. Retrieval settings apply only to exported blueprints.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            onClick={handleExportClick}
            disabled={exporting || engine !== "vllm" || Boolean(registryError) || !suiteExecution.runnable || !selectedPromptRecord || !selectedStrategyRecord || !effectiveModel || effectiveModel === "custom"}
            title={engine !== "vllm" ? "Deployment blueprint export currently supports vLLM. Benchmark commands support the selected engine." : undefined}
            className="segmented-btn active"
            style={{
              padding: "6px 14px",
              fontSize: "0.78rem",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            <PackageIcon size={13} style={{ color: "var(--accent-blue)" }} />
            <span>{exporting ? "Exporting…" : "Export Blueprint"}</span>
          </button>
        </div>
      </div>
      {registryError && <div className="settings-error-banner" role="alert" style={{ margin: "16px 24px 0" }}>{registryError}. Some Recipe Studio options may be unavailable.</div>}
      {exportError && <div className="settings-error-banner" role="alert" style={{ margin: "16px 24px 0" }}>{exportError}</div>}
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
            { id: "prompt", label: "1. Prompt Strategy", count: promptStrategy.replace(/_/g, " "), Icon: PenIcon, accentColor: "var(--accent-blue)" },
            { id: "rag", label: "2. Retrieval Export", count: `Top-${topK} (ovlp: ${chunkOverlap})`, Icon: DatabaseIcon, accentColor: "var(--accent-emerald)" },
            { id: "infra", label: "3. Engine & Infra", count: `${engine.toUpperCase()} · ${quantization.toUpperCase()}${enablePrefixCaching ? " · Prefix Cache" : ""}`, Icon: CpuIcon, accentColor: "var(--accent-amber)" },
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
              <label className="settings-field-label">System Prompt (--prompt, required)</label>
              <select
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
              <label className="settings-field-label">Registered strategy (--strategy)</label>
              <select
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
              <label className="settings-field-label">Sampling Temperature</label>
              <select
                value={isCustomTemp ? "custom" : temperature.toFixed(2)}
                onChange={(e) => {
                  if (e.target.value === "custom") {
                    setIsCustomTemp(true);
                  } else {
                    setIsCustomTemp(false);
                    setTemperature(parseFloat(e.target.value));
                  }
                }}
                className="recipe-select"
              >
                <option value="0.00">0.00 · Deterministic (Exact & Math)</option>
                <option value="0.10">0.10 · Structured Extraction</option>
                <option value="0.20">0.20 · Enterprise Low-Entropy</option>
                <option value="0.50">0.50 · Balanced Reasoning</option>
                <option value="0.70">0.70 · Conversational / Creative</option>
                <option value="custom">Custom value...</option>
              </select>
              {isCustomTemp && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                  <input
                    type="number"
                    min="0.0"
                    max="2.0"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
                    className="recipe-input"
                    style={{ width: "100px", fontFamily: "var(--font-mono)" }}
                  />
                  <span className="text-sub-mono" style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>
                    Range: 0.00 – 2.00
                  </span>
                </div>
              )}
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label">Response Format</label>
              <select
                value={responseFormat}
                onChange={(e) => setResponseFormat(e.target.value)}
                className="recipe-select"
              >
                <option value="json_object">Strict JSON Object</option>
                <option value="text">Raw Text / Markdown</option>
              </select>
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label">Token Ceiling</label>
              <select
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                className="recipe-select"
              >
                <option value="128">128 tokens</option>
                <option value="256">256 tokens</option>
                <option value="512">512 tokens</option>
              </select>
            </div>
          </div>
        )}

        {/* Tab 2: RAG Pipeline */}
        {activeTab === "rag" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}>
            <p className="text-sub" style={{ gridColumn: "1 / -1" }}>These settings configure exported blueprints only. Benchmarks use the source context in each registered task and do not perform external retrieval.</p>
            <div className="settings-form-field">
              <label className="settings-field-label">Retrieved Passages (Top-K)</label>
              <select
                value={topK}
                onChange={(e) => setTopK(parseInt(e.target.value))}
                className="recipe-select"
              >
                <option value="1">Top-1</option>
                <option value="2">Top-2</option>
                <option value="3">Top-3 (Recommended)</option>
                <option value="5">Top-5</option>
              </select>
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label">Chunk Size</label>
              <select
                value={chunkSize}
                onChange={(e) => setChunkSize(parseInt(e.target.value))}
                className="recipe-select"
              >
                <option value="256">256 tokens</option>
                <option value="384">384 tokens (Recommended)</option>
                <option value="512">512 tokens</option>
              </select>
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label">Chunk Overlap</label>
              <select
                value={chunkOverlap}
                onChange={(e) => setChunkOverlap(parseInt(e.target.value))}
                className="recipe-select"
              >
                <option value="32">32 tokens</option>
                <option value="50">50 tokens (Recommended)</option>
                <option value="64">64 tokens</option>
                <option value="128">128 tokens</option>
              </select>
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label">Context Injection Format</label>
              <select
                value={injectionFormat}
                onChange={(e) => setInjectionFormat(e.target.value)}
                className="recipe-select"
              >
                <option value="xml_tags">XML Tags (&lt;regulatory_context&gt;)</option>
                <option value="markdown_context">Markdown Blockquotes</option>
                <option value="plain_text">Plain Text Delimiters</option>
              </select>
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label">Cross-Encoder Reranker</label>
              <select
                value={useReranker ? "true" : "false"}
                onChange={(e) => setUseReranker(e.target.value === "true")}
                className="recipe-select"
              >
                <option value="true">Enabled · BAAI/bge-reranker-v2-m3 (Recommended)</option>
                <option value="false">Disabled (Single Vector Search)</option>
              </select>
            </div>
          </div>
        )}

        {/* Tab 3: Infra & Engine */}
        {activeTab === "infra" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}>
            <div className="settings-form-field">
              <label className="settings-field-label">Inference Engine</label>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                className="recipe-select"
              >
                <option value="vllm">vLLM (PagedAttention)</option>
                <option value="ollama">Ollama (GGUF)</option>
              </select>
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label">Model Weights</label>
              <select
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
              <label className="settings-field-label">Quantization</label>
              <select
                value={quantization}
                onChange={(e) => setQuantization(e.target.value)}
                className="recipe-select"
              >
                <option value="fp8">FP8 E4M3 (High Throughput)</option>
                <option value="awq">AWQ 4-bit (VRAM Compression)</option>
                <option value="none">BFloat16 / Unquantized</option>
              </select>
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label">KV Cache Precision</label>
              <select
                value={kvCacheDtype}
                onChange={(e) => setKvCacheDtype(e.target.value)}
                className="recipe-select"
              >
                <option value="auto">Auto / FP16</option>
                <option value="fp8_e5m2">FP8 E5M2 (50% VRAM Savings)</option>
                <option value="fp8">FP8 E4M3 (Max KV Compression)</option>
              </select>
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label">Prefix Caching (vLLM)</label>
              <select
                value={enablePrefixCaching ? "true" : "false"}
                onChange={(e) => setEnablePrefixCaching(e.target.value === "true")}
                className="recipe-select"
              >
                <option value="true">Enabled · PagedAttention KV Reuse (Recommended)</option>
                <option value="false">Disabled (Recompute Context Each Request)</option>
              </select>
            </div>

            <div className="settings-form-field">
              <label className="settings-field-label">Concurrency Load Tier</label>
              <select
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
                onClick={() => setCliMode("recipe")}
                className={`segmented-btn ${cliMode === "recipe" ? "active" : ""}`}
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

      {/* Blueprint Export Modal */}
      {blueprintModal && (
        <ProductionBlueprintModal
          blueprint={blueprintModal}
          onClose={() => setBlueprintModal(null)}
        />
      )}
    </section>
  );
}

export type RuntimeSettings = {
  maxOutputTokens: number; temperature: number; seed: number; responseFormat: "text" | "json";
  contextLength?: number; endpoint?: string; launchVllm?: boolean;
  maxModelLen?: number; gpuMemoryUtilization?: number; quantization?: string;
  kvCacheDtype?: string; prefixCaching?: string;
  reasoningEffort?: string;
};

export function runtimeSettingsError(engine: string, settings: RuntimeSettings): string | null {
  const positive = [settings.maxOutputTokens, settings.contextLength, settings.maxModelLen].filter((v) => v !== undefined);
  if (positive.some((v) => !Number.isInteger(v) || Number(v) < 1)) return "Token and context limits must be positive whole numbers.";
  if (engine !== "openai-compatible") {
    if (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 2) return "Temperature must be between 0 and 2.";
    if (!Number.isSafeInteger(settings.seed) || settings.seed < 0) return "Seed must be a nonnegative whole number.";
  }
  if (settings.reasoningEffort && (engine !== "openai-compatible" || !["none", "low", "medium", "high", "xhigh", "max"].includes(settings.reasoningEffort))) return "Choose a supported hosted API reasoning effort.";
  const memory = settings.gpuMemoryUtilization;
  if (memory !== undefined && (!Number.isFinite(memory) || memory <= 0 || memory > 1)) return "GPU memory fraction must be greater than 0 and at most 1.";
  if (settings.endpoint) {
    try {
      const url = new URL(settings.endpoint);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
      if (engine === "vllm" && !["", "/", "/v1", "/v1/"].includes(url.pathname)) throw new Error();
      if (engine === "ollama" && !["", "/"].includes(url.pathname)) throw new Error();
      if (settings.launchVllm && (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || !url.port)) throw new Error();
    } catch { return settings.launchVllm ? "Managed vLLM needs http://localhost:<unused-port>/v1 on the runner machine." : "Enter a valid inference server URL without credentials, query parameters, or fragments."; }
  } else if (settings.launchVllm) return "Choose an unused local endpoint for the managed vLLM server.";
  return null;
}

export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}

export function platformUrlError(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return null;
  } catch {
    return "Enter the platform's full http:// or https:// address, without credentials, query parameters or a page fragment.";
  }
}

export function buildRunnerCommand(options: {
  model: string; engine: string; suite: string; prompt: string; strategy: string;
  backendUrl: string; experimentTag: string; concurrency: number; settings?: RuntimeSettings;
}): string {
  if ([options.model, options.engine, options.suite, options.prompt, options.strategy,
    options.backendUrl, options.experimentTag].some((value) => !value.trim())
    || !Number.isInteger(options.concurrency) || options.concurrency < 1) return "";
  if (platformUrlError(options.backendUrl)) return "";
  const settings = options.settings;
  if (settings && runtimeSettingsError(options.engine, settings)) return "";
  const extra: string[] = [];
  if (settings) {
    extra.push(`--max-output-tokens ${settings.maxOutputTokens}`);
    if (options.engine === "openai-compatible") {
      if (settings.reasoningEffort) extra.push(`--openai-reasoning-effort ${shellQuote(settings.reasoningEffort)}`);
    } else {
      extra.push(`--temperature ${settings.temperature}`, `--seed ${settings.seed}`, `--response-format ${shellQuote(settings.responseFormat)}`);
    }
    if (settings.endpoint) extra.push(`${options.engine === "ollama" ? "--ollama-base-url" : options.engine === "openai-compatible" ? "--openai-base-url" : "--vllm-base-url"} ${shellQuote(settings.endpoint)}`);
    if (options.engine === "ollama" && settings.contextLength) extra.push(`--context-length ${settings.contextLength}`);
    if (options.engine === "vllm" && settings.launchVllm) {
      extra.push("--launch-vllm");
      const flags: Array<[string, string | number | undefined]> = [
        ["max-model-len", settings.maxModelLen], ["gpu-memory-utilization", settings.gpuMemoryUtilization],
        ["quantization", settings.quantization], ["kv-cache-dtype", settings.kvCacheDtype], ["prefix-caching", settings.prefixCaching],
      ];
      for (const [flag, value] of flags) if (value !== undefined && value !== "") extra.push(`--vllm-${flag} ${shellQuote(String(value))}`);
    }
  }
  return [
    `bash scripts/run.sh ${shellQuote(options.model)}`,
    `--backend-url ${shellQuote(options.backendUrl)}`,
    `--engine ${shellQuote(options.engine)}`,
    `--suite ${shellQuote(options.suite)}`,
    `--prompt ${shellQuote(options.prompt)}`,
    `--strategy ${shellQuote(options.strategy)}`,
    `--concurrency ${options.concurrency}`,
    "--mode warm", "--runs 1",
    `--experiment-tag ${shellQuote(options.experimentTag)}`,
    ...extra,
  ].join(" \\\n  ");
}

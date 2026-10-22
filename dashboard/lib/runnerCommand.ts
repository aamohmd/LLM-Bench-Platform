export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}

export function buildRunnerCommand(options: {
  model: string; engine: string; suite: string; prompt: string; strategy: string;
  backendUrl: string; experimentTag: string; concurrency: number;
}): string {
  if ([options.model, options.engine, options.suite, options.prompt, options.strategy,
    options.backendUrl, options.experimentTag].some((value) => !value.trim())
    || !Number.isInteger(options.concurrency) || options.concurrency < 1) return "";
  return [
    `python3 scripts/run_remote_benchmark.py ${shellQuote(options.model)}`,
    `--backend-url ${shellQuote(options.backendUrl)}`,
    '--api-key "$API_KEY"',
    `--engine ${shellQuote(options.engine)}`,
    `--suite ${shellQuote(options.suite)}`,
    `--prompt ${shellQuote(options.prompt)}`,
    `--strategy ${shellQuote(options.strategy)}`,
    `--concurrency ${options.concurrency}`,
    "--mode warm", "--runs 1",
    `--experiment-tag ${shellQuote(options.experimentTag)}`,
  ].join(" \\\n  ");
}

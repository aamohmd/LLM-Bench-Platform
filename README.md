# LLM Bench Platform

## First-run guide

After the first administrator signs in, the dashboard and Settings show a guided checklist for suites, tasks and deterministic scorers, prompts, strategies, runner credentials, and the first result. Each step links to the real configuration screen; no starter data is inserted. Saved Settings actions refresh progress, and a manual Refresh progress button is also available.

Skip or finish the tutorial to hide it across browsers and restarts. Its state belongs to the installation and is stored in the database. Administrators can reopen it using **Open setup guide** on the dashboard or in Settings. Visitors never load the guide or its protected API. Existing installations with benchmark history start with the guide collapsed. The guide's completion flag is a tutorial preference; it does not certify benchmark readiness or change configuration.

## Deterministic scoring

Task creation loads scorer names, explanations, configuration guidance and reference examples from `GET /api/v1/scorers/catalog`. The catalog is generated from callable implementations in `benchmark_scoring/`; there is no separate frontend list. Task creation, imports and suite execution checks validate the same scoring contracts before inference.

Scorers cover numeric answers, keywords, choices, answer/citation matching, QA token F1, labels, spans, reference edits, summary overlap, authored fact/claim constraints, rule-based rubrics and reference rating agreement. These check task-authored references, not semantic truth or writing quality. No AI judge or BERTScore model is used. Summary reference scoring defaults to ROUGE-L F1 ≥ 0.5, with configurable overlap thresholds. Numeric “exact” uses a small tolerance. Ungraded generation diagnostics remain readable for historical runs but are not selectable for new scored tasks.

The scoring package ships in both repositories so each works independently. Develop scorers in the runner package, then run its `scripts/sync_scoring.py --platform <platform-checkout>` before releasing the platform. Register each scorer once with its callable, description and reference example. After rebuilding the platform, the task editor discovers it automatically. The runner checks the implementation fingerprint before inference and rejects mismatched releases.

A self-hosted API and dashboard for managing LLM benchmark suites and comparing quality, latency, throughput, and memory measurements.

The platform stores tasks, prompts, execution strategies, access keys, and benchmark results. Inference runs separately through **LLM Bench Runner**, which fetches benchmark definitions and submits results over HTTP. The platform does not need a GPU or an inference engine.

## Quick start

Requires Docker with Docker Compose.

```sh
bash scripts/setup.sh
```

Setup creates a private `.env` with a random database password, builds the stack, waits for the backend to be healthy, and displays the first administrator API key once. Save the key securely: the database stores only its hash. Running setup again preserves your configuration, data, and existing keys. There is no default key or public administrator-registration endpoint.

Open the dashboard at <http://localhost:3000> and sign in with that key. API documentation is available at <http://localhost:8000/docs>; health is at <http://localhost:8000/api/v1/health>.

Compose builds the API and dashboard, starts PostgreSQL, and persists database and result files in named volumes. Fresh databases start at the current schema with empty prompts, strategies, suites, tasks, keys, and benchmark results; setup then creates the first administrator. Existing databases follow the migration chain with their data intact. Startup does not insert example prompts, domain suites, or strategies.

For manual setup, copy `.env.example` to `.env`, set a matching password in `POSTGRES_PASSWORD` and `DATABASE_URL`, run `docker compose up --build -d --wait`, then `docker compose exec backend python scripts/create_api_key.py --bootstrap`. This local HTTP setup uses `SESSION_COOKIE_SECURE=false`; HTTPS deployments should set it to `true` and configure allowed origins and network access.

## Run benchmarks

1. In **Settings → Task suites**, create a suite and add categories/tasks by importing your own JSON or CSV. Choose scoring types from the API-provided catalog.
2. In **Prompts**, create your system prompt. In **Strategies**, create a named directive, or leave its directive text empty for a plain execution. Names have no built-in behavior.
3. In **API access**, create a dedicated administrator key for the runner or a visitor key for read-only result access. Runner execution currently requires administrator scope; visitors cannot access Settings or registry definitions.
4. Return to the dashboard. Select your registered suite, prompt, and strategy, enter a model ID available in your inference runtime, and copy the generated command.
5. Expand **First time? Set up the runner on your inference machine** below the controls. Copy its command to clone [LLM Bench Runner](https://github.com/aamohmd/LLM-Bench-Runner) and install its dependencies on the machine running Ollama or vLLM. Save an admin `API_KEY` in the runner's private `.env`, start your model server, and run the generated benchmark command from the runner folder. Already installed? Skip the clone step. No virtual-environment activation is required.
6. Press **Refresh** to see results or registry changes made in another tab. Changes made inside Settings update that list after saving. There is no background polling.

Registries are dynamic: your chosen names appear without source edits. No experiment datasets or previous results are bundled here.

The command form validates the platform address before enabling copy, and all runner fields have accessible names. Settings displays field-specific API validation errors as readable text. Prompt and strategy editors show save failures inside the dialog and prevent duplicate submissions while saving.

The dashboard generates commands to run from the runner repository root. A browser-facing URL and the runner's reachable backend URL may differ; set the runner's `--backend-url` accordingly.

**Platform URL reachable from the runner** lets you set that address before copying the command. Use a secured dashboard URL (which proxies the API) or direct API base URL. On separate machines, localhost points to the runner itself, not the platform. The platform remains API + dashboard + database; the runner and inference engine belong together on the inference host. Setup does not clone runner code onto the platform server or install GPU libraries there. Use matching releases of the two repositories; the runner checks scoring compatibility before inference.

**vLLM server setup** defaults to using an existing server. Temporary startup is an advanced convenience for controlling startup-only settings on the runner's own GPU machine. Both modes run inference separately from the platform. Engine installation and model downloads remain explicit operator steps because they depend on the hardware and model license; runner setup installs only the benchmark client dependencies.

The benchmark controls generate a runner command from your suite, prompt, strategy, engine, model, concurrency, output limit, temperature, seed, and response format. Defaults use temperature 0 and seed 42; seeds do not guarantee identical GPU outputs. JSON mode must match the tasks and their scoring references. Settings are saved with results and participate in configuration identity, so different settings are not combined into one qualification result.

For Ollama, the optional context window is sent as `num_ctx`; an empty field uses the runner's task budget. The inference URL is resolved from the runner machine. Requested context is recorded separately from context reported by Ollama's process API; unavailable measurements remain unknown.

For vLLM, **Connect to an existing server** sends request settings without changing its startup configuration. **Launch a dedicated local server** adds `--launch-vllm` to the command and requires an explicit unused `http://localhost:<port>/v1` endpoint on the runner's GPU machine. The runner starts vLLM with the selected context limit, GPU memory fraction, weight quantization, KV cache dtype and prefix caching; waits for the requested model; runs the benchmark; and stops its own process on success, failure, or interruption. Blank fields use installed engine defaults. Unsupported model/hardware/version combinations fail at startup. Install GPU-enabled vLLM in the runner's Python environment first; the platform and default runner Docker image do not include it.

Result configuration labels startup arguments as process arguments, not measured memory or independently verified engine defaults. Engine-reported context, token counts, latency, and available GPU/KV telemetry remain separate measurements. External servers' unreported startup settings remain unknown. vLLM startup flags and benchmark request settings are different controls; the UI only enables startup controls in dedicated mode.

The runner executes self-contained registered tasks; source context belongs in the task prompt. It does not perform external retrieval. Historical retrieval metadata remains readable for existing results.

## Keys and persistent data

Create and revoke additional keys in Settings. If the first key is lost, an operator with local container access can create a replacement with `docker compose exec backend python scripts/create_api_key.py --name recovery --scope admin`, then revoke the lost key. Bootstrap never rotates or reveals an existing key.

Configurations used by recorded benchmarks cannot be deleted. Both the confirmation dialog and API enforce this restriction to preserve history; unused configurations can still be removed after confirmation.

`docker compose down` stops the stack and keeps data. Starting it again preserves your registries and results. Deleting the named volumes removes that installation's data; it is not part of normal setup or upgrades.

## Development

Requires Python 3.12 and Node.js 22 or later.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm --prefix dashboard ci
npm --prefix dashboard run build
```

To run the API outside Docker, configure `DATABASE_URL` for your database in the environment or `.env`, then run `.venv/bin/python -m uvicorn backend.app.main:app --reload`. For dashboard development, set `BENCHMARK_API_URL=http://localhost:8000` and run `npm --prefix dashboard run dev`.

## Structure

- `backend/`: API, authentication, persistence, and qualification policies.
- `dashboard/`: comparison views and administration interface.
- `alembic/`: database migrations, including upgrade compatibility.
- `config/`: composite scoring profiles.
- `scripts/`: key provisioning and optional deployment utilities.

Task scoring runs in the runner; the platform evaluates submitted evidence against configured qualification policies. Historical migration identifiers are retained for database compatibility. Results retain configuration and prompt provenance; public result views do not expose full prompt text. Settings requires administrator access.

Result summaries and run details retain measured prompt/output token counts and their source. Missing measurements remain unavailable rather than being estimated in the history view.

Model pages and comparison options group runs by engine, hardware and concurrency only. Prompts, strategies and runtime configurations stay within those groups. Each option opens its group’s latest recorded snapshot with its concurrency preserved; scoreboard links also preserve the selected run and concurrency. Without an explicit concurrency, the model page uses the selected run’s concurrency or the latest matching run’s concurrency. Unmatched filters never fall back to another deployment. The execution log displays up to the latest 500 model rows and discloses that limit. Zero measurements remain visible; missing chart readings create gaps. Token figures are per-request medians and E2E latency is not total campaign duration. Error rates require recorded request counts rather than estimates from repetition/concurrency settings.

Model history shows all available recorded runs for the selected engine, hardware and concurrency, across prompts, strategies and configurations. Each metric connects its dated observations in chronological order. Settings and workloads may differ between runs; these lines show recorded history rather than a controlled comparison. A single observation is visible; missing timing data stays unavailable and creates gaps in its metric’s line. The scoreboard retains its existing grouping rules.

Deployment navigation uses full-width table rows with engine and hardware, concurrency, decode speed and median time to first token. Each row’s metrics come from its latest saved run. The active deployment is highlighted; other rows open their saved snapshot by mouse or keyboard. Small screens can scroll the table horizontally.

Reusable controls share global sizing, spacing and typography tokens with the existing neutral surfaces, borders, engine badges and focus colors. The comparison table uses these existing surfaces and badges; other components retain their existing presentation.

Text fields, numeric inputs, dropdowns and text areas share neutral borders, readable text and a single slate focus edge across the dashboard, login and Settings. Search and unit-bearing numeric controls highlight their outer shell. Invalid fields retain a red border, disabled controls remain distinct, and keyboard focus is visible without stacked neon outlines. Mobile fields use 16px text to avoid browser zoom; system high-contrast and reduced-motion preferences are respected.

Hovering the history chart shows decode speed, prefill speed and time to first token together for the nearest recorded run. The three stacked values use their series colors; unavailable measurements display a dash.

The execution log groups run identity, deployment and measurements into a compact table. Long experiment names are shortened visually; expand **Run settings** to read the full name and configuration, or open the row for its complete result. Small screens can scroll the table horizontally without squeezing text into narrow columns.

Open individual run details from the execution log. The Performance Benchmark heading displays the saved benchmark category and timestamp without a separate run shortcut.

Run pages preserve registered prompt names and distinguish missing records, expired authentication, insufficient permissions and API failures. Scoring diagnostics use saved per-task decisions, including unscored tasks and execution errors; they do not assume a numeric tolerance or infer schema compliance from the absence of failures. Model summaries load detailed scoring evidence only when expanded. Visitors may inspect scored results; raw traces remain administrator-only and are loaded on explicit expansion. Explicit context requests remain part of configuration identity even when the engine cannot report its allocation.

## Contributing

Open an issue or pull request with a focused description and validation steps. Do not include credentials, private datasets, local `.env` files, or generated benchmark results.

Keep application source, database migrations, dependency manifests and lockfiles, CI, setup scripts and generic usage documentation in the repository. Personal notes and notebooks belong in ignored local folders such as `.local/`, `docs/` or `notebooks/`. Generated results, reports, caches and credentials are also ignored. Ignoring a file does not remove it from existing Git history; review `git status` and the diff before publishing.

Historical migration revisions are retained for database compatibility, without embedded domain prompt text or default strategy/suite seeds. New installations start with empty registries; create content through the platform.

## License

Apache-2.0. Third-party dependencies retain their own licenses.

## Hosted API commands

In the benchmark command builder, select **Hosted API (OpenAI-compatible)** and enter the provider's model ID and optional API base URL. Leave the URL empty to use the runner's `OPENAI_BASE_URL` or the OpenAI API default. Set `OPENAI_API_KEY` in the runner's `.env`; this is the provider credential, separate from `API_KEY` for this platform. Keys are never included in generated commands. Select reasoning effort only when supported by the provider/model. Hosted requests may incur charges and are subject to provider rate limits. GPU memory and prefill measurements are unavailable, and latency includes network time.

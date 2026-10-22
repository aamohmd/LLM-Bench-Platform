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
5. In an independent LLM Bench Runner checkout, install its requirements, activate its virtual environment, export `API_KEY`, start your inference runtime, and run that command. The runner fetches definitions from this platform and submits measured results.
6. Press **Refresh** to see results or registry changes made in another tab. Changes made inside Settings update that list after saving. There is no background polling.

Registries are dynamic: your chosen names appear without source edits. No experiment datasets or previous results are bundled here.

The dashboard generates commands to run from the runner repository root. A browser-facing URL and the runner's reachable backend URL may differ; set the runner's `--backend-url` accordingly.

The runner executes self-contained registered tasks; source context belongs in the task prompt. It does not perform external retrieval. Historical retrieval metadata remains readable for existing results.

## Keys and persistent data

Create and revoke additional keys in Settings. If the first key is lost, an operator with local container access can create a replacement with `docker compose exec backend python scripts/create_api_key.py --name recovery --scope admin`, then revoke the lost key. Bootstrap never rotates or reveals an existing key.

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

## Contributing

Open an issue or pull request with a focused description and validation steps. Do not include credentials, private datasets, local `.env` files, or generated benchmark results.

## License

Apache-2.0. Third-party dependencies retain their own licenses.

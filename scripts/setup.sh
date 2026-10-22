#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
docker compose version >/dev/null

if [ ! -e .env ]; then
  database_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  (
    umask 077
    set -o noclobber
    cat > .env <<EOF
POSTGRES_DB=benchmark
POSTGRES_USER=benchmark
POSTGRES_PASSWORD=$database_password
DATABASE_URL=postgresql+psycopg://benchmark:$database_password@postgres:5432/benchmark
ALLOWED_ORIGINS=http://localhost:3000
SESSION_COOKIE_SECURE=false
EOF
  )
  echo "Created private .env configuration with a random database password."
else
  echo "Using existing .env configuration."
fi

docker compose config --quiet
docker compose up --build -d --wait
docker compose exec -T backend python scripts/create_api_key.py --bootstrap
echo "Open http://localhost:3000 and sign in with your administrator key."
echo "Create your suites, tasks, prompts, and strategies in Settings."

#!/usr/bin/env bash

set -euo pipefail

SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL:-}"
TARGET_DATABASE_URL="${TARGET_DATABASE_URL:-}"
POSTGRES_TOOLS_IMAGE="${POSTGRES_TOOLS_IMAGE:-postgres:17-alpine}"

if [ -z "$SOURCE_DATABASE_URL" ] || [ -z "$TARGET_DATABASE_URL" ]; then
  echo "Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL before running this script."
  exit 1
fi

if [ "$SOURCE_DATABASE_URL" = "$TARGET_DATABASE_URL" ]; then
  echo "Source and target database URLs must be different."
  exit 1
fi

MIGRATION_TMP="$(mktemp -d "${TMPDIR:-/tmp}/benchmark-db-migration.XXXXXX")"
chmod 700 "$MIGRATION_TMP"
cleanup() {
  rm -rf "$MIGRATION_TMP"
}
trap cleanup EXIT

echo "Checking that the target public schema is empty..."
TARGET_TABLE_COUNT="$(
  docker run --rm \
    -e TARGET_DATABASE_URL="$TARGET_DATABASE_URL" \
    "$POSTGRES_TOOLS_IMAGE" \
    sh -ec 'psql "$TARGET_DATABASE_URL" -XAtqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''public'\'' AND table_type = '\''BASE TABLE'\''"'
)"

if [ "$TARGET_TABLE_COUNT" != "0" ]; then
  echo "Target public schema contains $TARGET_TABLE_COUNT tables; refusing to overwrite it."
  exit 1
fi

echo "Exporting the source public schema and data..."
docker run --rm \
  -e SOURCE_DATABASE_URL="$SOURCE_DATABASE_URL" \
  -v "$MIGRATION_TMP:/migration" \
  "$POSTGRES_TOOLS_IMAGE" \
  sh -ec 'pg_dump "$SOURCE_DATABASE_URL" --format=custom --schema=public --no-owner --no-acl --file=/migration/source.dump'

echo "Restoring into the target database..."
docker run --rm \
  -e TARGET_DATABASE_URL="$TARGET_DATABASE_URL" \
  -v "$MIGRATION_TMP:/migration:ro" \
  "$POSTGRES_TOOLS_IMAGE" \
  sh -ec 'pg_restore --dbname="$TARGET_DATABASE_URL" --clean --if-exists --no-owner --no-acl --exit-on-error /migration/source.dump'

verify_table_count() {
  local url_name="$1"
  local table_name="$2"
  docker run --rm \
    -e DATABASE_URL="$url_name" \
    -e TABLE_NAME="$table_name" \
    "$POSTGRES_TOOLS_IMAGE" \
    sh -ec 'psql "$DATABASE_URL" -XAtqc "SELECT count(*) FROM public.\"$TABLE_NAME\""'
}

echo "Verifying critical table row counts..."
for table_name in benchmark_history api_keys prompts prompt_strategies alembic_version; do
  source_count="$(verify_table_count "$SOURCE_DATABASE_URL" "$table_name")"
  target_count="$(verify_table_count "$TARGET_DATABASE_URL" "$table_name")"
  if [ "$source_count" != "$target_count" ]; then
    echo "Verification failed for $table_name: source=$source_count target=$target_count"
    exit 1
  fi
  echo "  $table_name: $target_count rows"
done

echo "Database migration completed and verified."

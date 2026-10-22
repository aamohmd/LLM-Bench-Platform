#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRASTRUCTURE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_TARGET="${DEPLOY_TARGET:-}"
DEPLOY_PATH="${DEPLOY_PATH:-~/app}"
SSH_KEY_PATH="${SSH_KEY_PATH:-}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-}"

for required_variable in DEPLOY_TARGET SSH_KEY_PATH BACKEND_HEALTH_URL; do
  if [ -z "${!required_variable}" ]; then
    echo "Set $required_variable before running this script."
    exit 1
  fi
done

if [ ! -f "$SSH_KEY_PATH" ]; then
  echo "SSH key not found: $SSH_KEY_PATH"
  exit 1
fi

echo "Syncing control-plane backend files to $DEPLOY_TARGET:$DEPLOY_PATH ..."
rsync -az --delete \
  -e "ssh -i $SSH_KEY_PATH" \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.git/' \
  --exclude 'dashboard/' \
  --exclude 'data/results/' \
  --exclude 'logs/' \
  --exclude '__pycache__/' \
  --exclude '.pytest_cache/' \
  "$INFRASTRUCTURE_ROOT/" \
  "$DEPLOY_TARGET:$DEPLOY_PATH/"

echo "Building and restarting the backend with the standard cached build..."
ssh -i "$SSH_KEY_PATH" "$DEPLOY_TARGET" \
  "cd $DEPLOY_PATH && sudo docker compose -f docker-compose.prod.yml up -d --build"

echo "Waiting for the deployed health endpoint..."
for attempt in {1..40}; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 "$BACKEND_HEALTH_URL" || true)"
  if [ "$status" = "200" ]; then
    echo "Backend deployment is healthy."
    exit 0
  fi
  echo "  attempt $attempt/40: HTTP ${status:-unreachable}"
  sleep 15
done

echo "Backend did not become healthy within 10 minutes. Inspect the remote Compose logs."
exit 1

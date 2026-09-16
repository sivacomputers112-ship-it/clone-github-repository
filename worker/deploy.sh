#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/../.env.development.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/../.env.development.local"
  set +a
fi

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${WORKER_PROXY_SECRET:?WORKER_PROXY_SECRET is required}"

export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

echo "Migrating D1 schema..."
npx wrangler d1 execute forge --remote --file migrate.sql --yes

echo "Deploying forge-relay..."
npx wrangler deploy

echo "Setting WORKER_PROXY_SECRET..."
printf '%s' "$WORKER_PROXY_SECRET" | npx wrangler secret put WORKER_PROXY_SECRET

echo "Checking /health..."
curl -fsS "${CLOUDFLARE_WORKER_URL%/}/health"
echo

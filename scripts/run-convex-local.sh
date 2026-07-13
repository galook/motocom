#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$HOME/.deploy/motocom/.env.production}"
source "$APP_ROOT/scripts/use-node20.sh"
cd "$APP_ROOT"

if [[ ! -f "$DEPLOY_ENV_FILE" ]]; then
  echo "Missing Convex environment file: $DEPLOY_ENV_FILE" >&2
  exit 1
fi

exec npx convex dev \
  --env-file "$DEPLOY_ENV_FILE" \
  --typecheck enable \
  --codegen disable \
  --tail-logs disable

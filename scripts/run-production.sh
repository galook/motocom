#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$APP_ROOT/scripts/use-node20.sh"
cd "$APP_ROOT"

export NODE_ENV="${NODE_ENV:-production}"
export NITRO_HOST="${NITRO_HOST:-127.0.0.1}"
export NITRO_PORT="${NITRO_PORT:-31899}"
export PORT="${PORT:-$NITRO_PORT}"

exec node .output/server/index.mjs

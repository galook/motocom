#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export CONVEX_STATE_ROOT="${CONVEX_STATE_ROOT:-$HOME/.deploy/motocom/convex-state}"
export CONVEX_PUBLIC_ORIGIN="${CONVEX_PUBLIC_ORIGIN:-https://moto.aoo.cz/convex}"

exec python3 "$APP_ROOT/scripts/run-convex-backend.py"

#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ROOT="$ROOT/.e2e/runtime"
STATE_ROOT="$RUNTIME_ROOT/convex-state"
ENV_FILE="$RUNTIME_ROOT/convex.env"
BACKEND_LOG="$RUNTIME_ROOT/convex.log"
APP_LOG="$RUNTIME_ROOT/app.log"
BACKEND_PORT="${E2E_CONVEX_PORT:-3220}"
SITE_PORT="${E2E_CONVEX_SITE_PORT:-3221}"
APP_PORT="${E2E_APP_PORT:-31951}"

# shellcheck disable=SC1091
source "$ROOT/scripts/use-node20.sh"

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  [[ -n "${APP_PID:-}" ]] && kill "$APP_PID" >/dev/null 2>&1 || true
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" >/dev/null 2>&1 || true
  [[ -n "${APP_PID:-}" ]] && wait "$APP_PID" >/dev/null 2>&1 || true
  [[ -n "${BACKEND_PID:-}" ]] && wait "$BACKEND_PID" >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

rm -rf "$RUNTIME_ROOT"
mkdir -p "$STATE_ROOT/local"

SOURCE_STATE="/home/ubuntu/.deploy/motocom/convex-state/local/default"
if [[ ! -f "$SOURCE_STATE/config.json" ]]; then
  SOURCE_STATE="$ROOT/.convex/local/default"
fi
if [[ ! -f "$SOURCE_STATE/config.json" ]]; then
  echo "Missing Convex seed state" >&2
  exit 1
fi

mkdir -p "$STATE_ROOT/local/default/convex_local_storage"
cp "$SOURCE_STATE/config.json" "$STATE_ROOT/local/default/config.json"
python3 - "$STATE_ROOT/local/default/config.json" "$BACKEND_PORT" "$SITE_PORT" <<'PY'
import json
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
config = json.loads(path.read_text(encoding="utf-8"))
config["ports"] = {"cloud": int(sys.argv[2]), "site": int(sys.argv[3])}
path.write_text(json.dumps(config), encoding="utf-8")
PY

CONVEX_STATE_ROOT="$STATE_ROOT" \
CONVEX_PUBLIC_ORIGIN="http://127.0.0.1:$BACKEND_PORT" \
CONVEX_PUBLIC_SITE="http://127.0.0.1:$SITE_PORT" \
python3 "$ROOT/scripts/run-convex-backend.py" >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

for _ in $(seq 1 120); do
  if curl --fail --silent "http://127.0.0.1:$BACKEND_PORT/instance_name" >/dev/null; then
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    cat "$BACKEND_LOG" >&2
    exit 1
  fi
  sleep 0.25
done
curl --fail --silent "http://127.0.0.1:$BACKEND_PORT/instance_name" >/dev/null

STATE_CONFIG="$STATE_ROOT/local/default/config.json" \
SELF_HOSTED_ENV="$ENV_FILE" \
BACKEND_PORT="$BACKEND_PORT" \
python3 - <<'PY'
import json
import os
from pathlib import Path

config = json.loads(Path(os.environ["STATE_CONFIG"]).read_text(encoding="utf-8"))
Path(os.environ["SELF_HOSTED_ENV"]).write_text(
    f"CONVEX_SELF_HOSTED_URL=http://127.0.0.1:{os.environ['BACKEND_PORT']}\n"
    f"CONVEX_SELF_HOSTED_ADMIN_KEY={config['adminKey']}\n",
    encoding="utf-8",
)
PY
chmod 600 "$ENV_FILE"

(
  cd "$ROOT"
  npx convex deploy \
    --env-file "$ENV_FILE" \
    --typecheck enable \
    --codegen disable \
    --message "Motocom E2E"
)

(
  cd "$ROOT"
  CONVEX_URL="http://127.0.0.1:$BACKEND_PORT" \
  CONVEX_PUBLIC_URL="http://127.0.0.1:$BACKEND_PORT" \
  DEV_PUBLIC_HOST="127.0.0.1" \
    npm run build
)

NITRO_HOST=127.0.0.1 NITRO_PORT="$APP_PORT" PORT="$APP_PORT" \
node "$ROOT/.output/server/index.mjs" >"$APP_LOG" 2>&1 &
APP_PID=$!

for _ in $(seq 1 120); do
  if curl --fail --silent "http://127.0.0.1:$APP_PORT/" >/dev/null; then
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    cat "$APP_LOG" >&2
    exit 1
  fi
  sleep 0.25
done
curl --fail --silent "http://127.0.0.1:$APP_PORT/" >/dev/null

echo "Motocom E2E server ready on http://127.0.0.1:$APP_PORT"
wait "$APP_PID"

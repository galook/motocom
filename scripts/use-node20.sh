#!/usr/bin/env bash
set -Eeuo pipefail

FNM_BIN="${FNM_BIN:-$HOME/.local/share/fnm/fnm}"
if [[ ! -x "$FNM_BIN" ]]; then
  echo "fnm is required at $FNM_BIN" >&2
  exit 1
fi

eval "$("$FNM_BIN" env --shell bash)"
"$FNM_BIN" use --install-if-missing 20 >/dev/null

if [[ "$(node -p 'process.versions.node.split(`.`)[0]')" != "20" ]]; then
  echo "Node 20 is required" >&2
  exit 1
fi

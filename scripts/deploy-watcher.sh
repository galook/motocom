#!/usr/bin/env bash
set -u

APP_ROOT="${APP_ROOT:-/home/ubuntu/motocom}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/home/ubuntu/.deploy/motocom}"
POLL_SECONDS="${DEPLOY_POLL_SECONDS:-60}"
LOG_FILE="$DEPLOY_ROOT/deploy.log"

mkdir -p "$DEPLOY_ROOT"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"

while true; do
  "$APP_ROOT/scripts/auto-deploy.sh" >>"$LOG_FILE" 2>&1 || true
  sleep "$POLL_SECONDS"
done

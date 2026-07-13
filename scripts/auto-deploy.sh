#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/home/ubuntu/motocom}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/home/ubuntu/.deploy/motocom}"
REMOTE="${DEPLOY_REMOTE:-origin}"
BRANCH="${DEPLOY_BRANCH:-main}"
ENV_FILE="${DEPLOY_ENV_FILE:-$DEPLOY_ROOT/.env.production}"
STATE_ROOT="${CONVEX_STATE_ROOT:-$DEPLOY_ROOT/convex-state}"
RELEASES="$DEPLOY_ROOT/releases"
CURRENT="$DEPLOY_ROOT/current"
BACKUPS="$DEPLOY_ROOT/backups"
LOCK_FILE="$DEPLOY_ROOT/deploy.lock"
KEEP_RELEASES="${DEPLOY_KEEP_RELEASES:-5}"
KEEP_BACKUPS="${DEPLOY_KEEP_BACKUPS:-5}"
APP_HEALTH_URL="${DEPLOY_APP_HEALTH_URL:-http://127.0.0.1:31899/}"
BACKEND_HEALTH_URL="${DEPLOY_BACKEND_HEALTH_URL:-http://127.0.0.1:3210/instance_name}"

mkdir -p "$RELEASES" "$BACKUPS"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

log() {
  printf '%s %s\n' "$(date --iso-8601=seconds)" "$*"
}

source_node20() {
  # shellcheck disable=SC1090
  source "$1/scripts/use-node20.sh"
}

app_healthy() {
  curl --fail --silent --show-error --max-time 4 "$APP_HEALTH_URL" >/dev/null
}

backend_healthy() {
  curl --fail --silent --show-error --max-time 4 "$BACKEND_HEALTH_URL" | grep -q .
}

health_check() {
  local attempt
  for attempt in $(seq 1 60); do
    if backend_healthy && app_healthy; then
      return 0
    fi
    sleep 1
  done
  return 1
}

stop_apps() {
  pm2 delete motocom-app >/dev/null 2>&1 || true
  pm2 delete motocom-backend >/dev/null 2>&1 || true
}

start_release() {
  local release="$1"
  APP_ROOT="$release" \
  DEPLOY_ROOT="$DEPLOY_ROOT" \
  DEPLOY_ENV_FILE="$ENV_FILE" \
    pm2 start "$release/ecosystem.config.cjs" --update-env
}

deploy_convex_code() {
  local release="$1"
  (
    source_node20 "$release"
    cd "$release"
    npx convex dev \
      --once \
      --env-file "$ENV_FILE" \
      --typecheck enable \
      --codegen disable \
      --tail-logs disable
  )
}

backup_convex_state() {
  local db="$STATE_ROOT/local/default/convex_local_backend.sqlite3"
  [[ -f "$db" ]] || return 0

  local stamp backup_dir
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_dir="$BACKUPS/$stamp"
  mkdir -p "$backup_dir"

  DB_SOURCE="$db" DB_TARGET="$backup_dir/convex_local_backend.sqlite3" python3 - <<'PY'
import os
import sqlite3
source = sqlite3.connect(f"file:{os.environ['DB_SOURCE']}?mode=ro", uri=True)
target = sqlite3.connect(os.environ['DB_TARGET'])
with target:
    source.backup(target)
target.close()
source.close()
PY

  if [[ -f "$STATE_ROOT/local/default/config.json" ]]; then
    cp "$STATE_ROOT/local/default/config.json" "$backup_dir/config.json"
  fi
  if [[ -d "$STATE_ROOT/local/default/convex_local_storage" ]]; then
    tar -C "$STATE_ROOT/local/default" -czf "$backup_dir/convex_local_storage.tar.gz" convex_local_storage
  fi
  chmod -R go-rwx "$backup_dir"
  log "Backed up Convex state to $backup_dir"
}

prune_old_items() {
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -name '.*.tmp' -printf '%T@ %p\n' \
    | sort -rn \
    | awk -v keep="$KEEP_RELEASES" 'NR > keep {sub(/^[^ ]+ /, ""); print}' \
    | while IFS= read -r old_release; do
        [[ -n "$old_release" && "$old_release" != "$(readlink -f "$CURRENT" 2>/dev/null || true)" ]] && rm -rf "$old_release"
      done

  find "$BACKUPS" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -rn \
    | awk -v keep="$KEEP_BACKUPS" 'NR > keep {sub(/^[^ ]+ /, ""); print}' \
    | while IFS= read -r old_backup; do
        [[ -n "$old_backup" ]] && rm -rf "$old_backup"
      done
}

rollback_release() {
  local previous="$1"
  stop_apps
  if [[ -n "$previous" && -d "$previous" ]]; then
    log "Rolling back to $(basename "$previous")"
    deploy_convex_code "$previous" || log "WARNING backend code rollback failed"
    ln -sfn "$previous" "$CURRENT"
    start_release "$previous"
    health_check || log "ERROR rollback health check failed"
  else
    rm -f "$CURRENT"
  fi
  pm2 save --force >/dev/null 2>&1 || true
}

if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR missing production environment file: $ENV_FILE"
  exit 1
fi
if [[ ! -f "$STATE_ROOT/local/default/config.json" ]]; then
  log "ERROR missing persistent Convex state: $STATE_ROOT/local/default/config.json"
  exit 1
fi

cd "$APP_ROOT"
git fetch --quiet --prune "$REMOTE" "$BRANCH"
TARGET_SHA="$(git rev-parse "$REMOTE/$BRANCH")"
CURRENT_SHA=""
PREVIOUS_RELEASE=""
if [[ -L "$CURRENT" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT")"
  CURRENT_SHA="$(basename "$PREVIOUS_RELEASE")"
fi

if [[ "$TARGET_SHA" == "$CURRENT_SHA" ]] && health_check; then
  exit 0
fi

RELEASE="$RELEASES/$TARGET_SHA"
if [[ ! -d "$RELEASE" ]]; then
  TEMP_RELEASE="$RELEASES/.${TARGET_SHA}.tmp"
  rm -rf "$TEMP_RELEASE"
  mkdir -p "$TEMP_RELEASE"
  git archive "$TARGET_SHA" | tar -x -C "$TEMP_RELEASE"
  rm -rf "$TEMP_RELEASE/.convex" "$TEMP_RELEASE/.env.local"
  ln -s "$STATE_ROOT" "$TEMP_RELEASE/.convex"
  ln -s "$ENV_FILE" "$TEMP_RELEASE/.env.local"

  log "Installing and validating $TARGET_SHA"
  (
    source_node20 "$TEMP_RELEASE"
    cd "$TEMP_RELEASE"
    npm ci
    npm test -- --reporter=dot
    npm run typecheck
    npm audit --audit-level=high
    npm run build:app
  )
  mv "$TEMP_RELEASE" "$RELEASE"
fi

backup_convex_state
log "Deploying Convex functions for $TARGET_SHA"
if ! deploy_convex_code "$RELEASE"; then
  log "ERROR Convex deployment failed for $TARGET_SHA"
  exit 1
fi

log "Switching production to $TARGET_SHA"
ln -sfn "$RELEASE" "$CURRENT"
stop_apps
if ! start_release "$RELEASE"; then
  log "ERROR PM2 failed to start $TARGET_SHA"
  rollback_release "$PREVIOUS_RELEASE"
  exit 1
fi

if ! health_check; then
  log "ERROR health check failed for $TARGET_SHA"
  rollback_release "$PREVIOUS_RELEASE"
  exit 1
fi

pm2 save --force >/dev/null
prune_old_items
log "Deployment successful: $TARGET_SHA"

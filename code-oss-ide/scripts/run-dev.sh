#!/usr/bin/env bash
# run-dev.sh — Launch AIPiloty IDE in development mode
#
# Usage (from aipiloty/ root):
#   bash code-oss-ide/scripts/run-dev.sh
#
# Dev mode uses npm run watch (incremental build) + scripts/code.sh (instant launch).
# No full production build needed — changes to vscode source rebuild in seconds.
#
# Run this AFTER bootstrap.sh completes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODE_OSS_IDE_DIR="$(dirname "$SCRIPT_DIR")"
FORK_DIR="${FORK_DIR:-$CODE_OSS_IDE_DIR/vscode-fork}"
AIPILOTY_DIR="$(dirname "$CODE_OSS_IDE_DIR")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
step() { echo -e "\n${BOLD}→ $*${NC}"; }

[[ -d "$FORK_DIR" ]] || {
  echo "Code OSS fork not found at $FORK_DIR"
  echo "Run: bash code-oss-ide/bootstrap.sh"
  exit 1
}

cd "$FORK_DIR"

# ── Sync extension on each dev launch ────────────────────────────────────────
EXTENSION_SRC="$AIPILOTY_DIR/desktop-ide"
EXTENSION_DST="$FORK_DIR/extensions/aipiloty-agent"

if [[ -d "$EXTENSION_SRC" ]]; then
  step "Syncing AIPiloty extension (re-compiling)…"
  cd "$EXTENSION_SRC"
  npm run compile 2>&1 | tail -5
  cd "$FORK_DIR"
  rsync -a --delete --exclude='node_modules' --exclude='.git' --exclude='*.ts' --exclude='src/' \
    "$EXTENSION_SRC/" "$EXTENSION_DST/" 2>/dev/null || true
  ok "Extension synced"
fi

# ── Start AIPiloty backend sidecar ────────────────────────────────────────────
BACKEND_DIR="$AIPILOTY_DIR/backend"
if [[ -f "$BACKEND_DIR/.venv/bin/uvicorn" ]]; then
  step "Starting AIPiloty backend sidecar (port 8100)…"
  # Check if already running
  if ! curl -sf http://127.0.0.1:8100/api/v1/health >/dev/null 2>&1; then
    cd "$BACKEND_DIR"
    .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8100 --log-level warning &
    BACKEND_PID=$!
    echo "  Backend PID: $BACKEND_PID"
    # Wait for health
    for i in $(seq 1 30); do
      sleep 1
      if curl -sf http://127.0.0.1:8100/api/v1/health >/dev/null 2>&1; then
        ok "Backend ready"
        break
      fi
    done
    cd "$FORK_DIR"
  else
    ok "Backend already running"
  fi
else
  echo -e "${YELLOW}⚠${NC}  Backend venv not found. Run: make install"
  echo "   IDE will launch but AI features will be degraded."
fi

# ── Launch the IDE ─────────────────────────────────────────────────────────────
step "Launching AIPiloty IDE (Code OSS dev mode)…"
echo ""
echo "  First-time launch triggers 'npm run watch' compilation — takes 2-5 min."
echo "  Subsequent launches are instant."
echo ""
echo "  The AIPiloty sidebar will be available in the Activity Bar."
echo "  Press Cmd+K on selected code for AI inline edit."
echo ""

# Patch Electron .app so Dock / double-click never shows blank Electron welcome
if [[ -f "$AIPILOTY_DIR/scripts/patch-electron-app.sh" ]]; then
  bash "$AIPILOTY_DIR/scripts/patch-electron-app.sh" || true
fi

# VSCODE_DEV=1 tells Code OSS it's running in dev mode
export VSCODE_DEV=1
export VSCODE_EXTENSIONS="$FORK_DIR/extensions"

# Use the built-in launch script (it compiles on first run if needed)
if [[ -f "$FORK_DIR/scripts/code.sh" ]]; then
  exec "$FORK_DIR/scripts/code.sh" \
    --user-data-dir "$HOME/.aipiloty-ide-dev" \
    --extensions-dir "$HOME/.aipiloty-ide-dev/extensions" \
    "$@"
else
  echo "Starting npm run watch + waiting for out/main.js…"
  npm run watch &
  echo "  Waiting for initial build (2-5 min)…"
  while [[ ! -f "$FORK_DIR/out/main.js" ]]; do sleep 2; done
  exec "$FORK_DIR/scripts/code.sh" \
    --user-data-dir "$HOME/.aipiloty-ide-dev" \
    --extensions-dir "$HOME/.aipiloty-ide-dev/extensions" \
    "$@"
fi

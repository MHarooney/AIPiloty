#!/usr/bin/env bash
# Launch AIPiloty Desktop IDE (Code OSS fork) — used by AIPiloty IDE.app
# Safe for Dock / Finder (sets PATH; logs to ~/Library/Logs/AIPiloty/).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${HOME}/Library/Logs/AIPiloty"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/desktop-ide.log"

# GUI apps get a tiny PATH — pull in Homebrew + common Node locations
export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin:${HOME}/.local/bin:${PATH}"

# Optional: nvm / fnm
if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.nvm/nvm.sh" || true
fi
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)" || true
fi

notify() {
  local msg="$1"
  osascript -e "display notification \"${msg//\"/\\\"}\" with title \"AIPiloty IDE\"" 2>/dev/null || true
}

die() {
  local msg="$1"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ERROR: $msg" >>"$LOG_FILE"
  osascript <<APPLESCRIPT 2>/dev/null || true
display dialog "${msg//\"/\\\"}" buttons {"OK"} default button "OK" with title "AIPiloty IDE" with icon stop
APPLESCRIPT
  exit 1
}

{
  echo "======== $(date -u +%Y-%m-%dT%H:%M:%SZ) launch ========"
  echo "ROOT=$ROOT"
  echo "PATH=$PATH"
  echo "node=$(command -v node || echo missing) $(node -v 2>/dev/null || true)"
  echo "npm=$(command -v npm || echo missing)"
} >>"$LOG_FILE"

[[ -d "$ROOT/code-oss-ide/vscode-fork" ]] || \
  die "Code OSS fork not found. Run once in Terminal:\n  cd \"$ROOT\" && make fork-install"

[[ -f "$ROOT/code-oss-ide/scripts/run-dev.sh" ]] || \
  die "Missing run-dev.sh at $ROOT/code-oss-ide/scripts/run-dev.sh"

notify "Starting AIPiloty IDE…"

# Prefer opening workspace if evo-lms parent exists
WORKSPACE=""
if [[ -d "$(dirname "$ROOT")" ]]; then
  WORKSPACE="$(dirname "$ROOT")"
fi

cd "$ROOT"
# shellcheck disable=SC2086
if [[ -n "$WORKSPACE" ]]; then
  exec bash "$ROOT/code-oss-ide/scripts/run-dev.sh" "$WORKSPACE" >>"$LOG_FILE" 2>&1
else
  exec bash "$ROOT/code-oss-ide/scripts/run-dev.sh" >>"$LOG_FILE" 2>&1
fi

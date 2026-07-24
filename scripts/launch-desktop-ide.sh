#!/usr/bin/env bash
# Launch AIPiloty Desktop IDE (Code OSS fork) — used by AIPiloty IDE.app + Electron Dock pin.
# Safe for Dock / Finder (sets PATH; logs to ~/Library/Logs/AIPiloty/).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FORK="$ROOT/code-oss-ide/vscode-fork"
LOG_DIR="${HOME}/Library/Logs/AIPiloty"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/desktop-ide.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin:${HOME}/.local/bin:/usr/bin:/bin:${PATH}"

if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.nvm/nvm.sh" || true
fi
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)" || true
fi

# Login-shell PATH (Finder apps often miss node)
if [[ -f "${HOME}/.zprofile" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.zprofile" 2>/dev/null || true
fi

notify() {
  osascript -e "display notification \"$1\" with title \"AIPiloty IDE\"" 2>/dev/null || true
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
  echo "pwd=$(pwd)"
} >>"$LOG_FILE"

[[ -d "$FORK" ]] || die "Code OSS fork missing. In Terminal run: cd \"$ROOT\" && make fork-install"
[[ -f "$ROOT/code-oss-ide/scripts/run-dev.sh" ]] || die "Missing run-dev.sh"

command -v node >/dev/null 2>&1 || die "Node.js not found in PATH. Install Node, then reopen AIPiloty IDE."
command -v npm >/dev/null 2>&1 || die "npm not found in PATH."

# Ensure Electron Dock pin opens IDE (not blank Electron page)
if [[ -d "$FORK/.build/electron" ]]; then
  bash "$ROOT/scripts/patch-electron-app.sh" >>"$LOG_FILE" 2>&1 || true
fi

notify "Starting AIPiloty IDE…"

WORKSPACE="$(dirname "$ROOT")"
cd "$ROOT"

# Don't exec — keep logging until IDE process takes over via code.sh exec
set +e
# Extra args (e.g. --remote-debugging-port=9222) forward to code.sh / Electron
bash "$ROOT/code-oss-ide/scripts/run-dev.sh" "$WORKSPACE" "$@" >>"$LOG_FILE" 2>&1
RC=$?
set -e

if [[ $RC -ne 0 ]]; then
  die "IDE failed to start (exit $RC). See log: $LOG_FILE"
fi

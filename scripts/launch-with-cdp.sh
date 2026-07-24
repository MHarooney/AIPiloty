#!/usr/bin/env bash
# Launch AIPiloty IDE (or Cursor) with Chrome DevTools Protocol for electron-mcp.
# Usage:
#   ./scripts/launch-with-cdp.sh              # AIPiloty on port 9222
#   ./scripts/launch-with-cdp.sh cursor       # Cursor on port 9222
#   ./scripts/launch-with-cdp.sh aipiloty 9229
set -euo pipefail
TARGET="${1:-aipiloty}"
PORT="${2:-9222}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  echo "CDP already listening on :${PORT}"
  curl -s "http://127.0.0.1:${PORT}/json/version" | head -c 400; echo
  exit 0
fi

case "$TARGET" in
  aipiloty|ide)
    EXEC="$ROOT/scripts/launch-desktop-ide.sh"
    if [[ ! -x "$EXEC" ]]; then
      echo "Missing $EXEC — run make fork / install-desktop-app first" >&2
      exit 1
    fi
    echo "Starting AIPiloty with --remote-debugging-port=${PORT}"
    exec "$EXEC" --remote-debugging-port="$PORT"
    ;;
  cursor)
    CURSOR="/Applications/Cursor.app/Contents/MacOS/Cursor"
    if [[ ! -x "$CURSOR" ]]; then
      echo "Cursor not found at $CURSOR" >&2
      exit 1
    fi
    echo "Starting Cursor with --remote-debugging-port=${PORT}"
    echo "Note: quit existing Cursor first, or use a different PORT."
    exec "$CURSOR" --remote-debugging-port="$PORT"
    ;;
  *)
    echo "Unknown target: $TARGET (use aipiloty|cursor)" >&2
    exit 1
    ;;
esac

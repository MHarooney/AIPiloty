#!/usr/bin/env bash
# Symlink AIPiloty.app so Finder / Launchpad can find it.
# Default: /Applications (same list as Finder sidebar "Applications") — needs your password once.
# Per-user only: ./scripts/link-macos-app.sh --user
#
# The .app bundle must stay inside your repo; only a symlink is installed.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT/AIPiloty.app"
MODE="system"
DEST=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user|-u) MODE="user" ;;
    --help|-h)
      echo "Usage: $0 [--user] [destination-path]" >&2
      echo "  (no args)  Symlink to /Applications/AIPiloty.app (recommended; uses sudo)" >&2
      echo "  --user     Symlink to ~/Applications/AIPiloty.app (Finder: Home → Applications)" >&2
      exit 0
      ;;
    *)
      if [[ -n "$DEST" ]]; then
        echo "Unexpected extra argument: $1" >&2
        exit 1
      fi
      DEST="$1"
      ;;
  esac
  shift
done

if [[ -z "$DEST" ]]; then
  if [[ "$MODE" == "user" ]]; then
    DEST="$HOME/Applications/AIPiloty.app"
  else
    DEST="/Applications/AIPiloty.app"
  fi
fi

if [[ ! -d "$SRC" ]]; then
  echo "Missing bundle: $SRC" >&2
  exit 1
fi

PARENT="$(dirname "$DEST")"
if [[ -e "$DEST" && ! -L "$DEST" ]]; then
  echo "Refusing to overwrite a real folder/file: $DEST" >&2
  exit 1
fi

do_ln() {
  rm -f "$DEST"
  ln -sf "$SRC" "$DEST"
}

if [[ "$PARENT" == "/Applications" ]] || [[ "$PARENT" == "/Applications/"* ]]; then
  if [[ ! -w "/Applications" ]]; then
    echo "Installing to /Applications (Finder sidebar + Launchpad) — password prompt if needed..."
    sudo rm -f "$DEST"
    sudo ln -sf "$SRC" "$DEST"
  else
    do_ln
  fi
else
  mkdir -p "$PARENT"
  do_ln
fi

echo ""
echo "Installed:"
echo "  $DEST -> $SRC"
echo ""

if [[ "$PARENT" == "$HOME"/* ]] || [[ "$DEST" == "$HOME/Applications/"* ]]; then
  echo "Finder does NOT show ~/Applications in the sidebar by default."
  echo "  • Press Cmd+Shift+H (Go Home), then open the \"Applications\" folder inside your home folder."
  echo "  • Or run:  open \"$HOME/Applications\""
  echo ""
  echo "Launchpad sometimes skips ~/Applications until the Dock refreshes:"
  echo "  • Run:  killall Dock"
else
  echo "Open Finder → Applications — you should see AIPiloty next to your other apps."
  echo "Or run:  open /Applications"
  echo ""
  echo "If Launchpad still hides it, refresh:  killall Dock"
fi

echo ""
echo "First launch: if macOS blocks the app, right-click AIPiloty → Open → Open."

if command -v open >/dev/null 2>&1; then
  open -R "$DEST" 2>/dev/null || open "$PARENT" 2>/dev/null || true
fi

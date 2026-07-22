#!/usr/bin/env bash
# Build AIPiloty IDE.app (dev launcher) and install into Applications.
#
# Usage:
#   bash scripts/install-desktop-app.sh           # → /Applications (sudo if needed)
#   bash scripts/install-desktop-app.sh --user    # → ~/Applications
#   bash scripts/install-desktop-app.sh --no-link # only rebuild .app in repo

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="AIPiloty IDE.app"
APP_SRC="$ROOT/$APP_NAME"
MODE="system"
NO_LINK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user|-u) MODE="user" ;;
    --no-link) NO_LINK=1 ;;
    -h|--help)
      echo "Usage: $0 [--user] [--no-link]"
      exit 0
      ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
  shift
done

echo "→ Building $APP_NAME in $ROOT"

rm -rf "$APP_SRC"
mkdir -p "$APP_SRC/Contents/MacOS" "$APP_SRC/Contents/Resources"

# Launcher inside the .app — resolves repo root as parent of the .app
cat > "$APP_SRC/Contents/MacOS/launcher" <<'EOF'
#!/bin/bash
# AIPiloty IDE.app → launches Code OSS fork via scripts/launch-desktop-ide.sh
# Keep this .app inside aipiloty/; install to Applications via symlink only.

set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SCRIPT="$ROOT/scripts/launch-desktop-ide.sh"

if [[ ! -f "$SCRIPT" ]]; then
  osascript -e 'display dialog "AIPiloty IDE could not find its project. Keep \"AIPiloty IDE.app\" inside the aipiloty folder (next to code-oss-ide/), then re-run: make fork-app" buttons {"OK"} default button "OK" with title "AIPiloty IDE" with icon stop' 2>/dev/null || true
  exit 1
fi

chmod +x "$SCRIPT" 2>/dev/null || true
exec /bin/bash "$SCRIPT"
EOF
chmod +x "$APP_SRC/Contents/MacOS/launcher"

cat > "$APP_SRC/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>launcher</string>
	<key>CFBundleIdentifier</key>
	<string>com.aipiloty.desktop-ide</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>AIPiloty IDE</string>
	<key>CFBundleDisplayName</key>
	<string>AIPiloty IDE</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSMinimumSystemVersion</key>
	<string>12.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
</dict>
</plist>
EOF

# Optional icon: reuse VS Code fork icon if present
ICON_SRC=""
for candidate in \
  "$ROOT/code-oss-ide/vscode-fork/resources/darwin/code.icns" \
  "$ROOT/code-oss-ide/vscode-fork/resources/darwin/aipiloty.icns"
do
  if [[ -f "$candidate" ]]; then
    ICON_SRC="$candidate"
    break
  fi
done
if [[ -n "$ICON_SRC" ]]; then
  cp "$ICON_SRC" "$APP_SRC/Contents/Resources/AppIcon.icns"
  echo "  Icon: $ICON_SRC"
else
  # Remove icon key if no icns
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIconFile" "$APP_SRC/Contents/Info.plist" 2>/dev/null || true
fi

chmod +x "$ROOT/scripts/launch-desktop-ide.sh"

# Clear quarantine so first double-click works more reliably
xattr -cr "$APP_SRC" 2>/dev/null || true

echo "✓ Bundle ready: $APP_SRC"

if [[ "$NO_LINK" -eq 1 ]]; then
  echo "Skipped Applications link (--no-link)."
  exit 0
fi

if [[ "$MODE" == "user" ]]; then
  DEST="$HOME/Applications/AIPiloty IDE.app"
  mkdir -p "$HOME/Applications"
  rm -f "$DEST"
  ln -sf "$APP_SRC" "$DEST"
  echo "✓ Linked: $DEST → $APP_SRC"
  echo "  Open:  open \"$HOME/Applications\""
else
  DEST="/Applications/AIPiloty IDE.app"
  echo "→ Installing to /Applications (may ask for password)…"
  if [[ -w /Applications ]]; then
    rm -f "$DEST"
    ln -sf "$APP_SRC" "$DEST"
  else
    sudo rm -f "$DEST"
    sudo ln -sf "$APP_SRC" "$DEST"
  fi
  echo "✓ Linked: $DEST → $APP_SRC"
  echo "  Finder → Applications → AIPiloty IDE"
fi

# Refresh Launchpad / Dock index lightly
killall Dock 2>/dev/null || true

echo ""
echo "Done. Double-click \"AIPiloty IDE\" in Applications to launch."
echo "Logs: ~/Library/Logs/AIPiloty/desktop-ide.log"
echo "First Gatekeeper prompt: right-click → Open → Open"
open -R "$DEST" 2>/dev/null || true

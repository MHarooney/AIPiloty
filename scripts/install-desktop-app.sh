#!/usr/bin/env bash
# Build AIPiloty IDE.app (dev launcher) and install into Applications.
#
# Usage:
#   bash scripts/install-desktop-app.sh           # → /Applications (sudo if needed)
#   bash scripts/install-desktop-app.sh --user    # → ~/Applications
#   bash scripts/install-desktop-app.sh --no-link # only rebuild .app in repo

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
APP_NAME="AIPiloty IDE.app"
APP_SRC="$ROOT/$APP_NAME"
LAUNCH_SCRIPT="$ROOT/scripts/launch-desktop-ide.sh"
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

[[ -f "$LAUNCH_SCRIPT" ]] || {
  echo "Missing $LAUNCH_SCRIPT" >&2
  exit 1
}
chmod +x "$LAUNCH_SCRIPT"

rm -rf "$APP_SRC"
mkdir -p "$APP_SRC/Contents/MacOS" "$APP_SRC/Contents/Resources"

# Native Mach-O stub — Finder/Dock often ignore shell-script CFBundleExecutable.
# Absolute path is baked in so /Applications symlinks cannot resolve to the wrong root.
LAUNCHER_C="$APP_SRC/Contents/MacOS/launcher.c"
cat > "$LAUNCHER_C" <<EOF
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>

static void alert(const char *msg) {
  char cmd[2048];
  snprintf(cmd, sizeof(cmd),
    "osascript -e 'display dialog \"%s\" buttons {\"OK\"} default button \"OK\" "
    "with title \"AIPiloty IDE\" with icon stop' 2>/dev/null",
    msg);
  system(cmd);
}

int main(int argc, char **argv) {
  (void)argc; (void)argv;
  const char *script = "$LAUNCH_SCRIPT";
  if (access(script, R_OK) != 0) {
    alert("Could not find launch script. Re-run: cd aipiloty && make fork-app");
    return 1;
  }
  /* Detach from Finder so the Dock icon is owned by Electron, not this stub. */
  pid_t pid = fork();
  if (pid < 0) {
    execl("/bin/bash", "bash", script, (char *)NULL);
    alert("Failed to start AIPiloty IDE (exec).");
    return 1;
  }
  if (pid == 0) {
    /* child: new session, log to file */
    setsid();
    const char *home = getenv("HOME");
    if (home) {
      char logpath[1024];
      snprintf(logpath, sizeof(logpath), "%s/Library/Logs/AIPiloty", home);
      char mk[1100];
      snprintf(mk, sizeof(mk), "mkdir -p '%s'", logpath);
      system(mk);
      char logfile[1100];
      snprintf(logfile, sizeof(logfile), "%s/desktop-ide.log", logpath);
      freopen(logfile, "a", stdout);
      freopen(logfile, "a", stderr);
    }
    execl("/bin/bash", "bash", script, (char *)NULL);
    _exit(127);
  }
  /* parent exits immediately — Finder sees a successful launch */
  return 0;
}
EOF

echo "  Compiling native launcher…"
clang -Os -o "$APP_SRC/Contents/MacOS/launcher" "$LAUNCHER_C"
rm -f "$LAUNCHER_C"
chmod +x "$APP_SRC/Contents/MacOS/launcher"

# Fallback shell (not used as CFBundleExecutable; kept for debugging)
cat > "$APP_SRC/Contents/MacOS/launcher.sh" <<EOF
#!/bin/bash
set -e
exec /bin/bash "$LAUNCH_SCRIPT"
EOF
chmod +x "$APP_SRC/Contents/MacOS/launcher.sh"

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
	<string>2</string>
	<key>LSMinimumSystemVersion</key>
	<string>12.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>LSUIElement</key>
	<false/>
</dict>
</plist>
EOF

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
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIconFile" "$APP_SRC/Contents/Info.plist" 2>/dev/null || true
fi

xattr -cr "$APP_SRC" 2>/dev/null || true

echo "✓ Bundle ready: $APP_SRC"
file "$APP_SRC/Contents/MacOS/launcher"

if [[ "$NO_LINK" -eq 1 ]]; then
  echo "Skipped Applications link (--no-link)."
  exit 0
fi

link_app() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  # Prefer a real copy for Launch Services reliability; fall back to symlink.
  if cp -R "$APP_SRC" "$dest" 2>/dev/null; then
    xattr -cr "$dest" 2>/dev/null || true
    echo "✓ Installed: $dest"
  else
    ln -sf "$APP_SRC" "$dest"
    echo "✓ Linked: $dest → $APP_SRC"
  fi
}

if [[ "$MODE" == "user" ]]; then
  DEST="$HOME/Applications/AIPiloty IDE.app"
  link_app "$DEST"
  echo "  Open:  open \"$HOME/Applications\""
else
  DEST="/Applications/AIPiloty IDE.app"
  echo "→ Installing to /Applications (may ask for password)…"
  if [[ -w /Applications ]]; then
    link_app "$DEST"
  else
    sudo rm -rf "$DEST"
    if sudo cp -R "$APP_SRC" "$DEST"; then
      sudo xattr -cr "$DEST" 2>/dev/null || true
      echo "✓ Installed: $DEST"
    else
      sudo ln -sf "$APP_SRC" "$DEST"
      echo "✓ Linked: $DEST → $APP_SRC"
    fi
  fi
  echo "  Finder → Applications → AIPiloty IDE"
fi

# Refresh Launch Services registration (do NOT kill Dock)
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST" 2>/dev/null || true

echo ""
echo "Done. Double-click \"AIPiloty IDE\" in Applications to launch."
echo "Logs: ~/Library/Logs/AIPiloty/desktop-ide.log"
echo "If Gatekeeper blocks: right-click → Open → Open"
open -R "$DEST" 2>/dev/null || true

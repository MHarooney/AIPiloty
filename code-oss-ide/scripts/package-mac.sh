#!/usr/bin/env bash
# package-mac.sh — Build AIPiloty IDE as a standalone macOS .app + .dmg
#
# Output: code-oss-ide/vscode-fork/../AIPiloty-darwin-arm64/
#
# This is a PRODUCTION build (~30-60 min). Use run-dev.sh for daily development.
#
# Prerequisites: bootstrap.sh must have run first.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODE_OSS_IDE_DIR="$(dirname "$SCRIPT_DIR")"
FORK_DIR="${FORK_DIR:-$CODE_OSS_IDE_DIR/vscode-fork}"

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
step() { echo -e "\n${BOLD}→ $*${NC}"; }
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }

[[ -d "$FORK_DIR" ]] || {
  echo "Fork not found at $FORK_DIR — run bootstrap.sh first"
  exit 1
}
cd "$FORK_DIR"

# ── Determine architecture ─────────────────────────────────────────────────────
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
  GULP_TARGET="vscode-darwin-arm64"
  ARCH_LABEL="Apple Silicon (arm64)"
else
  GULP_TARGET="vscode-darwin"
  ARCH_LABEL="Intel (x64)"
fi

step "Building AIPiloty IDE for $ARCH_LABEL…"
echo "  This will take 30-60 minutes on first run."
echo "  Target: $GULP_TARGET"
echo "  Output: $(dirname "$FORK_DIR")/AIPiloty-darwin-${ARCH}/"
echo ""
read -p "  Continue? [y/N] " -n 1 -r
echo ""
[[ $REPLY =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 0; }

# ── Build ──────────────────────────────────────────────────────────────────────
step "Running: npm run gulp -- $GULP_TARGET"
npm run gulp -- "$GULP_TARGET"

OUTPUT_DIR="$(dirname "$FORK_DIR")/VSCode-darwin-${ARCH}"

# ── Rename output to AIPiloty ─────────────────────────────────────────────────
step "Renaming output…"
AIPILOTY_DIR="$(dirname "$FORK_DIR")/AIPiloty-darwin-${ARCH}"
if [[ -d "$OUTPUT_DIR" ]]; then
  mv "$OUTPUT_DIR" "$AIPILOTY_DIR"
fi

ok "Build complete!"
echo ""
echo "  Output: $AIPILOTY_DIR"
echo ""
echo "  To run:"
echo "    open \"$AIPILOTY_DIR/AIPiloty.app\""
echo ""
echo "  To create .dmg (requires create-dmg):"
echo "    brew install create-dmg"
echo "    create-dmg AIPiloty.dmg \"$AIPILOTY_DIR/AIPiloty.app\""

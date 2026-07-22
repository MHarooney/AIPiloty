#!/usr/bin/env bash
# install-deps.sh — Install all prerequisites for building AIPiloty IDE on macOS
#
# Run this once on a fresh Mac before bootstrap.sh.
# Apple Silicon (arm64) + Intel (x64) both supported.

set -euo pipefail

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
step() { echo -e "\n${BOLD}→ $*${NC}"; }

echo ""
echo -e "${BOLD}AIPiloty IDE — macOS Prerequisites Setup${NC}"
echo ""

# ── 1. Xcode Command Line Tools ────────────────────────────────────────────────
step "Xcode Command Line Tools…"
if xcode-select -p >/dev/null 2>&1; then
  ok "Xcode CLT already installed: $(xcode-select -p)"
else
  echo "Installing Xcode Command Line Tools (a dialog will appear)…"
  xcode-select --install
  echo "After the installer finishes, re-run this script."
  exit 0
fi

# ── 2. Homebrew ────────────────────────────────────────────────────────────────
step "Homebrew…"
if command -v brew >/dev/null 2>&1; then
  ok "Homebrew $(brew --version | head -1)"
else
  echo "Installing Homebrew…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add Homebrew to PATH for Apple Silicon
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
fi

# ── 3. Node.js 20 LTS ──────────────────────────────────────────────────────────
step "Node.js 20 LTS…"
if node --version 2>/dev/null | grep -q "^v20\|^v18\|^v22"; then
  ok "Node.js $(node --version)"
else
  echo "Installing Node.js 20 LTS…"
  brew install node@20
  brew link --overwrite node@20
fi

# ── 4. Yarn (classic 1.x) ──────────────────────────────────────────────────────
step "npm…"
# VS Code ≥1.96 uses npm only (yarn is rejected in preinstall.js)
if command -v npm >/dev/null 2>&1; then
  ok "npm $(npm --version)"
else
  echo "npm missing — reinstall Node.js"
  exit 1
fi

step "Python 3.11+…"
if python3 --version 2>/dev/null | grep -qE "^Python 3\.(1[1-9]|[2-9][0-9])"; then
  ok "$(python3 --version)"
else
  echo "Installing Python 3.11…"
  brew install python@3.11
  brew link --overwrite python@3.11
fi

# ── 6. pkg-config (needed for native modules) ──────────────────────────────────
step "pkg-config…"
if brew list pkg-config >/dev/null 2>&1; then
  ok "pkg-config"
else
  brew install pkg-config
fi

# ── 7. Git ─────────────────────────────────────────────────────────────────────
step "Git…"
ok "$(git --version)"

# ── 8. Optional: create-dmg for packaging ─────────────────────────────────────
step "create-dmg (optional, for macOS packaging)…"
if command -v create-dmg >/dev/null 2>&1; then
  ok "create-dmg found"
else
  warn "create-dmg not installed (only needed for .dmg packaging)"
  warn "Install when ready: brew install create-dmg"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}All prerequisites satisfied!${NC}"
echo ""
echo "Next steps:"
echo "  1. cd aipiloty/"
echo "  2. bash code-oss-ide/bootstrap.sh    # clone + patch Code OSS (10-20 min)"
echo "  3. bash code-oss-ide/scripts/run-dev.sh  # launch AIPiloty IDE"
echo ""

#!/usr/bin/env bash
# bootstrap.sh — Clone Code OSS, apply AIPiloty patches, copy extension, install deps
#
# Usage (from aipiloty/ root):
#   bash code-oss-ide/bootstrap.sh
#
# After this script:
#   bash code-oss-ide/scripts/run-dev.sh
#
# Re-run anytime to update an existing clone.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
# Pin to a known stable VS Code release tag. Update this to the latest tag
# from https://github.com/microsoft/vscode/tags when you want to upgrade.
VSCODE_TAG="${VSCODE_TAG:-1.96.3}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AIPILOTY_DIR="$(dirname "$SCRIPT_DIR")"           # aipiloty/
FORK_DIR="${FORK_DIR:-$SCRIPT_DIR/vscode-fork}"    # where vscode is cloned

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
step() { echo -e "\n${BOLD}→ $*${NC}"; }
fail() { echo -e "${RED}✗  $*${NC}"; exit 1; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       AIPiloty IDE — Code OSS Bootstrap          ║${NC}"
echo -e "${BOLD}║       Base: microsoft/vscode @ ${VSCODE_TAG}          ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
step "Checking prerequisites…"

# Node.js ≥ 18
node_ver=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0")
(( node_ver >= 18 )) || fail "Node.js 18+ required (found: $(node --version 2>/dev/null || echo 'none')). Install: brew install node@20"
ok "Node.js $(node --version)"

# npm (VS Code ≥1.96 rejects yarn — use npm only)
command -v npm >/dev/null 2>&1 || fail "npm required (comes with Node.js)"
ok "npm $(npm --version)"

# Python 3 (needed for node-gyp native modules)
python3 --version >/dev/null 2>&1 || fail "Python 3 required. Run: brew install python@3.11"
ok "Python $(python3 --version 2>&1 | cut -d' ' -f2)"

# Xcode CLT (macOS)
if [[ "$(uname)" == "Darwin" ]]; then
  xcode-select -p >/dev/null 2>&1 || fail "Xcode Command Line Tools required. Run: xcode-select --install"
  ok "Xcode CLT: $(xcode-select -p)"
fi

# Git
git --version >/dev/null 2>&1 || fail "Git required"
ok "$(git --version)"

# ── 2. Clone or update vscode ─────────────────────────────────────────────────
step "Setting up Code OSS source @ ${VSCODE_TAG}…"

if [[ -d "$FORK_DIR/.git" ]]; then
  warn "Existing clone found at $FORK_DIR — updating to tag ${VSCODE_TAG}"
  cd "$FORK_DIR"
  git fetch origin "refs/tags/${VSCODE_TAG}:refs/tags/${VSCODE_TAG}" --no-tags 2>/dev/null || \
    git fetch origin
  git checkout "tags/${VSCODE_TAG}" 2>/dev/null || git checkout "$VSCODE_TAG"
  ok "Updated to ${VSCODE_TAG}"
else
  echo "Cloning microsoft/vscode @ ${VSCODE_TAG} (shallow — ~300 MB)…"
  git clone \
    --depth 1 \
    --branch "${VSCODE_TAG}" \
    https://github.com/microsoft/vscode.git \
    "$FORK_DIR"
  ok "Cloned to $FORK_DIR"
fi

cd "$FORK_DIR"

# ── 3. Apply product.json (AIPiloty branding) ─────────────────────────────────
step "Applying AIPiloty branding (product.json)…"
cp "$SCRIPT_DIR/product.json" "$FORK_DIR/product.json"
ok "product.json applied"

# ── 4. Copy AIPiloty extension as built-in ───────────────────────────────────
step "Installing AIPiloty AI extension as built-in…"

EXTENSION_SRC="$AIPILOTY_DIR/desktop-ide"
EXTENSION_DST="$FORK_DIR/extensions/aipiloty-agent"

if [[ ! -d "$EXTENSION_SRC" ]]; then
  fail "AIPiloty extension not found at: $EXTENSION_SRC\nRun from the aipiloty/ root."
fi

# Compile the extension first
step "  Compiling AIPiloty extension TypeScript…"
if [[ ! -d "$EXTENSION_SRC/node_modules" ]]; then
  cd "$EXTENSION_SRC" && npm install && cd "$FORK_DIR"
fi
cd "$EXTENSION_SRC" && npm run compile 2>&1 | tail -5; cd "$FORK_DIR"

# Copy compiled extension (exclude dev artifacts)
rm -rf "$EXTENSION_DST"
mkdir -p "$EXTENSION_DST"
rsync -a --exclude='node_modules' --exclude='.git' --exclude='*.ts' --exclude='src/' \
  "$EXTENSION_SRC/" "$EXTENSION_DST/"
ok "Extension copied to extensions/aipiloty-agent/"

# Register in built-in extension list
# Add to extensions/package.json if it exists, or create a marker
echo '{"version":"0.1.0","name":"aipiloty-agent"}' > "$EXTENSION_DST/.built-in"

# ── 5. Apply VS Code patches ─────────────────────────────────────────────────
step "Applying optional patches…"
PATCHES_DIR="$SCRIPT_DIR/patches"
if [[ -d "$PATCHES_DIR" ]] && ls "$PATCHES_DIR"/*.patch >/dev/null 2>&1; then
  for p in "$PATCHES_DIR"/*.patch; do
    echo "  Applying: $(basename "$p")"
    git apply "$p" --ignore-whitespace 2>/dev/null && ok "  Applied: $(basename "$p")" || \
      warn "  Skipped (already applied or conflict): $(basename "$p")"
  done
else
  ok "No extra patches"
fi

# ── 6. Install dependencies ────────────────────────────────────────────────────
step "Installing Node.js dependencies (npm — this may take 5-15 min first time)…"
# VS Code 1.96+ hard-rejects yarn in build/npm/preinstall.js
# Apple Clang 21 breaks @vscode/spdlog <0.15.8 (FMT consteval). Force the fixed release.
node <<'NODE'
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
const cur = p.dependencies?.["@vscode/spdlog"] || "";
if (!cur.includes("0.15.8")) {
  p.dependencies = p.dependencies || {};
  p.dependencies["@vscode/spdlog"] = "0.15.8";
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
  console.log("  Pinned @vscode/spdlog@0.15.8 (Clang 21 / macOS 26 fix)");
}
NODE
# Lockfile may not match the pin — use npm install (not ci)
npm install
ok "Dependencies installed"

# ── 7. Set up launch script ───────────────────────────────────────────────────
step "Setting up launch scripts…"
cp "$SCRIPT_DIR/scripts/run-dev.sh" "$FORK_DIR/aipiloty-run-dev.sh"
chmod +x "$FORK_DIR/aipiloty-run-dev.sh"
ok "Launch script: $FORK_DIR/aipiloty-run-dev.sh"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  Bootstrap complete! Start AIPiloty IDE:                     ║${NC}"
echo -e "${GREEN}${BOLD}║                                                              ║${NC}"
echo -e "${GREEN}${BOLD}║  DEV (recommended, fast):                                    ║${NC}"
echo -e "${GREEN}${BOLD}║    bash code-oss-ide/scripts/run-dev.sh                      ║${NC}"
echo -e "${GREEN}${BOLD}║                                                              ║${NC}"
echo -e "${GREEN}${BOLD}║  PRODUCTION BUILD (slow, ~30-60 min):                        ║${NC}"
echo -e "${GREEN}${BOLD}║    bash code-oss-ide/scripts/package-mac.sh                  ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Fork location: $FORK_DIR"
echo "  AIPiloty backend: make dev-backend (in a separate terminal)"
echo ""

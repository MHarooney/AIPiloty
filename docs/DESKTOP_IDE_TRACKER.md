# AIPiloty Desktop IDE — Tracker

> Legend: ✅ done · 🔄 in-progress · 🔲 not started

---

## Architecture Decision

| | Choice |
|---|---|
| Shell | **Owned Code OSS fork** — I build the .app |
| AI layer | `desktop-ide/` extension, bundled as built-in |
| Backend | Existing FastAPI — unchanged |
| Previous prototype | ~~Electron+Next.js~~ → **deleted** |

---

## Phase 0 — Architecture ✅

| Item | Status |
|---|---|
| Evaluate Electron+Next vs Code OSS fork | ✅ |
| Decision: own the Code OSS shell | ✅ |
| Delete Electron+Next prototype + frontend bridge leftovers | ✅ |
| Scaffold `code-oss-ide/` with bootstrap + scripts | ✅ |
| ProviderRouter (Claude/OpenAI/Gemini/Ollama) | ✅ |
| ProviderRouter unit tests (36/36) | ✅ |

---

## Phase 1 — Own Shell + AI Extension MVP ✅ (GUI smoke left for user)

### Code OSS fork scaffold (code-oss-ide/)

| Item | File | Status |
|---|---|---|
| `bootstrap.sh` — clone, patch, copy extension | `bootstrap.sh` | ✅ |
| `product.json` — AIPiloty branding | `product.json` | ✅ |
| `scripts/install-deps.sh` — macOS prereqs | `scripts/install-deps.sh` | ✅ |
| `scripts/run-dev.sh` — dev launch | `scripts/run-dev.sh` | ✅ |
| `scripts/package-mac.sh` — build .app | `scripts/package-mac.sh` | ✅ |
| `make fork-deps` Makefile target | `Makefile` | ✅ |
| `make fork-install` Makefile target | `Makefile` | ✅ |
| `make fork` Makefile target | `Makefile` | ✅ |
| `make fork-package` Makefile target | `Makefile` | ✅ |

### AIPiloty extension (desktop-ide/)

| Item | File | Status |
|---|---|---|
| Extension entry + commands | `src/extension.ts` | ✅ |
| Sidecar: FastAPI + Ollama spawn | `src/sidecar.ts` | ✅ |
| Keychain (context.secrets) | `src/keychain.ts` | ✅ |
| SSE streaming client | `src/agent/streaming.ts` | ✅ |
| Chat sidebar webview | `src/agent/chatProvider.ts` | ✅ |
| Default Chat participant + LM provider | `src/agent/chatParticipant.ts`, `languageModel.ts` | ✅ |
| Cmd+K inline edit | `src/agent/inlineEdit.ts` | ✅ |
| Provider status bar | `src/agent/providerStatus.ts` | ✅ |
| Provider key sync + Ollama tip | `src/agent/providerSync.ts` | ✅ |
| Tool approvals (Approve/Deny) | `src/agent/approvals.ts` | ✅ |
| Plan steps → markdown checklist | `chatParticipant.ts` | ✅ |
| Backend smoke test | `scripts/verify-backend.sh` | ✅ |
| Dev settings sync | `scripts/sync-dev-settings.py` | ✅ |

### Live verification

| Check | Status |
|---|---|
| `make fork-deps` / `make fork-install` | ✅ (already done on this machine) |
| `make fork` opens AIPiloty IDE window | ✅ |
| AIPiloty view on Activity Bar | ✅ |
| Backend health + SSE chat (`verify-backend.sh`) | ✅ |
| Chat in IDE receives tokens | 🔄 restart IDE after sync — user confirm |
| Cmd+K prompts and applies edit | 🔄 user confirm after restart |
| Status bar shows active LLM provider | ✅ (Ollama when only local) |
| Open folder, edit file, terminal work | ✅ |
| `make fork-package` .app | 🔲 later |

### Daily commands

```bash
cd aipiloty/
make fork                    # sync extension + launch IDE + backend
# After code changes: quit IDE, then make fork again

# Optional smoke test (backend must be up):
bash desktop-ide/scripts/verify-backend.sh
```

---

## Phase 1.5 — ProviderRouter ✅

| Item | Status |
|---|---|
| Claude/OpenAI/Gemini/Ollama adapters | ✅ |
| Error classification + failover | ✅ |
| Wired into AgentOrchestrator | ✅ |
| /api/v1/providers/llm/health endpoint | ✅ |
| 36/36 unit tests passing | ✅ |

Set API keys:
```bash
# In backend/.env:
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
# OR via IDE: Cmd+Shift+P → "AIPiloty: Set API Key for Provider"
```

---

## Phase 2 — Richer AI UX 🔄

| Item | Status |
|---|---|
| Tool approvals dialog + resume | ✅ |
| Plan/todos markdown in Chat | ✅ (foundation) |
| Cursor-like modes: Agent / Ask / Plan / Debug | ✅ (sidebar + backend) |
| MCP Servers panel (list/add/probe/import/toggle) | ✅ |
| Pretty tool cards (no raw JSON dump) | ✅ |
| Chat: code syntax highlighting | 🔲 |
| Chat: @-file mentions | 🔲 |
| Cmd-K: multi-hunk diff review | 🔲 |
| Project rules (AGENTS.md → system prompt) | ✅ (backend) |
| Agent checkpoint before multi-file edit | 🔲 |
| Full Cursor-like Plan board / Approvals panel | 🔲 |

---

## Phase 3 — Settings & Provider UI

| Item | Status |
|---|---|
| Provider quick-pick for API keys | ✅ (extension command) |
| Provider health webview | 🔲 |

---

## Phase 4 — Branded Release

| Item | Status |
|---|---|
| Fork microsoft/vscode on GitHub (own repo) | 🔲 |
| Custom icon (replace vscode default) | 🔲 |
| macOS .dmg with create-dmg | 🔲 |
| Code signing (Apple Developer cert) | 🔲 |
| GitHub Releases distribution | 🔲 |

---

## Known Risks

| Risk | Mitigation |
|---|---|
| vscode build deps change across tags | Pin `VSCODE_TAG` in bootstrap.sh |
| Yarn rejected by VS Code ≥1.96 | bootstrap.sh uses `npm ci` only |
| Code OSS upstream diverges | Re-run bootstrap with new tag |
| macOS Gatekeeper blocks unsigned .app | Phase 4: Apple Developer signing |

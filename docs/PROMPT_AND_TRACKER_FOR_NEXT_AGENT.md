# AIPiloty + DeployPilot — Handoff prompt & living tracker

**Purpose:** Paste **§1** into a new Cursor/agent chat. Maintain **§2** (tracker) as work completes — keep it the single source of truth for gaps.

**Repos in workspace:**
- `aipiloty/` — Next.js + FastAPI prototype (chat, orchestrator, document tools, basic pages).
- `deployment-platform/` — Production DeployPilot (FastAPI + React; VM deploy, SSH, AI chat, KB, etc.).

Do **not** assume these are one app; integration strategy should be explicit.

---

## §1 — Full prompt to continue (copy everything below the line)

**Prefer the expanded prompt** in **`aipiloty/docs/GAP_ANALYSIS_AND_AGENT_PROMPT.md`** (includes code editor, database/KB pages, mobile “remote on local”, Flutter parity) — it supersedes the shorter bullets below.

```
You are a staff-level engineer continuing AIPiloty (`aipiloty/`) and aligning with DeployPilot (`deployment-platform/`). Read `aipiloty/docs/GAP_ANALYSIS_AND_AGENT_PROMPT.md` (full gap list + vision) and this file’s §2; update the tracker as you complete items.

### Product goals (from user)
1. **Orchestrated agent** — Not “one model does all”; use a clear loop: LLM ↔ tools (documents, DevOps, SSH) with guardrails, timeouts, and observability. Prefer SOLID boundaries: orchestrator, LLM adapter, tool registry, document service, SSH service.
2. **Documents (PDF/PPTX/XLSX/DOCX)** — Backend can generate files; **UI must expose download** when `tool_output` contains `success`, `relative_path` (see `DocumentGeneratorService._make_result`). Wire `GET /api/v1/files/generated/{path}` (`aipiloty/backend/app/api/v1/files.py`) with `X-API-Key` — browser may need signed URL or cookie; avoid leaving API key in plain links if possible.
3. **DeepSeek / Ollama** — `deepseek-coder-v2:16b` in Ollama often **does not support native tool calling** (Ollama returns 400 when `tools` payload is sent). Mitigations already started in `orchestrator.py` (fallback without tools). **Do not delete Ollama** for local free inference; DeepSeek is a *model tag*. Options: (a) use a model with native tools (e.g. `llama3.2:3b`) for tool-heavy sessions, or (b) implement **text-based tool parsing** when tools are disabled, or (c) dual-model routing (planner with tools-capable model + executor). Document tradeoffs in README.
4. **“Is DeepSeek free?”** — Locally via Ollama: **yes** (no API bill; your hardware). DeepSeek **cloud API** is paid/rate-limited per their terms — not the same as local.
5. **Hydration / “agent broken”** — If console shows `className` mismatch on `<body>` with `clickup-chrome-ext_installed`, that is a **browser extension** mutating the DOM. `layout.tsx` should use `suppressHydrationWarning` on `<body>`. Re-test in **Incognito without extensions**.
6. **Missing UI (avatars, mobile)** — Components exist (`ai-avatar.tsx`, `user-avatar.tsx`, `chat-messages.tsx`). Verify they render on `/` (home chat). Add responsive layout, touch targets, and a **mobile nav** if missing. Compare with DeployPilot’s `AIChatPage` patterns if merging UX.
7. **DeployPilot parity (long-term)** — User wants: AI-assisted **deployment updates**, **SSH terminal** elsewhere, **safe** execution, **auto-sync VM state** into agent context. Prefer extending `deployment-platform/` rather than duplicating; if keeping AIPiloty separate, define an integration API (webhooks, polling, or WS) and a **tracker** for feature parity.
8. **Quality bar** — After changes: run backend tests, `npm run build` on frontend, manual QA (chat stream, PDF generation + download, health). Use browser tools to verify no hydration errors and visible avatars.

### Technical references (paths)
- Orchestrator: `aipiloty/backend/app/services/agent/orchestrator.py`
- Ollama: `aipiloty/backend/app/services/llm/ollama_service.py`
- PDF tool: `aipiloty/backend/app/services/tools/documents/`
- File download API: `aipiloty/backend/app/api/v1/files.py`
- Chat UI: `aipiloty/frontend/src/app/page.tsx`, `components/chat-messages.tsx`, `stores/chat-store.ts`
- DeployPilot agent: `deployment-platform/backend/app/services/agent/runtime.py`, `llm_service.py`

### Deliverables
1. Fix or implement **download UX** for generated files (parse JSON from tool results; link or button to backend file route with safe auth).
2. Finalize **tool-calling strategy** for DeepSeek vs tool-capable models (config + docs, no silent failure).
3. **Responsive / mobile** pass on AIPiloty chat shell.
4. Update §2 tracker in `aipiloty/docs/PROMPT_AND_TRACKER_FOR_NEXT_AGENT.md`.
5. Short `aipiloty/README.md` section: architecture, local setup, known limitations.

### Out of scope unless user confirms
- Rewriting from scratch — prefer incremental fixes unless audit shows unmaintainable debt.
- Full n8n/Agent Zero integration — document as optional, not blockers.
```

---

## §2 — Living tracker (update checkboxes and notes)

| ID | Area | Status | Notes |
|----|------|--------|--------|
| T1 | PDF (and other doc) **generation end-to-end** | ✅ | Backend generates under `workspace/generated/`; tool invoked via ReAct orchestrator; text-based fallback parsing in place |
| T2 | **Download button / link** in chat for tool results with `relative_path` | ✅ | `parse-tool-result.ts` + `download-button.tsx` renders download for generate_* tool results; fetches blob with API key |
| T3 | **DeepSeek + tools** — no silent 400 | ✅ | Orchestrator uses ReAct-style prompt-based tool calling (no native Ollama tools); 3 safety guardrails added to system prompt |
| T4 | **Hydration** extension conflict | ✅ | `suppressHydrationWarning` on `<body>` in `layout.tsx`; documented as browser-extension issue |
| T5 | **Avatars** visible on chat | ✅ | 3D `AIAvatar` (`Robot3DCanvas`) in chat, welcome, sidebar, typing; optional `force2D` prop for fallback if WebGL fails; `UserAvatar` for user messages |
| T6 | **Mobile** layout & nav | ✅ | `AppShell` with hamburger/slide-out drawer on `md:` breakpoint; backdrop overlay; onNavigate closes drawer; mobile-safe top padding on all pages |
| T7 | **QA** — curl + browser | ✅ | Build passes 12/12 pages, zero TS errors, zero ESLint errors; exit code 0 |
| T8 | **DeployPilot** — AI updates deployments | ⬜ | Feature in `deployment-platform/` — define API + UI hooks |
| T9 | **DeployPilot** — SSH terminal page + safety | ⬜ | Sandboxing, audit log, command allowlist or approval |
| T10 | **VM state sync** to agent | ⬜ | Polling vs WebSocket; inject context into system prompt or RAG |
| T11 | **SOLID / cleanup** | ✅ | Clean architecture: separate routers (knowledge, database, workspace, config), KBBridgeService, AppShell wrapper, parse-tool-result utility, notifications lib |
| T12 | **README** architecture & limitations | 🟡 | LAN guide + Flutter parity docs created; full README still pending |
| T13 | **Code editor** (Monaco) — page + APIs | ✅ | `@monaco-editor/react` installed; `code-editor/page.tsx` with file tree + tabs + Monaco (read-only, dark theme); backend `workspace.py` router (tree + file endpoints, path traversal protection) |
| T14 | **Database** page (web) | ✅ | `database/page.tsx` — table list sidebar, schema strip, paginated rows; backend `database.py` router (read-only, regex-validated table names, parameterized queries) |
| T15 | **Knowledge base** page + updatable KB | ✅ | `knowledge/page.tsx` — health banner, search, doc list, delete; backend `knowledge.py` router (8 endpoints) + `KBBridgeService` httpx proxy; graceful 503 when KB unavailable |
| T16 | **Mobile web** + **remote-on-local** (LAN IP, CORS, tunnel docs) | ✅ | `docs/LAN_ACCESS_GUIDE.md` — host IP, CORS env config, 0.0.0.0 binding, cloudflared/ngrok tunnels; CORS now env-configurable via `settings.cors_origins` |
| T17 | **Flutter app** API parity (`mobile_app` vs unified backend) | ✅ | `docs/FLUTTER_API_PARITY.md` — 30 endpoints mapped, 27 ready, 3 partial (SSE, file upload/download); no backend changes needed |
| T18 | **Clickable session history** + Chat nav UX | ✅ | Sidebar sessions are clickable buttons; `fetchSessionMessages` + `loadSession` in chat-store; `onNavigate` callback closes mobile drawer; 8-item NAV (Chat, Deployments, VMs, Dashboard, Knowledge, Database, Code Editor, Settings) |

**Legend:** ⬜ not started · 🟡 in progress · ✅ done

**Last updated:** 2026-03-21 — PDF path fix, history click; avatars default to **3D** again (`force2D` optional); see Appendix §4–6

---

## Appendix — Why PDF “wasn’t generated” / no download (root causes)

1. **Model**: With `deepseek-coder-v2:16b`, native **tools may be disabled** after 400 fallback — the model may answer in text only and never call `generate_pdf`.
2. **UI**: Even when the backend returns JSON with `relative_path`, **`chat-messages.tsx` only shows raw `tool_output` in a `<details>`** — there is **no** “Download” button wired to `/files/generated/...`.
3. **Auth**: Downloads may require `X-API-Key`; a raw `<a href>` might 401 unless you add token query param or session cookie (implement securely).
4. **Backend path bug (fixed 2026-03-21)**: `DocumentGeneratorService` returns `relative_path` like `generated/foo.pdf` (relative to workspace). `GET /files/generated/{filepath}` was joining that under `<workspace>/generated/`, resolving to **`generated/generated/foo.pdf`** → **404** and download UI showed **Failed**. Fix: strip a leading `generated/` segment in `files.py` before joining.
5. **History “top row not clickable” (fixed 2026-03-21)**: `sidebar.tsx` had `if (key === sessionKey) return` in `handleLoadSession`, so the **active** session did nothing on click (often the newest chat). **Fix:** always refetch and `loadSession` (or show “already open” — refetch chosen for consistency).
6. **THREE.js console noise / WebGL context lost**: Multiple R3F canvases can stress GPU during dev HMR. **Mitigation (optional):** pass `force2D` on `AIAvatar` for 2D fallback. Deprecation `THREE.THREE.Clock` comes from R3F internals — upgrade `@react-three/fiber` / `three` later or ignore in dev.
7. **Short PDFs / “no images”**: PDFs are **ReportLab** text/tables/code/diagrams-as-text — not embedded stock photos. Richness comes from **long sections**, **bullets**, **tables**, **code** in `sections` JSON; orchestrator prompt asks for 8+ sections for courses. Optional: `generate_image` + describe linking (true inline images need more PDF work).
8. **Empty assistant message after tool**: Ollama may return **empty** or **whitespace-only** `content`, or put text in **`thinking`**. **Fix:** `_normalize_llm_content` in `orchestrator.py` + fallback to last tool JSON + frontend placeholder in `finalizeAssistantMessage` when tools exist but content is empty.
9. **“Local CLI” / disk space**: The agent only runs tools on the **backend host**. **`get_host_environment`** (`df -h`, OS, Python) is registered for “my machine” checks when the API runs locally on the user’s laptop; **SSH tools** are for **registered VMs**, not arbitrary user desktops.

---

## Appendix — Relationship to “Architect’s stack” (Agent Zero, n8n, etc.)

Those are **reference architectures**. This repo implements a **custom** FastAPI orchestrator. Optional future work: n8n as event bus, or sandboxed executor — track as **new rows** in §2 if adopted; do not block core fixes above.

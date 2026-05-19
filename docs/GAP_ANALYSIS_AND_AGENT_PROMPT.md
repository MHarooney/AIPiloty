# AIPiloty — gap analysis (no code changes in this doc)

**Date:** 2026-03-21  
**Purpose:** Explain what’s missing vs user expectations, and provide a **copy-paste prompt** for another agent to implement fixes.

---

## 1. Download button & “where is the file?”

| Fact | Detail |
|------|--------|
| **PDF is generated** | Backend writes under workspace `generated/` (e.g. `generated/Server Health Report.pdf`). Logs/DB show `relative_path` like `generated/Server Health Report.pdf`. |
| **API exists** | `GET /api/v1/files/generated/{filepath:path}` in `backend/app/api/v1/files.py` — requires `X-API-Key` (same as chat). |
| **Why no download in UI** | `frontend/src/components/chat-messages.tsx` only renders tool results as **raw text inside `<details>`** — **no** parsing of JSON, **no** `Download` / `Open` link, **no** `fetch`+blob flow. |
| **Nested JSON** | Tool output may be double-wrapped (`success` + `output.relative_path`). UI must normalize and build URL: `{API_BASE}/files/generated/{encodeURIComponent(path)}` with auth header or signed URL. |

**User-visible gap:** Product promises “download” in assistant text, but **the frontend never implemented the control.**

---

## 2. Knowledge base (RAG), fast answers, updatable KB

| Fact | Detail |
|------|--------|
| **In AIPiloty** | **No** knowledge-base, Chroma, embeddings, or ingest APIs under `aipiloty/backend/app/` (grep finds nothing). |
| **In DeployPilot** | `deployment-platform/backend` has KB/RAG (`knowledge_service`, embeddings, etc.) — **different product folder**. |
| **User expectation** | Optional RAG for faster, grounded answers + admin UI to add/update docs. |

**Gap:** AIPiloty is a **thin** chat + tools prototype; **KB is not integrated** unless explicitly ported or called via HTTP from DeployPilot.

---

## 3. “Chat” not clickable / sidebar confusion

| Fact | Detail |
|------|--------|
| **Nav “Chat”** | `sidebar.tsx` uses Next `<Link href="/">` — **should** navigate when not already on `/`. On `/`, clicking again does nothing (same route) — can feel “broken.” |
| **History rows** | Session list items are **`<div>`s, not `<Link>`** — **no click handler** to load that session’s messages. Only **delete** works. So users expect “click history = open chat” but **that behavior is not implemented.** |

**Gap:** **Session history is display-only** (except delete). This matches “chat not working” reports if users click history expecting navigation.

---

## 4. “Database” page missing

| Fact | Detail |
|------|--------|
| **Routes in repo** | `app/page.tsx` (chat), `app/dashboard/page.tsx`, `app/deployments/page.tsx`, `app/vms/page.tsx` only. **No** `app/database/page.tsx` or similar. |
| **Sidebar `NAV`** | Only Chat, Deployments, VMs, Dashboard — **no Database.** |

**Gap:** If the user integrated a DB browser elsewhere (e.g. DeployPilot), it **was not copied** into AIPiloty.

---

## 5. Local Mac specs vs `vm_health_check`

| Fact | Detail |
|------|--------|
| **Logs** | `vm_health_check` returns `"VM lookup not configured"` — tool is for **configured VMs**, not the developer’s Mac. |
| **User asked** | “Local machine spec” — needs a **different tool** (e.g. read-only `local_system_info`) or clear system prompt: don’t call VM tools for localhost. |

**Gap:** **Tooling + prompts** don’t cover “this Mac” diagnostics.

---

## 6. Console: React DevTools, THREE.Clock, WebGL context lost

| Message | Meaning |
|---------|---------|
| **Download React DevTools** | Default React dev hint — optional browser extension. |
| **THREE.THREE.Clock deprecated** | Comes from **@react-three/fiber** + **three** version combo — library warning, not app logic. May clear when R3F/three align or when upgrading stack. |
| **WebGLRenderer: Context Lost** | GPU/driver stopped the WebGL context — often **too many canvases**, tab backgrounded, or **multiple** `Robot3DCanvas` instances (avatars in list + header). Can break 3D until refresh. |

**Mitigations (for implementer):** single shared WebGL canvas, reduce avatar count, `frameloop="demand"`, or **fallback to 2D** `FallbackAvatar` when `webglcontextlost` fires.

---

## 7. Summary table — missing vs expected

| Area | Status in AIPiloty |
|------|-------------------|
| Download/open generated files | **Missing UI** |
| Knowledge base / RAG | **Not present** |
| Updatable KB UI | **Not present** |
| Database page | **Not present** |
| Clickable session history | **Not implemented** (rows not links) |
| Local machine diagnostics tool | **Not implemented** (VM tool misused) |
| Parity with DeployPilot | **Not goal of folder** unless merged |

---

## 8. Code editor (Monaco / workspace) — missing in AIPiloty

| Fact | Detail |
|------|--------|
| **DeployPilot (reference)** | `deployment-platform/frontend/src/pages/CodeEditorPage.tsx` — Monaco editor, file tree, tabs, AI sidebar; route `/code-editor` in `App.tsx`. Backend uses workspace/code tooling (e.g. `code_tool_service`, related APIs). |
| **AIPiloty** | **No** code editor page, no Monaco, no file-tree integration in the Next app. |

**Gap:** User expects the same **agent-assisted code editing** workflow as the mature platform; AIPiloty currently stops at chat + simple CRUD pages.

---

## 9. Mobile web + “remote on local” + Flutter app parity

| Fact | Detail |
|------|--------|
| **Responsive web** | AIPiloty UI is desktop-first; **no** dedicated mobile nav, drawer, or touch-first QA pass is documented. |
| **“Remote on local”** | User tests **localhost** on phone/tablet or via tunnel — needs **same API base URL strategy** (env, CORS), **readable layouts** (no horizontal scroll traps), **safe viewport** meta. |
| **DeployPilot Flutter app** | `deployment-platform/mobile_app/` — AI chat, knowledge, database, code viewer, deployments, VM, settings, integrations, etc. **None of this exists in AIPiloty** (different stack). |

**Gap:** Treat **parity** as: **(A)** responsive Next.js shell + **(B)** long-term either **reuse Flutter** against AIPiloty APIs or **PWA** — document the chosen strategy.

---

## 10. Pages / features to reconcile (old project → new)

Use this as a **checklist** when porting or bridging (not all must be in AIPiloty; some may stay **only** in DeployPilot):

| Feature area | Reference in `deployment-platform/` |
|--------------|--------------------------------------|
| Code editor (Monaco) | `frontend/src/pages/CodeEditorPage.tsx` |
| DB browser | Web: trace DB UI; **Mobile:** `mobile_app/.../database_screen.dart` |
| AI knowledge / KB | Backend KB services; **Mobile:** `ai_knowledge_screen.dart` |
| AI chat (full) | `frontend` AI chat + **Mobile** `ai_chat_screen.dart` |
| Deployments detail / logs / exec | `DeploymentDetailPage.tsx`, mobile deployment screens |
| SSH / terminal / VM | Various; align with AIPiloty tools + safety model |

**User intent:** Rebuild **cleanly** (as if from scratch) with **local Ollama / DeepSeek** as the brain, but **feature completeness** should match what they already shipped in the **old** platform — implemented with **maintainable** architecture (SOLID, clear modules), not a one-off demo.

---

## 11. Affirmation of approach (for the product owner)

**Your direction is correct:** a **local-first** agent (Ollama + models like DeepSeek-Coder), **orchestrated tools** (documents, DevOps, SSH with guardrails), **optional RAG** for speed and accuracy, **code editor** for real work, and **mobile + web** so you can operate **remotely** against your **local** or **self-hosted** backend — rebuilt cleanly rather than copying spaghetti. The gap is **implementation scope** in `aipiloty/`, not the vision.

---

# Prompt for another agent (copy everything below the line)

```
You are working in the monorepo at `evo-lms/`, primarily `aipiloty/` (Next.js + FastAPI prototype). Read `aipiloty/docs/GAP_ANALYSIS_AND_AGENT_PROMPT.md` (sections 1–11) for verified gaps and the user’s product vision — **do not re-debate** facts listed there.

## Product vision (authoritative)

The user is rebuilding **cleanly from scratch** (AI-assisted, local **Ollama** / **DeepSeek**-class models) but expects **feature parity** with the **mature** `deployment-platform/` work: not a demo — **production-minded** structure (SOLID, testable modules, clear boundaries).

They need **web + mobile** behavior: **responsive** Next.js for “remote on local” (phone/tablet hitting LAN/tunnel to dev machine), and long-term **parity** with the **Flutter** app under `deployment-platform/mobile_app/` (AI chat, knowledge, database, code viewer, deployments, VM, etc.) — either by **shared APIs** or **documented bridge** between AIPiloty and DeployPilot.

## Goals (implement in order of user value; extend as needed)

1. **Generated file download UX**
   - In `frontend/src/components/chat-messages.tsx` (and store types if needed), parse `tool_output` JSON for successful document tools (`generate_pdf`, `generate_docx`, `generate_xlsx`, `generate_pptx`, `generate_image`).
   - Support both flat fields (`relative_path`, `path`) and nested `output.relative_path` as seen in DB logs.
   - Show a primary **Download** button (and optional “Open in new tab” if MIME allows) pointing to `GET {NEXT_PUBLIC_API_URL}/files/generated/...` with auth. Browsers cannot send `X-API-Key` on a plain `<a href>` — implement one of: (a) fetch with API key → blob → `URL.createObjectURL` download, (b) short-lived signed token query param from backend, or (c) Next.js API route proxy with server-side key.
   - Document for users: files live under backend workspace `generated/` on disk.

2. **Session history is clickable**
   - In `frontend/src/components/sidebar.tsx`, make each history row load that session: either navigate with query `?session=...` or call an API to fetch messages and hydrate `useChatStore`. Ensure “Chat” nav still works.
   - Backend: confirm or add `GET /api/v1/chat/sessions/{key}/messages` if missing.

3. **Knowledge base (optional phase)**
   - Either port minimal RAG from `deployment-platform/backend` (embeddings + vector store + ingest) into `aipiloty/backend`, or document HTTP integration to existing DeployPilot KB.
   - Add Settings or `/knowledge` page: list docs, upload, re-embed, delete.

4. **Database page (if in scope)**
   - Add `app/database/page.tsx` + sidebar link only if product requires it; align with any existing API under `aipiloty/backend` or stub “coming soon” with clear copy.

5. **Local machine vs VM**
   - Add guardrails in orchestrator/system prompt: do not use `vm_health_check` for “my Mac” requests.
   - Optionally add a safe read-only `local_system_info` tool (macOS: `sysctl`, `system_profiler` subset) behind explicit user consent — or return a fixed message that local introspection is not enabled.

6. **WebGL stability**
   - Reduce duplicate `Robot3DCanvas` mounts or switch crowded lists to `FallbackAvatar`. Listen for `webglcontextlost` and fallback to 2D.

7. **Code editor (high priority for parity)**
   - Study `deployment-platform/frontend/src/pages/CodeEditorPage.tsx` (Monaco, tabs, file tree, AI sidebar patterns).
   - Add an AIPiloty route e.g. `app/code-editor/page.tsx` + sidebar nav item; wire to backend workspace/file APIs (port minimal endpoints from `deployment-platform/backend` if needed, or extend `aipiloty/backend` with the same contracts).
   - Reuse agent/tool patterns so the LLM can propose edits with approval — align with existing guardrails in AIPiloty orchestrator.

8. **Missing pages — explicit list to add or bridge**
   - **Database** (browser / query UI): reference DeployPilot web + `mobile_app/lib/features/database/`. Either implement `app/database/page.tsx` + APIs or **embed/iframe** to DeployPilot with auth — **document the choice**.
   - **Knowledge base** (list, upload, update, re-embed): reference `deployment-platform` KB + `mobile_app/.../ai_knowledge/`. Same bridge vs port decision.
   - **Settings / AI config** (model, Ollama URL, API keys): parity with DeployPilot Settings / mobile `ai_settings_screen.dart`.
   - **Integrations / webhooks / audit** (if in user’s scope): see DeployPilot routes; stub or link.
   - Maintain a **parity matrix** in `aipiloty/docs/` (page × web × mobile × API status).

9. **Mobile web & “remote on local”**
   - Pass a **responsive** audit: sidebar → drawer or bottom nav on small screens; touch targets; no overflow clipping on chat.
   - Document **LAN access**: `NEXT_PUBLIC_API_URL` when opening from phone (use machine IP, not only localhost), CORS on FastAPI, optional **HTTPS tunnel** (ngrok, cloudflared) for testing.
   - Optional: **PWA** manifest for “install on home screen” (later).

10. **Flutter / native app**
    - Do **not** duplicate Flutter inside AIPiloty. **Do** define a **stable OpenAPI** for chat, sessions, files, KB, DB proxy, code workspace — so `deployment-platform/mobile_app` can point at the **same** backend or a **gateway** that fans out to AIPiloty + DeployPilot.
    - List **endpoint gaps** vs mobile `api_endpoints.dart` and close them incrementally.

11. **QA**
    - Browser MCP / manual: download PDF, code editor open/save, KB upload (when exists), mobile viewport.
    - `npm run build`; backend smoke tests.

## Constraints
- Keep SOLID boundaries: thin UI, parser utility for tool results, small hooks; separate **editor** and **chat** feature folders.
- Update `aipiloty/docs/PROMPT_AND_TRACKER_FOR_NEXT_AGENT.md` §2 checkboxes when done.
- Run `npm run build` in `aipiloty/frontend` and smoke-test PDF generation + download.

## Out of scope unless specified
- Blindly copying every line of DeployPilot into AIPiloty — prefer **shared packages** or **HTTP integration** where duplication hurts maintenance.
```

---

**End of prompt block**

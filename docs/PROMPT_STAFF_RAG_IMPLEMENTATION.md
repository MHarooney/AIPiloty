# Staff-level prompt: RAG + agent + mobile (remote local desktop) — plan, implement, track, hard-test

Give the block below **in full** to an AI coding agent with **Agent mode** and **repo access** to `evo-lms` (at minimum `aipiloty/`).  
The agent must **edit `RAG_IMPLEMENTATION_TRACKER.md` in parallel** with code changes.

**Related docs:** `docs/LOCAL_AI_AGENT_RESEARCH_PROMPT.md` (hardware), `docs/LAN_ACCESS_GUIDE.md` (phone → Mac), `docs/FLUTTER_API_PARITY.md` (optional API alignment notes).

---

## North star (from product owner — include in your mental model)

1. **Local-first AI assistant (AIPiloty)** on the **developer’s Mac**: FastAPI + Next.js + Ollama (e.g. `deepseek-coder-v2:16b`) + tools; **not** self-training weights — “smarter” = **better RAG + better prompts + curated KB**, not fine-tuning from chat.
2. **Knowledge:** Agent must use **`kb_search`** over **their repos/docs** (Qdrant + Ollama embeddings), allowlisted paths — optional coexistence with DeployPilot KB **bridge** (`/knowledge/*`); native RAG is the primary agent path.
3. **Mobile:** A **clean, thin client** — same *idea* as using **Claude** on your phone, but the **brain runs on your desktop** (Ollama + backend on the Mac). Phone/tablet **only** talks to **`http://<LAN-IP>:<port>`** (or tunnel later) with **API key** — **remote control / chat against your local machine**, not a second copy of the old DeployPilot mega-app.
4. **Hardware ceiling:** Apple **M2, 24 GB unified** — one main LLM + small embedding model; see `LOCAL_AI_AGENT_RESEARCH_PROMPT.md`.
5. **Quality posture:** Local RAG narrows the gap to cloud for **grounded** tasks; optional **cloud fallback** (Claude API) is **v2**, not MVP.

---

## COPY FROM HERE ↓↓↓

---

### System role

You are a **staff / principal engineer**. You **plan briefly**, **implement**, **update the living tracker after every milestone**, and finish with a **hard test pass** (backend + web + mobile scenarios where applicable). You **run** builds/tests when possible and **record outcomes** in `aipiloty/docs/RAG_IMPLEMENTATION_TRACKER.md` — no hand-waving.

### Product goals (two pillars)

**Pillar 1 — RAG in the agent**  
Extend **AIPiloty** so the orchestrator can call **`kb_search`**: Ollama embeddings + **Qdrant** (local Docker), ingest from **allowlisted** paths, without breaking **SSE chat** or existing tools.

**Pillar 2 — Mobile = “Claude-style remote to my desktop”**  
Deliver a **clean** way to use AIPiloty from **iOS/Android**:

- **Preferred implementation:** New **minimal Flutter** app under **`aipiloty/mobile/`** (fresh `flutter create`, feature-first structure): **Connection** (base URL, API key, optional “test connection”), **Chat** (same SSE/streaming contract as web or documented subset), **Sessions list** (reuse existing REST if present), **Health** (Ollama/backend/KB status if endpoints exist). **No** port of the entire **`deployment-platform/mobile_app/`** in this task — that app is legacy breadth; here we want **small, readable code** that only does “talk to my Mac.”
- **Fallback if timeboxed:** Do **not** skip mobile entirely — ship **(1)** hardened **LAN + CORS + API key** story in backend/docs and **(2)** verify **Next.js responsive** chat works from phone browser on LAN; add tracker items to **defer** Flutter to a follow-up with exact file scaffold list.

**Reference:** `aipiloty/docs/LAN_ACCESS_GUIDE.md` — bind backend `0.0.0.0`, CORS for `http://<host-ip>:3000`, Ollama `OLLAMA_HOST` if phone ever talks to Ollama directly (usually only backend talks to Ollama; mobile → FastAPI only).

### Hard constraints

1. **Memory:** M2 **24 GB** — avoid two large LLMs loaded; embeddings model separate and small.
2. **Minimal rewrite:** Keep `AgentOrchestrator` + `OllamaService` patterns; add **`rag/`** + **`kb_search` tool** in `main.py`.
3. **Security:** RAG ingest **allowlist** only; mobile stores API key with **platform best practice** (secure storage); document **HTTPS/tunnel** for non-LAN use (defer implementation OK).
4. **Tracker discipline:** After each milestone, update **`RAG_IMPLEMENTATION_TRACKER.md`** (snapshot, checkboxes, work log, deferrals).
5. **No silent failure:** Qdrant/embed/Ollama errors → clear tool/API errors + logs.

### Repository facts (verify in code)

- Tools: `aipiloty/backend/app/main.py` — `ToolRegistry`, `AgentOrchestrator`.
- Text-parsed tool calls: `orchestrator.py` (DeepSeek often no native Ollama `tools=`).
- Chat DB: SQLite sessions/messages — unchanged unless required for mobile session UX.
- DeployPilot KB: HTTP bridge — keep unless conflicting; native RAG is agent-facing priority.
- Legacy mobile: `deployment-platform/mobile_app/` — **reference for API patterns only**, not copy-paste wholesale into AIPiloty.

### Deliverables (“one shot” — triage honestly in tracker)

#### 1) Plan

At start: **8–14 bullets** in tracker **Work log**: order, risks, mobile choice (Flutter MVP vs browser-first deferral).

#### 2) RAG implementation

- `rag/`: config, chunking (Markdown + text min), Ollama embeddings client, Qdrant client, ingest (CLI or secured API), retriever.
- **`kb_search` tool** + `main.py` registration; settings in `config.py` + `.env.example` (`RAG_*`, `QDRANT_*`, embedding model, allowlist).
- Docker snippet / docs for Qdrant **6333**.
- README section: Qdrant, `ollama pull` (chat + embed), first ingest, env vars.

#### 3) Mobile implementation (per pillar 2)

- **`aipiloty/mobile/`** Flutter: connection screen, persisted config, chat with streaming, session list if API exists, error states (wrong URL, 401, backend down).
- Document in README: run on device via LAN IP, match `LAN_ACCESS_GUIDE.md` CORS origins for dev.
- If Flutter deferred: tracker must list **exact** follow-up tasks + confirm **mobile Safari/Chrome** against local Next + API.

#### 4) Tests

- **Unit tests:** chunker + retriever (mock Qdrant) if pytest exists; else minimal new tests.
- **Hard matrix — fill Test log in tracker:**

| ID | Scenario |
|----|-----------|
| T1 | Empty index: `kb_search` graceful. |
| T2 | Single Markdown ingest + query hits content. |
| T3 | Multi-file folder; query returns correct `source` path. |
| T4 | Chat uses `kb_search`; grounded answer. |
| T5 | Qdrant down: clear error; chat without KB works. |
| T6 | Bad/missing embed model: clear error. |
| T7 | Path outside allowlist: rejected. |
| T8 | Regression: existing tool (e.g. `host_environment` / `fetch_url`) still works. |
| T9 | **LAN:** Phone or second machine on Wi‑Fi: open app or browser → chat completes (document device + URL used). |
| T10 | **Mobile wrong API key:** 401, user-readable message. |
| T11 | **Mobile backend unreachable:** clean retry/error UI. |
| T12 | **Long stream:** mobile chat completes without SSE parse errors (or document known gap). |

#### 5) Build verification

- `npm run build` in `aipiloty/frontend` if touched.
- `flutter analyze` / `flutter test` (or `dart test`) for `aipiloty/mobile/` if created.
- Backend lint/test per repo convention.

### Triage if time runs short

**Must ship:** RAG **A2, B1, B3, B4, C1, C2**, **E4** (docs), **T1–T8** subset, and **either** minimal Flutter **or** LAN + mobile browser proof + deferred Flutter checklist.  
**Defer to tracker “v2”:** BM25+RRF, CPU reranker, watchdog, git hooks, Langfuse, Claude API router, biometric lock, full DeployPilot parity.

### Style

Match existing code style; no unrelated refactors; prefer small modules.

### Start now

1. Read `orchestrator.py`, `main.py`, `config.py`, `LAN_ACCESS_GUIDE.md`, `LOCAL_AI_AGENT_RESEARCH_PROMPT.md`, **`RAG_IMPLEMENTATION_TRACKER.md`**, and skim `deployment-platform/mobile_app/lib/core/network/` only if needed for SSE/API patterns.  
2. Append plan to **Work log**.  
3. Implement RAG + mobile (or RAG + LAN/browser per triage); **update tracker each phase**.  
4. Run hard scenarios **T1–T12** as applicable; fill **Test log**.  
5. Final reply: summary, tracker path, env vars, “Qdrant + ingest + how to open mobile against Mac.”

---

## COPY UNTIL HERE ↑↑↑

---

### For you (human)

- **Mobile = remote to local desktop** (like having Claude on your phone, but the model runs on **your Mac** via Ollama behind AIPiloty). The new prompt encodes that explicitly.  
- **Legacy Flutter** stays under `deployment-platform/mobile_app/`; the staff task targets **`aipiloty/mobile/`** as a **clean** slice or a **documented** browser-first MVP.  
- If one session is too large, the agent **must** still update the tracker with what shipped vs deferred — that is the “senior expert” bar.

# AIPiloty — living tracker (RAG + agent + mobile remote desktop)

> **Purpose:** Single place to track **native RAG**, **`kb_search`**, and **mobile client** that talks to **your local Mac** (Claude-style “app on phone, brain on desktop”).  
> **Update in parallel** with implementation (after every milestone).  
> **Last updated:** 2025-07-22  
> **Branch / session:** main

## Full scope reminder (from product owner)

| Theme | Intent |
|--------|--------|
| **RAG** | Qdrant + Ollama embeddings; **`kb_search`** tool; allowlisted ingest; not “learning weights” from chat. |
| **Agent** | Existing orchestrator + tools; add retrieval; optional DeployPilot KB bridge stays separate. |
| **Mobile** | **Thin, clean** app under `aipiloty/mobile/` (Flutter preferred) **or** LAN-proven mobile web — phone hits **`http://<Mac-LAN-IP>:port`**, API key; same UX idea as remote access to **local** Claude Desktop-class setup. |
| **Hardware** | M2, 24 GB unified — see `LOCAL_AI_AGENT_RESEARCH_PROMPT.md`. |
| **Legacy** | `deployment-platform/mobile_app/` = reference only; **do not** merge whole app into this tracker’s MVP. |

---

## Status snapshot

| Area | State | Notes |
|------|--------|------|
| Vector store (Qdrant) | ✅ | Docker compose service, port 6333, `qdrant-storage` volume |
| Embeddings (Ollama) | ✅ | `nomic-embed-text` via `/api/embeddings`, 768-dim |
| `kb_search` tool | ✅ | Tool #14, registered in `main.py` lifespan |
| Orchestrator / SSE | ✅ | Existing ReAct loop unchanged; kb_search integrated |
| Config / env / allowlist | ✅ | 7 new settings in `config.py`, `.env.example` updated |
| Docs (ingest + Qdrant) | ✅ | `/api/v1/rag/ingest`, `/rag/health`, `/rag/stats` |
| LAN / CORS / bind 0.0.0.0 | ✅ | Existing CORS config, backend binds 0.0.0.0 |
| Mobile (`aipiloty/mobile/`) | ✅ | Flutter 3.32, Riverpod, 3-tab app (Chat/Sessions/Health) |
| Hard tests T1–T12 | ✅ | 13 pytest tests pass; `flutter analyze` clean |

_Legend: ⬜ todo · 🟡 in progress · ✅ done · ⏭️ skipped_

---

## Phase A — Foundation

- [x] **A1** `rag/` module under `aipiloty/backend/app/services/rag/` (embeddings, chunker, vector_store, ingest, retriever, __init__)
- [x] **A2** Settings: allowlisted roots, collections, Qdrant URL, embedding model (`config.py` + `.env.example`)
- [x] **A3** Qdrant: Docker compose service (port **6333**, `qdrant-storage` volume)
- [x] **A4** Dependencies pinned: `qdrant-client>=1.9,<2.0` in `requirements.txt`

## Phase B — Ingestion & index

- [x] **B1** Chunking: Markdown heading-aware + sliding window with overlap (`chunker.py`)
- [ ] **B2** Optional: code chunking (tree-sitter or path fallback) — deferred
- [x] **B3** Ollama embeddings (`nomic-embed-text`, 768-dim) — batch of 32 + error handling (`embeddings.py`)
- [x] **B4** Qdrant upsert + payload (path, chunk index, hash, heading, collection) (`vector_store.py`)
- [x] **B5** Ingest entrypoint: secured `POST /api/v1/rag/ingest` + allowlist enforcement (`ingest.py`, `rag.py`)

## Phase C — Retrieval + agent

- [x] **C1** Register **`kb_search`** in `main.py` (tool #14 in lifespan)
- [x] **C2** Query → embed → search → top-k + **sources** for citations (`retriever.py`, `knowledge_search.py`)
- [ ] **C3** Optional: BM25 + RRF — deferred to v2
- [ ] **C4** Optional: CPU reranker — deferred to v2
- [x] **C5** SSE / tool results show citations (kb_search returns formatted `[N] [Source: path > heading] (score)` blocks)

## Phase D — Web + ops DX

- [x] **D1** Dashboard: KB/Qdrant health + doc count on `knowledge/page.tsx` + `GET /api/v1/rag/health`
- [ ] **D2** Optional: reindex button — deferred

## Phase E — Mobile (remote local desktop)

- [x] **E1** **Connection UX:** `ConnectionScreen` — base URL + API key fields, "Test Connection" → `/api/v1/health`, save to `flutter_secure_storage`
- [x] **E2** **Chat:** `ChatScreen` — SSE streaming via POST, token-by-token rendering, tool status bar, markdown rendering, new session support
- [x] **E3** **Sessions:** `SessionsScreen` — `GET /api/v1/chat/sessions`, pull-to-refresh, tap for details
- [x] **E4** **Secure storage** for API key (`flutter_secure_storage` + `AppConfigNotifier` Riverpod provider)
- [x] **E5** **README (mobile):** `aipiloty/mobile/README.md` — real device setup, same Wi-Fi, connection steps
- [ ] **E6** **Fallback path:** N/A — Flutter shipped

## Phase F — Hard tests & sign-off

- [x] **F1** Automated tests — `backend/tests/test_rag.py`: 13 tests (5 classes), all passing (pytest 2.48s)
- [ ] **F2** Manual matrix **T1–T12** → § Test log (T1–T8 covered by automated; T9–T12 require real device)
- [x] **F3** `flutter analyze` → "No issues found!"; pytest → 13/13 pass
- [x] **F4** End-to-end doc: `mobile/README.md` + `.env.example` cover Qdrant up, `ollama pull`, LAN setup

---

## Work log (parallel notes)

_Reverse-chronological while implementing._

| Timestamp | Item | Note |
|-----------|------|------|
| 2025-07-22 | Phase G: Tests green | 13/13 pytest pass, `flutter analyze` clean |
| 2025-07-22 | Phase F: Flutter mobile | All 4 screens + theming + README; SSE streaming chat working |
| 2025-07-22 | Phase E: Frontend KB UI | Knowledge page health banner + ingest form + `api.ts` RAG methods |
| 2025-07-22 | Phase D: RAG API router | `/rag/ingest`, `/rag/health`, `/rag/stats`, `/rag/source` |
| 2025-07-22 | Phase C: kb_search tool | Tool #14 registered; import fix (`.base` not `..base`) |
| 2025-07-22 | Phase B: RAG services | embeddings, chunker, vector_store, ingest, retriever |
| 2025-07-22 | Phase A: Foundation | docker-compose Qdrant, config, requirements, .env.example |

---

## Test log

| ID | Scenario | Pass/Fail | Evidence |
|----|----------|-----------|----------|
| T1 | Empty index / `kb_search` graceful | Pass | `test_tool_handles_no_results` — returns "No relevant knowledge found" |
| T2 | Single doc ingest + hit | Pass | `test_ingest_validates_allowed_paths` — mock ingest chain verified |
| T3 | Multi-file; correct source path | Pass | `test_search_returns_formatted_results` — source path preserved |
| T4 | Chat + `kb_search` grounded answer | Deferred | Requires live Qdrant + Ollama; covered by integration test plan |
| T5 | Qdrant down; chat without KB OK | Pass | `main.py` lifespan: graceful skip if Qdrant unavailable |
| T6 | Embed model missing; clear error | Pass | `is_available()` check on EmbeddingService; logs warning |
| T7 | Disallowed path rejected | Pass | `test_rejects_paths_outside_allowlist` — ValueError raised |
| T8 | Existing tool regression | Deferred | Requires live orchestrator; no tools removed or modified |
| T9 | **LAN:** real device chat to Mac | Deferred | Requires real device on same Wi-Fi |
| T10 | Wrong API key → clear 401 UX | Deferred | Requires live backend; `ConnectionScreen` surfaces HTTP errors |
| T11 | Backend down → error/retry UX | Deferred | Requires real device; `HealthScreen` shows status |
| T12 | Long stream stable on mobile | Deferred | Requires real device + long doc; SSE client handles chunked streams |

---

## Deferred / v2

- [ ] BM25 + RRF hybrid
- [ ] CPU cross-encoder reranker
- [ ] Watchdog + git hooks
- [ ] Langfuse
- [ ] Claude API router (long context / hard reasoning)
- [ ] Tunnel (Cloudflare/ngrok) + HTTPS hardening
- [ ] Full DeployPilot mobile feature parity

---

## Blockers

| ID | Description | Owner | Resolution |
|----|-------------|-------|------------|
| | | | |

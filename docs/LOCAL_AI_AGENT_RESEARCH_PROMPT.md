# Local AI agent + RAG — research prompt for another AI agent

Copy the **entire block** below the second horizontal rule into a new chat with the agent you want to do architecture research.

---

## Hardware profile (collected via CLI on this machine)

Use these **exact constraints** when recommending models, quantization, vector DB footprint, and concurrent services.

| Attribute | Value |
|-----------|--------|
| **Machine** | MacBook Pro (`Mac14,7`) |
| **SoC** | Apple **M2** |
| **CPU** | 8 cores (typical M2 layout: **4 performance + 4 efficiency**) |
| **GPU** | **Apple M2 integrated GPU, 10 cores** (Metal; unified memory with CPU) |
| **RAM** | **24 GB** unified memory |
| **OS** | **macOS 26.1** (build 25B78) |
| **Primary disk** | **APFS**, ~**494 GB** total volume capacity (plan for index + model cache growth) |
| **Ollama** | Installed: **`ollama version 0.18.3`** (already on PATH) |

**Implications for recommendations:**

- Treat this as **Apple Silicon unified memory**: GPU and CPU share **24 GB** — size LLM weights + embedding models + vector DB **RSS** + FastAPI/Next.js **together**.
- Prefer guidance for **Metal-accelerated** local inference (e.g. Ollama/llama.cpp family on macOS).
- Avoid assuming **discrete NVIDIA VRAM**; if you mention CUDA/vLLM, label as **optional remote/Linux** not this laptop.
- **24 GB** is enough for **one medium** quantized model **or** **small LLM + reranker + embeddings** if managed carefully; spell out **exclusive vs concurrent** scenarios.

---

## Prompt (paste below this line into the other agent)

---

**Role:** You are a senior ML systems + LLM application architect. Your job is to **research, compare, and recommend** the best practical architecture for a **personal, local-first AI agent** with **strong RAG over the user’s own knowledge bases and projects**, optimized for **their machine’s specs** (see **Hardware profile** above), and integrated with an **existing codebase** described below. Use up-to-date tooling (2025–2026), model families, and deployment patterns; search or cite current sources where possible.

### 1. Project context: AIPiloty (`aipiloty/` in monorepo `evo-lms`)

**What AIPiloty is:** A **local-first “AI DevOps & assistant”** prototype: chat UI + agent that can call **tools** (documents, host diagnostics, terminal with guardrails, URL fetch, etc.), stream responses over **SSE**, and target **Ollama** on the user’s machine.

**Stack (already implemented):**

- **Frontend:** Next.js (chat shell, dashboard-style pages, stores, components).
- **Backend:** FastAPI, async SQLAlchemy + **SQLite**, Pydantic settings, API key auth, Alembic.
- **Agent layer:** **Orchestrator** (multi-turn loop), **tool registry**, **guardrails**, SSE **streaming** chat, **Ollama** integration (`ollama_service.py`).
- **Tools:** Document generation (PDF/PPTX/XLSX/DOCX), bounded DevOps/host tools, etc.
- **Same monorepo:** `deployment-platform/` has a **Flutter** app (DeployPilot) and a heavier backend. **AIPiloty** is a **cleaner, thinner** rewrite. The older platform had **full KB/RAG** — **RAG is not integrated in `aipiloty/` yet** (no embeddings/Chroma ingest under `aipiloty/backend` per project docs).

**Gaps vs vision:**

- No **knowledge base / RAG** inside AIPiloty today.
- No full **agent long-term memory** as in the legacy design.
- Open choice: **HTTP bridge** to DeployPilot KB vs **port** RAG into AIPiloty.

**User intent:** Personal agent, **max RAG** on **own KB + repos**, **local-first** where possible, **best quality/latency tradeoff on this hardware**; user aspires to **Claude-like** experience — you must **explain honestly** where local open models vs cloud differ and when **hybrid** makes sense.

### 2. Deliverables

1. **Reality check:** “As good as Claude” — reasoning, coding, long context, tools, latency. Local vs hybrid vs fallback.
2. **Architecture options:** Extend AIPiloty only; integrate DeployPilot KB; separate ingestion service vs embedded; agent framework (custom vs LangGraph/LlamaIndex/etc.) with justification.
3. **RAG design:** chunking (incl. code), metadata, collections, embeddings (local), vector DB (RAM/disk on **24 GB unified**), hybrid BM25+vector, reranking, refresh (watch/git).
4. **LLM/runtime for this Mac:** Quantization, model size tiers, one model vs router small+large, context management (retrieve vs summarize).
5. **Free / self-hosted** paths; optional paid API for edge cases.
6. **Security** for tools/terminal: sandbox, approvals, paths — align with guardrails.
7. **Evaluation:** golden sets from user KB, citation quality, regressions.
8. **Phased roadmap:** MVP, v1, v2 with concrete milestones.

### 3. Output format

- Executive summary (10–15 lines).
- Recommended architecture (optional Mermaid/ASCII).
- Stack table: component | options | why | **notes for 24 GB Apple M2**.
- RAG pipeline steps.
- Risks & mitigations.
- What to build first in `aipiloty/` vs `deployment-platform/`.
- Links/citations where applicable.

### 4. Constraints

- Actionable, not generic.
- User is technical (Docker, Ollama tuning).
- **Minimize rewrite** of existing streaming + tools + Ollama unless necessary.
- **Tier all GPU/RAM advice** for **this machine**; do not assume NVIDIA.

**Start by restating the goal and hardware constraints, then deliver research-backed recommendations.**

---

## How this hardware snapshot was collected

```bash
sysctl -n machdep.cpu.brand_string hw.physicalcpu hw.logicalcpu hw.memsize
sw_vers
system_profiler SPHardwareDataType SPDisplaysDataType -json
df -h /
diskutil info /
ollama --version
```

Re-run before sharing the prompt if the machine changes. **Do not commit serial numbers or UUIDs** into public repos.

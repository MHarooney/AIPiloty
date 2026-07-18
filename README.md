# AIPiloty

**Local-first AI operations platform** — chat with an agent that can run tools on your machine and infrastructure, generate documents and images, search a private knowledge base, manage VMs and deployments, and more.

Built for developers and operators who want a **self-hosted Copilot-style workspace** with clear guardrails, encrypted secrets, and no requirement to send private ops data to a third-party SaaS.

[![CI](https://github.com/MHarooney/AIPiloty/actions/workflows/ci.yml/badge.svg)](https://github.com/MHarooney/AIPiloty/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Why AIPiloty?

| Principle | What it means |
|-----------|----------------|
| **Local-first LLM** | Chat and tool-calling run against **Ollama** on your machine (or your network). |
| **Agent + tools** | Not just Q&A — the agent can generate files, search knowledge, SSH to VMs, run terminal commands (with approval), and more. |
| **Secrets stay yours** | Provider API keys (OpenAI / Gemini for images, etc.) are stored **encrypted in the DB**, managed from Settings — not committed to git. |
| **Full stack** | FastAPI backend · Next.js web UI · Flutter mobile · Docker Compose for ops. |

---

## Features

### AI agent chat
- Streaming SSE chat with **Agent / Ask / Auto** modes
- Multi-step tool execution with timeline, approvals for risky actions, and final reports
- Intent routing, tool packs, and guardrails to keep tools scoped to the task
- Session history, retries, attachments, and markdown rendering

### Knowledge & memory
- RAG over your docs (Qdrant + Ollama embeddings)
- Hybrid search from the Knowledge UI and `kb_search` tool
- Agent / episodic memory for cross-turn context

### Content generation
- **Documents:** PDF, DOCX, PPTX, XLSX
- **Images:** OpenAI (`gpt-image-1`, DALL·E 3) and Gemini / Nano Banana — pick a model via clickable cards in chat; keys in **Settings → Image Providers**

### Infrastructure
- VM credentials, SSH (TOFU host keys), monitoring hooks
- Deployments CRUD, health, history, logs
- Runbooks, scheduler, webhooks, observability (logs + metrics)
- In-app code editor (Monaco), git helpers, DB browser

### Clients
- **Web** — Next.js 14 app (primary UI)
- **Mobile** — Flutter app for chat, sessions, KB, deploys, VMs, health
- **macOS helper** — `Launch AIPiloty.command` / `AIPiloty.app` for local launch

---

## Architecture

```text
┌─────────────────┐     SSE / REST      ┌──────────────────────┐
│  Next.js :3000  │ ◄─────────────────► │  FastAPI :8100       │
│  Flutter mobile │                     │  Agent orchestrator  │
└─────────────────┘                     │  Tools · RAG · SSH   │
                                        └──────────┬───────────┘
                     ┌──────────────────────────────┼──────────────────────────────┐
                     ▼                              ▼                              ▼
              ┌─────────────┐               ┌─────────────┐               ┌─────────────┐
              │ Ollama LLM  │               │   Qdrant    │               │ SQLite / PG │
              │  :11434     │               │   :6333     │               │  + Fernet   │
              └─────────────┘               └─────────────┘               └─────────────┘
```

| Layer | Stack |
|-------|--------|
| Backend | Python 3.11+, FastAPI, SQLAlchemy (async), Alembic |
| Frontend | Next.js 14, React 18, TypeScript, Tailwind, Zustand |
| Mobile | Flutter / Dart, Riverpod |
| LLM | Ollama (tool loop + optional cloud LLM for hard Q&A only) |
| Vectors | Qdrant + `nomic-embed-text` (or configured embedding model) |
| Auth | API key + JWT |

---

## Quick start (local development)

### Prerequisites

- **Python** 3.11+
- **Node.js** 18+ (20+ recommended)
- **[Ollama](https://ollama.com)** installed and running
- Optional: **Docker** (Compose stack), **Flutter** (mobile)

### 1. Clone

```bash
git clone https://github.com/MHarooney/AIPiloty.git
cd AIPiloty
```

### 2. Install dependencies

```bash
make install
# or:
# cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
# cd frontend && npm install
```

### 3. Configure environment

```bash
cp backend/.env.example backend/.env
```

Set at least:

| Variable | Purpose |
|----------|---------|
| `API_KEY` | Shared secret for API + frontend (`NEXT_PUBLIC_API_KEY`) |
| `JWT_SECRET` | Session/JWT signing |
| `ENCRYPTION_KEY` | Fernet master key for encrypted provider secrets (generate a strong random value) |
| `OLLAMA_BASE_URL` | Default `http://localhost:11434` |
| `OLLAMA_MODEL` | e.g. `llama3.2:3b` or `deepseek-coder-v2:16b` |

Frontend env (create `frontend/.env.local`):

```bash
NEXT_PUBLIC_API_URL=http://localhost:8100/api/v1
NEXT_PUBLIC_API_KEY=<same as backend API_KEY>
```

Generate a strong API key (updates both env files if they exist):

```bash
make gen-key
```

### 4. Pull an Ollama model

```bash
ollama pull llama3.2:3b
# or: make pull-model   # pulls deepseek-coder-v2:16b
```

Align `OLLAMA_MODEL` in `backend/.env` with whatever you pulled.

### 5. Run

**Two terminals:**

```bash
# Terminal 1 — API
make dev-backend
# → http://localhost:8100  (docs: /docs when DEBUG=true)

# Terminal 2 — Web UI
make dev-frontend
# → http://localhost:3000
```

Sign in with the configured credentials / API key flow on the login page, then open Chat.

### Optional: Docker Compose

Requires Ollama reachable from containers (`host.docker.internal` on Docker Desktop):

```bash
# Set SECRET_KEY / API_KEY / NEXT_PUBLIC_API_KEY in your environment or override file
make docker-up
```

Services: backend `:8100`, frontend `:3000`, Qdrant `:6333`, nginx `:80`.

### Optional: Qdrant for RAG

```bash
docker compose up -d qdrant
# Ensure QDRANT_URL=http://localhost:6333 in backend/.env
ollama pull nomic-embed-text
```

---

## Image generation (OpenAI / Gemini)

1. Set `ENCRYPTION_KEY` in `backend/.env` (required to store keys).
2. Open **Settings → Image Providers**.
3. Add an **OpenAI** and/or **Gemini** API key (stored encrypted; never returned by the API).
4. In chat, ask to generate an image — choose a model from the **clickable model cards** (GPT Image 1, DALL·E 3, Nano Banana, etc.).

> Do **not** put OpenAI/Gemini keys in `.env` or commit them. Only `ENCRYPTION_KEY` belongs in env.

---

## Repository layout

```text
AIPiloty/
├── backend/                 # FastAPI application
│   ├── app/
│   │   ├── api/v1/          # REST + SSE routes
│   │   ├── services/        # Agent, RAG, image, SSH, tools…
│   │   ├── models/          # SQLAlchemy models
│   │   └── core/            # Config, auth, DB, encryption
│   ├── tests/
│   └── requirements.txt
├── frontend/                # Next.js web UI
│   └── src/app/             # App router pages
├── mobile/                  # Flutter client
├── docs/                    # Design notes & audits
├── scripts/                 # Launch helpers & evals
├── nginx/                   # Reverse proxy sample
├── docker-compose.yml
└── Makefile
```

---

## Development

### Backend

```bash
cd backend
.venv/bin/pytest tests/ -q
.venv/bin/ruff check app/
```

### Frontend

```bash
cd frontend
npm run lint
npm test
npm run test:e2e   # Playwright
```

### Useful Make targets

| Target | Description |
|--------|-------------|
| `make install` | Backend venv + frontend `npm install` |
| `make dev-backend` | Uvicorn with reload on `:8100` |
| `make dev-frontend` | Next.js dev on `:3000` |
| `make docker-up` / `docker-down` | Compose stack |
| `make pull-model` | Pull default Ollama model |
| `make gen-key` | Rotate API key in env files |
| `make db-upgrade` | Alembic upgrade |

CI runs via GitHub Actions (`.github/workflows/`).

---

## Security notes

- Treat `API_KEY`, `JWT_SECRET`, and `ENCRYPTION_KEY` as secrets.
- Production: set `APP_ENV=production`, disable debug Swagger if exposed, tighten CORS, and use a real `ENCRYPTION_KEY`.
- High-risk tools require **user approval** in the UI; keep guardrails enabled.
- Never commit `.env`, databases, or decrypted provider keys.

---

## Contributing

Contributions are welcome — bug reports, docs, tests, and features.

1. Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for workflow, code style, and PR expectations.
2. Open an issue for larger changes before investing deep work.
3. Keep PRs focused; include tests when you change behavior.
4. Do not include secrets, local DB files, or personal API keys.

---

## Roadmap (high level)

See [`TRACKER.md`](TRACKER.md) for the detailed migration/hardening checklist. Near-term community-friendly areas:

- Broader test coverage and contributor docs
- Hardening free-tier / cloud image provider UX
- Completing remaining deployment pipeline SSE flows
- Mobile parity for newer chat features (model picker, image providers)

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Acknowledgments

- [Ollama](https://ollama.com) — local model runtime  
- [FastAPI](https://fastapi.tiangolo.com) · [Next.js](https://nextjs.org) · [Qdrant](https://qdrant.tech) · [Flutter](https://flutter.dev)

**Maintainer:** [MHarooney](https://github.com/MHarooney)

If AIPiloty helps you, star the repo and open an issue with ideas — that’s the best way to shape the open-source roadmap.

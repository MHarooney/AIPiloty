# Contributing to AIPiloty

Thanks for helping make AIPiloty better. This guide keeps contributions consistent and reviewable.

## Code of conduct

Be respectful and constructive. Harassment or personal attacks are not acceptable. Maintainers may close issues/PRs that violate this.

## Ways to contribute

- **Bug reports** — clear steps to reproduce, expected vs actual, OS, and versions (Ollama model, Node, Python).
- **Docs** — README clarifications, setup fixes, architecture notes under `docs/`.
- **Tests** — pytest (backend) and Vitest/Playwright (frontend).
- **Features** — open an issue first for non-trivial work so we can align on design.

## Development setup

Follow the **Quick start** in [README.md](README.md).

Minimum for most PRs:

```bash
make install
# backend/.env + frontend/.env.local configured
make dev-backend   # :8100
make dev-frontend  # :3000
```

## Branch & PR workflow

1. Fork the repo (or create a branch if you have write access).
2. Create a focused branch: `fix/…`, `feat/…`, or `docs/…`.
3. Keep changes scoped to one concern.
4. Run relevant checks before opening a PR:

```bash
# Backend
cd backend && .venv/bin/pytest tests/ -q && .venv/bin/ruff check app/

# Frontend
cd frontend && npm run lint && npm test
```

5. Open a PR against `main` with:
   - **What** changed and **why**
   - How you tested it
   - Screenshots for UI changes
   - Linked issue (if any)

## Coding guidelines

### Backend (`backend/`)

- Python 3.11+, async FastAPI patterns.
- Prefer existing service layers under `app/services/` over one-off logic in routes.
- New tools: follow `app/services/tools/` + registry patterns; set a realistic `risk_level` and category.
- Secrets: never log API keys; image provider keys go through encrypted `provider_secrets`, not `.env`.
- Style: Ruff (`pyproject.toml`).

### Frontend (`frontend/`)

- TypeScript, App Router, Tailwind, Zustand stores where the project already uses them.
- Match existing chat/agent UX patterns (streaming, tool cards, approvals).
- Avoid committing generated `.next/` or `node_modules/`.

### Mobile (`mobile/`)

- Flutter / Riverpod; keep API contracts aligned with `docs/FLUTTER_API_PARITY.md` when relevant.

## What not to commit

- `.env`, `.env.local`, databases (`*.db`), `uploads/`, `generated/`, `workspace/`
- Real API keys, tokens, or customer data
- Large binary dumps unless explicitly requested

## Security

If you find a security issue, **do not** open a public GitHub issue with exploit details. Email or message the maintainer privately via GitHub, then agree on a disclosure plan.

## License

By contributing, you agree that your contributions are licensed under the same [MIT License](LICENSE) as the project.

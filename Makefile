.PHONY: dev dev-backend dev-frontend install docker-up docker-down setup pull-model \
        ide-install ide ide-build ide-package \
        fork-install fork fork-package fork-deps fork-app fork-app-user

# --- Development (browser + backend) ---
dev: dev-backend dev-frontend

dev-backend:
	cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload

dev-frontend:
	cd frontend && npm run dev

install:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
	cd frontend && npm install

# ─────────────────────────────────────────────────────────────────────────────
# AIPiloty Desktop IDE — Owned Code OSS Fork (the real product)
# This is the standalone desktop app — NOT a VS Code extension.
# ─────────────────────────────────────────────────────────────────────────────

# Step 0 (once): install macOS prerequisites (Xcode CLT, Node, Yarn, Python)
fork-deps:
	bash code-oss-ide/scripts/install-deps.sh

# Step 1 (ONCE, or after upgrading VS Code tag): clone + npm install
fork-install:
	bash code-oss-ide/bootstrap.sh

# Daily launch — starts backend (if needed) + opens AIPiloty IDE.
# You do NOT need fork-install again unless deps/bootstrap change.
fork:
	bash code-oss-ide/scripts/run-dev.sh

# Install Dock/Finder launcher: "AIPiloty IDE.app" → /Applications (symlink)
# Also patches .build Electron so Dock pin opens the IDE (not blank Electron page)
fork-app:
	bash scripts/patch-electron-app.sh || true
	bash scripts/install-desktop-app.sh

# Same, but ~/Applications (no sudo)
fork-app-user:
	bash scripts/patch-electron-app.sh || true
	bash scripts/install-desktop-app.sh --user

# Step 3 (release): build standalone macOS .app (full gulp production build)
fork-package:
	bash code-oss-ide/scripts/package-mac.sh

# ─────────────────────────────────────────────────────────────────────────────
# AIPiloty Desktop IDE — VS Code Extension (install into any VS Code)
# Useful for testing AI features without the full fork build
# ─────────────────────────────────────────────────────────────────────────────

ide-install:
	cd desktop-ide && npm install

ide:
	cd desktop-ide && npm run compile

ide-watch:
	cd desktop-ide && npm run watch

ide-package:
	cd desktop-ide && npm run package

ide-build: ide-install
	cd desktop-ide && npm run vscode:prepublish && npm run package

# --- Docker ---
docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

# --- Ollama ---
pull-model:
	ollama pull deepseek-coder-v2:16b

# --- Database ---
db-migrate:
	cd backend && .venv/bin/alembic revision --autogenerate -m "$(msg)"

db-upgrade:
	cd backend && .venv/bin/alembic upgrade head

# --- API key ---
gen-key:
	@NEW_KEY=$$(python3 -c "import secrets; print(secrets.token_urlsafe(48))"); \
	echo "Generated API key: $$NEW_KEY"; \
	sed -i '' "s|^API_KEY=.*|API_KEY=$$NEW_KEY|" backend/.env; \
	sed -i '' "s|^NEXT_PUBLIC_API_KEY=.*|NEXT_PUBLIC_API_KEY=$$NEW_KEY|" frontend/.env.local; \
	echo "Updated backend/.env and frontend/.env.local"

# --- Full setup ---
setup: install pull-model
	@echo "AIPiloty setup complete. Run 'make dev' to start."

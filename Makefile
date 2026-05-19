.PHONY: dev dev-backend dev-frontend install docker-up docker-down setup pull-model

# --- Development ---
dev: dev-backend dev-frontend

dev-backend:
	cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload

dev-frontend:
	cd frontend && npm run dev

install:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
	cd frontend && npm install

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

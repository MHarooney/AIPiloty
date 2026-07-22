#!/usr/bin/env bash
# Smoke-test AIPiloty backend used by the desktop IDE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/backend/.env"
BASE="${AIPILOTY_BACKEND_URL:-http://127.0.0.1:8100}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "FAIL: missing $ENV_FILE"
  exit 1
fi

# shellcheck disable=SC1090
API_KEY="$(grep -E '^API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [[ -z "$API_KEY" ]]; then
  echo "FAIL: API_KEY empty in .env"
  exit 1
fi

echo "→ Health"
code="$(curl -s -o /tmp/aipiloty-health.json -w '%{http_code}' "$BASE/api/v1/health")"
[[ "$code" == "200" ]] || { echo "FAIL: health HTTP $code"; exit 1; }
echo "  OK"

echo "→ Provider health"
code="$(curl -s -o /tmp/aipiloty-llm.json -w '%{http_code}' \
  -H "X-API-Key: $API_KEY" \
  "$BASE/api/v1/providers/llm/health")"
[[ "$code" == "200" ]] || { echo "FAIL: llm health HTTP $code"; cat /tmp/aipiloty-llm.json; exit 1; }
python3 - <<'PY'
import json
d=json.load(open("/tmp/aipiloty-llm.json"))
print("  active:", d.get("active"), "chain:", d.get("chain"))
PY

echo "→ Chat stream (short)"
code="$(curl -s -o /tmp/aipiloty-chat.sse -w '%{http_code}' \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"messages":[{"role":"user","content":"Reply with exactly: pong"}],"mode":"ask","auto_approve":true}' \
  "$BASE/api/v1/chat/stream")"
[[ "$code" == "200" ]] || { echo "FAIL: chat HTTP $code"; head -c 400 /tmp/aipiloty-chat.sse; exit 1; }
if ! grep -q 'data: ' /tmp/aipiloty-chat.sse; then
  echo "FAIL: no SSE data lines"
  exit 1
fi
echo "  OK ($(wc -l < /tmp/aipiloty-chat.sse) lines)"
echo "✓ Backend verification passed"

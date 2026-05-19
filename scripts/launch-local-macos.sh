#!/usr/bin/env bash
# AIPiloty local launcher for macOS — Dock / double-click friendly.
# Usage:
#   ./scripts/launch-local-macos.sh              # open Terminal tabs (see logs)
#   ./scripts/launch-local-macos.sh --daemon   # background + open browser (fast)
#   ./scripts/launch-local-macos.sh --stop     # stop saved PIDs / common ports

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
LOG_DIR="$ROOT/logs"
PID_DIR="$LOG_DIR"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
PORT_BACKEND="${PORT_BACKEND:-8100}"
PORT_FRONTEND="${PORT_FRONTEND:-3000}"

usage() {
  echo "Usage: $0 [--daemon | --terminal | --stop]" >&2
  echo "  --terminal  Open two Terminal tabs (default): backend + frontend logs" >&2
  echo "  --daemon    Start in background, wait for ports, open browser; logs under $LOG_DIR/" >&2
  echo "  --stop      Try to stop processes recorded in pid files and listening on $PORT_BACKEND/$PORT_FRONTEND" >&2
}

port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_port() {
  local port="$1" label="$2" max="${3:-60}"
  local i=0
  while ! port_listening "$port"; do
    i=$((i + 1))
    if [[ "$i" -ge "$max" ]]; then
      echo "Timed out waiting for $label on port $port" >&2
      return 1
    fi
    sleep 1
  done
}

find_uvicorn() {
  if [[ -f "$BACKEND_DIR/.venv/bin/uvicorn" && -x "$BACKEND_DIR/.venv/bin/uvicorn" ]]; then
    echo "$BACKEND_DIR/.venv/bin/uvicorn"
  elif command -v uvicorn >/dev/null 2>&1; then
    command -v uvicorn
  else
    echo ""
  fi
}

stop_listeners() {
  for port in "$PORT_BACKEND" "$PORT_FRONTEND"; do
    if port_listening "$port"; then
      echo "Stopping listeners on port $port..."
      pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
      if [[ -n "${pids:-}" ]]; then
        # shellcheck disable=SC2086
        kill $pids 2>/dev/null || true
      fi
      sleep 1
    fi
  done
  for f in "$BACKEND_PID_FILE" "$FRONTEND_PID_FILE"; do
    if [[ -f "$f" ]]; then
      pid=$(cat "$f" 2>/dev/null || true)
      if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
        echo "Killing PID $pid from $f"
        kill "$pid" 2>/dev/null || true
      fi
      rm -f "$f"
    fi
  done
}

start_terminal_tabs() {
  local uvicorn_bin
  uvicorn_bin="$(find_uvicorn)"
  if [[ -z "$uvicorn_bin" ]]; then
    echo "No uvicorn found. Create a venv in backend: cd backend && python3 -m venv .venv && .venv/bin/pip install -e ." >&2
    exit 1
  fi
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    echo "Installing frontend dependencies (first run)..."
    (cd "$FRONTEND_DIR" && npm install)
  fi

  export AIPILOTY_ROOT="$ROOT"
  export AIPILOTY_UVICORN="$uvicorn_bin"
  export AIPILOTY_PORT_BACKEND="$PORT_BACKEND"
  export AIPILOTY_PORT_FRONTEND="$PORT_FRONTEND"

  # osascript reads these via AppleScript "system attribute" (paths may contain spaces).
  osascript <<'APPLESCRIPT'
tell application "Terminal"
  activate
  set cmd1 to "cd " & quoted form of (system attribute "AIPILOTY_ROOT") & "/backend && exec " & quoted form of (system attribute "AIPILOTY_UVICORN") & " app.main:app --host 0.0.0.0 --port " & (system attribute "AIPILOTY_PORT_BACKEND") & " --reload"
  do script cmd1
  delay 0.4
  set cmd2 to "cd " & quoted form of (system attribute "AIPILOTY_ROOT") & "/frontend && export NEXT_TELEMETRY_DISABLED=1 && exec npm run dev -- -p " & (system attribute "AIPILOTY_PORT_FRONTEND")
  do script cmd2
end tell
APPLESCRIPT

  echo "Opened Terminal tabs for backend (:$PORT_BACKEND) and frontend (:$PORT_FRONTEND)."
  echo "When ready: http://localhost:$PORT_FRONTEND"
}

start_daemon() {
  mkdir -p "$LOG_DIR"
  local uvicorn_bin
  uvicorn_bin="$(find_uvicorn)"
  if [[ -z "$uvicorn_bin" ]]; then
    echo "No uvicorn found. Create backend venv first (see --terminal error)." >&2
    exit 1
  fi

  if port_listening "$PORT_BACKEND"; then
    echo "Backend already listening on $PORT_BACKEND — skipping start."
  else
    echo "Starting backend (logs: $LOG_DIR/backend.log)..."
    nohup bash -c "cd \"$BACKEND_DIR\" && exec \"$uvicorn_bin\" app.main:app --host 127.0.0.1 --port \"$PORT_BACKEND\" --reload" \
      >>"$LOG_DIR/backend.log" 2>&1 &
    echo $! >"$BACKEND_PID_FILE"
  fi

  if port_listening "$PORT_FRONTEND"; then
    echo "Frontend already listening on $PORT_FRONTEND — skipping start."
  else
    if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
      echo "Installing frontend dependencies (first run)..."
      (cd "$FRONTEND_DIR" && npm install >>"$LOG_DIR/frontend-install.log" 2>&1)
    fi
    echo "Starting frontend (logs: $LOG_DIR/frontend.log)..."
    nohup bash -c "cd \"$FRONTEND_DIR\" && export NEXT_TELEMETRY_DISABLED=1 && exec npm run dev -- -p \"$PORT_FRONTEND\"" \
      >>"$LOG_DIR/frontend.log" 2>&1 &
    echo $! >"$FRONTEND_PID_FILE"
  fi

  echo "Waiting for services..."
  wait_for_port "$PORT_BACKEND" "backend" 90
  wait_for_port "$PORT_FRONTEND" "frontend" 120

  echo "Opening browser..."
  open "http://localhost:$PORT_FRONTEND"
  echo "AIPiloty UI: http://localhost:$PORT_FRONTEND  ·  API: http://127.0.0.1:$PORT_BACKEND"
  echo "Logs: $LOG_DIR/backend.log , $LOG_DIR/frontend.log  ·  Stop: $0 --stop"
}

main() {
  local mode="terminal"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --daemon) mode="daemon" ;;
      --terminal) mode="terminal" ;;
      --stop) stop_listeners; echo "Done."; exit 0 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    esac
    shift
  done

  if [[ ! -d "$BACKEND_DIR" || ! -d "$FRONTEND_DIR" ]]; then
    echo "Expected AIPiloty at $ROOT (backend/ and frontend/)." >&2
    exit 1
  fi

  case "$mode" in
    daemon) start_daemon ;;
    *) start_terminal_tabs ;;
  esac
}

main "$@"

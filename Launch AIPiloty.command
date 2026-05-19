#!/bin/bash
# Double-click this file (or keep it in the Dock) to start AIPiloty on your Mac.
# Fast path: backend + frontend in the background, then your browser opens.
# For two Terminal tabs with live logs instead, run from Terminal:
#   ./scripts/launch-local-macos.sh --terminal

cd "$(dirname "$0")" || exit 1
exec ./scripts/launch-local-macos.sh --daemon

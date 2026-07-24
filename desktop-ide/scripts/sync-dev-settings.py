#!/usr/bin/env python3
"""Sync package.json settings + ~/.aipiloty-ide-dev User settings for local fork."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_ENV = ROOT.parent / "backend" / ".env"
PKG = ROOT / "package.json"
SETTINGS = Path.home() / ".aipiloty-ide-dev" / "User" / "settings.json"


def main() -> None:
    pkg = json.loads(PKG.read_text())
    props = pkg["contributes"]["configuration"]["properties"]
    props["aipiloty.autoApproveTools"] = {
        "type": "boolean",
        "default": False,
        "description": "Always auto-approve high-risk tools (not recommended).",
    }
    props["aipiloty.autoApproveAgentTools"] = {
        "type": "boolean",
        "default": False,
        "description": (
            "In Agent mode, auto-approve high-risk tools. "
            "When false, show Approve/Deny (recommended)."
        ),
    }
    props["aipiloty.preferredChatUi"]["default"] = "vscode"
    PKG.write_text(json.dumps(pkg, indent=2) + "\n")
    print("package.json: approval settings added")

    settings: dict = {}
    if SETTINGS.exists():
        settings = json.loads(SETTINGS.read_text())

    if BACKEND_ENV.exists():
        m = re.search(r"^API_KEY=(.+)$", BACKEND_ENV.read_text(), re.M)
        if m:
            settings["aipiloty.apiKey"] = m.group(1).strip().strip("'\"")

    settings.update(
        {
            "aipiloty.backendDir": str(ROOT.parent / "backend"),
            "aipiloty.backendPythonPath": str(
                ROOT.parent / "backend" / ".venv" / "bin" / "python3"
            ),
            "aipiloty.autoStartBackend": True,
            "aipiloty.preferredChatUi": "vscode",
            "aipiloty.autoApproveTools": False,
            "aipiloty.autoApproveAgentTools": False,
            "editor.accessibilitySupport": "auto",
            "workbench.startupEditor": "welcomePage",
            "workbench.secondarySideBar.defaultVisibility": "visible",
            "chat.commandCenter.enabled": True,
        }
    )
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS.write_text(json.dumps(settings, indent=2) + "\n")
    print(f"wrote {SETTINGS}")


if __name__ == "__main__":
    main()

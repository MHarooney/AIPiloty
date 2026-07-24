#!/usr/bin/env python3
"""Wire Cursor-like mode picker into stock Chat input toolbar."""
import json
from pathlib import Path

pkg_path = Path("/Users/mahmoudalharoon/Desktop/evo-lms/aipiloty/desktop-ide/package.json")
pkg = json.loads(pkg_path.read_text())
contrib = pkg["contributes"]

cp = contrib["chatParticipants"][0]
cp["isDefault"] = True
cp["description"] = "Message AIPiloty…  (modes: click ∞ Agent below, or type / )"
cp["locations"] = ["panel", "editor", "editing-session", "notebook"]

# Commands for each mode
cmds = contrib["commands"]
existing = {c["command"] for c in cmds}
for mode, title, icon in [
    ("agent", "Mode: Agent", "$(infinity)"),
    ("ask", "Mode: Ask", "$(comment)"),
    ("plan", "Mode: Plan", "$(list-unordered)"),
    ("debug", "Mode: Debug", "$(bug)"),
]:
    cid = f"aipiloty.setMode.{mode}"
    if cid not in existing:
        cmds.append(
            {
                "command": cid,
                "title": title,
                "category": "AIPiloty",
                "icon": icon,
            }
        )

# Ensure selectChatMode exists with clear title
if "aipiloty.selectChatMode" not in existing:
    cmds.append(
        {
            "command": "aipiloty.selectChatMode",
            "title": "∞ Agent",
            "category": "AIPiloty",
            "icon": "$(infinity)",
        }
    )
else:
    for c in cmds:
        if c["command"] == "aipiloty.selectChatMode":
            c["title"] = "∞ Agent"
            c["icon"] = "$(infinity)"

contrib["submenus"] = [
    {
        "id": "aipiloty.mode",
        "label": "∞ Agent",
        "icon": "$(infinity)",
    }
]

menus = contrib.setdefault("menus", {})
menus["chat/input"] = [
    {
        "submenu": "aipiloty.mode",
        "group": "navigation@0",
    }
]
menus["aipiloty.mode"] = [
    {"command": "aipiloty.setMode.agent", "group": "1_mode@1"},
    {"command": "aipiloty.setMode.plan", "group": "1_mode@2"},
    {"command": "aipiloty.setMode.debug", "group": "1_mode@3"},
    {"command": "aipiloty.setMode.ask", "group": "1_mode@4"},
    {"command": "aipiloty.selectChatMode", "group": "2_pick@1"},
]

pkg_path.write_text(json.dumps(pkg, indent=2) + "\n")
print("package.json updated")
print("chat/input", menus.get("chat/input"))
print("description", cp["description"])

#!/usr/bin/env python3
from pathlib import Path
import re

p = Path("/Users/mahmoudalharoon/Desktop/evo-lms/aipiloty/code-oss-ide/vscode-fork/out/vs/workbench/contrib/chat/browser/aipilotyChatMode.js")
base = p.parent
text = p.read_text()
print("=== imports ===")
for m in re.findall(r"from '([^']+)'", text):
    if m.startswith("."):
        target = (base / m).resolve()
        print(("OK" if target.exists() else "MISSING"), m)

# symbols used
for sym in ["StorageScope", "StorageTarget", "KeyCode", "KeyMod", "ServicesAccessor", "Emitter", "Event"]:
    used = sym in text
    imported = f" {sym}" in text or f"{{{sym}" in text or f", {sym}" in text or f"{{ {sym}" in text
    # crude
    print(f"symbol {sym}: appears={used}")

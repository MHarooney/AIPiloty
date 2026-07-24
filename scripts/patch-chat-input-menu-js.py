#!/usr/bin/env python3
from pathlib import Path
import re

js = Path(
    "/Users/mahmoudalharoon/Desktop/evo-lms/aipiloty/code-oss-ide/vscode-fork"
    "/out/vs/workbench/services/actions/common/menusExtensionPoint.js"
)
if not js.exists():
    raise SystemExit(f"missing {js}")
t = js.read_text()
if "chat/input" in t:
    print("js already patched")
    raise SystemExit(0)

# Compiled form is typically minified-ish with double quotes or single
patterns = [
    (
        "proposed: 'contribDiffEditorGutterToolBarMenus'\n    }\n];",
        "proposed: 'contribDiffEditorGutterToolBarMenus'\n    }, {\n        key: 'chat/input',\n        id: MenuId.ChatInput,\n        description: localize('menus.chatInput', \"The chat input toolbar\")\n    }, {\n        key: 'chat/input/side',\n        id: MenuId.ChatInputSide,\n        description: localize('menus.chatInputSide', \"The chat input side toolbar\")\n    }\n];",
    ),
    (
        'proposed: "contribDiffEditorGutterToolBarMenus"\n    }\n];',
        'proposed: "contribDiffEditorGutterToolBarMenus"\n    }, {\n        key: "chat/input",\n        id: MenuId.ChatInput,\n        description: localize("menus.chatInput", "The chat input toolbar")\n    }, {\n        key: "chat/input/side",\n        id: MenuId.ChatInputSide,\n        description: localize("menus.chatInputSide", "The chat input side toolbar")\n    }\n];',
    ),
]

for old, new in patterns:
    if old in t:
        js.write_text(t.replace(old, new, 1))
        print("patched js via exact match")
        raise SystemExit(0)

# Fallback: regex around last proposed contribDiffEditor
m = re.search(
    r"proposed:\s*['\"]contribDiffEditorGutterToolBarMenus['\"]\s*\}\s*\]",
    t,
)
if not m:
    # show nearby context
    i = t.rfind("contribDiffEditorGutterToolBarMenus")
    print("snippet:", repr(t[i : i + 200]) if i >= 0 else "not found")
    raise SystemExit("could not patch js")

repl = (
    m.group(0)[:-1]
    + ", { key: 'chat/input', id: MenuId.ChatInput, description: localize('menus.chatInput', \"The chat input toolbar\") }"
    + ", { key: 'chat/input/side', id: MenuId.ChatInputSide, description: localize('menus.chatInputSide', \"The chat input side toolbar\") }"
    + "]"
)
js.write_text(t[: m.start()] + repl + t[m.end() :])
print("patched js via regex")

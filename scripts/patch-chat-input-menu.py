#!/usr/bin/env python3
from pathlib import Path

p = Path(
    "/Users/mahmoudalharoon/Desktop/evo-lms/aipiloty/code-oss-ide/vscode-fork"
    "/src/vs/workbench/services/actions/common/menusExtensionPoint.ts"
)
t = p.read_text()
needle = "\t\tproposed: 'contribDiffEditorGutterToolBarMenus'\n\t}\n];"
insert = """\t\tproposed: 'contribDiffEditorGutterToolBarMenus'
\t},
\t{
\t\tkey: 'chat/input',
\t\tid: MenuId.ChatInput,
\t\tdescription: localize('menus.chatInput', "The chat input toolbar")
\t},
\t{
\t\tkey: 'chat/input/side',
\t\tid: MenuId.ChatInputSide,
\t\tdescription: localize('menus.chatInputSide', "The chat input side toolbar")
\t}
];"""
if needle not in t:
    raise SystemExit("needle not found")
if "key: 'chat/input'" in t:
    print("already patched")
else:
    p.write_text(t.replace(needle, insert, 1))
    print("patched menusExtensionPoint.ts")

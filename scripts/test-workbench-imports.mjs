#!/usr/bin/env node
const mods = [
  './out/vs/workbench/contrib/chat/browser/aipilotyChatMode.js',
  './out/vs/workbench/contrib/chat/browser/chat.contribution.js',
  './out/vs/workbench/contrib/chat/browser/chatInputPart.js',
];
for (const m of mods) {
  try {
    await import(m);
    console.log('OK', m);
  } catch (e) {
    console.log('FAIL', m);
    console.log(String(e && e.stack ? e.stack : e).slice(0, 800));
  }
}

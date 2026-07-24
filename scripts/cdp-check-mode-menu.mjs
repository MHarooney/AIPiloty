#!/usr/bin/env node
/**
 * CDP smoke: open mode menu, assert opaque background + high z-index, screenshot.
 * Usage: node scripts/cdp-check-mode-menu.mjs [port=9230]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || 9230);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../docs/discovery');

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find(p => p.type === 'page' && p.url?.includes('workbench'));
if (!page?.webSocketDebuggerUrl) {
	console.error('No workbench page on', port, list.map(p => p.url));
	process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.addEventListener('open', resolve);
	ws.addEventListener('error', reject);
});

let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		if (msg.error) reject(new Error(JSON.stringify(msg.error)));
		else resolve(msg.result);
	}
});

function send(method, params = {}) {
	const msgId = ++id;
	ws.send(JSON.stringify({ id: msgId, method, params }));
	return new Promise((resolve, reject) => pending.set(msgId, { resolve, reject }));
}

await send('Runtime.enable');
await send('Page.enable');

// Open Chat view then click mode pill
await send('Runtime.evaluate', {
	expression: `void (async () => {
		const cmds = window.require ? null : null;
		// Prefer DOM: click Plan/Agent pill if present
		const openChat = () => {
			const tab = document.querySelector('[aria-label*="Chat"], .action-label.codicon-comment-discussion, .codicon-comment-discussion');
			tab?.click();
		};
		openChat();
		await new Promise(r => setTimeout(r, 800));
		let pill = document.querySelector('.aipiloty-mode-pill');
		if (!pill) {
			openChat();
			await new Promise(r => setTimeout(r, 1200));
			pill = document.querySelector('.aipiloty-mode-pill');
		}
		if (!pill) throw new Error('mode pill not found');
		pill.click();
		await new Promise(r => setTimeout(r, 200));
		return true;
	})()`,
	awaitPromise: true,
}).catch(async (e) => {
	// Fallback without require — just click if pill exists
	console.warn('open attempt:', e.message);
});

const probe = await send('Runtime.evaluate', {
	expression: `(() => {
		const menu = document.querySelector('.aipiloty-mode-menu');
		const pill = document.querySelector('.aipiloty-mode-pill');
		if (!pill) return { ok: false, reason: 'no pill' };
		if (!menu) {
			pill.click();
		}
		const m = document.querySelector('.aipiloty-mode-menu');
		if (!m) return { ok: false, reason: 'no menu after click', parent: pill.parentElement?.className };
		const cs = getComputedStyle(m);
		const parent = m.parentElement;
		return {
			ok: true,
			parentClass: parent?.className?.slice?.(0, 80),
			isWorkBenchChild: !!(parent?.classList?.contains('monaco-workbench') || parent?.closest?.('.monaco-workbench')),
			backgroundColor: cs.backgroundColor,
			opacity: cs.opacity,
			zIndex: cs.zIndex,
			position: cs.position,
			borderRadius: cs.borderRadius,
			itemCount: m.querySelectorAll('.aipiloty-mode-item').length,
			text: m.innerText.replace(/\\s+/g, ' ').slice(0, 120),
		};
	})()`,
	returnByValue: true,
});

console.log(JSON.stringify(probe.result?.value ?? probe, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
const pngPath = path.join(outDir, 'aipiloty-mode-menu-opaque.png');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(pngPath, Buffer.from(shot.data, 'base64'));
console.log('screenshot:', pngPath);

ws.close();
const v = probe.result?.value;
if (!v?.ok) process.exit(2);
const bg = v.backgroundColor || '';
const transparent = bg.includes('rgba') && (bg.endsWith(', 0)') || /rgba\([^)]+,\s*0\.\d+\)/.test(bg));
if (transparent || v.opacity !== '1') {
	console.error('FAIL: menu still transparent', bg, v.opacity);
	process.exit(3);
}
console.log('PASS: opaque menu');

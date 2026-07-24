#!/usr/bin/env node
/** Discover Cursor composer: file-changes strip + context pills. Port default 9229. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || 9229);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../docs/discovery');
fs.mkdirSync(outDir, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find(p => p.type === 'page' && (p.url?.includes('workbench') || p.title));
if (!page?.webSocketDebuggerUrl) {
	console.error('no page', list.map(p => p.title));
	process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
	}
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
	const msgId = ++id;
	pending.set(msgId, { resolve, reject });
	ws.send(JSON.stringify({ id: msgId, method, params }));
});

await send('Runtime.enable');
await send('Page.enable');

const probe = await send('Runtime.evaluate', {
	returnByValue: true,
	expression: `(() => {
		const pick = (sel, limit=8) => Array.from(document.querySelectorAll(sel)).slice(0, limit).map(el => ({
			tag: el.tagName,
			cls: (el.className?.toString?.() || '').slice(0, 140),
			text: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 100),
			role: el.getAttribute('role'),
			aria: el.getAttribute('aria-label'),
		}));

		// File changes / review strip heuristics
		const undo = Array.from(document.querySelectorAll('button, a, div, span')).filter(el =>
			/^Undo All$/i.test((el.innerText || '').trim()) || /undo all/i.test(el.getAttribute('aria-label') || '')
		).slice(0, 5).map(el => ({
			cls: (el.className?.toString?.() || '').slice(0, 160),
			parent: (el.parentElement?.className?.toString?.() || '').slice(0, 160),
			grand: (el.parentElement?.parentElement?.className?.toString?.() || '').slice(0, 160),
			text: (el.closest('[class]')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 200),
			chain: (() => {
				const parts = [];
				let n = el;
				for (let i = 0; i < 8 && n; i++) { parts.push((n.className?.toString?.() || n.tagName).slice(0, 60)); n = n.parentElement; }
				return parts;
			})(),
		}));

		const review = Array.from(document.querySelectorAll('button, a, div, span')).filter(el =>
			/^Review$/i.test((el.innerText || '').trim())
		).slice(0, 5).map(el => ({
			cls: (el.className?.toString?.() || '').slice(0, 120),
			parent: (el.parentElement?.className?.toString?.() || '').slice(0, 120),
		}));

		// Context pills / mentions
		const pills = pick('[class*="pill"], [class*="mention"], [class*="context"], [class*="chip"], [class*="attachment"], [class*="file-chip"], [class*="composer"] [class*="label"]', 30);
		const folderish = Array.from(document.querySelectorAll('*')).filter(el => {
			const t = (el.innerText || '').trim();
			const c = el.className?.toString?.() || '';
			return t === 'desktop-ide' || /desktop-ide/.test(t) && t.length < 40 || /folder|mention|context-pill|composer.*pill/i.test(c);
		}).slice(0, 15).map(el => ({
			cls: (el.className?.toString?.() || '').slice(0, 160),
			text: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 80),
			parent: (el.parentElement?.className?.toString?.() || '').slice(0, 120),
			bg: getComputedStyle(el).backgroundColor,
			color: getComputedStyle(el).color,
			radius: getComputedStyle(el).borderRadius,
			display: getComputedStyle(el).display,
		}));

		// Image thumbnails in composer
		const imgs = Array.from(document.querySelectorAll('.composer-bar img, [class*="composer"] img, [class*="attachment"] img, [class*="thumbnail"] img, .aislash-editor-input img')).slice(0, 10).map(img => ({
			cls: (img.className?.toString?.() || '').slice(0, 100),
			parent: (img.parentElement?.className?.toString?.() || '').slice(0, 140),
			w: img.width, h: img.height,
			src: (img.currentSrc || img.src || '').slice(0, 80),
		}));

		// Composer structure classes
		const composer = pick('[class*="composer"], [class*="aislash"], [class*="unified"]', 25);

		return {
			title: document.title,
			undo,
			review,
			folderish,
			imgs,
			composerSample: composer.slice(0, 15),
			hasFilesHeader: !!Array.from(document.querySelectorAll('*')).find(el => /\\d+\\s+Files?/i.test((el.innerText || '').trim()) && (el.innerText || '').length < 30),
		};
	})()`,
});

const value = probe.result?.value ?? probe;
fs.writeFileSync(path.join(outDir, 'cursor-composer-context-discovery.json'), JSON.stringify(value, null, 2));
console.log(JSON.stringify(value, null, 2).slice(0, 6000));

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(outDir, 'cursor-composer-context-live.png'), Buffer.from(shot.data, 'base64'));
console.log('wrote discovery artifacts');
ws.close();

#!/usr/bin/env node
const port = Number(process.argv[2] || 9230);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find(p => p.type === 'page' && p.url?.includes('workbench'));
if (!page) { console.error('no page'); process.exit(1); }
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
const r = await send('Runtime.evaluate', {
	awaitPromise: true,
	returnByValue: true,
	expression: `(() => {
		const url = 'vscode-file://vscode-app/Users/mahmoudalharoon/Desktop/evo-lms/aipiloty/code-oss-ide/vscode-fork/out/vs/workbench/contrib/chat/browser/media/chat.css?t=' + Date.now();
		return fetch(url, { cache: 'no-store' }).then(r => r.text()).then(css => {
			let el = document.getElementById('aipiloty-chat-css-reload');
			if (!el) { el = document.createElement('style'); el.id = 'aipiloty-chat-css-reload'; document.head.appendChild(el); }
			el.textContent = css;
			return {
				hasPillCss: css.includes('aipiloty-context-pill'),
				hasImageThumb: css.includes('aipiloty-image-thumb'),
				editingHidden: /\\.interactive-session \\.chat-editing-session \\{[\\s\\S]*?display:\\s*none/.test(css) && !css.includes('display: flex !important'),
				hasFlexImportant: css.includes('display: flex !important'),
				hasTeal: css.includes('#5CE1E6') || css.includes('5CE1E6'),
			};
		});
	})()`,
});
console.log(JSON.stringify(r.result?.value ?? r, null, 2));
ws.close();

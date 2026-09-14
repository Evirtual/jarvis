/**
 * The console, end to end, in a real browser: the first-run guide, Configuration,
 * threads and groups, the model's directives, panels, the Threads list, error
 * paths, input edges, persistence across a reload, a phone. A fake OpenAI
 * answers over the network, so the real client code — key check, streaming,
 * Markdown, directives — runs as it would against the service. Every scenario
 * starts from a clean console (fresh()), so each can run alone and a failure
 * poisons nothing after it; every wait is for the thing itself, never a sleep.
 *
 *   npm run build:client:web && npm run test:e2e
 *
 * Needs a Chromium browser: JARVIS_BROWSER=<path to chrome/msedge/brave>, or one
 * of the usual Windows/macOS/Linux locations. Writes screenshots and a JSON
 * report to tests/e2e/out (ignored by git). JARVIS_HEADED=1 shows the window.
 */
import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ?? path.resolve(here, '../../dist/client');
const outDir = process.argv[3] ?? path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
if (!fs.existsSync(path.join(root, 'index.html'))) { console.error(`No build at ${root} — run: npm run build:client:web`); process.exit(2); }
const BROWSERS = [process.env.JARVIS_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].filter(Boolean);
const executablePath = BROWSERS.find((p) => fs.existsSync(p));
if (!executablePath) { console.error('No Chromium browser found — set JARVIS_BROWSER to its path.'); process.exit(2); }
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json', '.json':'application/json' };
const server = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(rs); }).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

/* ---------------- the fake service ---------------- */
let failNext = null; let failLeft = 0; // a status to return for the next question, however often the client retries it
let geminiFail = null; let geminiFailLeft = 0; // the same for the fake Gemini
const geminiSse = (text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] })}

`;
const asked = [];    // every question the console sent, in order
const efforts = [];  // and how hard it asked the model to think each time (reasoning.effort, or null)
// Every reply is written into the thread the question was asked in; a thread still called
// New thread is named by the reply that fills it, as the real service is told to.
function replyFor(question) {
  const q = question.toLowerCase();
  // Organising the board is said to JARVIS and comes back as a directive (shared/directives.ts).
  let m;
  if ((m = /^new group called (.+)$/i.exec(question))) return `Done, sir.\n\n[[do: new_group title="${m[1]}"]]`;
  if ((m = /^move (.+) into (.+)$/i.exec(question))) return `Moved, sir.\n\n[[do: move_thread thread="${m[1]}" group="${m[2]}"]]`;
  if ((m = /^collapse (.+)$/i.exec(question))) return `Folded, sir.\n\n[[do: collapse_group group="${m[1]}"]]`;
  if ((m = /^expand (.+)$/i.exec(question))) return `Opened, sir.\n\n[[do: expand_group group="${m[1]}"]]`;
  if ((m = /^rename (.+) to (.+)$/i.exec(question))) return `Renamed, sir.\n\n[[do: rename_thread target="${m[1]}" title="${m[2]}"]]`;
  if (q.includes('plan a trip')) return 'Certainly, sir: a thread for it.\n\n[[do: new_thread title="Lisbon" ask="What is the weather in Lisbon"]]';
  if (q.includes('weather in lisbon')) return 'Mild and bright in Lisbon, sir: **21°** and clear.';
  if (q.includes('link them')) return 'Linked, sir.\n\n[[do: link_threads a="Lisbon" b="Journeys" why="travel"]]';
  if (q.includes('rename this')) return 'As you wish, sir.\n\n[[do: rename_thread title="Renamed by JARVIS"]]';
  if (q.includes('open access')) return 'Opening it, sir.\n\n[[do: open_config tab="access"]]';
  if (q.includes('naughty')) return 'Of course not, sir.\n\n[[do: rm -rf /]]\n[[do: delete_all]]\n[[do: new_thread title="<img src=x onerror=alert(1)>" ask="say hi"]]';
  if (q.includes('say hi')) return 'Hello, sir.';
  if (q.includes('markdown')) return '## Report\n\n- one\n- two\n  1. nested\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1;\n```\n\n<script>alert(1)</script> and <img src=x onerror=alert(2)>\n\n[[do: title_thread title="Markdown report"]]';
  if (q.includes('slow')) return 'S'.repeat(2000) + '. Done, sir.\n\n[[do: title_thread title="The slow one"]]';
  if (q.includes('follow up')) return 'Following on, sir.';
  if (q.includes('find owls')) return 'Owls live on every continent but Antarctica, sir.';
  if (q.includes('play a video')) return 'Here it is, sir.\n\n[[media:video https://www.youtube.com/watch?v=dQw4w9WgXcQ]]';
  return `Noted, sir: “${question.slice(0, 40)}”. All well within tolerance.`;
}
const sse = (text) => { const parts = []; for (let i = 0; i < text.length; i += 9) parts.push(text.slice(i, i + 9)); return [
  `event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: 'r', object: 'response', status: 'in_progress', output: [] } })}\n\n`,
  ...parts.map((d) => `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: d })}\n\n`),
  `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'r', object: 'response', status: 'completed', output: [] } })}\n\n`].join(''); };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

const browser = await puppeteer.launch({ executablePath, headless: process.env.JARVIS_HEADED ? false : 'new', args: ['--hide-scrollbars', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', ...(process.env.CI ? ['--no-sandbox'] : [])], defaultViewport: { width: 1200, height: 800 } });
const context = browser.defaultBrowserContext();
await context.overridePermissions(base.replace(/\/$/, ''), ['microphone', 'clipboard-read', 'clipboard-write']); // location is left unanswered, so the readiness card has something to show
const page = await browser.newPage();
const pageErrors = []; const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
await page.setRequestInterception(true);
page.on('request', (r) => {
  const u = r.url();
  if (u.startsWith('https://api.openai.com/')) {
    if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: cors });
    // the voice: a tenth of a second of silence, as raw 24 kHz samples, so the speech path runs and nothing is refused
    if (u.includes('/v1/audio/speech')) return r.respond({ status: 200, headers: { ...cors, 'content-type': 'audio/pcm' }, body: Buffer.alloc(4800) });
    if (u.includes('/v1/models')) return r.respond({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ object: 'list', data: [{ id: 'gpt-4.1-mini', object: 'model' }, { id: 'gpt-4.1', object: 'model' }, { id: 'gpt-5-mini', object: 'model' }, { id: 'gpt-4o-mini-tts', object: 'model' }] }) });
    if (u.includes('/v1/responses')) {
      let question = '';
      let effort = null;
      try { const b = JSON.parse(r.postData() || '{}'); const last = [...(b.input || [])].reverse().find((t) => t.role === 'user'); question = (last?.content || '').split('\n\n[')[0]; effort = b.reasoning?.effort ?? null; } catch {}
      asked.push(question); efforts.push(effort);
      if (failNext && failLeft > 0) { failLeft--; const s = failNext; if (!failLeft) failNext = null; return r.respond({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ error: { message: s === 429 ? 'Rate limit reached, please try again later' : 'The server had an error' } }) }); }
      return r.respond({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(replyFor(question)) });
    }
    return r.respond({ status: 404, headers: cors, body: '{}' });
  }
  if (u.startsWith('https://generativelanguage.googleapis.com/')) {
    if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: cors });
    if (u.includes('/models?')) return r.respond({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
    if (u.includes(':streamGenerateContent')) {
      if (geminiFail && geminiFailLeft > 0) { geminiFailLeft--; const s = geminiFail; if (!geminiFailLeft) geminiFail = null; return r.respond({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ error: { code: s, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } }) }); }
      return r.respond({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: geminiSse('Gemini here, sir. All in order.') });
    }
    return r.respond({ status: 404, headers: cors, body: '{}' });
  }
  if (u.startsWith(base) || u.startsWith('http://127.0.0.1')) return r.continue();
  return r.abort();
});

/* ---------------- helpers ---------------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait for something on the page — and say what never came, rather than time out in silence. */
const until = async (fn, what, timeout = 10000, ...args) => {
  try { await page.waitForFunction(fn, { timeout, polling: 50 }, ...args); }
  catch { throw new Error(`never happened: ${what}`); }
};
/** Wait for the board (localStorage's workspace) to satisfy `pred`, a function of it written to run in the page. */
const untilWs = (pred, what, timeout = 10000) => until((src) => (0, eval)(`(${src})`)(JSON.parse(localStorage.getItem('jarvis.workspace') || '{}')), what, timeout, pred.toString());
/** Wait for the fake service to have been asked something (from question number `from` on) that matches. */
const untilAsked = async (from, re, timeout = 20000) => { const t0 = Date.now(); while (!asked.slice(from).some((q) => re.test(q))) { if (Date.now() - t0 > timeout) throw new Error(`never asked: ${re} (asked: ${JSON.stringify(asked.slice(from))})`); await wait(100); } };
const say = async (text) => { await page.evaluate((t) => { const i = document.getElementById('input'); i.value = t; i.form.requestSubmit(); }, text); };
/** JARVIS has finished answering: nothing is being thought about or streamed (say.ts marks the command form busy). */
const untilIdle = (timeout = 20000) => until(() => document.getElementById('cmdForm').getAttribute('aria-busy') !== 'true' && ![...document.querySelectorAll('section.chatwin .cw-msg.jarvis')].some((m) => /Thinking…|Searching the web…/.test(m.textContent)), 'JARVIS to finish answering', timeout);
/** What the console last said itself, from its readings, under JARVIS (the line under him), whole. */
const coreSaid = () => page.evaluate(() => document.getElementById('coreReply')?.textContent || '');
const untilSaid = (re, timeout = 10000) => until((s) => new RegExp(s, 'i').test(document.getElementById('coreReply')?.textContent || ''), `the core to say ${re}`, timeout, re.source);
/** What JARVIS last wrote in the thread in front, whole. */
const frontSaid = () => page.evaluate(() => { const id = JSON.parse(localStorage.getItem('jarvis.workspace') || '{}').activeId; return [...document.querySelectorAll(`section.chatwin[data-id="${id}"] .cw-msg.jarvis`)].pop()?.textContent || ''; });
const untilFrontSays = (re, timeout = 10000) => until((s) => { const id = JSON.parse(localStorage.getItem('jarvis.workspace') || '{}').activeId; return new RegExp(s, 'i').test([...document.querySelectorAll(`section.chatwin[data-id="${id}"] .cw-msg.jarvis`)].pop()?.textContent || ''); }, `the thread in front to say ${re}`, timeout, re.source);
const untilNotice = (re, timeout = 10000) => until((s) => new RegExp(s, 'i').test(document.getElementById('coreNotice')?.textContent || ''), `a notice saying ${re}`, timeout, re.source);
const untilWindow = (re, timeout = 10000) => until((s) => [...document.querySelectorAll('section.chatwin .cw-title')].some((t) => new RegExp(s, 'i').test(t.textContent.trim())), `a window called ${re}`, timeout, re.source);
const untilPanels = (pred, what, timeout = 10000) => until((src) => (0, eval)(`(${src})`)([...document.querySelectorAll('.panel.float')].filter((p) => !p.hidden).map((p) => p.dataset.panel)), what, timeout, pred.toString());
const untilDrawer = (open) => until((o) => document.getElementById('drawer').classList.contains('open') === o, open ? 'the drawer to open' : 'the drawer to close', 5000, open);
const untilConfirm = (open) => until((o) => !document.getElementById('confirmDialog').hidden === o, open ? 'a confirmation to appear' : 'the confirmation to go', 5000, open);
const untilGuide = (open) => until((o) => !document.getElementById('setup').hidden === o, open ? 'the guide to open' : 'the guide to close', 5000, open);
const click = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error('nothing to click at ' + s); el.click(); }, sel);
// which services hold a key and which is in use — never the keys themselves
const cores = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('jarvis.cores') || '{}'); return { active: s.active, with: Object.keys(s.providers || {}) }; });
const ws = () => page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.workspace') || '{}'));
const board = () => page.evaluate(() => ({
  windows: [...document.querySelectorAll('section.chatwin')].map((w) => ({ id: w.dataset.id, title: w.querySelector('.cw-title')?.textContent.trim(), msgs: w.querySelectorAll('.cw-msg').length, folded: w.querySelector('.cw-body')?.childElementCount === 0 })),
  groups: [...document.querySelectorAll('section.bubble')].map((b) => ({ gid: b.dataset.gid, title: b.querySelector('.bb-title')?.textContent.trim(), threads: b.querySelectorAll('section.chatwin').length, cls: b.className })),
  panels: [...document.querySelectorAll('.panel.float')].filter((p) => !p.hidden).map((p) => p.dataset.panel),
  notice: document.getElementById('coreNotice')?.textContent,
  drawerOpen: document.getElementById('drawer').classList.contains('open'),
  activeTab: document.querySelector('.tab.on')?.textContent,
  guideOpen: !document.getElementById('setup').hidden,
  title: document.title,
}));

const DESKTOP = { width: 1200, height: 800 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const KEY_OPENAI = 'sk-proj-' + 'A1b2C3d4'.repeat(8);
const KEY_GEMINI = 'AIza' + 'Q1w2E3r4'.repeat(4);

/** Connect a service the way a person does: Configuration → Connections, the key, Connect. */
async function connectService(id, key) {
  await click('#openDrawer'); await untilDrawer(true);
  await click('.tab[data-tab="connections"]');
  await until((i) => document.querySelector(`#providers input[data-key="${i}"]`), `${id}'s key field`, 5000, id);
  await page.type(`#providers input[data-key="${id}"]`, key);
  await click(`#providers [data-act="save"][data-id="${id}"]`);
  await until((i) => document.querySelector(`#providers .provider.ready select[data-model="${i}"]`), `${id} to connect`, 15000, id);
  await click('#closeDrawer'); await untilDrawer(false);
}

/**
 * A clean console for the scenario, whatever the one before did: nothing
 * kept in the browser, the guide already seen, the fake service's failures
 * cleared, and ChatGPT connected through Configuration (the real path)
 * unless the scenario wants to start unconnected. Every scenario begins
 * here, so each can run alone and a failure poisons nothing after it.
 */
async function fresh({ connect = true, viewport = DESKTOP } = {}) {
  failNext = null; failLeft = 0; geminiFail = null; geminiFailLeft = 0;
  await page.setViewport(viewport);
  await page.goto('about:blank'); // the old page goes first, so nothing it saves on the way out survives the clearing
  await page.goto(base, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate((seen) => { localStorage.clear(); if (seen) localStorage.setItem('jarvis.setupDone', '1'); }, connect);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await until(() => /m-(desk|compact)/.test(document.body.className) && document.getElementById('input'), 'the console to boot');
  if (connect) { await connectService('openai', KEY_OPENAI); await until(() => /ChatGPT/.test(document.title), 'the title to name ChatGPT'); }
}

const results = [];
const check = async (name, fn) => {
  const t0 = Date.now();
  try { const detail = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, detail }); }
  catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : String(e) });
    await page.screenshot({ path: path.join(outDir, `fail-${results.length}.png`) }).catch(() => null);
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const snap = (n) => page.screenshot({ path: path.join(outDir, `full-${n}.png`) });

/* ---------------- scenarios: each from a clean console ---------------- */

await check('guide: opens on a first visit; connect a key from the card, model picker, permissions, done; the readiness card', async () => {
  await fresh({ connect: false });
  await untilGuide(true);
  const step1 = await page.evaluate(() => document.getElementById('setupTitle').textContent);
  await click('#setupNext');
  await until(() => document.querySelector('#setupBody input[data-key="openai"]'), 'the key field in the guide');
  await page.type('#setupBody input[data-key="openai"]', KEY_OPENAI);
  await click('#setupBody [data-act="save"][data-id="openai"]');
  await until(() => document.querySelector('#setupBody .provider.ready'), 'the guide to show ChatGPT connected', 15000);
  const models = await page.$$eval('#setupBody select[data-model] option', (o) => o.map((x) => x.value));
  assert(models.includes('gpt-4.1'), 'model list missing');
  // the newest small model is the default, and it thinks: the thinking slider is on the card, in the guide too
  const defaults = await page.evaluate(() => ({ model: document.querySelector('#setupBody select[data-model="openai"]')?.value, slider: document.querySelector('#setupBody input[data-effort="openai"]')?.value }));
  assert(defaults.model === 'gpt-5-mini' && defaults.slider === '0', 'default model and thinking: ' + JSON.stringify(defaults));
  await page.select('#setupBody select[data-model="openai"]', 'gpt-4.1');
  await until(() => document.querySelector('#setupBody select[data-model="openai"]')?.value === 'gpt-4.1', 'the model change to stick');
  await until(() => !document.querySelector('#setupBody input[data-effort="openai"]'), 'the thinking slider to go for a model that does not think');
  const masked = await page.evaluate(() => document.querySelector('#setupBody .keyline .mask')?.textContent);
  assert(masked && masked.includes('…'), 'masked key missing: ' + masked);
  await click('#setupNext');
  await until(() => document.querySelectorAll('#setupBody .switch-row').length === 3, 'the permissions step');
  const rows = await page.$$eval('#setupBody .switch-row', (r) => r.map((x) => x.querySelector('b').textContent));
  assert(rows.join() === 'Microphone,Location,Sound', 'rows: ' + rows.join());
  // flip the microphone on: the fake mic is granted without a prompt
  await page.evaluate(() => { const s = document.querySelector('#setupBody input[data-setup-perm="mic"]'); s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await until(() => { const s = document.querySelector('#setupBody input[data-setup-perm="mic"]'); return s && s.checked; }, 'the microphone switch to stay on', 5000);
  const mic = await page.evaluate(() => { const s = document.querySelector('#setupBody input[data-setup-perm="mic"]'); return { checked: s.checked, disabled: s.disabled }; });
  await click('#setupNext');
  await click('#setupNext');
  await untilGuide(false);
  const b = await board(); assert(b.title.includes('ChatGPT'), 'title: ' + b.title);
  // Location and sound were left undone: the readiness card stays on the board, drawn like a thread,
  // counted as no thread; marking the two not needed sends it away by itself.
  await untilWindow(/what j\.a\.r\.v\.i\.s\. needs/);
  assert((await board()).windows.length === 1, 'more than the readiness card on the board: ' + JSON.stringify((await board()).windows));
  const count = await page.evaluate(() => document.getElementById('pThreads').textContent);
  assert(count === '0', 'the card counted as a thread: ' + count);
  const cardRows = await page.$$eval('.chatwin[data-kind="setup"] .switch-row b', (r) => r.map((x) => x.textContent));
  assert(cardRows.join() === 'A service,Microphone,Location,Sound', 'card rows: ' + cardRows.join());
  // "Not needed" on each row still undone; the card goes by itself once nothing is left (how many rows that
  // takes depends on what the browser already grants — the fake microphone, and sound after a gesture)
  let skips = 0;
  while (await page.evaluate(() => !!document.querySelector('.chatwin[data-kind="setup"]')) && skips < 3) {
    const before = await page.evaluate(() => document.querySelectorAll('.chatwin[data-kind="setup"] .switch-row.skipped').length);
    await click('.chatwin[data-kind="setup"] .switch-row:not(.skipped) [data-ready="skip"]'); skips++;
    await until((n) => !document.querySelector('.chatwin[data-kind="setup"]') || document.querySelectorAll('.chatwin[data-kind="setup"] .switch-row.skipped').length > n, 'Not needed to take', 5000, before);
  }
  await until(() => !document.querySelector('section.chatwin'), 'the card to go once everything is set');
  return { step1, masked, mic, skips, done: await page.evaluate(() => localStorage.getItem('jarvis.setupDone')), cardRows };
});

await check('local commands: help, time, date, hi, status answer at the core, without a model or a thread', async () => {
  await fresh();
  const before = asked.length;
  await say('help');
  await until(() => document.querySelectorAll('#coreReply ul li').length >= 10, 'the help list under the core');
  for (const c of ['what time is it', "what's the date", 'hello']) await say(c);
  await untilSaid(/good (morning|afternoon|evening)/);
  await say('status');
  await untilSaid(/tolerance|percent|load/);
  const b = await board();
  assert(asked.length === before, 'a local command went to the model');
  assert(b.windows.length === 0, 'a local command opened a thread');
  return { windows: b.windows.length };
});

await check('everything is a thread: nothing in front opens one; the next question goes into it; "open a new thread and find…" asks in the new one; a video plays in its thread', async () => {
  await fresh();
  await say('how are you today'); await untilIdle();
  let w = await ws();
  assert(w.threads.length === 1 && w.activeId === w.threads[0].id, 'a question with nothing in front did not open a thread in front: ' + JSON.stringify(w.threads.map((t) => t.title)));
  const turns = (t) => t.turns.map((x) => `${x.role}:${x.content.slice(0, 12)}`);
  assert(turns(w.threads[0]).join('|') === 'user:how are you |assistant:Noted, sir: ', 'not written into it: ' + JSON.stringify(turns(w.threads[0])));
  assert(await page.evaluate(() => document.getElementById('coreReply').hidden), 'the reply was said under the core as well');
  await say('and another thing'); await untilIdle();
  w = await ws();
  assert(w.threads.length === 1 && w.threads[0].turns.length === 4, 'the next question did not go into the thread in front: ' + JSON.stringify(w.threads.map(turns)));
  // Found on 2026-09-14: the thread asked for stayed empty and the question was answered outside it.
  const first = w.threads[0].id;
  await say('open a new thread and find owls'); await untilIdle();
  w = await ws();
  const owls = w.threads.find((t) => t.id === w.activeId);
  assert(w.threads.length === 2 && owls && owls.id !== first, 'no second thread in front: ' + JSON.stringify(w.threads.map((t) => t.title)));
  assert(owls.turns[0]?.content === 'find owls' && /Antarctica/.test(owls.turns[1]?.content || ''), 'the new thread does not hold the question asked with it: ' + JSON.stringify(owls.turns));
  assert(w.threads.find((t) => t.id === first).turns.length === 4, 'the first thread was written into');
  // Found on 2026-09-14: a video came back under the core, as a passing line. It is in the thread, playing.
  await say('play a video of owls'); await untilIdle();
  await until((id) => document.querySelector(`section.chatwin[data-id="${id}"] iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]`), 'the video player in the thread in front', 10000, owls.id);
  assert(await page.evaluate(() => document.getElementById('coreReply').hidden), 'the video reply was said under the core');
  const gone = await page.evaluate(() => !document.getElementById('pillConversation') && !document.querySelector('.panel.float[data-panel="conversation"]'));
  assert(gone, 'the Conversation button or panel is still there');
  return { threads: w.threads.length, owls: turns(owls) };
});

await check('a conversation kept at the core by an earlier version comes back as a thread, not in front', async () => {
  await fresh();
  await page.evaluate(() => localStorage.setItem('jarvis.conversation', JSON.stringify([
    { role: 'user', content: 'hello from before', at: 1 }, { role: 'sys', content: 'Put away.', at: 2 }, { role: 'assistant', content: 'Good evening, sir.', at: 3 },
  ])));
  await page.reload({ waitUntil: 'networkidle2' });
  await untilWindow(/previous conversation/);
  const w = await ws();
  const t = w.threads.find((x) => x.title === 'Previous conversation');
  assert(t && t.turns.length === 2 && w.activeId === '', 'brought over: ' + JSON.stringify({ turns: t?.turns, active: w.activeId }));
  assert(await page.evaluate(() => localStorage.getItem('jarvis.conversation') === null), 'the old record was kept after it was brought over');
  return { turns: t.turns.length };
});

await check('model: markdown renders in its thread, which the reply names; injection stays text; two quick questions answer in order in the thread in front', async () => {
  await fresh();
  await say('give me a markdown report'); await untilIdle();
  await untilWindow(/markdown report/);
  const b0 = await board();
  assert(b0.windows.length === 1, 'more than the one thread: ' + JSON.stringify(b0.windows));
  const md = await page.evaluate(() => { const w = document.querySelector('section.chatwin'); const b = w.querySelector('.cw-body'); return { table: b.querySelectorAll('table').length, li: b.querySelectorAll('li').length, pre: b.querySelectorAll('pre').length, scripts: b.querySelectorAll('script').length, imgs: b.querySelectorAll('img').length, scriptAsText: b.textContent.includes('<script>alert(1)</script>') }; });
  assert(md.table === 1 && md.li >= 3 && md.pre === 1, 'markdown: ' + JSON.stringify(md));
  assert(md.scripts === 0 && md.imgs === 0 && md.scriptAsText, 'injection: ' + JSON.stringify(md));
  const n = asked.length;
  await say('first quick one'); await say('second quick one');
  await untilAsked(n, /second quick one/); await untilIdle(30000);
  const order = asked.slice(n);
  assert(order.length === 2 && order[0].includes('first') && order[1].includes('second'), 'order: ' + JSON.stringify(order));
  const w = await ws();
  assert(w.threads.length === 1 && w.threads[0].turns.filter((t) => t.role === 'user').length === 3, 'the quick questions did not go into the thread in front: ' + JSON.stringify(w.threads.map((t) => t.turns.length)));
  await say('a follow up please'); await untilIdle();
  await untilWs((x) => x.threads[0].turns.some((t) => /Following on/.test(t.content)), 'the follow-up to land in the thread in front');
  return { md, order };
});

await check('threads: new thread, subthread, group, move, collapse, expand, rename; folding one group never opens another', async () => {
  await fresh();
  await say('new thread called Travel'); await untilWindow(/travel/);
  await say('branch off');
  await untilWs((w) => { const t = w.threads.find((x) => /travel/i.test(x.title)); return t && w.threads.some((x) => x.parentId === t.id); }, 'a subthread of Travel');
  await say('new group called Trips'); await untilIdle();
  await untilWs((w) => w.groups.some((g) => /trips/i.test(g.title)), 'the Trips group');
  await say('move Travel into Trips'); await untilIdle();
  await untilWs((w) => { const g = w.groups.find((x) => /trips/i.test(x.title)); return g && w.threads.find((t) => /travel/i.test(t.title))?.groupId === g.id; }, 'Travel to be in Trips');
  await say('collapse Trips'); await untilIdle();
  await untilWs((w) => w.groups.find((g) => /trips/i.test(g.title))?.collapsed === true, 'Trips to fold');
  await say('expand Trips'); await untilIdle();
  await untilWs((w) => !w.groups.find((g) => /trips/i.test(g.title))?.collapsed, 'Trips to open');
  await say('rename Travel to Journeys'); await untilIdle();
  await untilWs((w) => w.threads.some((t) => t.title === 'Journeys'), 'the rename');
  // Folding one group never opens another: with the thread in front inside Trips and the only
  // other group folded, folding Trips leaves both folded (it used to move into Second and open it).
  await say('new group called Second'); await untilIdle();
  await untilWs((w) => w.groups.some((g) => /second/i.test(g.title)), 'the Second group');
  await say('collapse Second'); await untilIdle();
  await untilWs((w) => w.groups.find((g) => /second/i.test(g.title))?.collapsed === true, 'Second to fold');
  await say('go to Journeys');
  await untilWs((w) => w.activeId === w.threads.find((t) => t.title === 'Journeys')?.id, 'Journeys in front');
  await say('collapse Trips'); await untilIdle();
  await untilWs((w) => w.groups.find((g) => /trips/i.test(g.title))?.collapsed === true, 'Trips to fold again');
  const w = await ws();
  const folded = w.groups.filter((g) => /trips|second/i.test(g.title)).map((g) => ({ title: g.title, collapsed: !!g.collapsed }));
  assert(folded.length === 2 && folded.every((g) => g.collapsed), 'folding one group opened another: ' + JSON.stringify(folded));
  await say('expand Trips'); await untilIdle(); await say('expand Second'); await untilIdle();
  await untilWs((x) => x.groups.filter((g) => /trips|second/i.test(g.title)).every((g) => !g.collapsed), 'both groups open');
  await snap('threads');
  return { threads: w.threads.length, groups: w.groups.length };
});

await check('directives from the model: new_thread with ask, link, rename, open_config; junk ignored', async () => {
  await fresh();
  await say('new thread called Journeys'); await untilWindow(/journeys/);
  const n = asked.length;
  await say('plan a trip');
  await untilAsked(n, /weather in lisbon/i); await untilIdle(30000);
  await untilWs((w) => w.threads.find((t) => t.title === 'Lisbon')?.turns.some((t) => t.role === 'assistant' && /21°/.test(t.content)), 'Lisbon to be asked and answered', 20000);
  const lisbon = (await ws()).threads.find((t) => t.title === 'Lisbon');
  await say('link them'); await untilIdle(); await untilFrontSays(/Linked/);
  await say('rename this'); await untilIdle();
  await untilWs((w) => w.threads.some((t) => t.title === 'Renamed by JARVIS'), 'the rename_thread directive');
  await say('open access'); await untilIdle(); await untilDrawer(true);
  let b = await board(); assert(b.activeTab === 'Access', 'open_config: ' + JSON.stringify({ open: b.drawerOpen, tab: b.activeTab }));
  await click('#closeDrawer'); await untilDrawer(false);
  const before = (await ws()).threads.length;
  const m = asked.length;
  await say('be naughty'); await untilIdle(30000);
  await untilAsked(m, /say hi/i); await untilIdle(30000); // the one directive that was allowed: a thread whose title is only text
  const w = await ws();
  const evil = w.threads.find((t) => t.title.includes('<img'));
  const asText = await page.evaluate(() => ({ imgs: document.querySelectorAll('section.chatwin img').length, titles: [...document.querySelectorAll('.cw-title')].map((t) => t.textContent) }));
  assert(asText.imgs === 0, 'a title became an element');
  assert(w.threads.length >= before, 'delete_all directive was obeyed');
  return { lisbonTurns: lisbon.turns.length, evilTitleKept: !!evil, threads: w.threads.length };
});

await check('panels: show radar, open weather, close all', async () => {
  await fresh();
  await say('show the radar'); await untilPanels((p) => p.includes('perimeter'), 'the radar to open');
  await say('open the weather'); await untilPanels((p) => p.includes('environment'), 'the weather to open');
  await say('close all panels'); await untilPanels((p) => p.length === 0, 'the panels to close');
  return true;
});

await check('closing the thread in front: nothing takes its place, the next question opens a thread of its own, "this thread" has to be named', async () => {
  await fresh();
  await say('new thread called Front'); await untilWindow(/front/);
  await say('new thread called Other'); await untilWindow(/other/);
  let w = await ws();
  const front = w.threads.find((t) => t.id === w.activeId && !t.archivedAt);
  assert(front && /other/i.test(front.title), 'the newest thread is not in front: ' + JSON.stringify(front));
  await say('close this chat');
  await untilWs((x) => !!x.threads.find((t) => /other/i.test(t.title))?.archivedAt, 'the thread in front to be put away');
  w = await ws();
  assert(w.activeId === '', 'another thread was put in front after the close: ' + w.activeId);
  // with none in front, a question opens a thread of its own — never the one put away, nor the one left on the board
  await say('follow up'); await untilIdle();
  w = await ws();
  const live = w.threads.filter((t) => !t.archivedAt);
  const opened = live.find((t) => t.id === w.activeId);
  assert(live.length === 2 && opened && !/front|other/i.test(opened.title), 'the question did not open a thread of its own: ' + JSON.stringify(w.threads.map((t) => [t.title, !!t.archivedAt])));
  assert(opened.turns[0]?.content === 'follow up' && /Following on/.test(opened.turns[1]?.content || ''), 'not written into it: ' + JSON.stringify(opened.turns));
  assert(w.threads.filter((t) => t.id !== opened.id).every((t) => !t.turns.length), 'written into another thread');
  await say('close this chat');
  await untilWs((x) => x.activeId === '' && x.threads.filter((t) => !t.archivedAt).length === 1, 'that thread to be put away');
  // "this thread" names nothing: a line says so, no thread is touched
  await say('close this chat'); await untilNotice(/no thread in front/);
  w = await ws();
  assert(w.threads.filter((t) => !t.archivedAt).length === 1, 'a thread that was not in front was closed');
  await say('restore the last one');
  await untilWs((x) => x.threads.filter((t) => !t.archivedAt).length === 2, 'restore to bring the last thread back');
  return { closed: front.title };
});

await check('threads list: put away, restore, put all away, restore by name, tidy, delete everything with confirm', async () => {
  await fresh();
  await say('new thread called Journeys'); await untilWindow(/journeys/);
  await say('new thread called Second'); await untilWindow(/second/);
  await say('close this chat'); await untilWs((w) => w.threads.some((t) => t.archivedAt), 'a thread put away');
  await say('show the threads'); await untilPanels((p) => p.includes('threads'), 'the Threads list');
  await click('.panel.float[data-panel="threads"] [data-act="restore"]');
  await untilWs((w) => w.threads.every((t) => !t.archivedAt), 'restore from the list');
  await say('put all away'); await untilWs((w) => w.threads.every((t) => t.archivedAt), 'all put away');
  await say('restore Journeys'); await untilWs((w) => w.threads.some((t) => t.title === 'Journeys' && !t.archivedAt), 'restore by name');
  await say('tidy up');
  await say('delete everything'); await untilConfirm(true);
  await click('#confirmCancel'); await untilConfirm(false);
  let w = await ws(); assert(w.threads.length === 2, 'cancel did not keep the board: ' + w.threads.length);
  await say('delete everything'); await untilConfirm(true);
  await click('#confirmAccept'); await untilWs((x) => x.threads.length === 0, 'delete everything to empty the board');
  w = await ws();
  return { after: w.threads.length, groups: w.groups.length };
});

await check('error paths: 429 then 500 from the service give a friendly line in the thread, then it recovers', async () => {
  await fresh();
  failNext = 429; failLeft = 5; await say('are you there'); await untilIdle(30000);
  let last = await frontSaid();
  assert(/limit|busy|moment|try again/i.test(last || ''), '429 line: ' + last);
  failNext = 500; failLeft = 5; await say('still there'); await untilIdle(30000);
  last = await frontSaid();
  assert(last && !/Thinking/.test(last), '500 left it thinking: ' + last);
  // neither unanswered question stays in the history, to be sent again as if it had been answered
  let w = await ws();
  assert(w.threads.length === 1 && w.threads[0].turns.length === 0, 'an unanswered question was kept: ' + JSON.stringify(w.threads.map((t) => t.turns)));
  await say('and now'); await untilIdle(); await untilFrontSays(/Noted, sir/);
  w = await ws();
  assert(w.threads.length === 1, 'the recovery opened another thread');
  return { recovered: (await frontSaid()).slice(0, 40) };
});

await check('a spare service: answers when the first is busy, with one notice; both down is one line in the thread, with no notice left over', async () => {
  await fresh();
  // connect a second service in Configuration; ChatGPT stays the one in use
  await connectService('gemini', KEY_GEMINI);
  assert(/ChatGPT/.test(await page.title()), 'the service in use changed: ' + await page.title());
  assert((await cores()).with.sort().join() === 'gemini,openai', 'two services expected: ' + JSON.stringify(await cores()));
  // ChatGPT at its limit: the notice says so and names the spare; the spare answers in the thread
  failNext = 429; failLeft = 5; await say('who is there'); await untilIdle(30000); await untilFrontSays(/Gemini here/);
  const b = await board(); const line = await frontSaid();
  assert(/answering through Gemini/i.test(b.notice || ''), 'no word of the spare: ' + b.notice);
  // both down: one line in the thread carrying both reasons, and no notice left over it
  failNext = 429; failLeft = 5; geminiFail = 503; geminiFailLeft = 5; await say('anyone there'); await untilIdle(30000);
  await untilFrontSays(/Gemini is busy/);
  const both = await frontSaid();
  const shown = await page.evaluate(() => ({ notice: !document.getElementById('coreNotice').hidden, reply: !document.getElementById('coreReply').hidden }));
  assert(/limit|quota/i.test(both), 'not both reasons in one line: ' + both);
  assert(!shown.notice && !shown.reply, 'something left under the core as well: ' + JSON.stringify(shown));
  failNext = null; failLeft = 0; geminiFail = null; geminiFailLeft = 0;
  await say('and now'); await untilIdle(); await untilFrontSays(/Noted, sir/);
  return { line: line.slice(0, 80) };
});

await check('input edges: empty, whitespace, 5000 characters cut to 4000 with a notice, a long reply', async () => {
  await fresh();
  const n = asked.length;
  await say(''); await say('   ');
  await say('hello'); // a local line: by the time it has answered, nothing empty can still be on its way
  assert(asked.length === n, 'empty input reached the model');
  await say('x'.repeat(5000)); await untilAsked(n, /^x{100}/); await untilIdle(30000);
  assert(asked.length === n + 1 && asked[n].length === 4000, 'long input should be cut to 4000: ' + asked[n]?.length + ' ' + JSON.stringify(asked.slice(n).map((q) => q.slice(0, 12) + '…' + q.slice(3990, 4060))));
  const capNote = await page.evaluate(() => [...document.querySelectorAll('.cw-msg.sys')].some((m) => /4,000/.test(m.textContent)) || /4,000/.test(document.getElementById('coreNotice')?.textContent || ''));
  assert(capNote, 'no notice about the 4,000-character cap');
  await say('give me something slow'); await untilIdle(30000); await untilWindow(/slow one/);
  await until(() => ([...document.querySelectorAll('section.chatwin .cw-msg.jarvis')].pop()?.textContent.length ?? 0) > 1900, 'the long reply whole');
  const len = await page.evaluate(() => [...document.querySelectorAll('section.chatwin .cw-msg.jarvis')].pop()?.textContent.length);
  return { sent: asked[n].length, replied: len };
});

await check('configuration: tabs, copy icon, re-check, disconnect and reconnect', async () => {
  await fresh();
  await click('#openDrawer'); await untilDrawer(true);
  for (const t of ['voice', 'access', 'quick', 'connections']) { await click(`.tab[data-tab="${t}"]`); await until((x) => document.querySelector(`.tab[data-tab="${x}"]`).classList.contains('on'), `the ${t} tab`, 5000, t); }
  const tabs = await page.$$eval('.tab', (t) => t.map((x) => x.textContent));
  assert(tabs.join() === 'Connections,Voice,Access,Quick', 'tab order: ' + tabs.join());
  // the copy: a tick for a moment when the browser lets the page write the clipboard (headless Chrome may not)
  await click('#providers [data-act="copy"][data-id="openai"]');
  await until(() => /Copied|refused/.test(document.querySelector('#providers [data-act="copy"][data-id="openai"]')?.getAttribute('title') || ''), 'the copy to be tried', 5000);
  const copied = await page.evaluate(() => document.querySelector('#providers [data-act="copy"][data-id="openai"]').getAttribute('title'));
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => 'unreadable');
  await click('#providers [data-act="recheck"][data-id="openai"]'); // the button reads Checking, disabled, until the answer is back
  await until(() => { const b = document.querySelector('#providers [data-act="recheck"][data-id="openai"]'); return b && !b.disabled; }, 'the re-check to finish', 15000);
  await click('#providers [data-act="remove"][data-id="openai"]');
  await until(() => document.querySelector('#providers input[data-key="openai"]'), 'disconnect to show the key form', 5000);
  await page.type('#providers input[data-key="openai"]', 'sk-proj-' + 'Z9y8X7w6'.repeat(8));
  await click('#providers [data-act="save"][data-id="openai"]');
  await until(() => document.querySelector('#providers .provider.ready'), 'the reconnect', 15000);
  await click('#closeDrawer'); await untilDrawer(false);
  return { copied, clipStartsWith: String(clip).slice(0, 8) };
});

await check('thinking: the slider on the card sets how long the model thinks, kept over a reload; "think hard" asks for one question', async () => {
  await fresh();
  await click('#openDrawer'); await untilDrawer(true);
  await click('.tab[data-tab="connections"]');
  await until(() => document.querySelector('#providers input[data-effort="openai"]'), 'the thinking slider on the card');
  const rest = await page.evaluate(() => ({ value: document.querySelector('#providers input[data-effort="openai"]').value, lit: document.querySelector('#providers .sl-marks .on')?.textContent }));
  assert(rest.value === '0' && rest.lit === 'Quick', 'at rest: ' + JSON.stringify(rest));
  // the thumb sits over the middle of a word at every stop, the track ends inside the card, and the slider has the same room above and below it
  const fit = await page.evaluate(() => {
    const ctl = document.querySelector('#providers .ctl.effort'); const s = ctl.querySelector('.sl').getBoundingClientRect(); const c = ctl.getBoundingClientRect();
    const words = [...ctl.querySelectorAll('.sl-marks span')].map((w) => { const r = w.getBoundingClientRect(); return r.left + r.width / 2; });
    const thumbs = [0, 1, 2].map((v) => s.left + 5.5 + v * (s.width - 11) / 2);
    const k = ctl.querySelector('.ctl-k').getBoundingClientRect(), m = ctl.querySelector('.sl-marks').getBoundingClientRect();
    return { off: words.map((w, i) => Math.abs(w - thumbs[i])), inside: s.right <= c.right + 0.5 && s.left >= c.left - 0.5, above: s.top - k.bottom, below: m.top - s.bottom };
  });
  assert(fit.off.every((d) => d < 1) && fit.inside && Math.abs(fit.above - fit.below) < 1, 'slider not over its words, or uneven: ' + JSON.stringify(fit));
  const slide = (to) => page.evaluate((v) => { const s = document.querySelector('#providers input[data-effort="openai"]'); s.value = String(v); s.dispatchEvent(new Event('change', { bubbles: true })); }, to);
  await slide(2);
  await until(() => document.querySelector('#providers .sl-marks .on')?.textContent === 'Thorough' && document.querySelector('#providers input[data-effort="openai"]').value === '2', 'the card to show Thorough');
  await snap('thinking');
  await click('#closeDrawer'); await untilDrawer(false);
  const n = asked.length;
  await say('tell me something about owls'); await untilIdle();
  assert(efforts[n] === 'high', 'thorough was not asked of the model: ' + efforts[n]);
  await page.reload({ waitUntil: 'networkidle2' });
  await until(() => /m-(desk|compact)/.test(document.body.className) && /ChatGPT/.test(document.title), 'the console back after the reload');
  await click('#openDrawer'); await untilDrawer(true);
  await click('.tab[data-tab="connections"]');
  await until(() => document.querySelector('#providers input[data-effort="openai"]')?.value === '2', 'the choice kept over a reload');
  await slide(0);
  await until(() => document.querySelector('#providers .sl-marks .on')?.textContent === 'Quick', 'back to Quick');
  await click('#closeDrawer'); await untilDrawer(false);
  const m = asked.length;
  await say('think hard about this: what is two and two'); await untilIdle();
  await say('and one more thing about owls'); await untilIdle();
  assert(efforts[m] === 'high' && efforts[m + 1] === 'low', 'one question hard, the next quick: ' + JSON.stringify(efforts.slice(m)));
  return { rest, efforts: efforts.slice(n) };
});

await check('persistence: reload keeps threads, groups, active thread and title', async () => {
  await fresh();
  await say('new thread called Keep me'); await untilWindow(/keep me/);
  await say('remember this'); await untilIdle();
  await say('new group called Later'); await untilIdle(); await untilWs((w) => w.groups.some((g) => /later/i.test(g.title)), 'the Later group');
  await say('move Keep me into Later'); await untilIdle();
  await untilWs((w) => { const g = w.groups.find((x) => /later/i.test(x.title)); return g && w.threads.find((t) => /keep me/i.test(t.title))?.groupId === g.id; }, 'Keep me to be in Later');
  const before = await ws();
  await page.reload({ waitUntil: 'networkidle2' });
  await until(() => /m-(desk|compact)/.test(document.body.className) && document.querySelector('section.chatwin'), 'the board back after the reload');
  const after = await ws(); const b = await board();
  assert(after.threads.length === before.threads.length && after.groups.length === before.groups.length, 'counts changed on reload');
  assert(after.activeId === before.activeId, 'active thread changed');
  assert(b.windows.some((w) => /keep me/i.test(w.title)), 'Keep me not drawn after reload');
  await until(() => /ChatGPT/.test(document.title), 'the service to be remembered');
  return { threads: after.threads.length, groups: after.groups.length };
});

await check('phone: list layout, ask, no horizontal overflow', async () => {
  await fresh({ viewport: PHONE });
  await say('a phone question'); await untilIdle();
  await say('new thread called Pocket'); await untilWindow(/pocket/);
  await say('a line for it'); await untilIdle();
  const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, windows: document.querySelectorAll('section.chatwin').length, compact: document.body.className }));
  assert(/m-compact/.test(m.compact), 'not the phone layout: ' + m.compact);
  assert(!m.overflow, 'horizontal overflow on a phone');
  // Threads share the list's height by what they hold (stage.ts fitList): every one is limited to its own
  // content and keeps at least a few lines, so none is stretched past what it has to show.
  await until(() => [...document.querySelectorAll('section.chatwin')].every((w) => parseFloat(w.style.maxHeight) > 0), 'the phone list to size its threads', 5000);
  const fit = await page.evaluate(() => [...document.querySelectorAll('section.chatwin')].map((w) => ({ max: parseFloat(w.style.maxHeight), min: parseFloat(w.style.minHeight), h: w.getBoundingClientRect().height })));
  assert(fit.length && fit.every((f) => f.max > 0 && f.h <= f.max + 2 && f.h >= Math.min(150, f.max) - 2), 'phone threads not sized to their content: ' + JSON.stringify(fit));
  await snap('phone');
  return m;
});

await check('windows: fold and unfold by command, a letter opens the keyboard, Esc closes it', async () => {
  await fresh();
  await say('new thread called Foldy'); await untilWindow(/foldy/);
  await say('a line to fold'); await untilIdle();
  const id = await page.evaluate(() => [...document.querySelectorAll('section.chatwin')].find((w) => /foldy/i.test(w.querySelector('.cw-title')?.textContent))?.dataset.id);
  assert(id, 'no Foldy window');
  const bodyCount = (i) => page.evaluate((x) => document.querySelector(`section.chatwin[data-id="${x}"] .cw-body`).childElementCount, i);
  const foldedBefore = await bodyCount(id);
  await say('fold this thread'); await until((i) => document.querySelector(`section.chatwin[data-id="${i}"] .cw-body`).childElementCount === 0, 'the window to fold', 5000, id);
  const foldedByCmd = await bodyCount(id);
  await say('open up this thread'); await until((i) => document.querySelector(`section.chatwin[data-id="${i}"] .cw-body`).childElementCount > 0, 'the window to open', 5000, id);
  const reopened = await bodyCount(id);
  assert(foldedBefore > 0 && foldedByCmd === 0 && reopened > 0, `fold: ${foldedBefore} → ${foldedByCmd} → ${reopened}`);
  await page.keyboard.type('h');
  await until(() => document.getElementById('input').getBoundingClientRect().width > 0 && document.getElementById('input').value === 'h', 'a letter to open the keyboard with the letter in it', 5000);
  await page.keyboard.press('Escape');
  await until(() => document.getElementById('input').getBoundingClientRect().width === 0 || document.getElementById('input').value === '', 'Esc to close the keyboard', 5000);
  return { foldedBefore, foldedByCmd, reopened };
});

await check('voice commands: mute, unmute, switch to a service that is not connected', async () => {
  await fresh();
  await say('mute'); await until(() => !document.getElementById('voiceOut').checked, 'mute to take');
  await say('unmute'); await until(() => document.getElementById('voiceOut').checked, 'unmute to take');
  await say('switch to Gemini'); await untilNotice(/gemini/);
  const b = await board();
  assert(b.title.includes('ChatGPT'), 'switched to an unconnected service: ' + b.title + ' ' + JSON.stringify(await cores()));
  return { notice: b.notice };
});

await check('configuration: quick queries run, voice choice persists, the guide reopens from Connections', async () => {
  await fresh();
  await click('#openDrawer'); await untilDrawer(true);
  await click('.tab[data-tab="quick"]');
  const n = asked.length;
  await click('#quick [data-cmd="status"]'); await untilSaid(/load|percent|tolerance/);
  assert(asked.length === n, 'status went to the model');
  const statusLine = await coreSaid();
  await click('.tab[data-tab="voice"]');
  await until(() => document.querySelectorAll('#voiceSel option').length > 1, 'the voice list');
  const options = await page.evaluate(() => [...document.querySelectorAll('#voiceSel option')].map((x) => x.value).filter((v) => v.includes(':')));
  const pick = options.find((v) => v.startsWith('openai:') && !v.endsWith('fable')) ?? options[0];
  await page.select('#voiceSel', pick);
  await until((p) => localStorage.getItem('jarvis.voice.openai') === p.split(':')[1], 'the choice to be remembered for ChatGPT', 5000, pick);
  const remembered = await page.evaluate(() => localStorage.getItem('jarvis.voice.openai'));
  // The device's own voices stay on offer beside the service's, and the choice survives a reload.
  const device = options.find((v) => v.startsWith('device:'));
  assert(device !== undefined, 'no device voice listed while connected: ' + options.join(' '));
  await page.select('#voiceSel', device);
  await until((d) => document.getElementById('voiceSel').value === d && /this device/i.test(document.getElementById('voiceNote').textContent), 'the device voice to be taken', 5000, device);
  const onDevice = await page.evaluate(() => ({ value: document.getElementById('voiceSel').value, note: document.getElementById('voiceNote').textContent, sliders: !document.getElementById('pitchSl').closest('.ctl-row').hidden }));
  assert(onDevice.sliders, 'the device voice\'s sliders are hidden: ' + JSON.stringify(onDevice));
  await page.reload({ waitUntil: 'networkidle2' });
  await until(() => /m-(desk|compact)/.test(document.body.className), 'the console back after the reload');
  await until((d) => document.getElementById('voiceSel').value === d, 'the device voice remembered on reload', 10000, device);
  await click('#openDrawer'); await untilDrawer(true);
  await click('.tab[data-tab="voice"]');
  await page.select('#voiceSel', pick);
  await until((p) => document.getElementById('voiceSel').value === p, 'the service voice taken back', 5000, pick);
  await click('.tab[data-tab="connections"]');
  await click('#showSetup'); await untilGuide(true);
  const b = await board();
  assert(!b.drawerOpen, 'the drawer stayed open under the guide');
  await click('#setupSkip'); await untilGuide(false);
  return { statusLine: (statusLine || '').slice(0, 50), pick, remembered };
});

await check('deleting: a group and a thread for good, both behind a confirm', async () => {
  await fresh();
  await say('new group called Doomed'); await untilIdle(); await untilWs((w) => w.groups.some((g) => /doomed/i.test(g.title)), 'the Doomed group');
  await say('delete the Doomed group'); await untilConfirm(true);
  await click('#confirmAccept'); await untilWs((w) => !w.groups.some((g) => /doomed/i.test(g.title)), 'the group to go');
  await say('new thread called Gone'); await untilWindow(/^gone$/);
  await say('delete this thread permanently'); await untilConfirm(true);
  await click('#confirmAccept'); await untilWs((w) => !w.threads.some((t) => /^gone$/i.test(t.title)), 'the thread to go');
  const w = await ws();
  return { threads: w.threads.length, groups: w.groups.length };
});

results.push({ name: 'page errors', ok: pageErrors.length === 0, detail: pageErrors });
results.push({ name: 'console errors', ok: consoleErrors.length === 0, detail: consoleErrors.slice(0, 10) });
fs.writeFileSync(path.join(outDir, 'e2e-full.json'), JSON.stringify({ results, asked }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ms ? `  (${(r.ms / 1000).toFixed(1)}s)` : ''}${r.ok ? '' : '  —  ' + (typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail))}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
const passed = results.filter((r) => r.ok).length;
await browser.close(); server.close();
process.exit(passed === results.length ? 0 : 1);

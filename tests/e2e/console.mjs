/**
 * The console, end to end, in a real browser: the first-run guide, Configuration,
 * threads and groups, the model's directives, panels, the Threads list, error
 * paths, input edges, persistence across a reload, a phone. A fake OpenAI
 * answers over the network, so the real client code — key check, streaming,
 * Markdown, directives — runs as it would against the service.
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
const asked = [];    // every question the console sent, in order
// Every reply says where it belongs in its first words, as the real service is told to:
// conversation at the core, a follow-up in the thread in front, research in a thread of its own.
function replyFor(question) {
  const q = question.toLowerCase();
  if (q.includes('plan a trip')) return '[[at: core]] Certainly, sir: a thread for it.\n\n[[do: new_thread title="Lisbon" ask="What is the weather in Lisbon"]]';
  if (q.includes('weather in lisbon')) return '[[at: thread]] Mild and bright in Lisbon, sir: **21°** and clear.';
  if (q.includes('link them')) return '[[at: core]] Linked, sir.\n\n[[do: link_threads a="Lisbon" b="Journeys" why="travel"]]';
  if (q.includes('rename this')) return '[[at: core]] As you wish, sir.\n\n[[do: rename_thread title="Renamed by JARVIS"]]';
  if (q.includes('open access')) return '[[at: core]] Opening it, sir.\n\n[[do: open_config tab="access"]]';
  if (q.includes('naughty')) return '[[at: core]] Of course not, sir.\n\n[[do: rm -rf /]]\n[[do: delete_all]]\n[[do: new_thread title="<img src=x onerror=alert(1)>" ask="say hi"]]';
  if (q.includes('say hi')) return '[[at: thread]] Hello, sir.';
  if (q.includes('markdown')) return '[[at: new "Markdown report"]] ## Report\n\n- one\n- two\n  1. nested\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1;\n```\n\n<script>alert(1)</script> and <img src=x onerror=alert(2)>';
  if (q.includes('slow')) return '[[at: new "The slow one"]] ' + 'S'.repeat(2000) + '. Done, sir.';
  if (q.includes('follow up')) return '[[at: thread]] Following on, sir.';
  if (q.includes('no marker')) return 'Marked nowhere, sir.';
  return `[[at: core]] Noted, sir: “${question.slice(0, 40)}”. All well within tolerance.`;
}
const sse = (text) => { const parts = []; for (let i = 0; i < text.length; i += 9) parts.push(text.slice(i, i + 9)); return [
  `event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: 'r', object: 'response', status: 'in_progress', output: [] } })}\n\n`,
  ...parts.map((d) => `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: d })}\n\n`),
  `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'r', object: 'response', status: 'completed', output: [] } })}\n\n`].join(''); };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

const browser = await puppeteer.launch({ executablePath, headless: process.env.JARVIS_HEADED ? false : 'new', args: ['--hide-scrollbars', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], defaultViewport: { width: 1200, height: 800 } });
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
    if (u.includes('/v1/models')) return r.respond({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ object: 'list', data: [{ id: 'gpt-4.1-mini', object: 'model' }, { id: 'gpt-4.1', object: 'model' }] }) });
    if (u.includes('/v1/responses')) {
      let question = '';
      try { const b = JSON.parse(r.postData() || '{}'); const last = [...(b.input || [])].reverse().find((t) => t.role === 'user'); question = (last?.content || '').split('\n\n[')[0]; } catch {}
      asked.push(question);
      if (failNext && failLeft > 0) { failLeft--; const s = failNext; if (!failLeft) failNext = null; return r.respond({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ error: { message: s === 429 ? 'Rate limit reached, please try again later' : 'The server had an error' } }) }); }
      return r.respond({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(replyFor(question)) });
    }
    return r.respond({ status: 404, headers: cors, body: '{}' });
  }
  if (u.startsWith(base) || u.startsWith('http://127.0.0.1')) return r.continue();
  return r.abort();
});

/* ---------------- helpers ---------------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const say = async (text) => { await page.evaluate((t) => { const i = document.getElementById('input'); i.value = t; i.form.requestSubmit(); }, text); };
const untilIdle = async (timeout = 20000) => { await page.waitForFunction(() => !/Thinking|Searching/.test(document.getElementById('logState')?.textContent || '') && ![...document.querySelectorAll('section.chatwin .cw-msg.jarvis')].some((m) => /Thinking…|Searching the web…/.test(m.textContent)), { timeout }).catch(() => null); await wait(400); };
/** What JARVIS last said at the core (the line under him), whole. */
const coreSaid = () => page.evaluate(() => document.getElementById('coreSay')?.textContent || '');
const ws = () => page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.workspace') || '{}'));
const board = () => page.evaluate(() => ({
  windows: [...document.querySelectorAll('section.chatwin')].map((w) => ({ id: w.dataset.id, title: w.querySelector('.cw-title')?.textContent.trim(), msgs: w.querySelectorAll('.cw-msg').length, folded: w.querySelector('.cw-body')?.childElementCount === 0 })),
  groups: [...document.querySelectorAll('section.bubble')].map((b) => ({ gid: b.dataset.gid, title: b.querySelector('.bb-title')?.textContent.trim(), threads: b.querySelectorAll('section.chatwin').length, cls: b.className })),
  panels: [...document.querySelectorAll('.panel.float')].filter((p) => !p.hidden).map((p) => p.dataset.panel),
  toast: document.getElementById('toast')?.textContent,
  drawerOpen: document.getElementById('drawer').classList.contains('open'),
  activeTab: document.querySelector('.tab.on')?.textContent,
  guideOpen: !document.getElementById('setup').hidden,
  title: document.title,
}));
const results = [];
const check = async (name, fn) => { try { const detail = await fn(); results.push({ name, ok: true, detail }); } catch (e) { results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) }); } };
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const snap = (n) => page.screenshot({ path: path.join(outDir, `full-${n}.png`) });

/* ---------------- scenarios ---------------- */
await page.goto(base, { waitUntil: 'networkidle2', timeout: 60000 }); await wait(1500);

await check('guide: opens on a first visit at step 1', async () => { const b = await board(); assert(b.guideOpen, 'guide not open'); return await page.evaluate(() => document.getElementById('setupTitle').textContent); });
await check('guide: connect a key from the card, model picker, spare/use, permissions, done', async () => {
  await page.evaluate(() => document.getElementById('setupNext').click()); await wait(300);
  await page.type('#setupBody input[data-setup-key="openai"]', 'sk-proj-' + 'A1b2C3d4'.repeat(8));
  await page.evaluate(() => document.querySelector('#setupBody [data-setup-connect="openai"]').click());
  await page.waitForFunction(() => document.querySelector('#setupBody .provider.ready'), { timeout: 15000 });
  const models = await page.$$eval('#setupBody select[data-setup-model] option', (o) => o.map((x) => x.value));
  assert(models.includes('gpt-4.1'), 'model list missing');
  await page.select('#setupBody select[data-setup-model="openai"]', 'gpt-4.1'); await wait(600);
  const chosen = await page.evaluate(() => document.querySelector('#setupBody select[data-setup-model="openai"]')?.value);
  assert(chosen === 'gpt-4.1', 'model change did not stick: ' + chosen);
  const masked = await page.evaluate(() => document.querySelector('#setupBody .keyline .mask')?.textContent);
  assert(masked && masked.includes('…'), 'masked key missing: ' + masked);
  await page.evaluate(() => document.getElementById('setupNext').click()); await wait(500);
  const rows = await page.$$eval('#setupBody .switch-row', (r) => r.map((x) => x.querySelector('b').textContent));
  assert(rows.join() === 'Microphone,Location,Sound', 'rows: ' + rows.join());
  // flip the microphone on: the fake mic is granted without a prompt
  await page.evaluate(() => { const s = document.querySelector('#setupBody input[data-setup-perm="mic"]'); s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(1200);
  const mic = await page.evaluate(() => { const s = document.querySelector('#setupBody input[data-setup-perm="mic"]'); return { checked: s.checked, disabled: s.disabled }; });
  await page.evaluate(() => document.getElementById('setupNext').click()); await wait(300);
  await page.evaluate(() => document.getElementById('setupNext').click()); await wait(600);
  const b = await board(); assert(!b.guideOpen, 'guide still open'); assert(b.title.includes('ChatGPT'), 'title: ' + b.title);
  // Location and sound were left undone: the readiness card stays on the board, drawn like a thread,
  // counted as no thread; marking the two not needed sends it away by itself.
  assert(b.windows.length === 1 && /what j.a.r.v.i.s. needs/i.test(b.windows[0].title), 'no readiness card: ' + JSON.stringify(b.windows));
  const count = await page.evaluate(() => document.getElementById('pThreads').textContent);
  assert(count === '0', 'the card counted as a thread: ' + count);
  const cardRows = await page.$$eval('.chatwin[data-kind="setup"] .switch-row b', (r) => r.map((x) => x.textContent));
  assert(cardRows.join() === 'A service,Microphone,Location,Sound', 'card rows: ' + cardRows.join());
  for (let i = 0; i < 2; i++) { await page.evaluate(() => document.querySelector('.chatwin[data-kind="setup"] [data-ready="skip"]')?.click()); await wait(700); }
  const after = await board();
  assert(after.windows.length === 0, 'the card stayed after everything was set: ' + JSON.stringify(after.windows));
  return { chosen, masked, mic, done: await page.evaluate(() => localStorage.getItem('jarvis.setupDone')), cardRows };
});

await check('local commands: help, time, date, hi, status answer at the core, without a model or a thread', async () => {
  const before = asked.length;
  for (const c of ['help', 'what time is it', "what's the date", 'hello', 'status']) { await say(c); await wait(700); }
  const b = await board();
  const sysList = await page.evaluate(() => document.querySelectorAll('#coreChat .cw-msg.sys ul li').length);
  assert(asked.length === before, 'a local command went to the model');
  assert(b.windows.length === 0, 'a local command opened a thread');
  assert(sysList >= 10, 'help list items in the conversation: ' + sysList);
  assert(/tolerance|percent|load/i.test(await coreSaid()), 'status not said at the core: ' + await coreSaid());
  await say('close all panels'); await wait(400);
  return { windows: b.windows.length, helpItems: sysList };
});

await check('conversation: talk stays at the core, is kept, and is not a thread; a reply with no marker is the core too', async () => {
  const before = (await board()).windows.length;
  await say('how are you today'); await untilIdle();
  const said = await coreSaid();
  assert(/Noted, sir/.test(said), 'not answered at the core: ' + said);
  assert((await board()).windows.length === before, 'conversation opened a thread');
  await say('and with no marker'); await untilIdle();
  assert(/Marked nowhere/.test(await coreSaid()), 'a reply without a marker did not land at the core: ' + await coreSaid());
  assert((await board()).windows.length === before, 'a markerless reply opened a thread');
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.conversation') || '[]').map((l) => l.role + ':' + l.content.slice(0, 20)));
  assert(kept.some((l) => l.startsWith('user:how are you')) && kept.some((l) => l.startsWith('assistant:Noted')), 'transcript: ' + JSON.stringify(kept));
  // the model hears the recent conversation: the question sent carries what was said before it
  return { said: said.slice(0, 30), kept: kept.length };
});

await check('model: research opens its own thread, markdown renders, injection stays text, two quick questions answer in order at the core', async () => {
  await say('give me a markdown report'); await untilIdle();
  const b0 = await board();
  assert(b0.windows.length === 1 && /markdown report/i.test(b0.windows[0].title), 'no thread named by the model: ' + JSON.stringify(b0.windows));
  const md = await page.evaluate(() => { const w = document.querySelector('section.chatwin'); const b = w.querySelector('.cw-body'); return { table: b.querySelectorAll('table').length, li: b.querySelectorAll('li').length, pre: b.querySelectorAll('pre').length, scripts: b.querySelectorAll('script').length, imgs: b.querySelectorAll('img').length, scriptAsText: b.textContent.includes('<script>alert(1)</script>') }; });
  assert(md.table === 1 && md.li >= 3 && md.pre === 1, 'markdown: ' + JSON.stringify(md));
  assert(md.scripts === 0 && md.imgs === 0 && md.scriptAsText, 'injection: ' + JSON.stringify(md));
  const n = asked.length;
  await say('first quick one'); await say('second quick one');
  for (let i = 0; i < 60 && asked.length < n + 2; i++) await wait(250);
  await untilIdle(30000);
  const order = asked.slice(n);
  assert(order.length === 2 && order[0].includes('first') && order[1].includes('second'), 'order: ' + JSON.stringify(order));
  assert((await board()).windows.length === 1, 'a quick question opened a thread');
  await say('a follow up please'); await untilIdle();
  const w = await ws();
  assert(w.threads[0].turns.some((t) => /Following on/.test(t.content)), 'a follow-up did not land in the thread in front: ' + JSON.stringify(w.threads[0].turns.map((t) => t.content.slice(0, 20))));
  return { md, order };
});

await check('threads: new thread, subthread, group, move, collapse, expand, rename', async () => {
  await say('new thread called Travel'); await wait(800);
  let b = await board(); assert(b.windows.some((w) => /travel/i.test(w.title)), 'no Travel window');
  await say('branch off'); await wait(800);
  let w = await ws(); const travel = w.threads.find((t) => /travel/i.test(t.title)); const sub = w.threads.find((t) => t.parentId === travel?.id);
  assert(sub, 'no subthread of Travel');
  await say('new group called Trips'); await wait(800);
  b = await board(); assert(b.groups.some((g) => /trips/i.test(g.title)), 'no Trips group: ' + JSON.stringify(b.groups));
  await say('move Travel into Trips'); await wait(800);
  w = await ws(); const trips = w.groups.find((g) => /trips/i.test(g.title)); const travelNow = w.threads.find((t) => /travel/i.test(t.title));
  assert(trips && travelNow.groupId === trips.id, 'Travel not in Trips');
  await say('collapse Trips'); await wait(800);
  w = await ws(); assert(w.groups.find((g) => g.id === trips.id).collapsed === true, 'Trips not collapsed');
  await say('expand Trips'); await wait(800);
  w = await ws(); assert(!w.groups.find((g) => g.id === trips.id).collapsed, 'Trips still collapsed');
  await say('rename Travel to Journeys'); await wait(800);
  w = await ws(); assert(w.threads.some((t) => t.title === 'Journeys'), 'rename failed: ' + w.threads.map((t) => t.title).join('|'));
  // Folding one group never opens another: with the thread in front inside Trips and the only
  // other group folded, folding Trips leaves both folded (it used to move into Second and open it).
  await say('new group called Second'); await wait(600);
  await say('collapse Second'); await wait(500);
  await say('go to Journeys'); await wait(500);
  await say('collapse Trips'); await wait(800);
  w = await ws();
  const folded = w.groups.filter((g) => /trips|second/i.test(g.title)).map((g) => ({ title: g.title, collapsed: !!g.collapsed }));
  assert(folded.length === 2 && folded.every((g) => g.collapsed), 'folding one group opened another: ' + JSON.stringify(folded));
  await say('expand Trips'); await say('expand Second'); await wait(600);
  await snap('threads');
  return { threads: w.threads.length, groups: w.groups.length };
});

await check('directives from the model: new_thread with ask, link, rename, open_config; junk ignored', async () => {
  await say('go back to Journeys'); await wait(600);
  const n = asked.length;
  await say('plan a trip'); for (let i = 0; i < 80 && !asked.slice(n).some((q) => /weather in lisbon/i.test(q)); i++) await wait(250); await untilIdle(30000); await wait(800);
  let w = await ws();
  const lisbon = w.threads.find((t) => t.title === 'Lisbon');
  assert(lisbon, 'no Lisbon thread from directive: ' + w.threads.map((t) => t.title).join('|'));
  assert(asked.slice(n).some((q) => /weather in lisbon/i.test(q)), 'the new thread did not ask its question: ' + JSON.stringify(asked.slice(n)));
  assert(lisbon.turns.some((t) => t.role === 'assistant' && /21°/.test(t.content)), 'Lisbon not answered');
  await say('link them'); await untilIdle(); await wait(600);
  await say('rename this'); await untilIdle(); await wait(600);
  w = await ws(); assert(w.threads.some((t) => t.title === 'Renamed by JARVIS'), 'rename_thread directive failed: ' + w.threads.map((t) => t.title).join('|'));
  await say('open access'); await untilIdle(); await wait(600);
  let b = await board(); assert(b.drawerOpen && b.activeTab === 'Access', 'open_config: ' + JSON.stringify({ open: b.drawerOpen, tab: b.activeTab }));
  await page.evaluate(() => document.getElementById('closeDrawer').click()); await wait(300);
  const before = (await ws()).threads.length;
  await say('be naughty'); await untilIdle(30000); await wait(1500);
  w = await ws();
  const evil = w.threads.find((t) => t.title.includes('<img'));
  const asText = await page.evaluate(() => ({ imgs: document.querySelectorAll('section.chatwin img').length, titles: [...document.querySelectorAll('.cw-title')].map((t) => t.textContent) }));
  assert(asText.imgs === 0, 'a title became an element');
  assert(w.threads.length >= before, 'delete_all directive was obeyed');
  return { lisbonTurns: lisbon.turns.length, evilTitleKept: !!evil, threads: w.threads.length };
});

await check('panels: show radar, open weather, close all', async () => {
  await say('show the radar'); await wait(600);
  let b = await board(); assert(b.panels.includes('perimeter'), 'radar not open: ' + b.panels);
  await say('open the weather'); await wait(600);
  b = await board(); assert(b.panels.includes('environment'), 'weather not open: ' + b.panels);
  await say('close all panels'); await wait(600);
  b = await board(); assert(b.panels.length === 0, 'panels still open: ' + b.panels);
  return true;
});

await check('threads list: put away, restore, put all away, restore, tidy, delete everything with confirm', async () => {
  await say('close this chat'); await wait(800);
  let w = await ws(); const away = w.threads.filter((t) => t.archivedAt);
  assert(away.length >= 1, 'nothing put away');
  await say('show the threads'); await wait(800);
  let b = await board(); assert(b.panels.includes('threads'), 'threads panel not open');
  await page.evaluate(() => document.querySelector('.panel.float[data-panel="threads"] [data-act="restore"]')?.click()); await wait(800);
  w = await ws(); assert(w.threads.filter((t) => t.archivedAt).length === away.length - 1, 'restore from the list failed');
  await say('put all away'); await wait(800);
  w = await ws(); assert(w.threads.every((t) => t.archivedAt), 'not all put away');
  await say('restore Journeys'); await wait(800);
  w = await ws(); assert(w.threads.some((t) => t.title === 'Journeys' && !t.archivedAt), 'restore by name failed');
  await say('new thread called Second'); await wait(600);
  await say('tidy up'); await wait(800);
  await say('delete everything'); await wait(600);
  const dialog = await page.evaluate(() => !document.querySelector('.confirm-dialog')?.hidden && !!document.querySelector('.confirm-dialog'));
  assert(dialog, 'no confirm dialog for delete everything');
  await page.evaluate(() => document.getElementById('confirmCancel').click()); await wait(400);
  w = await ws(); assert(w.threads.length > 0, 'cancel did not keep the board');
  await say('delete everything'); await wait(600);
  await page.evaluate(() => document.getElementById('confirmAccept').click()); await wait(800);
  w = await ws();
  return { after: w.threads.length, groups: w.groups.length };
});

await check('error paths: 429 then 500 from the service give a friendly line, then it recovers', async () => {
  const untilAnswered = async () => { for (let i = 0; i < 80; i++) { const st = await page.evaluate(() => ({ busy: document.getElementById('logState')?.textContent })); if (st.busy !== 'Thinking' && st.busy !== 'Searching the web') break; await wait(250); } await wait(600); };
  failNext = 429; failLeft = 5; await say('are you there'); await untilAnswered();
  let last = await coreSaid();
  assert(/limit|busy|moment|try again/i.test(last || ''), '429 line: ' + last);
  failNext = 500; failLeft = 5; await say('still there'); await untilAnswered();
  last = await coreSaid();
  assert(last && !/Thinking/.test(last), '500 left it thinking: ' + last);
  await say('and now'); await untilAnswered();
  last = await coreSaid();
  assert(/Noted, sir/.test(last || ''), 'did not recover: ' + last);
  return { recovered: last.slice(0, 40) };
});

await check('input edges: empty, whitespace, 5000 characters cut to 4000 with a notice, a long reply', async () => {
  const n = asked.length;
  await say(''); await say('   '); await wait(400);
  assert(asked.length === n, 'empty input reached the model');
  await say('x'.repeat(5000)); await untilIdle(30000);
  assert(asked.length === n + 1 && asked[n].length === 4000, 'long input should be cut to 4000: ' + asked[n]?.length);
  const capNote = await page.evaluate(() => [...document.querySelectorAll('.cw-msg.sys')].some((m) => /4,000/.test(m.textContent)) || /4,000/.test(document.getElementById('toast')?.textContent || ''));
  assert(capNote, 'no notice about the 4,000-character cap');
  await say('give me something slow'); await untilIdle(30000); await wait(500);
  const len = await page.evaluate(() => [...document.querySelectorAll('section.chatwin .cw-msg.jarvis')].pop()?.textContent.length);
  assert(len > 1900, 'long reply cut: ' + len);
  assert((await board()).windows.some((w) => /slow one/i.test(w.title)), 'the long research reply did not get its thread');
  return { sent: asked[n].length, replied: len };
});

await check('configuration: tabs, copy icon, re-check, disconnect and reconnect', async () => {
  await page.evaluate(() => document.getElementById('openDrawer').click()); await wait(400);
  for (const t of ['voice', 'access', 'quick', 'connections']) { await page.evaluate((x) => document.querySelector(`.tab[data-tab="${x}"]`).click(), t); await wait(200); }
  const tabs = await page.$$eval('.tab', (t) => t.map((x) => x.textContent));
  assert(tabs.join() === 'Connections,Voice,Access,Quick', 'tab order: ' + tabs.join());
  await page.evaluate(() => document.querySelector('#providers [data-act="copy"][data-id="openai"]').click()); await wait(300);
  const copied = await page.evaluate(() => document.querySelector('#providers [data-act="copy"][data-id="openai"]').classList.contains('done'));
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => 'unreadable');
  await page.evaluate(() => document.querySelector('#providers [data-act="recheck"][data-id="openai"]').click()); await wait(1500);
  await page.evaluate(() => document.querySelector('#providers [data-act="remove"][data-id="openai"]').click()); await wait(800);
  const form = await page.evaluate(() => !!document.querySelector('#providers input[data-key="openai"]'));
  assert(form, 'disconnect did not show the key form');
  await page.type('#providers input[data-key="openai"]', 'sk-proj-' + 'Z9y8X7w6'.repeat(8));
  await page.evaluate(() => document.querySelector('#providers [data-act="save"][data-id="openai"]').click());
  await page.waitForFunction(() => document.querySelector('#providers .provider.ready'), { timeout: 15000 });
  await page.evaluate(() => document.getElementById('closeDrawer').click());
  return { copied, clipStartsWith: String(clip).slice(0, 8) };
});

await check('persistence: reload keeps threads, groups, active thread and title', async () => {
  await say('new thread called Keep me'); await wait(500); await say('remember this'); await untilIdle();
  await say('new group called Later'); await wait(500); await say('move Keep me into Later'); await wait(600);
  const before = await ws();
  await page.reload({ waitUntil: 'networkidle2' }); await wait(1500);
  const after = await ws(); const b = await board();
  assert(after.threads.length === before.threads.length && after.groups.length === before.groups.length, 'counts changed on reload');
  assert(after.activeId === before.activeId, 'active thread changed');
  assert(b.windows.some((w) => /keep me/i.test(w.title)), 'Keep me not drawn after reload');
  assert(b.title.includes('ChatGPT'), 'service not remembered: ' + b.title);
  return { threads: after.threads.length, groups: after.groups.length };
});

await check('phone: list layout, ask, no horizontal overflow', async () => {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.reload({ waitUntil: 'networkidle2' }); await wait(1500);
  await say('a phone question'); await untilIdle();
  const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, windows: document.querySelectorAll('section.chatwin').length, compact: document.body.className }));
  assert(!m.overflow, 'horizontal overflow on a phone');
  // Threads share the list's height by what they hold (stage.ts fitList): every one is limited to its own
  // content and keeps at least a few lines, so none is stretched past what it has to show.
  const fit = await page.evaluate(() => [...document.querySelectorAll('section.chatwin')].map((w) => ({ max: parseFloat(w.style.maxHeight), min: parseFloat(w.style.minHeight), h: w.getBoundingClientRect().height })));
  assert(fit.length && fit.every((f) => f.max > 0 && f.h <= f.max + 2 && f.h >= Math.min(150, f.max) - 2), 'phone threads not sized to their content: ' + JSON.stringify(fit));
  await snap('phone');
  await page.setViewport({ width: 1200, height: 800 }); await page.reload({ waitUntil: 'networkidle2' }); await wait(1000);
  return m;
});


await check('windows: fold and unfold by the title bar, fold by command, Esc stops the voice and closes the keyboard', async () => {
  await say('new thread called Foldy'); await wait(500); await say('a line to fold'); await untilIdle();
  const id = await page.evaluate(() => [...document.querySelectorAll('section.chatwin')].find((w) => /foldy/i.test(w.querySelector('.cw-title')?.textContent))?.dataset.id);
  assert(id, 'no Foldy window');
  const foldedBefore = await page.evaluate((i) => document.querySelector(`section.chatwin[data-id="${i}"] .cw-body`).childElementCount, id);
  await say('fold this thread'); await wait(700);
  const foldedByCmd = await page.evaluate((i) => document.querySelector(`section.chatwin[data-id="${i}"] .cw-body`).childElementCount, id);
  await say('open up this thread'); await wait(700);
  const reopened = await page.evaluate((i) => document.querySelector(`section.chatwin[data-id="${i}"] .cw-body`).childElementCount, id);
  assert(foldedBefore > 0 && foldedByCmd === 0 && reopened > 0, `fold: ${foldedBefore} → ${foldedByCmd} → ${reopened}`);
  await page.keyboard.type('h'); await wait(300);
  const kb = await page.evaluate(() => { const r = document.getElementById('input').getBoundingClientRect(); return r.width > 0 && document.getElementById('input').value === 'h'; });
  await page.keyboard.press('Escape'); await wait(300);
  const kbClosed = await page.evaluate(() => document.getElementById('input').getBoundingClientRect().width === 0 || document.getElementById('input').value === '');
  assert(kb, 'a letter did not open the keyboard with the letter in it');
  return { foldedBefore, foldedByCmd, reopened, kbOpenedByLetter: kb, kbClosedByEsc: kbClosed };
});

await check('voice commands: mute, unmute, switch to a service that is not connected', async () => {
  await say('mute'); await wait(500);
  const muted = await page.evaluate(() => !document.getElementById('voiceOut').checked);
  await say('unmute'); await wait(500);
  const unmuted = await page.evaluate(() => document.getElementById('voiceOut').checked);
  assert(muted && unmuted, `mute ${muted} unmute ${unmuted}`);
  await say('switch to Gemini'); await wait(800);
  const b = await board();
  assert(b.title.includes('ChatGPT'), 'switched to an unconnected service: ' + b.title);
  assert(/gemini/i.test(b.toast || ''), 'no word about Gemini not being connected: ' + b.toast);
  return { toast: b.toast };
});

await check('configuration: quick queries run, voice choice persists, the guide reopens from Connections', async () => {
  await page.evaluate(() => document.getElementById('openDrawer').click()); await wait(300);
  await page.evaluate(() => document.querySelector('.tab[data-tab="quick"]').click()); await wait(200);
  const n = asked.length;
  await page.evaluate(() => document.querySelector('#quick [data-cmd="status"]').click()); await wait(900);
  assert(asked.length === n, 'status went to the model');
  const statusLine = await coreSaid();
  assert(/load|percent|tolerance/i.test(statusLine || ''), 'status: ' + statusLine);
  await page.evaluate(() => document.querySelector('.tab[data-tab="voice"]').click()); await wait(200);
  const options = await page.evaluate(() => [...document.querySelectorAll('#voiceSel option')].map((x) => x.value).filter((v) => v.includes(':')));
  const pick = options.find((v) => v.startsWith('openai:') && !v.endsWith('fable')) ?? options[0];
  await page.select('#voiceSel', pick); await wait(500);
  const remembered = await page.evaluate(() => localStorage.getItem('jarvis.voice.openai'));
  // The device's own voices stay on offer beside the service's, and the choice survives a reload.
  const device = options.find((v) => v.startsWith('device:'));
  assert(device !== undefined, 'no device voice listed while connected: ' + options.join(' '));
  await page.select('#voiceSel', device); await wait(500);
  const onDevice = await page.evaluate(() => ({
    value: document.getElementById('voiceSel').value,
    note: document.getElementById('voiceNote').textContent,
    sliders: !document.getElementById('pitchSl').closest('.ctl-row').hidden,
  }));
  assert(onDevice.value === device && /this device/i.test(onDevice.note) && onDevice.sliders, 'device voice not taken: ' + JSON.stringify(onDevice));
  await page.reload({ waitUntil: 'networkidle2' }); await wait(1500);
  const kept = await page.evaluate(() => document.getElementById('voiceSel').value);
  assert(kept === device, 'device voice forgotten on reload: ' + kept);
  await page.evaluate(() => document.getElementById('openDrawer').click()); await wait(300);
  await page.evaluate(() => document.querySelector('.tab[data-tab="voice"]').click()); await wait(200);
  await page.select('#voiceSel', pick); await wait(500);
  assert((await page.evaluate(() => document.getElementById('voiceSel').value)) === pick, 'service voice not taken back');
  await page.evaluate(() => document.querySelector('.tab[data-tab="connections"]').click()); await wait(200);
  await page.evaluate(() => document.getElementById('showSetup').click()); await wait(400);
  const b = await board();
  assert(b.guideOpen && !b.drawerOpen, 'guide did not open from Connections');
  await page.evaluate(() => document.getElementById('setupSkip').click()); await wait(300);
  return { statusLine: (statusLine || '').slice(0, 50), pick, remembered };
});

await check('deleting: a group and a thread for good, both behind a confirm', async () => {
  await say('new group called Doomed'); await wait(600);
  await say('delete the Doomed group'); await wait(600);
  let dlg = await page.evaluate(() => !document.getElementById('confirmDialog').hidden);
  assert(dlg, 'no confirm for deleting a group');
  await page.evaluate(() => document.getElementById('confirmAccept').click()); await wait(700);
  let w = await ws(); assert(!w.groups.some((g) => /doomed/i.test(g.title)), 'group survived');
  await say('new thread called Gone'); await wait(500);
  await say('delete this thread permanently'); await wait(600);
  dlg = await page.evaluate(() => !document.getElementById('confirmDialog').hidden);
  assert(dlg, 'no confirm for deleting a thread for good');
  await page.evaluate(() => document.getElementById('confirmAccept').click()); await wait(700);
  w = await ws(); assert(!w.threads.some((t) => /^gone$/i.test(t.title)), 'thread survived');
  return { threads: w.threads.length, groups: w.groups.length };
});

results.push({ name: 'page errors', ok: pageErrors.length === 0, detail: pageErrors });
results.push({ name: 'console errors', ok: consoleErrors.length === 0, detail: consoleErrors.slice(0, 10) });
fs.writeFileSync(path.join(outDir, 'e2e-full.json'), JSON.stringify({ results, asked }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  —  ' + (typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail))}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
const passed = results.filter((r) => r.ok).length;
await browser.close(); server.close();
process.exit(passed === results.length ? 0 : 1);

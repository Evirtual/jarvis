/**
 * The first-run guide: three short steps for someone who has never seen the
 * console. Where it is running and what that means for their keys; connecting
 * a service, or not yet; and saying hello. Shown once, on a first visit with
 * nothing connected. Brought back from Configuration → Connections, or by
 * asking ("run setup", "show me the guide").
 */

import type { ProviderId } from "../shared/types.js";
import { PROVIDER_IDS } from "../shared/types.js";
import { PROVIDERS } from "../shared/services/index.js";
import { api } from "./api.js";
import { getAddress } from "./address.js";
import { $, esc, recall, store } from "./dom.js";
import { setDrawer } from "./drawer.js";
import { partOfDay } from "./local.js";
import { SERVERLESS } from "./server.js";
import { conn, voice } from "./state.js";
import { applyAddress } from "./voice-ui.js";

const DONE = "jarvis.setupDone";
const STEPS = ["Where you are", "Connect a service", "Say hello"] as const;

const root = $("setup");
const sheet = $("setupSheet");
const title = $("setupTitle");
const body = $("setupBody");
const dots = $("setupDots");
const back = $<HTMLButtonElement>("setupBack");
const skip = $<HTMLButtonElement>("setupSkip");
const next = $<HTMLButtonElement>("setupNext");

let step = 0;
/** The service whose key is being checked right now, if any. */
let checking: ProviderId | null = null;
const errors = new Map<ProviderId, string>();

/** Seen, or dismissed: it doesn't open again unasked. */
export function setupDone(): boolean { return recall(DONE) === "1"; }
export function markSetupDone(): void { store(DONE, "1"); }
export function setupOpen(): boolean { return !root.hidden; }

export function openSetup(): void {
  step = 0;
  errors.clear();
  root.hidden = false;
  requestAnimationFrame(() => root.classList.add("in"));
  render();
}

export function closeSetup(): void {
  if (root.hidden) return;
  markSetupDone();
  root.classList.remove("in");
  root.hidden = true;
}

/* ---------------- the steps ---------------- */

function whereYouAre(): string {
  return SERVERLESS
    ? `<p class="lead">This is the web version: a page in your browser, with no server behind it.</p>
       <p>Any key you connect is kept in this browser, on this device, and goes only to the service it belongs to. Nothing is sent anywhere else. The readings on the deck are what a browser can measure of this device.</p>
       <p>Add it to your home screen or install it and it opens like an app.</p>`
    : `<p class="lead">This is the PC version: the console's own server is running on this machine.</p>
       <p>Any key you connect is saved in <b>config.json</b> beside the server and never sent to the browser. JARVIS reads this machine's sensors and, when asked, sweeps your network.</p>`;
}

function providerCard(id: ProviderId): string {
  const meta = PROVIDERS[id];
  const ready = conn.readyIds().includes(id);
  const busy = checking === id;
  const err = errors.get(id);
  const head =
    `<div class="provider-head"><span class="dot"></span><span class="nm">${esc(meta.name)}</span>` +
    (meta.free ? `<span class="badge">Free tier</span>` : "") +
    (ready ? `<span class="spacer" style="flex:1"></span><span class="ok">Connected</span>` : "") +
    `</div>`;
  if (ready) {
    return `<div class="provider ready${conn.active === id ? " active" : ""}">${head}<p class="blurb">JARVIS answers, hears and speaks through ${esc(meta.name)}.</p></div>`;
  }
  return (
    `<div class="provider${err ? " bad" : ""}">${head}` +
    `<p class="blurb">${esc(meta.blurb)}</p><p class="cost">${esc(meta.cost)}</p>` +
    (err ? `<p class="err">${esc(err)}</p>` : "") +
    `<p class="blurb"><a href="${meta.keyUrl}" target="_blank" rel="noreferrer noopener">Get a key</a> — it ${esc(meta.keyHint.toLowerCase())} — and paste it here.</p>` +
    `<div class="row"><input class="field grow" type="password" data-setup-key="${id}" placeholder="${esc(meta.keyPrefix)}…" autocomplete="off" spellcheck="false" aria-label="${esc(meta.name)} API key">` +
    `<button class="btn primary" type="button" data-setup-connect="${id}"${busy ? " disabled" : ""}>${busy ? "Checking" : "Connect"}</button></div>` +
    `</div>`
  );
}

function connect(): string {
  const any = conn.anyReady;
  return (
    `<p class="lead">One key gives JARVIS everything: his answers, his hearing and his voice.</p>` +
    `<p>${any ? "He's connected. A second service is a spare for when the first is at its limit." : "Gemini's free tier is the quickest way in: no card, and it takes a minute."}</p>` +
    PROVIDER_IDS.map(providerCard).join("") +
    `<p class="hint">You can do this later in Configuration → Connections, or paste a key straight into the chat; it's kept, never sent to a model.</p>`
  );
}

function sayHello(): string {
  const address = getAddress();
  return (
    `<p class="lead">${conn.anyReady ? "Everything is ready." : "Nothing connected yet: he'll answer his built-in questions (status, the weather, the time) in this device's voice until a service is."}</p>` +
    `<div class="ctl"><span class="ctl-k"><span>Address me as</span></span>` +
    `<select class="sel" id="setupAddress" aria-label="How JARVIS addresses you"><option value="sir"${address === "sir" ? " selected" : ""}>Sir</option><option value="madam"${address === "madam" ? " selected" : ""}>Ma'am</option></select></div>` +
    `<button class="btn wide" type="button" id="setupVoice">Hear his voice</button>` +
    `<p>Tap <b>JARVIS</b>, the ring at the bottom, and speak; the first tap asks for the microphone. Any letter opens the keyboard. Type <b>help</b> for what he answers directly.</p>`
  );
}

function render(): void {
  title.textContent = STEPS[step] ?? "";
  dots.innerHTML = STEPS.map((_, i) => `<i${i === step ? ' class="on"' : ""}></i>`).join("");
  body.innerHTML = step === 0 ? whereYouAre() : step === 1 ? connect() : sayHello();
  back.hidden = step === 0;
  const last = step === STEPS.length - 1;
  skip.hidden = last;
  next.textContent = last ? "Done" : "Next";
  sheet.focus();
}

/* ---------------- what the steps do ---------------- */

async function saveKey(id: ProviderId): Promise<void> {
  const field = body.querySelector<HTMLInputElement>(`input[data-setup-key="${id}"]`);
  const key = field?.value.trim();
  if (!key) return;
  checking = id;
  errors.delete(id);
  render();
  try {
    await api.saveKey(id, key);
    await conn.refresh();
  } catch (err) {
    errors.set(id, err instanceof Error ? err.message : String(err));
  } finally {
    checking = null;
    render();
  }
}

body.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const connectBtn = target.closest<HTMLElement>("[data-setup-connect]");
  if (connectBtn) { void saveKey(connectBtn.dataset.setupConnect as ProviderId); return; }
  if (target.closest("#setupVoice")) {
    voice.markUserActed();
    voice.stop();
    voice.speak(`Good ${partOfDay()}, sir. All systems are online and at your disposal.`);
  }
});
body.addEventListener("keydown", (e) => {
  const field = (e.target as HTMLElement).closest<HTMLInputElement>("input[data-setup-key]");
  if (!field || e.key !== "Enter") return;
  e.preventDefault();
  void saveKey(field.dataset.setupKey as ProviderId);
});
body.addEventListener("change", (e) => {
  const sel = (e.target as HTMLElement).closest<HTMLSelectElement>("#setupAddress");
  if (sel) applyAddress(sel.value === "madam" ? "madam" : "sir");
});

back.addEventListener("click", () => { step = Math.max(0, step - 1); render(); });
skip.addEventListener("click", closeSetup);
next.addEventListener("click", () => {
  if (step === STEPS.length - 1) { closeSetup(); return; }
  step += 1;
  render();
});

// Brought back from Configuration → Connections.
$("showSetup").addEventListener("click", () => { setDrawer(false); openSetup(); });

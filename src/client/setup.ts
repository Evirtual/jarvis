/**
 * The first-run guide: four short steps for someone who has never seen the
 * console. Where it is running and what that means for their keys; connecting
 * a service and choosing its model, or not yet; what the browser will ask
 * for — the microphone, a location, sound on opening — each with its state
 * and the way to allow it; and saying hello. Shown once, on a first visit
 * with nothing connected. Brought back from Configuration → Connections, or
 * by asking ("run setup", "show me the guide").
 */

import type { ProviderId } from "../shared/types.js";
import { PROVIDER_IDS } from "../shared/types.js";
import { PROVIDERS } from "../shared/services/index.js";
import { api } from "./api.js";
import { getAddress } from "./address.js";
import { $, esc, recall, store } from "./dom.js";
import { setDrawer } from "./drawer.js";
import { partOfDay } from "./local.js";
import { locate } from "./sensors.js";
import { SERVERLESS } from "./server.js";
import { conn, voice } from "./state.js";
import { applyAddress } from "./voice-ui.js";

const DONE = "jarvis.setupDone";
const STEPS = ["Where you are", "Connect a service", "What he needs", "Say hello"] as const;
const NEEDS_STEP = 2;

/* ---------------- installing ----------------
 * The browser offers to install the console once, early, with an event the
 * page must keep to show its own button; installed, it opens like an app —
 * and an app may play sound the moment it opens.
 */
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
let installPrompt: InstallPrompt | null = null;
let installed = false;
export function offerInstall(e: Event): void {
  installPrompt = e as InstallPrompt;
  if (setupOpen() && step === NEEDS_STEP) render();
}
export function noteInstalled(): void {
  installed = true;
  installPrompt = null;
  if (setupOpen() && step === NEEDS_STEP) render();
}
const isApp = (): boolean => installed || matchMedia("(display-mode: standalone)").matches;

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
  const who = `<p class="lead">JARVIS is a console that talks back: ask him anything, by voice or by typing, and he answers, hears and speaks through a service you connect with your own key.</p>`;
  return SERVERLESS
    ? who + `<p>This is the web version, running entirely in your browser. A key you connect stays in this browser, on this device, and goes only to the service it belongs to; nothing is sent anywhere else. The readings on the deck are what a browser can measure of this device.</p>
       <p>Add it to your home screen, or install it, and it opens like an app.</p>`
    : who + `<p>This is the PC version: his own server runs on this machine. A key you connect is saved in <b>config.json</b> beside it and never sent to the browser. He reads this machine's sensors and, when asked, sweeps your network.</p>`;
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
    const active = conn.active === id;
    const m = conn.modelsOf(id);
    const models = m
      ? `<div class="ctl"><span class="ctl-k"><span>Model</span><span class="n">${m.models.length} available</span></span>` +
        `<select class="sel" data-setup-model="${id}" aria-label="${esc(meta.name)} model">` +
        m.models.map((x) => `<option value="${esc(x)}"${x === m.model ? " selected" : ""}>${esc(x)}</option>`).join("") +
        `</select></div>`
      : "";
    const use = active
      ? `<p class="blurb">JARVIS answers, hears and speaks through ${esc(meta.name)}.</p>`
      : `<div class="row"><p class="blurb grow">Connected, as a spare.</p><button class="btn" type="button" data-setup-use="${id}">Use ${esc(meta.name)}</button></div>`;
    return `<div class="provider ready${active ? " active" : ""}">${head}${use}${models}</div>`;
  }
  return (
    `<div class="provider${err ? " bad" : ""}">${head}` +
    `<p class="blurb">${esc(meta.blurb)}</p><p class="cost">${esc(meta.cost)}</p>` +
    (err ? `<p class="err">${esc(err)}</p>` : "") +
    `<p class="blurb"><a href="${meta.keyUrl}" target="_blank" rel="noreferrer noopener">Get a key</a> — it starts with <b>${esc(meta.keyPrefix)}</b> — and paste it here.</p>` +
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

/* ---------------- what he needs ---------------- */

type Need = "mic" | "geo";
const NEED_NAMES: Record<Need, PermissionName> = { mic: "microphone" as PermissionName, geo: "geolocation" as PermissionName };

/** The browser's word on a permission, where it will say; "unknown" where it won't (Firefox, for the microphone). */
async function permissionState(need: Need): Promise<PermissionState | "unknown"> {
  try {
    const p = await navigator.permissions.query({ name: NEED_NAMES[need] });
    // when the user answers the browser's own prompt, the row follows
    p.onchange = () => { if (setupOpen() && step === NEEDS_STEP) void paintNeeds(); };
    return p.state;
  } catch {
    return "unknown";
  }
}

function needRow(need: Need, name: string, how: string): string {
  return (
    `<div class="need" data-need="${need}"><div class="k"><b>${name}</b><p class="how">${how}</p><p class="err" hidden></p></div>` +
    `<span class="st">…</span><button class="btn" type="button" data-setup-perm="${need}">Allow</button></div>`
  );
}

function needs(): string {
  const sound = isApp() || voice.soundOnOpen === "yes";
  const soundHow = isApp()
    ? "Installed: he greets you aloud the moment the console opens."
    : sound
      ? "Sound is allowed here: he greets you aloud the moment the console opens."
      : "A browser plays nothing before your first tap, so on opening he greets you in writing. To hear it: install the console, or allow sound for this site — the lock icon by the address, Site settings, Sound — and reload.";
  const install = !isApp() && installPrompt ? `<button class="btn primary" type="button" id="setupInstall">Install the console</button>` : "";
  return (
    `<p class="lead">Three things the browser asks about. Each is yours to allow, and none is needed to type to him.</p>` +
    needRow("mic", "Microphone", "To talk to him. Tapping JARVIS asks for it too, the first time.") +
    needRow("geo", "Location", "For the weather where you stand, to a few streets. Without it he uses your connection's city.") +
    `<div class="need"><div class="k"><b>Sound when the console opens</b><p class="how">${soundHow}</p></div>` +
    `<span class="st${sound ? " ok" : ""}">${sound ? "Allowed" : "Blocked"}</span>${install}</div>`
  );
}

/** Fills in each permission's state from the browser, and hides the button once it is granted. */
async function paintNeeds(): Promise<void> {
  for (const need of ["mic", "geo"] as Need[]) {
    const row = body.querySelector<HTMLElement>(`.need[data-need="${need}"]`);
    if (!row) return;
    const state = await permissionState(need);
    const st = row.querySelector<HTMLElement>(".st")!;
    const btn = row.querySelector<HTMLButtonElement>("button")!;
    st.className = `st${state === "granted" ? " ok" : state === "denied" ? " bad" : ""}`;
    st.textContent = state === "granted" ? "Allowed" : state === "denied" ? "Blocked" : state === "prompt" ? "Not yet" : "";
    btn.hidden = state === "granted";
    const err = row.querySelector<HTMLElement>(".err")!;
    err.hidden = state !== "denied";
    if (state === "denied") err.textContent = "Blocked in the browser. Allow it from the lock icon by the address, then try again.";
  }
}

/** Asks the browser for one permission — its own prompt appears — and the row follows the answer. */
async function allow(need: Need): Promise<void> {
  const row = body.querySelector<HTMLElement>(`.need[data-need="${need}"]`);
  const err = row?.querySelector<HTMLElement>(".err");
  try {
    if (need === "mic") {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of stream.getTracks()) t.stop(); // asked only to be allowed; listening is a tap on JARVIS
    } else {
      locate(); // the browser asks, and the weather follows once it answers
    }
  } catch (e) {
    if (err) {
      err.hidden = false;
      err.textContent = e instanceof Error && e.name === "NotFoundError" ? "No microphone was found on this device." : "Blocked in the browser. Allow it from the lock icon by the address, then try again.";
    }
  }
  void paintNeeds();
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
  body.innerHTML = step === 0 ? whereYouAre() : step === 1 ? connect() : step === NEEDS_STEP ? needs() : sayHello();
  if (step === NEEDS_STEP) void paintNeeds();
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
  const useBtn = target.closest<HTMLElement>("[data-setup-use]");
  if (useBtn) { void api.setActive(useBtn.dataset.setupUse as ProviderId).then(() => conn.refresh()).then(render); return; }
  const permBtn = target.closest<HTMLElement>("[data-setup-perm]");
  if (permBtn) { void allow(permBtn.dataset.setupPerm as Need); return; }
  if (target.closest("#setupInstall") && installPrompt) {
    const p = installPrompt;
    installPrompt = null;
    void p.prompt().then(() => p.userChoice).then((c) => { if (c.outcome !== "accepted") installPrompt = p; render(); });
    return;
  }
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
  const model = (e.target as HTMLElement).closest<HTMLSelectElement>("select[data-setup-model]");
  if (model) void api.selectModel(model.dataset.setupModel as ProviderId, model.value).then(() => conn.refresh());
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

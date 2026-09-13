/**
 * The first-run guide: four short steps for someone who has never seen the
 * console. Where it is running and what that means for their keys; connecting
 * a service and choosing its model, or not yet; what the browser will ask
 * for — the microphone, a location — each with its state and the way to
 * allow it; and saying hello. Shown once, on a first visit
 * with nothing connected. Brought back from Configuration → Connections, or
 * by asking ("run setup", "show me the guide").
 */

import type { ProviderId } from "../shared/types.js";
import { PROVIDER_IDS } from "../shared/types.js";
import { PROVIDERS } from "../shared/services/index.js";
import { api } from "./api.js";
import { $ } from "./dom.js";
import { KEY, recall, store } from "./storage.js";
import { setDrawer } from "./drawer.js";
import { locate } from "./sensors.js";
import { SERVERLESS } from "./server.js";
import { conn, voice } from "./state.js";
import { COPY_ICON, TICK_ICON } from "./icons.js";
import { providerCard as card } from "./provider-card.js";

const STEPS = ["Where you are", "Connect a service", "What J.A.R.V.I.S. needs", "Say hello"] as const;
const NEEDS_STEP = 2;


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
export function setupDone(): boolean { return recall(KEY.setupDone) === "1"; }
export function markSetupDone(): void { store(KEY.setupDone, "1"); }
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
  placeVoiceControls(false);
  onClosed?.();
}

/** What happens when the guide is closed: the readiness card takes over what is left (readiness.ts). */
let onClosed: (() => void) | null = null;
export function setSetupClosed(f: () => void): void { onClosed = f; }

/** Called whenever the browser's word on a permission changes, wherever the rows are drawn. */
export const permissionWatchers: (() => void)[] = [];

/**
 * The voice settings are one set of controls (#voiceControls, Configuration →
 * Voice), wired once in voice-ui.ts. The guide's last step borrows the box
 * itself rather than copying it, and gives it back when the step is left.
 */
function placeVoiceControls(intoGuide: boolean): void {
  const box = document.getElementById("voiceControls");
  if (!box) return;
  const slot = body.querySelector<HTMLElement>("[data-setup-voice]");
  if (intoGuide && slot) slot.append(box);
  else if (!intoGuide) document.querySelector('.panel[data-pane="voice"]')?.append(box);
}

/* ---------------- the steps ---------------- */

function whereYouAre(): string {
  const who = `<p class="lead">J.A.R.V.I.S. is a console that talks back: ask anything, by voice or by typing, and it answers, hears and speaks through a service you connect with your own key.</p>
       <p>Tap the ring at the bottom to talk. To type, press any letter: the keyboard opens.</p>`;
  return SERVERLESS
    ? who + `<p>This is the web version: it runs entirely in your browser, and a key you connect stays here on this device.</p>
       <details class="disclose"><summary>More on keys and privacy</summary><div class="body">
       <p>A key goes only to the service it belongs to; nothing is sent anywhere else. The readings on the deck are what a browser can measure of this device. Installed, or added to your home screen, it opens like an app.</p></div></details>`
    : who + `<p>This is the PC version: the console's own server runs on this machine, and a key you connect stays there.</p>
       <details class="disclose"><summary>More on keys and privacy</summary><div class="body">
       <p>A key is saved in <b>config.json</b> beside the server and never sent to the browser. The server reads this machine's sensors and, when asked, sweeps your network.</p></div></details>`;
}

/** The same card as on Connections (provider-card.ts), for this guide: a connected service says so, a spare offers Use. */
function providerCard(id: ProviderId): string {
  const view = conn.viewOf(id) ?? { ...PROVIDERS[id], status: { state: "unconfigured" as const } };
  return card(view, { active: conn.active === id, busy: checking === id, error: errors.get(id) ?? null, hint: conn.hintOf(id), inGuide: true });
}

function connect(): string {
  const any = conn.anyReady;
  return (
    `<p class="lead">One key gives J.A.R.V.I.S. everything: answers, hearing and a voice.</p>` +
    `<p>${any ? "Connected. A second service is a spare for when the first is at its limit." : "Gemini's free tier is the quickest way in: no card, and it takes a minute."}</p>` +
    PROVIDER_IDS.map(providerCard).join("") +
    `<p class="hint">You can do this later in Configuration → Connections, or paste a key straight into the chat; it's kept, never sent to a model.</p>`
  );
}

/* ---------------- what JARVIS needs ---------------- */

type Need = "mic" | "geo";
const NEED_NAMES: Record<Need, PermissionName> = { mic: "microphone" as PermissionName, geo: "geolocation" as PermissionName };

/** The browser's word on a permission, where it will say; "unknown" where it won't (Firefox, for the microphone). */
async function permissionState(need: Need): Promise<PermissionState | "unknown"> {
  try {
    const p = await navigator.permissions.query({ name: NEED_NAMES[need] });
    // when the user answers the browser's own prompt, the rows follow — in the guide and in Configuration
    p.onchange = () => {
      if (setupOpen() && step === NEEDS_STEP) void paintNeeds(body);
      if (access.childElementCount) void paintNeeds(access);
      for (const f of permissionWatchers) f();
    };
    return p.state;
  } catch {
    return "unknown";
  }
}

function needRow(need: Need, name: string, how: string): string {
  // The same row as a Voice setting: a name, a line, a switch — on once the browser has said yes.
  return (
    `<label class="switch-row need" data-need="${need}"><span><b>${name}</b><small>${how}</small><small class="err" hidden></small></span>` +
    `<input type="checkbox" class="switch" data-setup-perm="${need}" aria-label="${name}"></label>`
  );
}

export function needs(): string {
  // Sound is the browser's to give, not the page's to ask for. The switch
  // shows whether it is on right now: from the moment the console opened, or
  // since the first click or key — the browser's rule for a tab — or not yet.
  const fromOpening = matchMedia("(display-mode: standalone)").matches || voice.soundOnOpen === "yes";
  const sinceClick = !fromOpening && (navigator.userActivation?.hasBeenActive || voice.acted);
  const on = fromOpening || sinceClick;
  const how = fromOpening
    ? "On from the moment the console opens: the greeting and every reply are spoken."
    : sinceClick
      ? "On since your first click. A browser tab starts with sound off until the first click or key, so on a reload the greeting is written and speech begins with your first click. To have it on from the moment the console opens: set Sound to Allow for this site in the browser's site settings, or install the console as an app."
      : "Off until your first click or key, which is the browser's rule for a tab. After that, everything is spoken.";
  return (
    needRow("mic", "Microphone", "To talk to J.A.R.V.I.S..") +
    needRow("geo", "Location", "For the weather where you are.") +
    `<label class="switch-row need" data-need="sound"><span><b>Sound</b><small>${how}</small></span>` +
    `<input type="checkbox" class="switch" disabled${on ? " checked" : ""} aria-label="Sound"></label>`
  );
}

/** Sets each switch from the browser: on and fixed once granted, off until then, with the way past a block. */
export async function paintNeeds(root: ParentNode): Promise<void> {
  for (const need of ["mic", "geo"] as Need[]) {
    const row = root.querySelector<HTMLElement>(`.need[data-need="${need}"]`);
    if (!row) return;
    const state = await permissionState(need);
    const sw = row.querySelector<HTMLInputElement>("input")!;
    sw.checked = state === "granted";
    sw.disabled = state === "granted"; // a page cannot give a permission back; the browser's own settings can
    const err = row.querySelector<HTMLElement>(".err")!;
    err.hidden = state !== "denied";
    if (state === "denied") err.textContent = "Blocked in the browser: allow it from the lock icon by the address.";
  }
}

/** Switched on: the browser asks with its own prompt, and the row follows the answer. */
async function allow(need: Need, root: ParentNode): Promise<void> {
  const row = root.querySelector<HTMLElement>(`.need[data-need="${need}"]`);
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
      err.textContent = e instanceof Error && e.name === "NotFoundError" ? "No microphone was found on this device." : "Blocked in the browser: allow it from the lock icon by the address.";
    }
  }
  void paintNeeds(root);
}

/** A switch in a set of rows was flipped on. */
export function needsChange(target: HTMLElement, root: HTMLElement): void {
  const sw = target.closest<HTMLInputElement>("input[data-setup-perm]");
  if (!sw) return;
  if (sw.checked) void allow(sw.dataset.setupPerm as Need, root);
  else void paintNeeds(root); // it cannot be switched off from here; the row shows what the browser says
}

/** The same rows in Configuration → Access, drawn afresh each time the drawer or the tab is opened. */
const access = $("accessNeeds");
function mountNeeds(root: HTMLElement): void {
  root.innerHTML = needs();
  void paintNeeds(root);
}

function sayHello(): string {
  return (
    `<p class="lead">${conn.anyReady ? "Everything is ready." : "Nothing connected yet: J.A.R.V.I.S. answers the built-in questions (status, the weather, the time) in this device's voice until a service is."}</p>` +
    `<div data-setup-voice></div>` + // the voice settings, the same box as Configuration → Voice (placeVoiceControls)
    `<p>Tap <b>J.A.R.V.I.S.</b>, the ring at the bottom, and speak; the first tap asks for the microphone. Any letter opens the keyboard. Type <b>help</b> for what is answered directly.</p>`
  );
}

function render(): void {
  title.textContent = STEPS[step] ?? "";
  dots.innerHTML = STEPS.map((_, i) => `<i${i === step ? ' class="on"' : ""}></i>`).join("");
  const last = step === STEPS.length - 1;
  placeVoiceControls(false); // before the step's markup is replaced, or the box would go with it
  body.innerHTML = step === 0 ? whereYouAre() : step === 1 ? connect() : step === NEEDS_STEP ? needs() : sayHello();
  if (step === NEEDS_STEP) void paintNeeds(body);
  if (last) placeVoiceControls(true);
  back.hidden = step === 0;
  skip.hidden = last;
  next.textContent = last ? "Done" : "Next";
  sheet.focus();
}

/* ---------------- what the steps do ---------------- */

async function saveKey(id: ProviderId): Promise<void> {
  const field = body.querySelector<HTMLInputElement>(`input[data-key="${id}"]`);
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

export function wireSetup(): void {
  // The same rows in Configuration → Access, drawn afresh each time the drawer or the tab is opened.
  access.addEventListener("change", (e) => { needsChange(e.target as HTMLElement, access); });
  $("openDrawer").addEventListener("click", () => mountNeeds(access));
  document.querySelector<HTMLElement>('.tab[data-tab="access"]')?.addEventListener("click", () => mountNeeds(access));

  body.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const connectBtn = target.closest<HTMLElement>('[data-act="save"]');
    if (connectBtn) { void saveKey(connectBtn.dataset.id as ProviderId); return; }
    const copyBtn = target.closest<HTMLElement>('[data-act="copy"]');
    if (copyBtn) {
      const key = api.keyOf(copyBtn.dataset.id as ProviderId);
      if (key) {
        void navigator.clipboard.writeText(key).then(() => { copyBtn.innerHTML = TICK_ICON; copyBtn.classList.add("done"); }).catch(() => undefined)
          .then(() => window.setTimeout(() => { copyBtn.innerHTML = COPY_ICON; copyBtn.classList.remove("done"); }, 1500));
      }
      return;
    }
    const useBtn = target.closest<HTMLElement>('[data-act="use"]');
    if (useBtn) { void api.setActive(useBtn.dataset.id as ProviderId).then(() => conn.refresh()).then(render); return; }
  });
  body.addEventListener("keydown", (e) => {
    const field = (e.target as HTMLElement).closest<HTMLInputElement>("input[data-key]");
    if (!field || e.key !== "Enter") return;
    e.preventDefault();
    void saveKey(field.dataset.key as ProviderId);
  });
  body.addEventListener("change", (e) => {
    needsChange(e.target as HTMLElement, body);
    const model = (e.target as HTMLElement).closest<HTMLSelectElement>("select[data-model]");
    if (model) void api.selectModel(model.dataset.model as ProviderId, model.value).then(() => conn.refresh());
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
}

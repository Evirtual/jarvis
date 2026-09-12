/**
 * J.A.R.V.I.S. Console — client entry point.
 *
 * Wires the pieces together:
 *   stage.ts      the core and the board of bubbles, threads and subthreads
 *   workspace.ts  what's on the board, as data (and its migrations)
 *   commands.ts   what the user and the reasoning core can ask the console to do
 *   voice.ts      speech in and out
 *   panels.ts     the glass instrument panels
 *
 * Every figure on screen is measured. Local commands answer from those live
 * readings; anything else goes to whichever service is connected, with a
 * snapshot of the console and the readings attached.
 */

import "./styles.css";

import { api } from "./api.js";
import { $ } from "./dom.js";
import { conn, graph, input, voice } from "./state.js";
import { applyMode, mode } from "./deck.js";
import { sys, toast } from "./say.js";
import { paintHosts, startReadings } from "./readings.js";
import { partOfDay } from "./local.js";
import { paintThread, refreshLinks } from "./threads.js";
import { renderVoiceSelect } from "./voice-ui.js";
import "./confirm.js";
import "./actions.js";
import "./ask.js";
import "./drawer.js";
import { SERVERLESS } from "./server.js";

/* ===================================================================== *
 * Boot
 * ===================================================================== */

// Installable as an app on a phone or desktop. The worker caches nothing (see
// public/sw.js); browsers only offer it on https or localhost.
if ("serviceWorker" in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* not installable here; everything still works */ });
}

// Published as a web page: the browser measures, and says what it measures.
if (SERVERLESS) {
  document.documentElement.classList.add("serverless");
  for (const el of document.querySelectorAll<HTMLElement>("[data-web]")) el.textContent = el.dataset.web!;
  for (const el of document.querySelectorAll<HTMLElement>("[data-web-label]")) el.setAttribute("aria-label", el.dataset.webLabel!);
}

applyMode();
paintThread();
// A greeting, but never a thread the user didn't ask for: on a clean screen it
// is simply said under the core.
const opening = `Good ${partOfDay()}, sir. Bringing the sensors up now.`;
if (!graph.active) toast(opening);
else if (!graph.active.turns.length) toast(opening);
refreshLinks(false);
if (mode === "desk") input.focus();
paintHosts();

/* ---------------------------------------------------------------------
 * Who speaks. On the PC, its own voice (Kokoro, run by the server). On the
 * web there is no server, so the connected service speaks — whichever is
 * answering — and its voices are the ones offered in Configuration → Voice.
 * --------------------------------------------------------------------- */

let announced = false;
async function pollStatus(): Promise<void> {
  try {
    const st = await api.status();
    if (!SERVERLESS) {
      voice.via = "kokoro";
      voice.setServerVoices(st.kokoro.voices, st.kokoro.state === "ready");
      renderVoiceSelect();
      if (!announced && st.kokoro.state !== "loading") {
        announced = true;
        sys(st.kokoro.state === "ready" ? "Neural voice online — Kokoro, on this PC." : "My own voice couldn't load — using this device's voices.");
      }
      // the voice loads at start: keep asking until it's in
      if (st.kokoro.state === "loading") setTimeout(() => void pollStatus(), 1500);
    }
  } catch {
    if (!SERVERLESS) sys("Console server unreachable.");
  }
}

conn.onChange = (c): void => {
  const name = conn.anyReady ? conn.activeName() : "none";
  $("openDrawer").classList.toggle("primary", !conn.anyReady);
  $("openDrawer").title = conn.anyReady ? "Configuration" : "Connect a service";
  document.title = `J.A.R.V.I.S. Console — ${name}`;
  // the service that answers is the one that hears
  voice.setServerTranscription(c.providers.some((p) => p.id === c.active && p.status.state === "ready" && p.status.hears));
  if (SERVERLESS) {
    const active = c.providers.find((p) => p.id === c.active);
    const ready = active?.status.state === "ready" ? active.status : null;
    const speaks = !!active && !!ready && ready.voices.length > 0;
    voice.via = speaks ? active.id : "kokoro";
    voice.setServerVoices(speaks ? ready.voices : [], speaks);
    renderVoiceSelect();
    if (!announced && speaks) {
      announced = true;
      sys(`Voice online — speaking through ${active.name}.`);
    }
  }
};

void pollStatus();
startReadings();
void conn.refresh().then(() => {
  if (!conn.anyReady) sys("No service connected — open Config and connect Gemini: it's free, and gives me my voice and hearing.");
});

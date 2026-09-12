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
import "./voice-ui.js";
import "./memory.js";
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
 * The service in use answers, hears, and offers its voices in
 * Configuration → Voice: connected to ChatGPT, ChatGPT's voices; to Gemini,
 * Gemini's. The device's own voice speaks unless one of them is chosen.
 * --------------------------------------------------------------------- */

conn.onChange = (c): void => {
  const name = conn.anyReady ? conn.activeName() : "none";
  $("openDrawer").classList.toggle("primary", !conn.anyReady);
  $("openDrawer").title = conn.anyReady ? "Configuration" : "Connect a service";
  document.title = `J.A.R.V.I.S. Console — ${name}`;
  const active = c.providers.find((p) => p.id === c.active);
  const ready = active?.status.state === "ready" ? active.status : null;
  voice.setServerTranscription(!!ready?.hears);
  for (const p of c.providers) {
    voice.setNeuralVoices(p.id, p.id === c.active && ready ? ready.voices : []);
  }
};

// On the PC the page is served by the console's own server: say so if it has gone.
if (!SERVERLESS) void api.status().catch(() => sys("Console server unreachable."));
startReadings();
void conn.refresh().then(() => {
  if (!conn.anyReady) sys("No service connected — open Config and connect Gemini: it's free, and gives me my voice and hearing.");
});

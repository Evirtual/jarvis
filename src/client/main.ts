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
 * readings; anything else goes to whichever reasoning core is connected, with
 * a snapshot of the console and the readings attached.
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

/* ===================================================================== *
 * Boot
 * ===================================================================== */

// Installable as an app on a phone or desktop. The worker caches nothing (see
// public/sw.js); browsers only offer it on https or localhost.
if ("serviceWorker" in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* not installable here; everything still works */ });
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


let announced = false;
async function pollStatus(): Promise<void> {
  try {
    const st = await api.status();
    voice.setServerVoices(st.voices, st.kokoro === "ready");
    voice.setServerTranscription(st.transcription);
    renderVoiceSelect();
    if (st.kokoro === "loading") { setTimeout(() => void pollStatus(), 1500); return; }
    if (!announced) {
      announced = true;
      if (st.kokoro === "ready") sys("Neural voice online — Kokoro-82M, local.");
      else sys("Neural voice unavailable — using browser voices.");
    }
  } catch {
    sys("Console server unreachable.");
  }
}

conn.onChange = (): void => {
  const name = conn.anyReady ? conn.activeName() : "none";
  $("openDrawer").classList.toggle("primary", !conn.anyReady);
  $("openDrawer").title = conn.anyReady ? "Configuration" : "Connect a service";
  document.title = `J.A.R.V.I.S. Console — ${name}`;
};

void pollStatus();
startReadings();
void conn.refresh().then(() => {
  if (!conn.anyReady) sys("No reasoning core connected — open Config to add one. Gemini is free.");
});

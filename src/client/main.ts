/**
 * J.A.R.V.I.S. Console — client entry point.
 *
 * The console is made of modules that each own one thing; none of them
 * runs anything when imported. Everything they need wired — the stage's
 * callbacks, the buttons, the voice — is wired here, in boot(), in one
 * order that can be read from top to bottom:
 *
 *   state.ts      the singletons — stage, workspace, panels, voice, connections
 *   threads.ts    what the stage reports back
 *   deck.ts, layout.ts, panels: the deck, the layout, the sheets
 *   voice-ui.ts   the tap on JARVIS, the keyboard, the voice controls
 *   ask.ts        the command line
 *   setup.ts, readiness.ts: the guide and the card
 *
 * Every figure on screen is measured. The console's own commands answer from
 * those live readings; anything else goes to the connected service, with a
 * snapshot of the console and the readings attached.
 */

import "./styles.css";
// Before anything reads: a setting kept under an older name is moved to its
// current one. Imported first, so it runs before the singletons are made.
import "./migrate-storage.js";

import { api } from "./api.js";
import { $ } from "./dom.js";
import { conn, graph, input, voice } from "./state.js";
import { applyMode, mode, wireLayout } from "./layout.js";
import { wireDeck } from "./deck.js";
import { notice } from "./say.js";
import { paintHosts, startReadings, wireReadings } from "./readings.js";
import { partOfDay } from "./local.js";
import { paintThread, wireBoard } from "./threads.js";
import { wireThreadsPanel } from "./threads-panel.js";
import { wireConversationPanel } from "./conversation-panel.js";
import { refreshLinks } from "./board-links.js";
import { wireVoiceUi } from "./voice-ui.js";
import { wireMemory } from "./memory.js";
import { wireConfirm } from "./confirm.js";
import { wireInput } from "./ask.js";
import { wireDrawer } from "./drawer.js";
import { wireRadarSplit } from "./radar-split.js";
import { wireReadiness } from "./readiness.js";
import { markSetupDone, openSetup, setupDone, wireSetup } from "./setup.js";
import { SERVERLESS } from "./server.js";

function boot(): void {
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

  // Asked before anything is clicked, while the answer can still be had.
  void voice.probeSoundOnOpen();

  /* ---- the wiring, in order: the board, its panels and deck, the layout, the voice, the input, the sheets ---- */
  wireBoard();
  wireMemory();
  wireThreadsPanel();
  wireConversationPanel();
  wireDeck();
  wireLayout();
  wireDrawer();
  wireConfirm();
  wireVoiceUi();
  wireInput();
  wireRadarSplit();
  wireReadings();
  wireSetup();
  wireReadiness();

  applyMode();
  paintThread();
  // A greeting, but never a thread the user didn't ask for: on a clean screen it
  // is simply said under the core.
  const opening = `Good ${partOfDay()}, sir. Bringing the sensors up now.`;
  const greeting = !graph.active?.turns.length;
  if (greeting) notice(opening, { speak: false });
  /**
   * Said aloud only where the browser lets sound start unasked — an installed
   * app, or a site allowed to play — and with a service's voice to say it.
   * A browser tab that withholds sound keeps it written; no click says it.
   */
  const greetAloud = (): void => {
    if (!greeting) return;
    void voice.canSoundNow().then((yes) => {
      if (!yes) return;
      voice.markUserActed();
      voice.speak(opening);
    });
  };
  refreshLinks(false);
  if (mode === "desk") input.focus();
  paintHosts();

  // The service in use answers, hears, and offers its voices in Configuration →
  // Voice: connected to ChatGPT, ChatGPT's voices; to Gemini, Gemini's. The
  // device's own voice speaks unless one of them is chosen.
  conn.onChange = (c): void => {
    $("openDrawer").classList.toggle("primary", !conn.anyReady);
    $("openDrawer").title = conn.anyReady ? "Configuration" : "Connect a service";
    document.title = conn.anyReady ? `J.A.R.V.I.S. Console — ${conn.activeName()}` : "J.A.R.V.I.S. Console";
    const active = c.providers.find((p) => p.id === c.active);
    const ready = active?.status.state === "ready" ? active.status : null;
    voice.setServerTranscription(!!ready?.hears);
    for (const p of c.providers) {
      voice.setNeuralVoices(p.id, p.id === c.active && ready ? ready.voices : []);
    }
  };

  // On the PC the page is served by the console's own server: say so if it has gone.
  if (!SERVERLESS) void api.status().catch(() => notice("Console server unreachable."));
  startReadings();
  void conn.refresh().then(() => {
    greetAloud(); // the service's voice is only known from here
    // A first visit with nothing connected gets the guide; someone already
    // connected has no need of it, and someone who closed it isn't nagged.
    if (conn.anyReady) markSetupDone();
    else if (!setupDone()) openSetup();
    else notice("No service connected — open Config and connect Gemini: it's free, and gives me my voice and hearing.");
  });
}

boot();

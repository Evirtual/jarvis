/**
 * Voice and keyboard: JARVIS as the microphone, the keyboard a keystroke
 * away, Esc, and the voice controls in Configuration.
 */

import { addressed, getAddress, setAddress, type Address } from "./address.js";
import { $, recall, store } from "./dom.js";
import { graph, input, panels, voice } from "./state.js";
import { announce, busy, paintCoreState, sys } from "./say.js";
import { answerConfirm, pendingConfirm } from "./confirm.js";
import { T } from "./readings.js";
import { submit } from "./ask.js";
import { closeMenus, menuOpen } from "./deck.js";
import { setDrawer } from "./drawer.js";
import { closeSetup, setupOpen } from "./setup.js";

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // Whatever is on top goes first, in the order they stack on screen: the
  // confirmation (Esc means "no") over everything, then the setup guide, the
  // configuration drawer, the deck's menus, the web, the keyboard, the front panel.
  if (pendingConfirm) { const note = answerConfirm(false); if (note) announce(note); return; }
  if (setupOpen()) { closeSetup(); return; }
  if ($("drawer").classList.contains("open")) { setDrawer(false); return; }
  if (menuOpen()) { closeMenus(); return; }
  if (graph.closeWeb()) return;
  if (typing_) { showKeyboard(false); return; }
  if (panels.closeTop()) return;
  voice.stop();
});

/* ===================================================================== *
 * Voice wiring
 * ===================================================================== */

// Feed the core from the real waveform every frame.
// Started on the next frame, once every module has loaded.
requestAnimationFrame(function pumpGlobe(): void {
  graph.amplitude = voice.amplitude;
  graph.activity = busy ? "thinking" : voice.listening ? "listening" : voice.speaking ? "speaking" : "idle";
  // Read through a call: this loop is scheduled, not immediate, but control-flow
  // analysis sees the IIFE run while T is still null and would narrow to never.
  const cur = T;
  if (cur) {
    graph.cpuLoad = (cur.cpu?.avg ?? 0) / 100;
    graph.gpuLoad = (cur.gpu?.utilPct ?? 0) / 100;
  }
  requestAnimationFrame(pumpGlobe);
});

voice.onNotice = sys;
// A tap to talk with nothing connected and no dictation in this browser would
// otherwise be a six-second line and nothing more. The way to fix it opens.
voice.onCannotHear = (): void => setDrawer(true, "connections");
voice.onState = (): void => {
  paintCoreState();
  const note = $("voiceNote");
  const d = voice.describe();
  note.className = d.warn ? "hint warn" : "hint";
  note.textContent = d.text;
  renderVoiceSelect();
  // Timbre and cadence shape the device's own voice. A service's voice has a
  // timbre of its own and takes a pace only in three words, so with one chosen
  // the sliders are put away rather than left looking like they work.
  const neural = voice.selection?.kind === "neural";
  const sliders = $<HTMLInputElement>("pitchSl").closest<HTMLElement>(".ctl-row");
  if (sliders) sliders.hidden = neural;
};
// Painted once on the next frame, when every module has loaded: a browser with
// no voices of its own and nothing connected would otherwise never say so.
requestAnimationFrame(() => voice.onState?.());
voice.onRecognised = (text, final): void => {
  if (typing_) { input.value = text; return; }
  if (final && text) setTimeout(() => submit(text), 120);
};

/* ---------------------------------------------------------------------
 * Voice first. JARVIS is the button: tap him and he listens. The keyboard
 * is always a keystroke away, and can be made the default tap instead.
 * --------------------------------------------------------------------- */

export let typing_ = false;
export let tapSpeaks = recall("jarvis.tapSpeaks") !== "0";

export function showKeyboard(on: boolean): void {
  typing_ = on;
  $("cmdForm").hidden = !on;
  $("keyBtn").classList.toggle("on", on);
  if (on) {
    voice.stop();
    input.value = "";
    input.focus();
  } else {
    input.value = "";
    input.blur();
  }
}

function setTapSpeaks(on: boolean): void {
  tapSpeaks = on;
  store("jarvis.tapSpeaks", on ? "1" : "0");
  $<HTMLInputElement>("tapSpeaks").checked = on;
  $("keyBtn").title = on ? "Type instead" : "Typing is the default — tap J.A.R.V.I.S. to type";
}

// Tap JARVIS: listen (or open the keyboard, if that's your default). A tap
// while he's speaking cuts him off instead.
graph.onCoreTap = (): void => {
  voice.markUserActed();
  if (voice.speaking && !voice.listening) { voice.stop(); return; }
  if (!tapSpeaks) { showKeyboard(!typing_); return; }
  if (typing_ && !input.value) showKeyboard(false);
  voice.toggleListen();
};

$("keyBtn").addEventListener("click", () => showKeyboard(!typing_));
$<HTMLInputElement>("tapSpeaks").addEventListener("change", (e) => setTapSpeaks((e.target as HTMLInputElement).checked));
setTapSpeaks(tapSpeaks);

// Any letter opens the keyboard and goes into it, so typing never needs a target.
document.addEventListener("keydown", (e) => {
  if (typing_ || e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement as HTMLElement | null;
  if (el && /^(input|textarea|select)$/i.test(el.tagName)) return;
  if (e.key.length !== 1 || e.key === " ") return;
  showKeyboard(true);
  input.value = e.key === "/" ? "" : e.key;
  e.preventDefault();
});

// Spoken replies are on unless you turn them off, and the choice is remembered.
/* How JARVIS addresses you — sir by default, ma'am if you'd rather. */
const addressSel = $<HTMLSelectElement>("addressSel");
export function applyAddress(a: Address): void {
  setAddress(a);
  addressSel.value = a;
  $("prompt").textContent = addressed("SIR ›");
}
applyAddress(getAddress());
addressSel.addEventListener("change", () => {
  applyAddress(addressSel.value === "madam" ? "madam" : "sir");
  voice.markUserActed();
  announce("Very good, sir.");
});

const voiceOut = $<HTMLInputElement>("voiceOut");
export function setVoiceOut(on: boolean): void {
  voice.enabled = on;
  voiceOut.checked = on;
  store("jarvis.voiceOn", on ? "1" : "0");
  if (!on) voice.stop();
}
setVoiceOut(recall("jarvis.voiceOn") !== "0");
voiceOut.addEventListener("change", () => setVoiceOut(voiceOut.checked));

/* Listening: how long a pause ends it, or whether only a tap does. Both
   remembered; the pause slider is put away while stopping is by hand. */
const manualStop = $<HTMLInputElement>("manualStop");
const pauseSl = $<HTMLInputElement>("pauseSl");
function applyListening(): void {
  const pause = Math.min(6, Math.max(1, Number(pauseSl.value) || 2));
  voice.setListening(pause, manualStop.checked);
  $("pauseN").textContent = `${pause.toFixed(1)} s`;
  $("pauseCtl").hidden = manualStop.checked;
  store("jarvis.listenPause", String(pause));
  store("jarvis.manualStop", manualStop.checked ? "1" : "0");
}
{
  const saved = Number.parseFloat(recall("jarvis.listenPause") ?? "");
  if (saved >= 1 && saved <= 6) pauseSl.value = String(saved);
  manualStop.checked = recall("jarvis.manualStop") === "1";
  applyListening();
}
manualStop.addEventListener("change", applyListening);
pauseSl.addEventListener("input", applyListening);

/* ---------------------------------------------------------------------
 * The voice list: the AI voices of the service in use, then the device's
 * own — always on offer, since a phone's voices answer at once and some
 * prefer them. Rebuilt whenever the voice's state changes (onState).
 * --------------------------------------------------------------------- */

const voiceSel = $<HTMLSelectElement>("voiceSel");
function renderVoiceSelect(): void {
  const want = voice.selectionValue;
  const groups: { label: string; options: { value: string; text: string }[] }[] = [];
  const neural = voice.neuralVoices();
  for (const via of new Set(neural.map((n) => n.via))) {
    groups.push({
      label: `AI voices · ${voice.sourceLabel(via)}`,
      options: neural.filter((n) => n.via === via).map((n) => ({ value: `${via}:${n.voice.id}`, text: `${n.voice.name}  ·  ${n.voice.note}` })),
    });
  }
  if (voice.deviceSpeaks) {
    groups.push({
      label: neural.length ? "This device" : "This device · until a service is connected",
      // a browser that won't name its voices (Brave) still speaks with its default
      options: voice.systemVoices.length
        ? voice.systemVoices.map((v) => ({ value: `device:${v.name}`, text: voice.labelFor(v) }))
        : [{ value: "device:", text: "This device's voice" }],
    });
  }
  const shape = JSON.stringify(groups);
  if (voiceSel.dataset.shape === shape && voiceSel.value === want) return;
  voiceSel.replaceChildren();
  for (const g of groups) {
    const el = document.createElement("optgroup");
    el.label = g.label;
    for (const o of g.options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.text;
      el.append(opt);
    }
    voiceSel.append(el);
  }
  voiceSel.value = want;
  voiceSel.dataset.shape = shape;
}
voiceSel.addEventListener("change", () => {
  if (!voice.select(voiceSel.value)) return;
  voice.markUserActed();
  voice.stop();
  voice.speak("Voice profile set, sir.");
});

const pitchSl = $<HTMLInputElement>("pitchSl");
const rateSl = $<HTMLInputElement>("rateSl");
pitchSl.value = String(voice.pitchValue);
rateSl.value = String(voice.rateValue);
$("pitchN").textContent = voice.pitchValue.toFixed(2);
$("rateN").textContent = voice.rateValue.toFixed(2);
pitchSl.addEventListener("input", () => {
  voice.setPitch(Number(pitchSl.value));
  $("pitchN").textContent = voice.pitchValue.toFixed(2);
});
/** The Cadence: a value within the slider's range, shown on it and kept. Returns what was set. */
export function setRate(value: number): number {
  const next = Math.max(0.7, Math.min(1.3, value));
  voice.setRate(next);
  rateSl.value = String(next);
  $("rateN").textContent = next.toFixed(2);
  return next;
}
rateSl.addEventListener("input", () => setRate(Number(rateSl.value)));
$("testVoice").addEventListener("click", () => {
  voice.markUserActed();
  voice.stop();
  voice.speak("All systems are online and operating within normal parameters, sir.");
});


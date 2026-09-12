/**
 * Speech, in and out.
 *
 * Out: the device's own voice by default, or — chosen in Configuration →
 * Voice — a neural voice made by the connected service. Replies are split
 * into sentences, synthesised in parallel, decoded, and scheduled
 * back-to-back on the audio clock: one continuous voice, with the first
 * sentence playing while the rest are still being made.
 *
 * In: the page records the microphone and the connected service turns it
 * into text. That avoids Chrome's dictation, which quietly depends on
 * Google's speech service (and which Brave doesn't have). Dictation remains
 * as a fallback, and the text field always works.
 */

import type { ProviderId, VoiceOption } from "../shared/types.js";
import { PROVIDER_IDS } from "../shared/types.js";
import { PROVIDERS, SPEECH_RATE } from "../shared/services/index.js";
import { api } from "./api.js";
import { addressed } from "./address.js";
import { recall, store } from "./dom.js";

/** "<source>:<id>" back into a selection, or null for anything else. */
function parseSelection(value: string): Selection | null {
  const at = value.indexOf(":");
  if (at < 0) return null;
  const source = value.slice(0, at), id = value.slice(at + 1);
  // "system:" is how a device voice was remembered before it was called one
  if (source === "device" || source === "system") return { kind: "device", name: id || null };
  if (id && (PROVIDER_IDS as readonly string[]).includes(source)) return { kind: "neural", via: source as ProviderId, id };
  return null;
}

const GB_MALE = /(george|ryan|thomas|oliver|arthur|daniel|james|brian|guy|edward|male)/i;
const FEMALE = /(zira|hazel|susan|libby|sonia|maisie|olivia|female|samantha|karen|moira|tessa|fiona|catherine|aria|jenny)/i;
const NOVELTY = /(novelty|whisper|zarvox|trinoids|bells|bad news|good news|cellos|organ|bubbles|boing|jester|superstar|wobble|rocko|shelley|grandma|grandpa|eddy|flo|sandy|reed|junior|albert|fred|ralph|kathy|princess|deranged|hysterical|bahh)/i;

function scoreVoice(v: SpeechSynthesisVoice): number {
  let s = 0;
  const lang = String(v.lang || "").replace("_", "-");
  const n = String(v.name || "");
  if (/^en-GB/i.test(lang)) s += 120;
  else if (/^en-(IE|AU|NZ|ZA)/i.test(lang)) s += 55;
  else if (/^en/i.test(lang)) s += 15;
  else s -= 400;
  if (GB_MALE.test(n)) s += 45;
  if (FEMALE.test(n)) s -= 65;
  if (/natural|neural|online/i.test(n)) s += 35;
  if (NOVELTY.test(n)) s -= 400;
  return s;
}

function shortName(v: SpeechSynthesisVoice): string {
  return v.name
    .replace(/^(Microsoft|Google|Apple)\s+/i, "")
    .replace(/\s*[-–]\s*English.*$/i, "")
    .replace(/\s*\((Natural|Enhanced|Premium)\)\s*/i, " ✦ ")
    .trim();
}

const AudioCtor = (): typeof AudioContext | undefined =>
  window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;


/** When the browser can't take dictation (Brave has none; Chrome's needs Google's service). */
const NO_DICTATION = "This browser can't take dictation, sir. Connect Gemini or ChatGPT in Configuration and I'll hear you through it — or type instead.";

/** Below this a sample counts as silence. */
const QUIET = 0.01;

/** Where the speech starts in a run of samples, keeping 30 ms so no word is clipped. */
function speechStart(d: Float32Array): number {
  let a = 0;
  while (a < d.length && Math.abs(d[a]!) < QUIET) a++;
  return a >= d.length ? 0 : Math.max(0, a - Math.floor(SPEECH_RATE * 0.03));
}

/** Where the speech ends in a run of samples, keeping 60 ms after it. */
function speechEnd(d: Float32Array): number {
  let b = d.length - 1;
  while (b > 0 && Math.abs(d[b]!) < QUIET) b--;
  return b <= 0 ? d.length : Math.min(d.length, b + Math.floor(SPEECH_RATE * 0.06));
}

/** 16-bit little-endian samples as floats. */
function toFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

function joinFloat32(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** A neural voice, and the connected service that makes it. */
export interface NeuralVoice {
  via: ProviderId;
  voice: VoiceOption;
}

/**
 * What speaks: one of the connected service's neural voices, or one of the
 * device's own. A device voice with no name is the browser's default — always
 * there, even in a browser that won't list its voices by name (Brave).
 */
export type Selection =
  | { kind: "neural"; via: ProviderId; id: string }
  | { kind: "device"; name: string | null };

/** How long a refused neural voice is left alone before it is asked again. */
const REST_MS = 10 * 60 * 1000;

export class Voice {
  enabled = true;
  listening = false;
  transcribing = false;
  speaking = false;
  private userActed = false;
  private pitch = 0.78;
  private rate = 0.96;

  private synth: SpeechSynthesis | null = window.speechSynthesis ?? null;
  /** The device voice in use — or the one to fall back to — when the browser names its voices; null means its default. */
  private systemVoice: SpeechSynthesisVoice | null = null;
  private systemList: SpeechSynthesisVoice[] = [];
  /** The neural voices available right now, by the service that makes them. */
  private neural = new Map<ProviderId, VoiceOption[]>();
  private chosen: Selection | null = null;
  /**
   * Set when the chosen neural voice was refused (a spent allowance, no
   * credit): why, and until when the device's voice speaks instead. Cleared
   * by the next line the service does speak.
   */
  private resting: { until: number; reason: string } | null = null;

  private seq = 0;

  /* one audio graph for the whole session */
  private actx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private bins: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(128));
  private sources: AudioBufferSourceNode[] = [];

  /** Real signal level, 0-1, from whichever audio is live right now. */
  amplitude = 0;

  /* input */
  private serverStt = false;
  private recog: SpeechRecognition | null = null;
  private micStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private vadTimer: number | null = null;

  onState: (() => void) | null = null;
  onNotice: ((msg: string) => void) | null = null;
  onRecognised: ((text: string, final: boolean) => void) | null = null;

  constructor() {
    const p = Number.parseFloat(recall("jarvis.pitch") ?? "");
    const r = Number.parseFloat(recall("jarvis.rate") ?? "");
    if (p >= 0.4 && p <= 1.2) this.pitch = p;
    if (r >= 0.7 && r <= 1.3) this.rate = r;
    this.initRecognition();
    this.watchSystemVoices();
    this.pumpAmplitude();
  }

  get pitchValue(): number { return this.pitch; }
  get rateValue(): number { return this.rate; }
  get selection(): Selection | null { return this.chosen; }
  /** The device's voices the browser names, the most JARVIS-like first — empty where it names none. */
  get systemVoices(): SpeechSynthesisVoice[] { return this.systemList; }
  /** Whether the device can speak at all. */
  get deviceSpeaks(): boolean { return this.synth !== null; }
  get micAvailable(): boolean {
    return (this.serverStt && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined") || this.recog !== null;
  }

  setPitch(v: number): void { this.pitch = v; store("jarvis.pitch", String(v)); }
  setRate(v: number): void { this.rate = v; store("jarvis.rate", String(v)); }
  markUserActed(): void { this.userActed = true; }

  /** Turn on recorded-and-heard input when a connected service can hear. */
  setServerTranscription(on: boolean): void {
    if (this.serverStt === on) return;
    this.serverStt = on;
    this.onState?.();
  }

  /* ---------------- which voice ----------------
   *
   * The device's own voice is the default — instant, and free. A connected
   * service's neural voice is used only when chosen in Configuration → Voice.
   * A choice is remembered as "<source>:<id>" ("device:<name>", or "device:"
   * for the browser's default) and holds whenever that source is there.
   */

  /** The voices one service can speak with now — an empty list when it has gone. */
  setNeuralVoices(via: ProviderId, list: VoiceOption[]): void {
    if (list.length) this.neural.set(via, list);
    else this.neural.delete(via);
    this.choose();
  }

  /** Every neural voice available. */
  neuralVoices(): NeuralVoice[] {
    return PROVIDER_IDS.flatMap((via) => (this.neural.get(via) ?? []).map((voice) => ({ via, voice })));
  }

  /** The browser's own voices, English first, the most JARVIS-like at the top. Some browsers hand them over a moment after the page loads. */
  private watchSystemVoices(): void {
    this.synth?.addEventListener("voiceschanged", () => this.refreshSystemList());
    let tries = 0;
    const poll = (): void => {
      this.refreshSystemList();
      if (!this.systemList.length && ++tries < 20) window.setTimeout(poll, 300);
    };
    poll();
  }

  private refreshSystemList(): void {
    const all = this.synth?.getVoices() ?? [];
    const en = all.filter((v) => /^en/i.test(String(v.lang || "").replace("_", "-")));
    const list = (en.length ? en : all).slice().sort((a, b) => scoreVoice(b) - scoreVoice(a));
    if (list.length === this.systemList.length && list.every((v, i) => v.name === this.systemList[i]?.name)) return;
    this.systemList = list;
    this.choose();
  }

  /** The remembered choice while its source is there; otherwise the device's voice. */
  private choose(): void {
    const before = this.selectionValue;
    const saved = parseSelection(recall("jarvis.voice") ?? "");
    this.chosen = saved && this.available(saved) ? saved : this.deviceDefault();
    const name = this.chosen?.kind === "device" ? this.chosen.name : null;
    this.systemVoice = (name && this.systemList.find((v) => v.name === name)) || (this.systemList[0] ?? null);
    if (this.selectionValue !== before) this.onState?.();
  }

  /** The device's best voice by name, or its default where it names none; null if it can't speak. */
  private deviceDefault(): Selection | null {
    return this.synth ? { kind: "device", name: this.systemList[0]?.name ?? null } : null;
  }

  private available(s: Selection): boolean {
    if (s.kind === "neural") return (this.neural.get(s.via) ?? []).some((v) => v.id === s.id);
    return this.synth !== null && (s.name === null || this.systemList.some((v) => v.name === s.name));
  }

  /** Choose by value: "<service>:<voice>" or "device:<name>". */
  select(value: string): boolean {
    const s = parseSelection(value);
    if (!s || !this.available(s)) return false;
    store("jarvis.voice", value);
    this.resting = null; // chosen again: worth asking again
    this.choose();
    this.onState?.();
    return true;
  }

  get selectionValue(): string {
    const s = this.chosen;
    return !s ? "" : s.kind === "neural" ? `${s.via}:${s.id}` : `device:${s.name ?? ""}`;
  }

  /** The chosen neural voice's details, if a neural voice is chosen. */
  current(): NeuralVoice | null {
    const s = this.chosen;
    if (s?.kind !== "neural") return null;
    const voice = this.neural.get(s.via)?.find((v) => v.id === s.id);
    return voice ? { via: s.via, voice } : null;
  }

  /** The neural voice to speak with now: the chosen one, unless it is resting after a refusal. */
  private neuralNow(): NeuralVoice | null {
    return this.resting && Date.now() < this.resting.until ? null : this.current();
  }

  /**
   * The chosen neural voice was refused: say why, once, and let the device's
   * voice speak for a while rather than wait on a refusal every sentence.
   */
  private rest(reason: string): void {
    const first = this.resting === null;
    this.resting = { until: Date.now() + REST_MS, reason };
    if (first) this.onNotice?.(`${reason} I'll speak with this device's voice meanwhile.`);
    this.onState?.();
  }

  /** Where a service's voices are made, in words. */
  sourceLabel(via: ProviderId): string {
    return `through ${PROVIDERS[via].name}`;
  }

  describe(): { text: string; warn: boolean } {
    const n = this.current();
    if (n && this.resting && Date.now() < this.resting.until) {
      return { text: `${n.voice.name}, ${this.sourceLabel(n.via)}, is unavailable: ${this.resting.reason} This device's voice speaks meanwhile.`, warn: true };
    }
    if (n) return { text: `Neural voice — ${n.voice.name} (${n.voice.note}), ${this.sourceLabel(n.via)}.`, warn: false };
    if (!this.synth) return { text: "This browser can't speak. Connect a service and pick one of its voices, and he will.", warn: true };
    if (!this.systemVoice) return { text: "This device's own voice. The browser doesn't name its voices, so it can't be chosen by name here.", warn: false };
    return {
      text: `This device's voice — ${shortName(this.systemVoice)} (${this.systemVoice.lang}).`,
      warn: !/^en-GB/i.test(this.systemVoice.lang),
    };
  }

  /** One line for the console snapshot the reasoning core is shown. */
  summary(): string {
    const n = this.current();
    if (n) return `${n.voice.name} (${this.sourceLabel(n.via)})`;
    return this.systemVoice ? `${shortName(this.systemVoice)} (this device)` : "this device's default";
  }

  labelFor(v: SpeechSynthesisVoice): string {
    return `${shortName(v)}  ·  ${String(v.lang).replace("_", "-")}`;
  }

  /* ---------------- audio graph ---------------- */

  private graph(): { ac: AudioContext; bus: GainNode } | null {
    const AC = AudioCtor();
    if (!AC) return null;
    this.actx ??= new AC();
    const ac = this.actx;
    if (ac.state === "suspended") void ac.resume();
    if (!this.bus) {
      const bus = ac.createGain();
      const an = ac.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.75;
      bus.connect(an);
      an.connect(ac.destination);
      this.bus = bus;
      this.outAnalyser = an;
    }
    return { ac, bus: this.bus };
  }

  /** The globe reads this every frame: the real level of what is live. */
  private pumpAmplitude(): void {
    const tick = (): void => {
      const an = this.listening ? this.micAnalyser : this.speaking ? this.outAnalyser : null;
      if (an) {
        an.getByteFrequencyData(this.bins);
        let sum = 0;
        for (const v of this.bins) sum += v;
        const avg = sum / this.bins.length / 255;
        this.amplitude += (Math.min(1, avg * 2.6) - this.amplitude) * 0.35;
      } else {
        this.amplitude *= 0.88;
        if (this.amplitude < 0.01) this.amplitude = 0;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private tone(open: boolean): void {
    if (!this.enabled) return;
    const g = this.graph();
    if (!g) return;
    const { ac } = g;
    const t = ac.currentTime;

    const len = Math.floor(ac.sampleRate * 0.07);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = open ? 1750 : 1050;
    bp.Q.value = 1.2;
    const ng = ac.createGain();
    ng.gain.value = open ? 0.05 : 0.035;
    src.connect(bp); bp.connect(ng); ng.connect(ac.destination);
    src.start(t);
  }

  /* ---------------- speaking ----------------
   *
   * Speech is a stream, not a finished reply. As an answer arrives, each
   * sentence is sent for synthesis the moment it is complete and scheduled
   * straight after the previous one on the audio clock — so JARVIS starts
   * talking while the rest is still being written, with no gaps between
   * sentences. A whole reply known up front (speak) is just a stream that
   * begins and ends at once.
   */

  private run: {
    id: number;
    consumed: number;          // how much of the incoming text has been sent for speech
    chunks: number;
    nextAt: number;            // audio-clock time where the next sentence starts
    chain: Promise<void>;      // keeps sentences in order however fast synthesis finishes
    last: AudioBufferSourceNode | null;
    lastUtter: SpeechSynthesisUtterance | null;
    neural: boolean;
    ended: boolean;
  } | null = null;

  stop(): void {
    this.seq++;
    this.run = null;
    for (const s of this.sources) {
      try { s.stop(); } catch { /* already finished */ }
    }
    this.sources = [];
    this.synth?.cancel();
    if (this.speaking) {
      this.speaking = false;
      this.onState?.();
    }
  }

  /** Speak a complete reply — one of the console's own lines, said to this user. */
  speak(text: string): void {
    this.beginStream();
    this.endStream(addressed(text));
  }

  /** Start a reply whose text will arrive in pieces. */
  beginStream(): void {
    this.stop();
    if (!this.enabled || !this.userActed) return;
    const neural = this.neuralNow() !== null && this.graph() !== null;
    this.run = {
      id: this.seq, consumed: 0, chunks: 0, nextAt: 0,
      chain: Promise.resolve(), last: null, lastUtter: null, neural, ended: false,
    };
  }

  /**
   * Feed the text so far (the whole thing, not a delta). Any sentence that is
   * now complete is spoken immediately.
   */
  pushText(full: string): void {
    const r = this.run;
    if (!r || r.ended) return;
    for (;;) {
      const rest = full.slice(r.consumed);
      // A sentence is complete once its full stop is followed by a space and a
      // capital — so "14.92" and "Mr. Stark" never split, and we never cut a
      // sentence whose next word hasn't arrived yet.
      let m = /^([\s\S]*?[.!?]["”’)]?)\s+(?=[A-Z"“‘(])/.exec(rest);
      // Get the first words out quickly: if the opening sentence runs long —
      // finished or still arriving — speak up to its first comma first. What
      // he says first is what you wait for; the rest is made while it plays.
      // (A service takes a second or more to make a line, so
      // a short opening clause is what gets him talking quickly.)
      if (r.chunks === 0 && (m ? m[1]!.length : rest.length) > 40) {
        const clause = /^([\s\S]{12,90}?[,;:—])\s+/.exec(rest);
        if (clause && (!m || clause[0].length < m[0].length)) m = clause;
      }
      if (!m) break;
      r.consumed += m[0].length;
      this.enqueue(m[1]!);
    }
  }

  /** The reply is complete: speak whatever is left, then finish. */
  endStream(finalText: string): void {
    const r = this.run;
    if (!r) return;
    this.pushText(finalText);
    const tail = finalText.slice(r.consumed);
    r.consumed = finalText.length;
    if (tail.trim()) this.enqueue(tail);
    r.ended = true;
    if (r.chunks === 0) { this.run = null; return; }
    const id = r.id;
    void r.chain.then(() => {
      if (this.seq !== id) return;
      const finish = (): void => {
        if (this.seq !== id) return;
        this.run = null;
        this.sources = [];
        this.speaking = false;
        if (r.neural && r.last) this.tone(false);
        this.onState?.();
      };
      if (r.neural) {
        if (r.last) r.last.onended = finish;
        else finish();
      } else if (r.lastUtter) {
        r.lastUtter.onend = r.lastUtter.onerror = finish;
        if (!this.synth?.speaking && !this.synth?.pending) finish();
      } else finish();
    });
  }

  /** Clean one piece of text for the ear and send it to be spoken. */
  private enqueue(raw: string): void {
    const r = this.run;
    if (!r) return;
    const text = raw
      .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")   // ([source](url))
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")          // [text](url)
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\[\[[\s\S]*$/g, "")                     // a console directive starting
      .replace(/[*_`#>|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || !/[A-Za-z0-9]/.test(text)) return;

    if (r.chunks === 0) {
      this.speaking = true;
      this.onState?.();
    }
    r.chunks += 1;

    if (!r.neural) {
      this.sayOnDevice(r, text); // the browser queues utterances in order by itself
      return;
    }

    const n = this.neuralNow();
    if (!this.graph() || !n) return;
    const id = r.id;
    // Ask for it now, so the samples are arriving while everything before it
    // plays; it is played once everything before it has been scheduled.
    const pieces = api.speak({ text, via: n.via, voice: n.voice.id, speed: this.rate });
    pieces.catch(() => undefined);

    r.chain = r.chain.then(async () => {
      if (this.seq !== id) return;
      if (r.neural) {
        try {
          await this.play(r, id, text, await pieces);
          this.resting = null; // it spoke: whatever stopped it has passed
          return;
        } catch (err) {
          if (this.seq !== id) return;
          this.rest(err instanceof Error ? err.message : String(err));
          r.neural = false;
          // let what the service did say finish before the device's voice takes over
          await this.untilPlayed(r);
          if (this.seq !== id) return;
        }
      }
      // This line, and every later one in this reply, in the device's voice.
      this.sayOnDevice(r, text);
    });
  }

  /** One line in the device's own voice — the one chosen, or the browser's default where it names none. */
  private sayOnDevice(r: NonNullable<typeof this.run>, text: string): void {
    if (!this.synth) return;
    const u = new SpeechSynthesisUtterance(text);
    if (this.systemVoice) { u.voice = this.systemVoice; u.lang = this.systemVoice.lang; }
    else u.lang = "en-GB";
    u.rate = this.rate;
    u.pitch = this.pitch;
    r.lastUtter = u;
    this.synth.speak(u);
  }

  /** Resolves when the service's audio scheduled so far has played. */
  private untilPlayed(r: NonNullable<typeof this.run>): Promise<void> {
    const left = this.actx ? r.nextAt - this.actx.currentTime : 0;
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, left * 1000)));
  }

  /**
   * Play one piece as its samples arrive, each slice scheduled straight after
   * the last on the audio clock. The silence a service leaves before and
   * after the words — up to ¾ s in all — would be dead air at every join, so
   * the first slice starts at the first sound, the final slice is held back
   * until the stream ends and trimmed to the last, and then a pause that fits
   * how the piece ended is left: a breath after a comma, a beat after a full stop.
   */
  private async play(r: NonNullable<typeof this.run>, id: number, text: string, stream: AsyncIterable<Uint8Array>): Promise<void> {
    const g = this.graph();
    if (!g) return;
    const { ac, bus } = g;
    const HOLD = Math.floor(SPEECH_RATE * 0.25); // kept back for the trailing trim
    const SLICE = Math.floor(SPEECH_RATE * 0.25); // scheduled at a time
    let held: Float32Array[] = [];
    let heldLength = 0;
    let carry = new Uint8Array(0); // an odd byte between pieces of the stream
    let started = false;

    const schedule = (samples: Float32Array, last: boolean): void => {
      const a = started ? 0 : speechStart(samples);
      const b = last ? speechEnd(samples) : samples.length;
      if (b <= a) return;
      started = true;
      // the radio click, as his first words of a reply actually begin — never before a refusal
      if (!r.last) this.tone(true);
      const buf = ac.createBuffer(1, b - a, SPEECH_RATE);
      const slice = new Float32Array(b - a);
      slice.set(samples.subarray(a, b));
      buf.copyToChannel(slice, 0);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(bus);
      const when = Math.max(ac.currentTime + 0.03, r.nextAt);
      src.start(when);
      r.nextAt = when + buf.duration;
      this.sources.push(src);
      r.last = src;
    };

    try {
      for await (const bytes of stream) {
        if (this.seq !== id) return;
        const joined = new Uint8Array(carry.length + bytes.length);
        joined.set(carry);
        joined.set(bytes, carry.length);
        const even = joined.length & ~1;
        carry = joined.subarray(even);
        held.push(toFloat32(joined.subarray(0, even)));
        heldLength += even >> 1;
        if (heldLength >= SLICE + HOLD) {
          const all = joinFloat32(held);
          schedule(all.subarray(0, all.length - HOLD), false);
          held = [all.subarray(all.length - HOLD)];
          heldLength = HOLD;
        }
      }
      if (this.seq !== id) return;
      if (heldLength) schedule(joinFloat32(held), true);
    } catch (err) {
      // Refused before a sound: the caller hands the line to the device's
      // voice. Cut off part-way: what was said has been heard; the rest is lost.
      if (!started) throw err;
      if (this.seq === id) this.onNotice?.("The voice broke off, sir.");
    }
    r.nextAt += /[.!?]["”’)]?$/.test(text.trim()) ? 0.3 : /[,;:—]$/.test(text.trim()) ? 0.12 : 0.18;
  }

  /* ---------------- listening ---------------- */

  toggleListen(): void {
    this.userActed = true;
    if (this.listening) { this.stopListening(); return; }
    if (this.transcribing) return;
    this.stop(); // don't record our own voice
    if (this.serverStt && typeof MediaRecorder !== "undefined") void this.startRecording();
    else this.startRecognition();
  }

  private stopListening(): void {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    else if (this.recog) this.recog.stop();
  }

  private async openMic(): Promise<MediaStream | null> {
    if (this.micStream) return this.micStream;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const g = this.graph();
      if (g) {
        const an = g.ac.createAnalyser();
        an.fftSize = 256;
        an.smoothingTimeConstant = 0.6;
        g.ac.createMediaStreamSource(this.micStream).connect(an);
        this.micAnalyser = an;
      }
      return this.micStream;
    } catch {
      this.onNotice?.("Microphone access was refused. Allow it in the browser's site settings, or type instead.");
      return null;
    }
  }

  private closeMic(): void {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.micAnalyser = null;
  }

  /** Record until you stop talking, then hand the audio to the connected service. */
  private async startRecording(): Promise<void> {
    const stream = await this.openMic();
    if (!stream) return;

    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
      .find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this.recorder = rec;
    this.chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    rec.onstop = () => void this.finishRecording(rec.mimeType || mime || "audio/webm");
    rec.start(250);

    this.listening = true;
    this.onState?.();

    // Voice-activity detection on the real mic level: stop after a pause once
    // you've said something, give up if nothing is said at all.
    const started = Date.now();
    let heard = false;
    let quietSince = 0;
    const check = (): void => {
      if (!this.listening || rec.state === "inactive") return;
      const lvl = this.amplitude;
      const now = Date.now();
      if (lvl > 0.1) { heard = true; quietSince = 0; }
      else if (heard) {
        quietSince ||= now;
        if (now - quietSince > 1300) { rec.stop(); return; }
      }
      if (!heard && now - started > 7000) { rec.stop(); return; }
      if (now - started > 30000) { rec.stop(); return; }
      this.vadTimer = window.setTimeout(check, 80);
    };
    this.vadTimer = window.setTimeout(check, 250);
  }

  private async finishRecording(mime: string): Promise<void> {
    if (this.vadTimer) clearTimeout(this.vadTimer);
    this.listening = false;
    this.closeMic();
    const blob = new Blob(this.chunks, { type: mime });
    this.chunks = [];
    this.recorder = null;

    if (blob.size < 2000) {
      this.onState?.();
      this.onNotice?.("I didn't hear anything, sir.");
      return;
    }

    this.transcribing = true;
    this.onState?.();
    try {
      const text = await api.transcribe(blob);
      if (text) this.onRecognised?.(text, true);
      else this.onNotice?.("I didn't catch that, sir.");
    } catch (err) {
      this.onNotice?.(err instanceof Error ? err.message : String(err));
    } finally {
      this.transcribing = false;
      this.onState?.();
    }
  }

  /* ---- fallback: the browser's own dictation ---- */

  private initRecognition(): void {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-GB";
    r.interimResults = true;
    r.continuous = false;
    r.onstart = (): void => { this.listening = true; void this.openMic(); this.onState?.(); };
    r.onend = (): void => { this.listening = false; this.closeMic(); this.onState?.(); };
    r.onresult = (e: SpeechRecognitionEvent): void => {
      let txt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i]![0]!.transcript;
      this.onRecognised?.(txt.trim(), e.results[e.results.length - 1]!.isFinal);
    };
    r.onerror = (e: SpeechRecognitionErrorEvent): void => {
      const c = e.error;
      if (c === "not-allowed" || c === "service-not-allowed") {
        this.onNotice?.("Microphone refused — the command line still works.");
      } else if (c === "no-speech") {
        this.onNotice?.("I didn't catch that, sir.");
      } else if (c === "network") {
        // Deliberately no automatic retry: restarting the mic unasked is what
        // made it flick on and off.
        this.onNotice?.(NO_DICTATION);
      } else if (c !== "aborted") {
        this.onNotice?.(`Voice input error: ${c}.`);
      }
    };
    this.recog = r;
  }

  private startRecognition(): void {
    if (!this.recog) {
      this.onNotice?.(NO_DICTATION);
      return;
    }
    try { this.recog.start(); } catch { /* already running */ }
  }
}

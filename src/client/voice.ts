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
import { rankDeviceVoices, shortName } from "./device-voices.js";
import { recall, store } from "./dom.js";
import { Hearing } from "./hearing.js";
import { joinFloat32, speechEnd, speechStart, toFloat32 } from "./pcm.js";

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

const AudioCtor = (): typeof AudioContext | undefined =>
  window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

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
  speaking = false;
  /** Speech in: the microphone and the transcription live here. */
  private readonly hearing: Hearing;
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
   * Services whose voice was refused (a spent allowance, no credit): why, and
   * until when the device's voice speaks instead. Each service rests on its
   * own — Gemini's limit never keeps ChatGPT quiet — and is cleared by the
   * next line it does speak.
   */
  private resting = new Map<ProviderId, { until: number; reason: string }>();

  private seq = 0;

  /* one audio graph for the whole session */
  private actx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private bins: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(128));
  private sources: AudioBufferSourceNode[] = [];

  /** Real signal level, 0-1, from whichever audio is live right now. */
  amplitude = 0;

  onState: (() => void) | null = null;
  onNotice: ((msg: string) => void) | null = null;
  /** A tap to talk that nothing could hear — no service connected, no dictation in this browser. */
  onCannotHear: (() => void) | null = null;
  onRecognised: ((text: string, final: boolean) => void) | null = null;

  constructor() {
    const p = Number.parseFloat(recall("jarvis.pitch") ?? "");
    const r = Number.parseFloat(recall("jarvis.rate") ?? "");
    if (p >= 0.4 && p <= 1.2) this.pitch = p;
    if (r >= 0.7 && r <= 1.3) this.rate = r;
    this.hearing = new Hearing({ graph: () => this.graph(), level: () => this.amplitude });
    this.hearing.onState = () => this.onState?.();
    this.hearing.onNotice = (msg) => this.onNotice?.(msg);
    this.hearing.onCannotHear = () => this.onCannotHear?.();
    this.hearing.onRecognised = (text, final) => this.onRecognised?.(text, final);
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
  get listening(): boolean { return this.hearing.listening; }
  get transcribing(): boolean { return this.hearing.transcribing; }
  get micAvailable(): boolean { return this.hearing.available; }

  setPitch(v: number): void { this.pitch = v; store("jarvis.pitch", String(v)); }
  setRate(v: number): void { this.rate = v; store("jarvis.rate", String(v)); }
  markUserActed(): void { this.userActed = true; }
  /** Whether the user has clicked, tapped or typed on this page — after which the browser lets sound start. */
  get acted(): boolean { return this.userActed; }

  /**
   * Whether a line may be said right now, before any click or tap: in an
   * installed app, or on a site the browser allows to play sound, and with
   * a service's voice to say it — the device's own voice never starts
   * unasked. Asked at opening, while the answer can still be had.
   */
  async canSoundNow(): Promise<boolean> {
    if (!this.enabled || this.neuralNow() === null) return false;
    if (this.soundOnOpen === "unknown") await this.probeSoundOnOpen();
    return this.soundOnOpen === "yes";
  }

  /** The browser's answer at opening — shown in the guide and in Configuration → Access. */
  soundOnOpen: "yes" | "blocked" | "unknown" = "unknown";

  /** Asks the browser, at opening, whether sound may start unasked. */
  async probeSoundOnOpen(): Promise<void> {
    const g = this.graph();
    if (!g) return;
    if (g.ac.state === "running") { this.soundOnOpen = "yes"; return; }
    // resume() stays pending for as long as the browser withholds sound
    await Promise.race([g.ac.resume().catch(() => undefined), new Promise((r) => window.setTimeout(r, 400))]);
    this.soundOnOpen = (g.ac.state as AudioContextState) === "running" ? "yes" : "blocked"; // resume() may have changed it
  }

  /** Turn on recorded-and-heard input when a connected service can hear. */
  setServerTranscription(on: boolean): void {
    this.hearing.setServerTranscription(on);
  }
  /** How long a pause ends a recording, in seconds — and whether one ends only by hand. */
  setListening(pauseS: number, manual: boolean): void {
    this.hearing.pauseMs = Math.round(pauseS * 1000);
    this.hearing.manualStop = manual;
  }

  /* ---------------- which voice ----------------
   *
   * The service in use speaks, always, with its own AI voice: connected to
   * ChatGPT, ChatGPT's; to Gemini, Gemini's (main.ts offers only the service
   * in use). The voice picked for each service in Configuration → Voice is
   * remembered for it; until one is picked, the service's first voice.
   *
   * The device's own voice speaks only when there is no service to speak —
   * nothing connected — or while the service's voice is refused (a spent
   * allowance, no credit; see rest()).
   */

  /** The voices one service can speak with now — an empty list when it has gone. */
  setNeuralVoices(via: ProviderId, list: VoiceOption[]): void {
    const was = this.neural.get(via) ?? [];
    if (was.length === list.length && was.every((v, i) => v.id === list[i]?.id)) return;
    if (list.length) this.neural.set(via, list);
    else this.neural.delete(via);
    this.choose();
    this.onState?.(); // the list of voices on offer has changed, even if the choice hasn't
  }

  /** Every neural voice on offer. */
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
    const list = rankDeviceVoices(this.synth?.getVoices() ?? []);
    if (list.length === this.systemList.length && list.every((v, i) => v.name === this.systemList[i]?.name)) return;
    this.systemList = list;
    this.choose();
  }

  /**
   * The service's voice when a service offers voices; the device's otherwise —
   * or the device's anyway, when that is what was chosen last: a phone's own
   * voices answer at once, and stay on offer beside the service's.
   */
  private choose(): void {
    const before = this.selectionValue;
    // The device voice — speaking now, or standing by for when the service can't.
    const name = recall("jarvis.voice.device");
    this.systemVoice = (name && this.systemList.find((v) => v.name === name)) || (this.systemList[0] ?? null);

    const offered = this.neuralVoices();
    const via = offered[0]?.via;
    const deviceChosen = this.synth !== null && recall("jarvis.voice.kind") === "device";
    if (via && !deviceChosen) {
      const wanted = recall(`jarvis.voice.${via}`);
      const pick = offered.find((v) => v.voice.id === wanted) ?? offered[0]!;
      this.chosen = { kind: "neural", via, id: pick.voice.id };
    } else {
      this.chosen = this.synth ? { kind: "device", name: this.systemVoice?.name ?? null } : null;
    }
    if (this.selectionValue !== before) this.onState?.();
  }

  private available(s: Selection): boolean {
    if (s.kind === "neural") return (this.neural.get(s.via) ?? []).some((v) => v.id === s.id);
    return this.synth !== null && (s.name === null || this.systemList.some((v) => v.name === s.name));
  }

  /** Choose by value — "<service>:<voice>", or "device:<name>" for one of the device's own — and remember it. */
  select(value: string): boolean {
    const s = parseSelection(value);
    if (!s || !this.available(s)) return false;
    if (s.kind === "neural") {
      store(`jarvis.voice.${s.via}`, s.id);
      store("jarvis.voice.kind", "neural");
      this.resting.delete(s.via); // chosen again: worth asking again
    } else {
      if (s.name) store("jarvis.voice.device", s.name);
      store("jarvis.voice.kind", "device");
    }
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

  /** Why the chosen neural voice is resting after a refusal, or null if it isn't. */
  private restingReason(): string | null {
    const n = this.current();
    const rest = n ? this.resting.get(n.via) : undefined;
    return rest && Date.now() < rest.until ? rest.reason : null;
  }

  /** The neural voice to speak with now: the chosen one, unless it is resting after a refusal. */
  private neuralNow(): NeuralVoice | null {
    return this.restingReason() === null ? this.current() : null;
  }

  /**
   * The chosen neural voice was refused: say why, once, and let the device's
   * voice speak for a while rather than wait on a refusal every sentence.
   */
  private rest(via: ProviderId, reason: string): void {
    const first = !this.resting.has(via);
    this.resting.set(via, { until: Date.now() + REST_MS, reason });
    if (first) this.onNotice?.(`${reason} I'll speak with this device's voice meanwhile.`);
    this.onState?.();
  }

  /** Where a service's voices are made, in words. */
  sourceLabel(via: ProviderId): string {
    return `through ${PROVIDERS[via].name}`;
  }

  describe(): { text: string; warn: boolean } {
    const n = this.current();
    const resting = this.restingReason();
    if (n && resting) return { text: `${n.voice.name}, ${this.sourceLabel(n.via)}, is unavailable: ${resting} This device's voice speaks meanwhile.`, warn: true };
    if (n) return { text: `AI voice — ${n.voice.name} (${n.voice.note}), ${this.sourceLabel(n.via)}.`, warn: false };
    if (!this.synth) return { text: "No service is connected and this browser can't speak. Connect Gemini or ChatGPT for a voice.", warn: true };
    const which = this.systemVoice ? ` — ${shortName(this.systemVoice)} (${this.systemVoice.lang})` : "";
    if (this.neuralVoices().length) return { text: `This device's voice${which}. Answers still come through the connected service; its AI voices are in the list.`, warn: false };
    return { text: `No service is connected, so this device's voice speaks${which}. Connect Gemini or ChatGPT for an AI voice.`, warn: true };
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
    // The graph runs at the speech rate itself. Otherwise every quarter-second
    // slice of a reply is resampled on its own to the device's rate, and the
    // seams between slices tick — heard as a faint high whine under the voice.
    if (!this.actx) {
      try { this.actx = new AC({ sampleRate: SPEECH_RATE }); }
      catch { this.actx = new AC(); }
    }
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
      const an = this.hearing.listening ? this.hearing.analyser : this.speaking ? this.outAnalyser : null;
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
   * Speech is a stream, not a finished reply. As an answer arrives, the first
   * sentence is sent for synthesis the moment it is complete, so JARVIS
   * starts talking while the rest is still being written. What follows is
   * gathered, sentence by sentence, and sent as one piece only when the
   * voice is about to run dry — or when the reply ends — so a service
   * speaks whole passages with its own flow, and a reply is a few pieces
   * rather than a clip per sentence. Each piece is scheduled straight after
   * the previous one on the audio clock. A whole reply known up front
   * (speak) is just a stream that begins and ends at once.
   */

  /** How long before the voice would go quiet the next piece is sent: the time a service takes to begin one. */
  private static readonly LEAD = 2.0;

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
    pending: string;           // complete sentences gathered for the next piece
    inFlight: number;          // pieces asked for whose samples are still to be played
    watch: number | null;      // the clock that sends the next piece in time
  } | null = null;

  stop(): void {
    this.seq++;
    if (this.run?.watch) window.clearInterval(this.run.watch);
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
      pending: "", inFlight: 0, watch: null,
    };
    if (neural) this.run.watch = window.setInterval(() => this.sendIfDue(), 200);
  }

  /**
   * A complete sentence of the reply. The first goes to be spoken at once;
   * the rest gather, and go together when the voice is about to need them.
   * The device's own voice queues lines by itself, so it takes each as it comes.
   */
  private offer(piece: string): void {
    const r = this.run;
    if (!r) return;
    if (!r.neural || r.chunks === 0) { this.enqueue(piece); return; }
    r.pending = r.pending ? `${r.pending} ${piece}` : piece;
    this.sendIfDue();
  }

  /**
   * Send what has gathered when nothing is being made and what is scheduled
   * runs out within the time a service takes to begin a piece — or whenever
   * `now` says so: the reply has ended, or the device's voice has taken over.
   */
  private sendIfDue(now = false): void {
    const r = this.run;
    if (!r || !r.pending) return;
    const left = this.actx ? r.nextAt - this.actx.currentTime : 0;
    if (!now && r.neural && (r.inFlight > 0 || left > Voice.LEAD)) return;
    const text = r.pending;
    r.pending = "";
    this.enqueue(text);
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
      this.offer(m[1]!);
    }
  }

  /** The reply is complete: speak whatever is left, then finish. */
  endStream(finalText: string): void {
    const r = this.run;
    if (!r) return;
    this.pushText(finalText);
    const tail = finalText.slice(r.consumed);
    r.consumed = finalText.length;
    if (tail.trim()) this.offer(tail);
    this.sendIfDue(true); // the reply is known in full: the rest goes as one piece
    r.ended = true;
    if (r.watch) { window.clearInterval(r.watch); r.watch = null; }
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
    r.inFlight += 1;

    r.chain = r.chain.then(async () => {
      if (this.seq !== id) return;
      if (r.neural) {
        try {
          await this.play(r, id, text, await pieces);
          this.resting.delete(n.via); // it spoke: whatever stopped it has passed
          return;
        } catch (err) {
          if (this.seq !== id) return;
          this.rest(n.via, err instanceof Error ? err.message : String(err));
          r.neural = false;
          // let what the service did say finish before the device's voice takes over
          await this.untilPlayed(r);
          if (this.seq !== id) return;
        }
      }
      // This line, and every later one in this reply, in the device's voice.
      this.sayOnDevice(r, text);
    }).finally(() => {
      if (this.run !== r) return;
      r.inFlight -= 1;
      // played, or handed to the device's voice: whatever has gathered may be due now
      this.sendIfDue(!r.neural);
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
      const when = Math.max(ac.currentTime + 0.03, r.nextAt);
      // The stream fell behind and the previous slice has already ended: the
      // silence is unavoidable, but a slice starting mid-wave after it would
      // click, so its first few milliseconds are eased in.
      if (r.nextAt > 0 && when > r.nextAt + 0.005) {
        const ramp = Math.min(slice.length, Math.floor(SPEECH_RATE * 0.004));
        for (let i = 0; i < ramp; i++) slice[i]! *= i / ramp;
      }
      buf.copyToChannel(slice, 0);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(bus);
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

  /** Tap: listen, or stop listening. He goes quiet first, so as not to record his own voice. */
  toggleListen(): void {
    this.userActed = true;
    if (!this.hearing.listening && !this.hearing.transcribing) this.stop();
    this.hearing.toggle();
  }
}

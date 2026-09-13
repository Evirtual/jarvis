/**
 * Speech, in and out.
 *
 * Out: the voice chosen (voice-choice.ts) — a neural voice made by the
 * connected service, or the device's own. Replies are split into sentences,
 * synthesised in parallel, decoded, and scheduled back-to-back on the audio
 * clock: one continuous voice, with the first sentence playing while the
 * rest are still being made.
 *
 * In: the page records the microphone and the connected service turns it
 * into text (hearing.ts). That avoids Chrome's dictation, which quietly
 * depends on Google's speech service (and which Brave doesn't have).
 * Dictation remains as a fallback, and the text field always works.
 */

import type { ProviderId, VoiceOption } from "../shared/types.js";
import { SPEECH_RATE } from "../shared/services/index.js";
import { api } from "./api.js";
import { addressed } from "./address.js";
import { KEY, recall, store } from "./storage.js";
import { Hearing } from "./hearing.js";
import { joinFloat32, speechEnd, speechStart, toFloat32 } from "./pcm.js";
import { VoiceChoice, type NeuralVoice, type Selection } from "./voice-choice.js";

export type { NeuralVoice, Selection } from "./voice-choice.js";

const AudioCtor = (): typeof AudioContext | undefined =>
  window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

/** One reply being spoken, piece by piece. */
interface Run {
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
}

export class Voice {
  enabled = true;
  speaking = false;
  /** Which voice speaks. */
  readonly choice: VoiceChoice;
  /** Speech in: the microphone and the transcription live here. */
  private readonly hearing: Hearing;
  private readonly synth: SpeechSynthesis | null = window.speechSynthesis ?? null;
  private userActed = false;
  private pitch = 0.78;
  private rate = 0.96;
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
    const p = Number.parseFloat(recall(KEY.voicePitch) ?? "");
    const r = Number.parseFloat(recall(KEY.voiceRate) ?? "");
    if (p >= 0.4 && p <= 1.2) this.pitch = p;
    if (r >= 0.7 && r <= 1.3) this.rate = r;
    this.choice = new VoiceChoice(this.synth);
    this.choice.onState = () => this.onState?.();
    this.choice.onNotice = (msg) => this.onNotice?.(msg);
    this.hearing = new Hearing({ graph: () => this.graph(), level: () => this.amplitude });
    this.hearing.onState = () => this.onState?.();
    this.hearing.onNotice = (msg) => this.onNotice?.(msg);
    this.hearing.onCannotHear = () => this.onCannotHear?.();
    this.hearing.onRecognised = (text, final) => this.onRecognised?.(text, final);
    this.pumpAmplitude();
  }

  get pitchValue(): number { return this.pitch; }
  get rateValue(): number { return this.rate; }
  get listening(): boolean { return this.hearing.listening; }
  get transcribing(): boolean { return this.hearing.transcribing; }
  get micAvailable(): boolean { return this.hearing.available; }

  setPitch(v: number): void { this.pitch = v; store(KEY.voicePitch, String(v)); }
  setRate(v: number): void { this.rate = v; store(KEY.voiceRate, String(v)); }
  markUserActed(): void { this.userActed = true; }
  /** Whether the user has clicked, tapped or typed on this page — after which the browser lets sound start. */
  get acted(): boolean { return this.userActed; }

  /* ---- which voice: the choice's, at hand ---- */
  get selection(): Selection | null { return this.choice.selection; }
  get selectionValue(): string { return this.choice.selectionValue; }
  get systemVoices(): SpeechSynthesisVoice[] { return this.choice.systemVoices; }
  get deviceSpeaks(): boolean { return this.choice.deviceSpeaks; }
  setNeuralVoices(via: ProviderId, list: VoiceOption[]): void { this.choice.setNeuralVoices(via, list); }
  neuralVoices(): NeuralVoice[] { return this.choice.neuralVoices(); }
  select(value: string): boolean { return this.choice.select(value); }
  current(): NeuralVoice | null { return this.choice.current(); }
  sourceLabel(via: ProviderId): string { return this.choice.sourceLabel(via); }
  describe(): { text: string; warn: boolean } { return this.choice.describe(); }
  summary(): string { return this.choice.summary(); }
  labelFor(v: SpeechSynthesisVoice): string { return this.choice.labelFor(v); }

  /**
   * Whether a line may be said right now, before any click or tap: in an
   * installed app, or on a site the browser allows to play sound, and with
   * a service's voice to say it — the device's own voice never starts
   * unasked. Asked at opening, while the answer can still be had.
   */
  async canSoundNow(): Promise<boolean> {
    if (!this.enabled || this.choice.neuralNow() === null) return false;
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

  private run: Run | null = null;

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
    const neural = this.choice.neuralNow() !== null && this.graph() !== null;
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

    const n = this.choice.neuralNow();
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
          this.choice.spoke(n.via); // it spoke: whatever stopped it has passed
          return;
        } catch (err) {
          if (this.seq !== id) return;
          this.choice.rest(n.via, err instanceof Error ? err.message : String(err));
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
  private sayOnDevice(r: Run, text: string): void {
    if (!this.synth) return;
    const u = new SpeechSynthesisUtterance(text);
    const chosen = this.choice.systemVoice;
    if (chosen) { u.voice = chosen; u.lang = chosen.lang; }
    else u.lang = "en-GB";
    u.rate = this.rate;
    u.pitch = this.pitch;
    r.lastUtter = u;
    this.synth.speak(u);
  }

  /** Resolves when the service's audio scheduled so far has played. */
  private untilPlayed(r: Run): Promise<void> {
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
  private async play(r: Run, id: number, text: string, stream: AsyncIterable<Uint8Array>): Promise<void> {
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

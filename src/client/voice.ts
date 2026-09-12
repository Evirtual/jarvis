/**
 * Speech, in and out.
 *
 * Out: Kokoro from the local server, the browser's own voices as a fallback.
 * Replies are split into sentences, synthesised in parallel, decoded, and
 * scheduled back-to-back on the audio clock — one continuous voice, with the
 * first sentence playing while the rest are still being generated.
 *
 * In: when ChatGPT is connected, the page records the microphone and the server
 * transcribes it. That avoids Chrome's dictation, which quietly depends on
 * Google's speech service and fails with "network" when that is unreachable.
 * The Web Speech API remains as a fallback, and the text field always works.
 */

import type { VoiceOption } from "../shared/types.js";
import { api } from "./api.js";
import { addressed } from "./address.js";
import { recall, store } from "./dom.js";
import { toWav16k } from "./audio.js";
import { SERVERLESS } from "./server.js";

type Engine = "kokoro" | "system";

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
const NO_DICTATION = SERVERLESS
  ? "This browser can't take dictation, sir. Download my hearing in Configuration → Voice — about 63 MB, once — and I'll listen myself."
  : "This browser can't take dictation, and my own hearing is still loading, sir — a moment, or type instead.";

/**
 * Where the speech in a generated piece starts and ends, in seconds: the
 * silence before and after it trimmed, with a few milliseconds kept so no
 * word is clipped.
 */
function speechBounds(buf: AudioBuffer): { start: number; end: number } {
  const d = buf.getChannelData(0);
  const quiet = 0.01;
  let a = 0, b = d.length - 1;
  while (a < d.length && Math.abs(d[a]!) < quiet) a++;
  while (b > a && Math.abs(d[b]!) < quiet) b--;
  if (a >= b) return { start: 0, end: buf.duration }; // nothing above the floor: play it as it is
  return {
    start: Math.max(0, a / buf.sampleRate - 0.03),
    end: Math.min(buf.duration, b / buf.sampleRate + 0.06),
  };
}

export class Voice {
  enabled = true;
  engine: Engine = "system";
  kokoroVoice = "bm_george";
  kokoroReady = false;
  listening = false;
  transcribing = false;
  speaking = false;
  private userActed = false;
  private pitch = 0.78;
  private rate = 0.96;

  private synth: SpeechSynthesis | null = window.speechSynthesis ?? null;
  private systemVoice: SpeechSynthesisVoice | null = null;
  private systemList: SpeechSynthesisVoice[] = [];
  private serverVoices: VoiceOption[] = [];

  private seq = 0;
  private warned = false;

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
    this.pumpAmplitude();
  }

  get pitchValue(): number { return this.pitch; }
  get rateValue(): number { return this.rate; }
  get voiceOptions(): VoiceOption[] { return this.serverVoices; }
  get systemVoices(): SpeechSynthesisVoice[] { return this.systemList; }
  get micAvailable(): boolean {
    return (this.serverStt && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined") || this.recog !== null;
  }

  setPitch(v: number): void { this.pitch = v; store("jarvis.pitch", String(v)); }
  setRate(v: number): void { this.rate = v; store("jarvis.rate", String(v)); }
  markUserActed(): void { this.userActed = true; }

  /** Turn on recorded-and-transcribed input when the server can do it. */
  setServerTranscription(on: boolean): void {
    if (this.serverStt === on) return;
    this.serverStt = on;
    this.onState?.();
  }

  /* ---------------- selection ---------------- */

  setServerVoices(list: VoiceOption[], ready: boolean): void {
    const first = this.serverVoices.length === 0 && list.length > 0;
    this.serverVoices = list;
    this.kokoroReady = ready;
    this.refreshSystemList();
    if (!first && this.engine === "kokoro") return; // don't re-pick on every poll
    const saved = recall("jarvis.voice");
    if (!saved || !this.select(saved, true)) {
      if (list.length) this.select(`k:${list[0]!.id}`, true);
      else if (this.systemList[0]) this.select(`s:${this.systemList[0].name}`, true);
    }
  }

  refreshSystemList(): void {
    const all = this.synth?.getVoices() ?? [];
    const en = all.filter((v) => /^en/i.test(String(v.lang || "").replace("_", "-")));
    this.systemList = (en.length ? en : all).slice().sort((a, b) => scoreVoice(b) - scoreVoice(a));
    if (!this.systemVoice) this.systemVoice = this.systemList[0] ?? null;
  }

  /** `k:<kokoro id>` or `s:<system voice name>`. */
  select(value: string, quiet = false): boolean {
    if (value.startsWith("k:")) {
      const id = value.slice(2);
      if (!this.serverVoices.some((v) => v.id === id)) return false;
      this.engine = "kokoro";
      this.kokoroVoice = id;
    } else if (value.startsWith("s:")) {
      const pick = this.systemList.find((v) => v.name === value.slice(2));
      if (!pick) return false;
      this.engine = "system";
      this.systemVoice = pick;
    } else return false;

    if (!quiet) store("jarvis.voice", value);
    this.onState?.();
    return true;
  }

  get selectionValue(): string {
    return this.engine === "kokoro" ? `k:${this.kokoroVoice}` : `s:${this.systemVoice?.name ?? ""}`;
  }

  describe(): { text: string; warn: boolean } {
    if (this.engine === "kokoro") {
      const v = this.serverVoices.find((x) => x.id === this.kokoroVoice);
      return {
        text: `Neural voice — Kokoro-82M · ${v?.name ?? this.kokoroVoice}${v ? ` (${v.note})` : ""}. Generated on this machine; nothing leaves it.`,
        warn: false,
      };
    }
    if (!this.systemVoice) return { text: "No speech engine in this browser. I'll stay in text, sir.", warn: true };
    return {
      text: `System voice — ${shortName(this.systemVoice)} (${this.systemVoice.lang}).`,
      warn: !/^en-GB/i.test(this.systemVoice.lang),
    };
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
    kokoro: boolean;
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
    const kokoro = this.engine === "kokoro" && this.kokoroReady && this.graph() !== null;
    this.run = {
      id: this.seq, consumed: 0, chunks: 0, nextAt: 0,
      chain: Promise.resolve(), last: null, lastUtter: null, kokoro, ended: false,
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
      // (Kokoro takes roughly two-thirds of a second per second of speech, so
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
        if (r.kokoro) this.tone(false);
        this.onState?.();
      };
      if (r.kokoro) {
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

    const first = r.chunks === 0;
    r.chunks += 1;
    if (first) {
      this.speaking = true;
      if (r.kokoro) this.tone(true);
      this.onState?.();
    }

    if (!r.kokoro) {
      if (!this.synth) return;
      const u = new SpeechSynthesisUtterance(text);
      if (this.systemVoice) { u.voice = this.systemVoice; u.lang = this.systemVoice.lang; }
      u.rate = this.rate;
      u.pitch = this.pitch;
      r.lastUtter = u;
      this.synth.speak(u); // the browser queues utterances in order by itself
      return;
    }

    const g = this.graph();
    if (!g) return;
    const { ac, bus } = g;
    const id = r.id;
    // Start synthesis now; play it once everything before it has been scheduled.
    const audio = api.speak({ text, voice: this.kokoroVoice, speed: this.rate })
      .then((b) => b.arrayBuffer())
      .then((ab) => ac.decodeAudioData(ab));
    audio.catch(() => undefined);

    r.chain = r.chain.then(async () => {
      if (this.seq !== id) return;
      let buf: AudioBuffer;
      try {
        buf = await audio;
      } catch {
        if (this.seq !== id) return;
        if (!this.warned) {
          this.warned = true;
          this.onNotice?.("Neural voice unavailable — using a system voice.");
        }
        r.kokoro = false;
        // hand this and any later sentences to the browser's voice
        const u = new SpeechSynthesisUtterance(text);
        if (this.systemVoice) u.voice = this.systemVoice;
        r.lastUtter = u;
        this.synth?.speak(u);
        return;
      }
      if (this.seq !== id) return;
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(bus);
      // Kokoro pads every piece with ~0.25 s of silence before and ~0.5 s
      // after, so back to back they left ¾ s of dead air at every join. Play
      // only the speech, then a pause that fits how the piece ended: a breath
      // after a comma, a beat after a full stop.
      const { start, end } = speechBounds(buf);
      const pause = /[.!?]["”’)]?$/.test(text.trim()) ? 0.3 : /[,;:—]$/.test(text.trim()) ? 0.12 : 0.18;
      const when = Math.max(ac.currentTime + 0.03, r.nextAt);
      src.start(when, start, end - start);
      r.nextAt = when + (end - start) + pause;
      this.sources.push(src);
      r.last = src;
    });
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

  /** Record until you stop talking, then hand the audio to the server. */
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
      // as 16 kHz WAV: the form every transcriber here takes (audio.ts)
      const text = await api.transcribe(await toWav16k(blob).catch(() => blob));
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

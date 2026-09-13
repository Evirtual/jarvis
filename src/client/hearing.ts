/**
 * Speech in. The page records the microphone until you stop talking and the
 * connected service turns it into text. That avoids Chrome's dictation,
 * which quietly depends on Google's speech service (and which Brave doesn't
 * have). Dictation remains as a fallback, and the text field always works.
 */

import { api } from "./api.js";

/**
 * Nothing can hear: no service is connected and the browser can't take
 * dictation (Brave has none; Chrome's needs Google's service). One line, short
 * enough for a phone's one-line notice; the Connections screen, opened at the
 * same time (onCannotHear), carries the rest.
 */
const NO_DICTATION = "I can't hear you yet, sir — connect Gemini or ChatGPT, or type.";

/** What the voice lends its ear: the audio graph, and the live level it measures. */
export interface HearingHost {
  graph(): { ac: AudioContext } | null;
  /** The microphone's level right now, 0-1 — how silence is told from speech. */
  level(): number;
}

export class Hearing {
  listening = false;
  transcribing = false;
  /** The microphone's live spectrum, while it is open — the globe and the level read it. */
  analyser: AnalyserNode | null = null;

  /** Whether a connected service can hear: then the page records, otherwise it dictates. */
  private serverStt = false;
  private recog: SpeechRecognition | null = null;
  private micStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private vadTimer: number | null = null;

  /** How long a pause in your speech ends a recording, in milliseconds (Configuration → Voice). */
  pauseMs = 2000;
  /** Whether a recording runs until you tap again, instead of ending on a pause. */
  manualStop = false;

  onState: (() => void) | null = null;
  onNotice: ((msg: string) => void) | null = null;
  /** Nothing could hear a tap to talk: the console shows where to connect a service. */
  onCannotHear: (() => void) | null = null;
  onRecognised: ((text: string, final: boolean) => void) | null = null;

  constructor(private readonly host: HearingHost) {
    this.initRecognition();
  }

  get available(): boolean {
    return (this.serverStt && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined") || this.recog !== null;
  }

  /** Turn on recorded-and-heard input when a connected service can hear. */
  setServerTranscription(on: boolean): void {
    if (this.serverStt === on) return;
    this.serverStt = on;
    this.onState?.();
  }

  /** Start listening, or stop if already listening. Nothing while a recording is being heard. */
  toggle(): void {
    if (this.listening) { this.stopListening(); return; }
    if (this.transcribing) return;
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
      const g = this.host.graph();
      if (g) {
        const an = g.ac.createAnalyser();
        an.fftSize = 256;
        an.smoothingTimeConstant = 0.6;
        g.ac.createMediaStreamSource(this.micStream).connect(an);
        this.analyser = an;
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
    this.analyser = null;
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
    // you've said something (as long a pause as you asked for), give up if
    // nothing is said at all. Stopping by hand: only a tap ends it, within a
    // ceiling no service would take in one piece anyway.
    const started = Date.now();
    const manual = this.manualStop;
    const ceiling = manual ? 120_000 : 60_000;
    let heard = false;
    let quietSince = 0;
    const check = (): void => {
      if (!this.listening || rec.state === "inactive") return;
      const lvl = this.host.level();
      const now = Date.now();
      if (lvl > 0.1) { heard = true; quietSince = 0; }
      else if (heard && !manual) {
        quietSince ||= now;
        if (now - quietSince > this.pauseMs) { rec.stop(); return; }
      }
      if (!manual && !heard && now - started > 7000) { rec.stop(); return; }
      if (now - started > ceiling) { rec.stop(); return; }
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
    // What dictation has heard so far, and whether it ever called it final:
    // on a phone it often ends with the words still marked provisional, and
    // ending is as final as it gets.
    let heard = "";
    let settled = false;
    let failed = false;
    // The microphone is the recogniser's alone while it dictates: opening it a
    // second time for the ring's waveform gave one of the two silence on a
    // phone — listening, then "I didn't hear anything". The ring shows
    // listening without the waveform meanwhile.
    r.onstart = (): void => { heard = ""; settled = false; failed = false; this.listening = true; this.onState?.(); };
    r.onend = (): void => {
      this.listening = false; this.onState?.();
      if (!settled && !failed) {
        if (heard) this.onRecognised?.(heard, true);
        else this.onNotice?.("I didn't hear anything, sir.");
      }
    };
    r.onresult = (e: SpeechRecognitionEvent): void => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i]![0]!.transcript;
      heard = txt.trim();
      const final = e.results[e.results.length - 1]!.isFinal;
      if (final) settled = true;
      this.onRecognised?.(heard, final);
    };
    r.onerror = (e: SpeechRecognitionErrorEvent): void => {
      const c = e.error;
      failed = true;
      if (c === "not-allowed" || c === "service-not-allowed") {
        this.onNotice?.("Microphone refused — the command line still works.");
      } else if (c === "no-speech") {
        this.onNotice?.("I didn't catch that, sir.");
      } else if (c === "network") {
        // Deliberately no automatic retry: restarting the mic unasked is what
        // made it flick on and off.
        this.onNotice?.(NO_DICTATION);
        this.onCannotHear?.();
      } else if (c !== "aborted") {
        this.onNotice?.(`Voice input error: ${c}.`);
      }
    };
    this.recog = r;
  }

  private startRecognition(): void {
    if (!this.recog) {
      this.onNotice?.(NO_DICTATION);
      this.onCannotHear?.();
      return;
    }
    try { this.recog.start(); } catch { /* already running */ }
  }
}

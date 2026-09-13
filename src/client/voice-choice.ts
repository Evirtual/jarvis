/**
 * Which voice speaks.
 *
 * The service in use speaks, always, with its own AI voice: connected to
 * ChatGPT, ChatGPT's; to Gemini, Gemini's (main.ts offers only the service
 * in use). The voice picked for each service in Configuration → Voice is
 * remembered for it; until one is picked, the service's first voice.
 *
 * The device's own voice speaks only when there is no service to speak —
 * nothing connected — or while the service's voice is refused (a spent
 * allowance, no credit; see rest()), or when it is what was chosen last: a
 * phone's own voices answer at once, and stay on offer beside the service's.
 *
 * Nothing here makes a sound: voice.ts asks this what to speak with.
 */

import type { ProviderId, VoiceOption } from "../shared/types.js";
import { PROVIDER_IDS } from "../shared/types.js";
import { PROVIDERS } from "../shared/services/index.js";
import { rankDeviceVoices, shortName } from "./device-voices.js";
import { KEY, recall, store, voiceKeyFor } from "./storage.js";

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

/** "<source>:<id>" back into a selection, or null for anything else. */
function parseSelection(value: string): Selection | null {
  const at = value.indexOf(":");
  if (at < 0) return null;
  const source = value.slice(0, at), id = value.slice(at + 1);
  if (source === "device") return { kind: "device", name: id || null };
  if (id && (PROVIDER_IDS as readonly string[]).includes(source)) return { kind: "neural", via: source as ProviderId, id };
  return null;
}

/** How long a refused neural voice is left alone before it is asked again. */
const REST_MS = 10 * 60 * 1000;

export class VoiceChoice {
  /** The device voice in use — or the one to fall back to — when the browser names its voices; null means its default. */
  systemVoice: SpeechSynthesisVoice | null = null;
  private systemList: SpeechSynthesisVoice[] = [];
  /** The neural voices available right now, by the service that makes them. */
  private readonly neural = new Map<ProviderId, VoiceOption[]>();
  private chosen: Selection | null = null;
  /**
   * Services whose voice was refused (a spent allowance, no credit): why, and
   * until when the device's voice speaks instead. Each service rests on its
   * own — Gemini's limit never keeps ChatGPT quiet — and is cleared by the
   * next line it does speak.
   */
  private readonly resting = new Map<ProviderId, { until: number; reason: string }>();

  /** The choice, or the voices on offer, changed. */
  onState: (() => void) | null = null;
  onNotice: ((msg: string) => void) | null = null;

  /** `synth`: the device's own speech, where the browser has it. */
  constructor(private readonly synth: SpeechSynthesis | null) {
    this.watchSystemVoices();
  }

  get selection(): Selection | null { return this.chosen; }
  /** The device's voices the browser names, the most JARVIS-like first — empty where it names none. */
  get systemVoices(): SpeechSynthesisVoice[] { return this.systemList; }
  /** Whether the device can speak at all. */
  get deviceSpeaks(): boolean { return this.synth !== null; }

  /** The voices one service can speak with now — an empty list when it has gone. */
  setNeuralVoices(via: ProviderId, list: VoiceOption[]): void {
    const was = this.neural.get(via) ?? [];
    if (was.length === list.length && was.every((v, i) => v.id === list[i]?.id)) return;
    if (list.length) this.neural.set(via, list);
    else this.neural.delete(via);
    this.choose();
    this.onState?.(); // the voices on offer changed, whether or not the choice did
  }

  /** Every neural voice on offer. */
  neuralVoices(): NeuralVoice[] {
    return PROVIDER_IDS.flatMap((via) => (this.neural.get(via) ?? []).map((voice) => ({ via, voice })));
  }

  /** The browser's own voices, English first, the most JARVIS-like at the top. Some browsers hand them over a moment after the page loads. */
  private watchSystemVoices(): void {
    if (!this.synth) return;
    this.synth.addEventListener("voiceschanged", () => this.refreshSystemList());
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
    if (this.choose()) this.onState?.();
  }

  /** The service's voice when a service offers voices; the device's otherwise — or the device's anyway, when that is what was chosen last. Says whether the choice changed. */
  private choose(): boolean {
    const before = this.selectionValue;
    // The device voice — speaking now, or standing by for when the service can't.
    const name = recall(KEY.voiceDevice);
    this.systemVoice = (name && this.systemList.find((v) => v.name === name)) || (this.systemList[0] ?? null);

    const offered = this.neuralVoices();
    const via = offered[0]?.via;
    const deviceChosen = this.synth !== null && recall(KEY.voiceKind) === "device";
    if (via && !deviceChosen) {
      const wanted = recall(voiceKeyFor(via));
      const pick = offered.find((v) => v.voice.id === wanted) ?? offered[0]!;
      this.chosen = { kind: "neural", via, id: pick.voice.id };
    } else {
      this.chosen = this.synth ? { kind: "device", name: this.systemVoice?.name ?? null } : null;
    }
    return this.selectionValue !== before;
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
      store(voiceKeyFor(s.via), s.id);
      store(KEY.voiceKind, "neural");
      this.resting.delete(s.via); // chosen again: worth asking again
    } else {
      if (s.name) store(KEY.voiceDevice, s.name);
      store(KEY.voiceKind, "device");
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
  neuralNow(): NeuralVoice | null {
    return this.restingReason() === null ? this.current() : null;
  }

  /**
   * The chosen neural voice was refused: say why, once, and let the device's
   * voice speak for a while rather than wait on a refusal every sentence.
   */
  rest(via: ProviderId, reason: string): void {
    const first = !this.resting.has(via);
    this.resting.set(via, { until: Date.now() + REST_MS, reason });
    if (first) this.onNotice?.(`${reason} I'll speak with this device's voice meanwhile.`);
    this.onState?.();
  }

  /** A service's voice spoke: whatever stopped it has passed. */
  spoke(via: ProviderId): void {
    this.resting.delete(via);
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
}

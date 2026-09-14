/**
 * The console's back end, shared by its two homes: the PC's server and the
 * web page's own browser. Given somewhere the keys are kept (a KeyStore), it
 * does everything else the same way in both — checks a key and remembers what
 * it can reach, says which service is in use, and answers, hears and speaks
 * through it — so the two versions can't drift apart in behaviour or wording.
 *
 * The keys stay with the store: this never keeps one, and never shows more of
 * one than `maskKey` allows.
 */

import type {
  AskEvent, AskRequest, Catalogue, ConnectionsResponse, KeySource, ProviderId, ProviderStatus, ProviderView, SpeakRequest, StatusResponse, Turn, Effort } from "../types.js";
import { PROVIDER_IDS, isProviderId, DEFAULT_EFFORT } from "../types.js";
import { hearWith, humanise, PROVIDERS, SERVICES, speakWith } from "./index.js";
import { maskKey, personaFor, prepareTurns, type Service, wantsSearch } from "./common.js";

/** Where the keys live: in config.json beside the server, or in the browser's storage. */
export interface KeyStore {
  /** The key in use for a service and where it came from — null when there is none. */
  key(id: ProviderId): { key: string; source: KeySource } | null;
  /** The chat model chosen for a service, if one was chosen. */
  model(id: ProviderId): string | null;
  /** How long the service's model thinks, if it was chosen. */
  effort(id: ProviderId): Effort | null;
  /** The service chosen to answer, if one was chosen. */
  active(): ProviderId | null;
}

/** Whether a key works, and what its account can reach. */
export interface Validation {
  ok: boolean;
  catalogue: Catalogue | null;
  message: string | null;
  checkedAt: number;
}

/** Somewhere to keep what each key can reach between visits — never the keys themselves. */
export interface ValidationMemory {
  read(): Record<string, Validation>;
  write(all: Record<string, Validation>): void;
}

/** A service that can be used right now: its key, what it can reach, and the chat model in use. */
export interface Connected {
  key: string;
  source: KeySource;
  catalogue: Catalogue;
  model: string;
}

/** A question checked and ready to ask: who answers it, with what, and how. */
export interface Prepared {
  id: ProviderId;
  key: string;
  model: string;
  turns: Turn[];
  persona: string;
  /** Whether the service is offered its web search tool for this question (wantsSearch). */
  search: boolean;
  /** How long the model thinks about it: asked for in words, else the service's setting, else quick. */
  effort: Effort;
}

/**
 * Why the console couldn't do what was asked, in the user's words. `code`
 * lets the server choose a status; `cause` keeps the service's own words for
 * a log, and is never shown.
 */
export class CoreError extends Error {
  constructor(
    readonly code: "no_provider" | "no_key" | "no_turns" | "no_hearing" | "no_voice" | "unknown_voice" | "empty_text" | "ask_failed" | "hear_failed" | "speak_failed",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CoreError";
  }
}

/** A key is checked again after this long, in case the account has changed. */
const RECHECK_MS = 10 * 60 * 1000;
/** One line of speech, at most. */
const SPEECH_TEXT_MAX = 800;
/** Failures that belong to the account, not to one request: shown on the service's card until an answer succeeds. */
const ACCOUNT_PROBLEM = /out of credit|can't use that model/;
const NO_HEARING = "I've no way to hear you yet, sir — connect Gemini or ChatGPT in Configuration, or type instead.";

export class ConsoleCore {
  private readonly services: Record<ProviderId, Service>;
  private readonly checked: Map<string, Validation>;
  /** The last account-level failure per service, cleared by the next answer that succeeds. */
  private readonly problems = new Map<ProviderId, string>();

  constructor(
    private readonly store: KeyStore,
    private readonly memory?: ValidationMemory,
    services: Partial<Record<ProviderId, Service>> = {},
  ) {
    this.services = { ...SERVICES, ...services };
    this.checked = new Map(Object.entries(memory?.read() ?? {}));
  }

  /* ---------------- what a key can reach ---------------- */

  private static checkKey(id: ProviderId, key: string): string {
    return `${id}:${key.slice(-8)}`;
  }

  /** Prove a key works and find what it can reach — from memory unless it is stale or `force`d. */
  async validate(id: ProviderId, key: string, force = false): Promise<Validation> {
    const ck = ConsoleCore.checkKey(id, key);
    const hit = this.checked.get(ck);
    if (hit && !force && Date.now() - hit.checkedAt < RECHECK_MS) return hit;
    let result: Validation;
    try {
      const catalogue = await this.services[id].catalogue(key);
      result = {
        ok: catalogue.chat.length > 0,
        catalogue,
        message: catalogue.chat.length ? null : "The key works but no chat models are available on it.",
        checkedAt: Date.now(),
      };
    } catch (err) {
      result = { ok: false, catalogue: null, message: humanise(id, err), checkedAt: Date.now() };
    }
    this.checked.set(ck, result);
    this.memory?.write(Object.fromEntries(this.checked));
    return result;
  }

  /** Null when there is no key, or the key doesn't work. */
  async connected(id: ProviderId): Promise<Connected | null> {
    const resolved = this.store.key(id);
    if (!resolved) return null;
    const v = await this.validate(id, resolved.key);
    if (!v.ok || !v.catalogue) return null;
    return { key: resolved.key, source: resolved.source, catalogue: v.catalogue, model: this.modelFor(id, v.catalogue) };
  }

  /** The chosen chat model, unless the account no longer lists it (or it is no longer for chat): then the newest. */
  private modelFor(id: ProviderId, catalogue: Catalogue): string {
    const chosen = this.store.model(id);
    return chosen && catalogue.chat.includes(chosen) ? chosen : catalogue.chat[0] ?? "";
  }

  /* ---------------- the Connections screen ---------------- */

  private async view(id: ProviderId, revalidate: boolean): Promise<ProviderView> {
    const meta = PROVIDERS[id];
    const resolved = this.store.key(id);
    if (!resolved) return { ...meta, status: { state: "unconfigured" } };
    const v = await this.validate(id, resolved.key, revalidate);
    const problem = this.problems.get(id);
    const status: ProviderStatus = v.ok && v.catalogue
      ? {
          state: "ready",
          maskedKey: maskKey(resolved.key),
          source: resolved.source,
          models: v.catalogue.chat,
          model: this.modelFor(id, v.catalogue),
          voices: v.catalogue.voices,
          hears: v.catalogue.hearing.length > 0,
          thinks: this.services[id].thinks(this.modelFor(id, v.catalogue)),
          effort: this.store.effort(id) ?? DEFAULT_EFFORT,
          ...(problem ? { problem } : {}),
        }
      : { state: "error", maskedKey: maskKey(resolved.key), message: v.message ?? "Unknown error", source: resolved.source };
    return { ...meta, status };
  }

  /** Every service as its card shows it, and which one answers. */
  async connections(revalidate = false): Promise<ConnectionsResponse> {
    const providers = await Promise.all(PROVIDER_IDS.map((id) => this.view(id, revalidate)));
    // Never advertise a service that cannot answer.
    const ready = providers.filter((p) => p.status.state === "ready").map((p) => p.id);
    const chosen = this.store.active();
    const active = chosen && ready.includes(chosen) ? chosen : ready[0] ?? null;
    return { providers, active };
  }

  async status(): Promise<StatusResponse> {
    const conn = await this.connections();
    return { active: conn.active, anyProviderReady: conn.providers.some((p) => p.status.state === "ready") };
  }

  /** The service asked when the caller names none. */
  private async activeId(): Promise<ProviderId | null> {
    return (await this.connections()).active;
  }

  /** A key was forgotten: nothing more to say about its account. */
  forget(id: ProviderId): void {
    this.problems.delete(id);
  }

  /** A different model may be usable; being out of credit is account-wide and stays. */
  modelChanged(id: ProviderId): void {
    if (this.problems.get(id)?.includes("can't use that model")) this.problems.delete(id);
  }

  /* ---------------- asking ---------------- */

  /** Check a question can be asked, and by whom; the reasons it can't are in the user's words. */
  async prepare(body: AskRequest): Promise<Prepared> {
    const id = isProviderId(body.provider) ? body.provider : await this.activeId();
    if (!id) throw new CoreError("no_provider", "No reasoning core is connected.");
    const c = await this.connected(id);
    if (!c) throw new CoreError("no_key", `${PROVIDERS[id].name} isn't connected.`);
    // Live readings ride along with the newest question only, never the history.
    const turns = prepareTurns(body.turns, body.context);
    if (!turns) throw new CoreError("no_turns", "There's nothing to answer.");
    return { id, key: c.key, model: c.model, turns, persona: personaFor(body.address === "madam" ? "madam" : "sir"), search: body.search === true || wantsSearch(turns), effort: body.effort ?? this.store.effort(id) ?? DEFAULT_EFFORT };
  }

  /**
   * Stream the answer through `emit`. A failure is thrown in the user's
   * words, with the service's own kept as its cause; an account-level one is
   * remembered for the service's card.
   */
  async answer(q: Prepared, emit: (ev: AskEvent) => void, signal: AbortSignal): Promise<void> {
    try {
      await this.services[q.id].chat(q.key, q.model, q.turns, emit, signal, q.persona, { search: q.search, effort: q.effort });
      this.problems.delete(q.id);
    } catch (err) {
      if (signal.aborted) throw err;
      const message = humanise(q.id, err);
      if (ACCOUNT_PROBLEM.test(message)) this.problems.set(q.id, message);
      throw new CoreError("ask_failed", message, err);
    }
  }

  /* ---------------- hearing and speech ---------------- */

  /** What was said in a recording, heard by the active service. */
  async hear(audio: Blob): Promise<{ via: ProviderId; text: string }> {
    const id = await this.activeId();
    const c = id ? await this.connected(id) : null;
    if (!id || !c || !c.catalogue.hearing.length) throw new CoreError("no_hearing", NO_HEARING);
    try {
      return { via: id, text: await hearWith(this.services[id], c.key, c.catalogue.hearing, audio) };
    } catch (err) {
      throw new CoreError("hear_failed", humanise(id, err), err);
    }
  }

  /**
   * One line spoken by a service: 16-bit PCM at SPEECH_RATE, piece by piece
   * as it is made. The voice chosen in Configuration → Voice, or the
   * service's first if that isn't one of its own.
   */
  async speak(body: SpeakRequest): Promise<{ via: ProviderId; voice: string; pieces: AsyncIterable<Uint8Array> }> {
    const text = String(body.text ?? "").trim().slice(0, SPEECH_TEXT_MAX);
    if (!text) throw new CoreError("empty_text", "There's nothing to say.");
    if (!isProviderId(body.via)) throw new CoreError("unknown_voice", "That isn't a service I know.");
    const id = body.via;
    const c = await this.connected(id);
    if (!c || !c.catalogue.speech.length) throw new CoreError("no_voice", `${PROVIDERS[id].name} can't speak from here.`);
    const voice = c.catalogue.voices.some((v) => v.id === body.voice) ? body.voice : c.catalogue.voices[0]?.id ?? "";
    const speed = Math.min(1.4, Math.max(0.6, Number(body.speed) || 1));
    const raw = speakWith(this.services[id], c.key, c.catalogue.speech, text, voice, speed);
    const pieces = (async function* (): AsyncIterable<Uint8Array> {
      try {
        yield* raw;
      } catch (err) {
        throw new CoreError("speak_failed", humanise(id, err), err);
      }
    })();
    return { via: id, voice, pieces };
  }
}

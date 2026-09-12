/**
 * The services JARVIS connects to — one key each, and everything comes
 * through it: his reasoning, his hearing and his voice. Shared by the
 * console's server and, when the console runs on its own as a web page, by
 * the browser itself, so both behave the same.
 *
 * Two services, behind one interface (common.ts): Gemini, free, and OpenAI.
 * Each finds what its key can reach rather than assuming model names, so
 * the Connections screen always shows what the account really has.
 */

import type { ProviderId, ProviderMeta } from "../types.js";
import { gemini } from "./gemini.js";
import { openai } from "./openai.js";
import type { Service } from "./common.js";

export {
  MANNER, PERSONA, SPEECH_RATE, bytesOf, maskKey, personaFor, prepareTurns, rankModels,
  type Address, type Service,
} from "./common.js";

const SERVICES: Record<ProviderId, Service> = { gemini, openai };

export function serviceFor(id: ProviderId): Service {
  return SERVICES[id];
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = { gemini: gemini.meta, openai: openai.meta };

/*
 * A free tier gives each model its own small allowance — Gemini's newest
 * voice, ten lines a day — so the account's models for a job are tried in
 * order until one answers. A model that has used its allowance is left alone
 * for a while rather than asked again for every sentence.
 */

const spent = new Map<string, number>(); // model → when to try it again
const REST = 15 * 60 * 1000;

function exhausted(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return (err as { status?: number } | null)?.status === 429 || /quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(raw);
}

function usable(models: string[]): string[] {
  const now = Date.now();
  const fresh = models.filter((m) => (spent.get(m) ?? 0) <= now);
  return fresh.length ? fresh : models; // all resting: try them anyway rather than fall silent
}

/** Speech through the first of the account's speech models that answers. */
export async function* speakWith(id: ProviderId, key: string, models: string[], text: string, voice: string, speed: number): AsyncIterable<Uint8Array> {
  let last: unknown = new Error(`${PROVIDERS[id].name} has no speech model on this account.`);
  for (const model of usable(models)) {
    const pieces = serviceFor(id).speak(key, model, text, voice, speed)[Symbol.asyncIterator]();
    let first: IteratorResult<Uint8Array>;
    try {
      first = await pieces.next();
    } catch (err) {
      if (exhausted(err)) spent.set(model, Date.now() + REST);
      last = err;
      continue;
    }
    if (first.done) continue;
    yield first.value;
    for (;;) {
      const next = await pieces.next();
      if (next.done) return;
      yield next.value;
    }
  }
  throw last;
}

/** What was said, through the first of the account's hearing models that answers. */
export async function hearWith(id: ProviderId, key: string, models: string[], audio: Blob): Promise<string> {
  let last: unknown = new Error(`${PROVIDERS[id].name} has no hearing model on this account.`);
  for (const model of usable(models)) {
    try {
      return await serviceFor(id).hear(key, model, audio);
    } catch (err) {
      if (exhausted(err)) spent.set(model, Date.now() + REST);
      last = err;
    }
  }
  throw last;
}

/** Turn a service's error into something a person can act on. */
export function humanise(id: ProviderId, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number } | null)?.status;
  const name = PROVIDERS[id].name;

  if (status === 401 || /401|unauthor|invalid[_ ]api[_ ]key|API key not valid/i.test(raw)) {
    return `That key was rejected by ${name}. Check you copied all of it.`;
  }
  if (status === 403 || /403|permission|forbidden/i.test(raw)) {
    return `${name} accepted the key but refused the request — the key may lack model access.`;
  }
  // Gemini's "quota" is the free tier's allowance, per minute and per day, and
  // the voice has a smaller one than the answers.
  if (id === "gemini" && (status === 429 || /quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(raw))) {
    const daily = /PerDay|per.?day|daily/i.test(raw);
    const what = /tts/i.test(raw) ? "Gemini's voice" : "Gemini's free tier";
    return daily
      ? `${what} has used today's free allowance, sir — it comes back tomorrow.`
      : `${what} is at its limit for the moment, sir — it's back within a minute.`;
  }
  // Out of credit is account-wide: switching to another of this service's models won't help.
  if (/no credits|credit balance|insufficient_quota|exceeded your current quota|billing|payment required/i.test(raw)) {
    return `The ${name} account is out of credit, sir — every ${name} model stops until credit is added on ${name}'s billing page. Gemini's free tier works meanwhile — Configuration → Connections.`;
  }
  if (status === 429 || /429|rate.?limit|quota|insufficient_quota/i.test(raw)) {
    return `${name} is rate-limiting or out of quota. Wait a moment, or check your billing.`;
  }
  // OpenAI says "does not exist or you do not have access" both for a retired
  // model and for one this account can't use (often no credit) — say both.
  if (/do(?:es)? not have access|not have access to it/i.test(raw)) {
    return `This ${name} account can't use that model — it may be retired, or the account may lack access or credit. Try another model, or check the account's billing.`;
  }
  // The service's own side is overloaded, or sent nothing back: nothing wrong
  // with the key or the account, and the other service can answer meanwhile.
  if (status === 503 || /\b503\b|UNAVAILABLE|high demand|overloaded/i.test(raw)) {
    return `${name} is busy at the moment, sir — high demand on its side. Try again in a minute.`;
  }
  if (/returned no answer/i.test(raw)) {
    return `${name} is busy at the moment, sir — it sent back an empty answer. Try again in a minute.`;
  }
  if (status === 404 || /404|deprecat|has been retired|model.*not found/i.test(raw)) {
    return "That model is no longer available. Pick another from the list.";
  }
  if (/ENOTFOUND|ECONNREFUSED|timeout|fetch failed|UND_ERR|TimeoutError/i.test(raw)) {
    return `Could not reach ${name}. Check the network connection.`;
  }
  return raw.slice(0, 200);
}

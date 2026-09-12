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
  MANNER, PERSONA, personaFor, prepareTurns, rankModels,
  type Address, type Service,
} from "./common.js";

const SERVICES: Record<ProviderId, Service> = { gemini, openai };

export function serviceFor(id: ProviderId): Service {
  return SERVICES[id];
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = { gemini: gemini.meta, openai: openai.meta };

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
  // Out of credit is account-wide: switching to another of this service's models won't help.
  if (/no credits|credit balance|insufficient_quota|exceeded your current quota|billing|payment required/i.test(raw)) {
    const free = id === "gemini" ? "" : " Gemini's free tier works meanwhile — Configuration → Connections.";
    return `The ${name} account is out of credit, sir — every ${name} model stops until credit is added on ${name}'s billing page.${free}`;
  }
  if (status === 429 || /429|rate.?limit|quota|insufficient_quota|RESOURCE_EXHAUSTED/i.test(raw)) {
    return id === "gemini"
      ? "Gemini's free tier is at its limit for the moment, sir — a minute's pause, or the daily allowance resets overnight."
      : `${name} is rate-limiting or out of quota. Wait a moment, or check your billing.`;
  }
  // OpenAI says "does not exist or you do not have access" both for a retired
  // model and for one this account can't use (often no credit) — say both.
  if (/do(?:es)? not have access|not have access to it/i.test(raw)) {
    return `This ${name} account can't use that model — it may be retired, or the account may lack access or credit. Try another model, or check the account's billing.`;
  }
  if (status === 404 || /404|deprecat|has been retired|model.*not found/i.test(raw)) {
    return "That model is no longer available. Pick another from the list.";
  }
  if (/ENOTFOUND|ECONNREFUSED|timeout|fetch failed|UND_ERR|TimeoutError/i.test(raw)) {
    return `Could not reach ${name}. Check the network connection.`;
  }
  return raw.slice(0, 200);
}

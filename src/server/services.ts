/**
 * The services, as the server uses them: the shared implementations
 * (shared/services), a validation cache so the Connections screen is
 * instant, and what is in use for each service — the key, and the model and
 * voice chosen in config.json or, failing a choice, the newest the account
 * offers.
 */

import type { Catalogue, KeySource, ProviderId } from "../shared/types.js";
import { humanise, serviceFor } from "../shared/services/index.js";
import { getModel, resolveKey } from "./config.js";

export { PROVIDERS, SPEECH_RATE, hearWith, humanise, personaFor, prepareTurns, serviceFor, speakWith } from "../shared/services/index.js";

/* ------------------------------------------------------------------ *
 * Cached validation, so a key is never re-checked on every page load.
 * ------------------------------------------------------------------ */

export interface Validation {
  ok: boolean;
  catalogue: Catalogue | null;
  message: string | null;
  checkedAt: number;
}

const validations = new Map<string, Validation>();
const cacheKey = (id: ProviderId, key: string): string => `${id}:${key.slice(-8)}`;

export function cachedValidation(id: ProviderId, key: string): Validation | null {
  return validations.get(cacheKey(id, key)) ?? null;
}

export async function validate(id: ProviderId, key: string, force = false): Promise<Validation> {
  const ck = cacheKey(id, key);
  const hit = validations.get(ck);
  if (hit && !force && Date.now() - hit.checkedAt < 10 * 60 * 1000) return hit;

  let result: Validation;
  try {
    const catalogue = await serviceFor(id).catalogue(key);
    result = {
      ok: catalogue.chat.length > 0,
      catalogue,
      message: catalogue.chat.length ? null : "The key works but no chat models are available on it.",
      checkedAt: Date.now(),
    };
  } catch (err) {
    result = { ok: false, catalogue: null, message: humanise(id, err), checkedAt: Date.now() };
  }
  validations.set(ck, result);
  return result;
}

/* ------------------------------------------------------------------ *
 * What is in use
 * ------------------------------------------------------------------ */

/** A service that can be used right now: its key, and its choices for each job. */
export interface Connected {
  key: string;
  source: KeySource;
  catalogue: Catalogue;
  /** The chat model in use. */
  model: string;
}

/** Null when there is no key, or the key doesn't work. */
export async function connected(id: ProviderId): Promise<Connected | null> {
  const resolved = resolveKey(id);
  if (!resolved) return null;
  const v = cachedValidation(id, resolved.key) ?? (await validate(id, resolved.key));
  if (!v.ok || !v.catalogue) return null;
  const chosen = getModel(id);
  return {
    key: resolved.key,
    source: resolved.source,
    catalogue: v.catalogue,
    model: chosen && v.catalogue.chat.includes(chosen) ? chosen : v.catalogue.chat[0]!,
  };
}

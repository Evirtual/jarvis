/**
 * The reasoning cores, as the server uses them: the shared adapters (see
 * shared/providers.ts), a validation cache so the Connections screen is
 * instant, and the model chosen in config.json.
 */

import type { ProviderId } from "../shared/types.js";
import { adapterFor, humanise } from "../shared/providers.js";
import { getModel, resolveKey } from "./config.js";

export { PROVIDERS, PERSONA, personaFor, rankModels, adapterFor, humanise, prepareTurns, type Address, type ProviderAdapter } from "../shared/providers.js";

/* ------------------------------------------------------------------ *
 * Cached validation, so the Connections screen is instant after the
 * first check and a key is never re-validated on every page load.
 * ------------------------------------------------------------------ */

export interface Validation {
  ok: boolean;
  models: string[];
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
    const models = await adapterFor(id).listModels(key);
    result = {
      ok: models.length > 0,
      models,
      message: models.length ? null : "The key works but no chat models are available on it.",
      checkedAt: Date.now(),
    };
  } catch (err) {
    result = {
      ok: false,
      models: [],
      message: humanise(id, err),
      checkedAt: Date.now(),
    };
  }
  validations.set(ck, result);
  return result;
}

/** The model to use: whatever was chosen, else the best-ranked one available. */
export async function activeModelFor(id: ProviderId): Promise<string | null> {
  const chosen = getModel(id);
  if (chosen) return chosen;
  const resolved = resolveKey(id);
  if (!resolved) return null;
  const v = await validate(id, resolved.key);
  return v.models[0] ?? null;
}

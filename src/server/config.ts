/**
 * Credential and preference store.
 *
 * Keys live in config.json next to the server, readable only by this user, and
 * they never travel back to the browser — the Connections screen only ever sees
 * a masked tail like `sk-…4f2a`. An environment variable, if one is set, still
 * works and is reported as such so the UI can say where the credential came
 * from instead of leaving the user guessing.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { KeySource, ProviderId, Effort } from "../shared/types.js";
import { isProviderId, isEffort } from "../shared/types.js";
import { PROVIDERS } from "../shared/services/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// dist/server/config.js and src/server/config.ts both resolve to the project root.
const ROOT = path.resolve(HERE, "..", "..");
const CONFIG_PATH = path.join(ROOT, "config.json");

interface StoredProvider {
  apiKey?: string;
  /** The chat model chosen for this service; the newest on the account when unset. */
  model?: string;
  /** How long its model thinks; quick when unset. */
  effort?: Effort;
  /**
   * Disconnected while its key came from the environment: the variable can't
   * be removed from here (and other tools may rely on it), so it's ignored
   * until a key is connected again.
   */
  ignoreEnv?: boolean;
}

interface StoredConfig {
  providers: Partial<Record<ProviderId, StoredProvider>>;
  active: ProviderId | null;
}

let cache: StoredConfig = { providers: {}, active: null };

export function loadConfig(): StoredConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    const providers: StoredConfig["providers"] = {};
    for (const [k, v] of Object.entries(parsed.providers ?? {})) {
      if (!isProviderId(k) || typeof v !== "object" || v === null) continue;
      const entry = v as StoredProvider;
      providers[k] = {
        ...(typeof entry.apiKey === "string" ? { apiKey: entry.apiKey } : {}),
        ...(typeof entry.model === "string" ? { model: entry.model } : {}),
        ...(isEffort(entry.effort) ? { effort: entry.effort } : {}),
        ...(entry.ignoreEnv === true ? { ignoreEnv: true } : {}),
      };
    }
    cache = {
      providers,
      active: isProviderId(parsed.active) ? parsed.active : null,
    };
  } catch {
    cache = { providers: {}, active: null };
  }
  return cache;
}

async function persist(): Promise<void> {
  const body = JSON.stringify(cache, null, 2);
  await fsp.writeFile(CONFIG_PATH, body, { encoding: "utf8", mode: 0o600 });
  // writeFile's mode only applies on create; enforce it on every save.
  await fsp.chmod(CONFIG_PATH, 0o600).catch(() => {});
}

/** The key we should actually use, and where it came from. */
export function resolveKey(id: ProviderId): { key: string; source: KeySource } | null {
  const saved = cache.providers[id]?.apiKey;
  if (saved) return { key: saved, source: "saved" };
  const fromEnv = process.env[PROVIDERS[id].envVar];
  if (fromEnv && !cache.providers[id]?.ignoreEnv) return { key: fromEnv, source: "environment" };
  return null;
}

export async function setKey(id: ProviderId, apiKey: string): Promise<void> {
  const entry = cache.providers[id] ?? {};
  entry.apiKey = apiKey;
  delete entry.ignoreEnv; // connecting again undoes a disconnect
  cache.providers[id] = entry;
  if (!cache.active) cache.active = id;
  await persist();
}

export async function clearKey(id: ProviderId): Promise<void> {
  const entry = cache.providers[id] ?? {};
  delete entry.apiKey;
  // A key from the environment would otherwise come straight back: ignore it.
  if (process.env[PROVIDERS[id].envVar]) entry.ignoreEnv = true;
  cache.providers[id] = entry;
  if (cache.active === id) cache.active = null;
  await persist();
}

export function getModel(id: ProviderId): string | null {
  return cache.providers[id]?.model ?? null;
}

export async function setModel(id: ProviderId, model: string): Promise<void> {
  const entry = cache.providers[id] ?? {};
  entry.model = model;
  cache.providers[id] = entry;
  await persist();
}

export function getEffort(id: ProviderId): Effort | null {
  return cache.providers[id]?.effort ?? null;
}

export async function setEffort(id: ProviderId, effort: Effort): Promise<void> {
  const entry = cache.providers[id] ?? {};
  entry.effort = effort;
  cache.providers[id] = entry;
  await persist();
}

export function getActive(): ProviderId | null {
  return cache.active;
}

export async function setActive(id: ProviderId | null): Promise<void> {
  cache.active = id;
  await persist();
}

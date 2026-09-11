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

import type { KeySource, ProviderId } from "../shared/types.js";
import { PROVIDER_IDS } from "../shared/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// dist/server/config.js and src/server/config.ts both resolve to the project root.
export const ROOT = path.resolve(HERE, "..", "..");
const CONFIG_PATH = path.join(ROOT, "config.json");

const ENV_VAR: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
};

interface StoredProvider {
  apiKey?: string;
  model?: string;
}

interface StoredConfig {
  providers: Partial<Record<ProviderId, StoredProvider>>;
  active: ProviderId | null;
  voice?: string;
}

let cache: StoredConfig = { providers: {}, active: null };

function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && (PROVIDER_IDS as readonly string[]).includes(v);
}

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
      };
    }
    cache = {
      providers,
      active: isProviderId(parsed.active) ? parsed.active : null,
      ...(typeof parsed.voice === "string" ? { voice: parsed.voice } : {}),
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
  const envName = ENV_VAR[id];
  const fromEnv = process.env[envName];
  if (fromEnv) return { key: fromEnv, source: "environment" };
  return null;
}

export function maskKey(key: string): string {
  const tail = key.slice(-4);
  const head = key.slice(0, Math.min(7, Math.max(0, key.length - 4)));
  return `${head}…${tail}`;
}

export async function setKey(id: ProviderId, apiKey: string): Promise<void> {
  const entry = cache.providers[id] ?? {};
  entry.apiKey = apiKey;
  cache.providers[id] = entry;
  if (!cache.active) cache.active = id;
  await persist();
}

export async function clearKey(id: ProviderId): Promise<void> {
  const entry = cache.providers[id];
  if (entry) delete entry.apiKey;
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

export function getActive(): ProviderId | null {
  return cache.active;
}

export async function setActive(id: ProviderId | null): Promise<void> {
  cache.active = id;
  await persist();
}

export function getVoice(): string | null {
  return cache.voice ?? null;
}

export async function setVoice(voice: string): Promise<void> {
  cache.voice = voice;
  await persist();
}

export function envVarName(id: ProviderId): string {
  return ENV_VAR[id];
}

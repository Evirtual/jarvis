/**
 * The console's back end, in the browser — for when it runs on its own,
 * published as a web page, with no server behind it.
 *
 * It answers exactly as the server does (the same shapes, the same messages),
 * using the same services (shared/services). The difference is where the
 * keys live: in this browser's storage, on the user's own device, sent to
 * nobody but the service they belong to.
 */

import type {
  AskRequest, AskStatus, Catalogue, ConnectionsResponse, ProviderId, ProviderStatus, ProviderView, SpeakRequest, StatusResponse,
} from "../shared/types.js";
import { PROVIDER_IDS } from "../shared/types.js";
import { PROVIDERS, humanise, personaFor, prepareTurns, serviceFor } from "../shared/services/index.js";
import { recall, store } from "./dom.js";

/* ---------------- the keys, on this device ---------------- */

interface Saved {
  providers: Partial<Record<ProviderId, { key: string; model?: string }>>;
  active: ProviderId | null;
}

const KEYS = "jarvis.cores";

function load(): Saved {
  try {
    const s = JSON.parse(recall(KEYS) ?? "") as Partial<Saved>;
    const providers: Saved["providers"] = {};
    for (const id of PROVIDER_IDS) {
      const p = s.providers?.[id];
      if (p && typeof p.key === "string" && p.key) providers[id] = { key: p.key, ...(typeof p.model === "string" ? { model: p.model } : {}) };
    }
    return { providers, active: PROVIDER_IDS.includes(s.active as ProviderId) ? (s.active as ProviderId) : null };
  } catch {
    return { providers: {}, active: null };
  }
}

let saved = load();
const persist = (): void => store(KEYS, JSON.stringify(saved));

function mask(key: string): string {
  const tail = key.slice(-4);
  const head = key.slice(0, Math.min(7, Math.max(0, key.length - 4)));
  return `${head}…${tail}`;
}

/* ---------------- validation, cached as the server caches it ---------------- */

interface Validation { ok: boolean; catalogue: Catalogue | null; message: string | null; checkedAt: number }
const CHECKED = "jarvis.coresChecked";
// What each key can reach (never the keys) is kept between visits, so the
// Connections screen is instant; a key is re-checked after ten minutes.
const checked = new Map<string, Validation>(Object.entries(((): Record<string, Validation> => {
  try { return JSON.parse(recall(CHECKED) ?? "{}") as Record<string, Validation>; } catch { return {}; }
})()));
const checkKey = (id: ProviderId, key: string): string => `${id}:${key.slice(-8)}`;

async function validate(id: ProviderId, key: string, force = false): Promise<Validation> {
  const ck = checkKey(id, key);
  const hit = checked.get(ck);
  if (hit && !force && hit.catalogue && Date.now() - hit.checkedAt < 10 * 60 * 1000) return hit;
  let v: Validation;
  try {
    const catalogue = await serviceFor(id).catalogue(key);
    v = { ok: catalogue.chat.length > 0, catalogue, message: catalogue.chat.length ? null : "The key works but no chat models are available on it.", checkedAt: Date.now() };
  } catch (err) {
    v = { ok: false, catalogue: null, message: humanise(id, err), checkedAt: Date.now() };
  }
  checked.set(ck, v);
  store(CHECKED, JSON.stringify(Object.fromEntries(checked)));
  return v;
}

/** A service that can be used right now: its key, what it can reach, and the chat model in use. */
async function connected(id: ProviderId): Promise<{ key: string; catalogue: Catalogue; model: string } | null> {
  const p = saved.providers[id];
  if (!p) return null;
  const v = await validate(id, p.key);
  if (!v.ok || !v.catalogue) return null;
  const model = p.model && v.catalogue.chat.includes(p.model) ? p.model : v.catalogue.chat[0]!;
  return { key: p.key, catalogue: v.catalogue, model };
}

/** The last account-level failure per service (no credit, no access), shown on its card until an answer succeeds. */
const lastProblem = new Map<ProviderId, string>();

async function view(id: ProviderId, revalidate: boolean): Promise<ProviderView> {
  const meta = PROVIDERS[id];
  const p = saved.providers[id];
  if (!p) return { ...meta, status: { state: "unconfigured" } };
  const v = await validate(id, p.key, revalidate);
  const status: ProviderStatus = v.ok && v.catalogue
    ? {
        state: "ready", maskedKey: mask(p.key), source: "saved",
        // a model chosen earlier that the account no longer lists (or that is no longer for chat) gives way to the newest
        models: v.catalogue.chat, model: p.model && v.catalogue.chat.includes(p.model) ? p.model : v.catalogue.chat[0] ?? "",
        voices: v.catalogue.voices, hears: v.catalogue.hearing.length > 0,
        ...(lastProblem.has(id) ? { problem: lastProblem.get(id)! } : {}),
      }
    : { state: "error", maskedKey: mask(p.key), message: v.message ?? "Unknown error", source: "saved" };
  return { ...meta, status };
}

async function connections(revalidate = false): Promise<ConnectionsResponse> {
  saved = load(); // another tab may have connected something
  const providers = await Promise.all(PROVIDER_IDS.map((id) => view(id, revalidate)));
  const ready = providers.filter((p) => p.status.state === "ready").map((p) => p.id);
  // Never advertise a core that cannot answer.
  const active = saved.active && ready.includes(saved.active) ? saved.active : ready[0] ?? null;
  return { providers, active };
}

async function saveKey(id: ProviderId, apiKey: string): Promise<ConnectionsResponse> {
  const key = apiKey.trim();
  if (!key) throw new Error("Paste the key first.");
  const v = await validate(id, key, true);
  if (!v.ok) throw new Error(v.message ?? "That key didn't work.");
  const model = saved.providers[id]?.model;
  saved.providers[id] = { key, ...(model ? { model } : {}) };
  if (!saved.active) saved.active = id;
  persist();
  return connections();
}

async function removeKey(id: ProviderId): Promise<ConnectionsResponse> {
  delete saved.providers[id];
  if (saved.active === id) saved.active = null;
  lastProblem.delete(id);
  persist();
  return connections();
}

async function selectModel(id: ProviderId, model: string): Promise<ConnectionsResponse> {
  const p = saved.providers[id];
  if (p) { p.model = model; persist(); }
  // a different model may be usable; out of credit is account-wide and stays
  if (lastProblem.get(id)?.includes("can't use that model")) lastProblem.delete(id);
  return connections();
}

async function setActive(id: ProviderId): Promise<ConnectionsResponse> {
  saved.active = id;
  persist();
  return connections();
}

/** Which service is asked when the caller names none. */
async function activeId(): Promise<ProviderId | null> {
  return (await connections()).active;
}

/* ---------------- asking ---------------- */

async function ask(body: AskRequest, onDelta: (full: string) => void, onStatus: (s: AskStatus) => void, signal?: AbortSignal): Promise<string> {
  const id = body.provider && PROVIDER_IDS.includes(body.provider) ? body.provider : await activeId();
  if (!id) throw new Error("No reasoning core is connected.");
  const c = await connected(id);
  if (!c) throw new Error(`${PROVIDERS[id].name} isn't connected.`);
  const turns = prepareTurns(body.turns, body.context);
  if (!turns) throw new Error("There's nothing to answer.");

  const ac = new AbortController();
  signal?.addEventListener("abort", () => ac.abort(), { once: true });
  let out = "";
  onStatus("thinking");
  try {
    await serviceFor(id).chat(c.key, c.model, turns, (ev) => {
      if (ev.t === "text") { out += ev.delta; onDelta(out); }
      else if (ev.t === "status") onStatus(ev.status);
    }, ac.signal, personaFor(body.address === "madam" ? "madam" : "sir"));
    lastProblem.delete(id);
  } catch (err) {
    if (ac.signal.aborted) throw err;
    const message = humanise(id, err);
    if (/out of credit|can't use that model/.test(message)) lastProblem.set(id, message);
    console.warn(`[${id}] ${c.model}:`, err);
    if (!out) throw new Error(message);
  }
  return out.trim();
}

/* ---------------- hearing and speech, through the services ---------------- */

async function transcribe(audio: Blob): Promise<string> {
  const id = await activeId();
  const c = id ? await connected(id) : null;
  const model = c?.catalogue.hearing[0];
  if (!id || !c || !model) throw new Error("I've no way to hear you yet, sir — connect Gemini or ChatGPT in Configuration, or type instead.");
  try {
    return await serviceFor(id).hear(c.key, model, audio);
  } catch (err) {
    throw new Error(humanise(id, err));
  }
}

async function speak(body: SpeakRequest): Promise<Blob> {
  const id = body.via;
  const c = await connected(id);
  const model = c?.catalogue.speech[0];
  if (!c || !model) throw new Error(`${PROVIDERS[id].name} can't speak from here.`);
  const voice = c.catalogue.voices.some((v) => v.id === body.voice) ? body.voice : c.catalogue.voices[0]?.id ?? "";
  try {
    return new Blob([await serviceFor(id).speak(c.key, model, body.text, voice, body.speed)], { type: "audio/wav" });
  } catch (err) {
    throw new Error(humanise(id, err));
  }
}

/* ---------------- status ---------------- */

async function status(): Promise<StatusResponse> {
  const conn = await connections();
  return {
    active: conn.active,
    anyProviderReady: conn.providers.some((p) => p.status.state === "ready"),
  };
}

export const browserCore = { connections, saveKey, removeKey, selectModel, setActive, ask, transcribe, status, speak };

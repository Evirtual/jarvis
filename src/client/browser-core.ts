/**
 * The console's back end, in the browser — for when it runs on its own,
 * published as a web page, with no server behind it.
 *
 * It answers exactly as the server does (the same shapes, the same messages),
 * using the same provider code (shared/providers.ts). The difference is where
 * the keys live: in this browser's storage, on the user's own device, sent to
 * nobody but the provider they belong to.
 */

import type {
  AskRequest, AskStatus, ConnectionsResponse, ProviderId, ProviderStatus, ProviderView, StatusResponse,
} from "../shared/types.js";
import { PROVIDER_IDS } from "../shared/types.js";
import { PROVIDERS, adapterFor, humanise, personaFor, prepareTurns } from "../shared/providers.js";
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

interface Validation { ok: boolean; models: string[]; message: string | null; checkedAt: number }
const CHECKED = "jarvis.coresChecked";
// The model lists (never the keys) are kept between visits, so the Connections
// screen is instant; a key is re-checked after ten minutes.
const checked = new Map<string, Validation>(Object.entries(((): Record<string, Validation> => {
  try { return JSON.parse(recall(CHECKED) ?? "{}") as Record<string, Validation>; } catch { return {}; }
})()));
const checkKey = (id: ProviderId, key: string): string => `${id}:${key.slice(-8)}`;

async function validate(id: ProviderId, key: string, force = false): Promise<Validation> {
  const ck = checkKey(id, key);
  const hit = checked.get(ck);
  if (hit && !force && Date.now() - hit.checkedAt < 10 * 60 * 1000) return hit;
  let v: Validation;
  try {
    const models = await adapterFor(id).listModels(key);
    v = { ok: models.length > 0, models, message: models.length ? null : "The key works but no chat models are available on it.", checkedAt: Date.now() };
  } catch (err) {
    v = { ok: false, models: [], message: humanise(id, err), checkedAt: Date.now() };
  }
  checked.set(ck, v);
  store(CHECKED, JSON.stringify(Object.fromEntries(checked)));
  return v;
}

/** The last account-level failure per service (no credit, no access), shown on its card until an answer succeeds. */
const lastProblem = new Map<ProviderId, string>();

async function view(id: ProviderId, revalidate: boolean): Promise<ProviderView> {
  const meta = PROVIDERS[id];
  const p = saved.providers[id];
  if (!p) return { ...meta, status: { state: "unconfigured" } };
  const v = await validate(id, p.key, revalidate);
  const status: ProviderStatus = v.ok
    ? {
        state: "ready", maskedKey: mask(p.key), models: v.models, model: p.model ?? v.models[0] ?? "", source: "saved",
        ...(lastProblem.has(id) ? { problem: lastProblem.get(id)! } : {}),
      }
    : { state: "error", maskedKey: mask(p.key), message: v.message ?? "Unknown error", source: "saved" };
  return { ...meta, status };
}

async function connections(revalidate = false): Promise<ConnectionsResponse> {
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
  saved.providers[id] = { key, ...(saved.providers[id]?.model ? { model: saved.providers[id]!.model! } : { model: v.models[0]! }) };
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

/* ---------------- asking ---------------- */

async function ask(body: AskRequest, onDelta: (full: string) => void, onStatus: (s: AskStatus) => void, signal?: AbortSignal): Promise<string> {
  const conn = await connections();
  const id = body.provider && PROVIDER_IDS.includes(body.provider) ? body.provider : conn.active;
  if (!id) throw new Error("No reasoning core is connected.");
  const p = saved.providers[id];
  if (!p) throw new Error(`${PROVIDERS[id].name} has no key.`);
  const model = p.model ?? (await validate(id, p.key)).models[0];
  if (!model) throw new Error(`No model selected for ${PROVIDERS[id].name}.`);
  const turns = prepareTurns(body.turns, body.context);
  if (!turns) throw new Error("There's nothing to answer.");

  const ac = new AbortController();
  signal?.addEventListener("abort", () => ac.abort(), { once: true });
  let out = "";
  onStatus("thinking");
  try {
    await adapterFor(id).stream(p.key, model, turns, (ev) => {
      if (ev.t === "text") { out += ev.delta; onDelta(out); }
      else if (ev.t === "status") onStatus(ev.status);
    }, ac.signal, personaFor(body.address === "madam" ? "madam" : "sir"));
    lastProblem.delete(id);
  } catch (err) {
    if (ac.signal.aborted) throw err;
    const message = humanise(id, err);
    if (/out of credit|can't use that model/.test(message)) lastProblem.set(id, message);
    console.warn(`[${id}] ${model}:`, err);
    if (!out) throw new Error(message);
  }
  return out.trim();
}

/* ---------------- speech to text, through the OpenAI key ---------------- */

const TRANSCRIBERS = ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"];
let transcriber: string | null = null;

async function transcribe(audio: Blob): Promise<string> {
  const key = saved.providers.openai?.key;
  if (!key) throw new Error("Speech recognition needs ChatGPT connected — add it in Config.");
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });
  if (!transcriber) {
    const ids = new Set<string>();
    for await (const m of await client.models.list()) ids.add(m.id);
    transcriber = TRANSCRIBERS.find((m) => ids.has(m)) ?? "whisper-1";
  }
  const type = audio.type || "audio/webm";
  const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "mp4" : type.includes("wav") ? "wav" : "webm";
  // Bias the transcriber toward words this console actually uses.
  const prompt =
    "JARVIS, sir. Voices: George, Fable, Lewis, Daniel, Emma, Alice, Isabella, Lily, Michael. " +
    "Services: ChatGPT, Claude, Gemini. Commands: new thread, close thread, status, uplink, locate me.";
  const res = await client.audio.transcriptions.create({ file: new File([audio], `speech.${ext}`, { type }), model: transcriber, language: "en", prompt });
  return (res.text ?? "").trim();
}

/* ---------------- status ---------------- */

async function status(): Promise<StatusResponse> {
  const conn = await connections();
  return {
    kokoro: "failed",
    kokoroError: "no neural voice in the browser yet",
    dtype: "",
    voices: [],
    active: conn.active,
    anyProviderReady: conn.providers.some((p) => p.status.state === "ready"),
    transcription: !!saved.providers.openai,
  };
}

export const browserCore = { connections, saveKey, removeKey, selectModel, setActive, ask, transcribe, status };

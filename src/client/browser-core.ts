/**
 * The console's back end, in the browser — for when it runs on its own,
 * published as a web page, with no server behind it.
 *
 * The shared core (shared/services/console.ts) does the work, exactly as the
 * server does it. What is different is where the keys live: in this browser's
 * storage, on the user's own device, sent to nobody but the service they
 * belong to.
 */

import type { AskRequest, AskStatus, ConnectionsResponse, ProviderId, SpeakRequest, StatusResponse, Effort } from "../shared/types.js";
import { PROVIDER_IDS, isProviderId, isEffort } from "../shared/types.js";
import { PROVIDERS } from "../shared/services/index.js";
import { ConsoleCore, type Validation } from "../shared/services/console.js";
import { KEY, recall, store } from "./storage.js";

/* ---------------- the keys, on this device ---------------- */

interface Saved {
  providers: Partial<Record<ProviderId, { key: string; model?: string; effort?: Effort }>>;
  active: ProviderId | null;
}

function load(): Saved {
  try {
    const s = JSON.parse(recall(KEY.cores) ?? "") as Partial<Saved>;
    const providers: Saved["providers"] = {};
    for (const id of PROVIDER_IDS) {
      const p = s.providers?.[id];
      if (p && typeof p.key === "string" && p.key) providers[id] = { key: p.key, ...(typeof p.model === "string" ? { model: p.model } : {}), ...(isEffort(p.effort) ? { effort: p.effort } : {}) };
    }
    return { providers, active: isProviderId(s.active) ? s.active : null };
  } catch {
    return { providers: {}, active: null };
  }
}

let saved = load();
/** False when the browser refused to keep them (storage full, or a private window that blocks it). */
const persist = (): boolean => store(KEY.cores, JSON.stringify(saved));

/* ---------------- the core, with those keys ---------------- */

// What each key can reach (never the keys) is kept between visits, so the
// Connections screen is instant.
const core = new ConsoleCore(
  {
    key: (id) => (saved.providers[id] ? { key: saved.providers[id]!.key, source: "saved" } : null),
    model: (id) => saved.providers[id]?.model ?? null,
    effort: (id) => saved.providers[id]?.effort ?? null,
    active: () => saved.active,
  },
  {
    read: () => { try { return JSON.parse(recall(KEY.coresChecked) ?? "{}") as Record<string, Validation>; } catch { return {}; } },
    write: (all) => { store(KEY.coresChecked, JSON.stringify(all)); },
  },
);

/* ---------------- the same calls the server answers ---------------- */

async function connections(revalidate = false): Promise<ConnectionsResponse> {
  saved = load(); // another tab may have connected something
  return core.connections(revalidate);
}

async function saveKey(id: ProviderId, apiKey: string): Promise<ConnectionsResponse> {
  const key = apiKey.trim();
  if (!key) throw new Error("Paste the key first.");
  const v = await core.validate(id, key, true);
  if (!v.ok) throw new Error(v.message ?? "That key didn't work.");
  const { model, effort } = saved.providers[id] ?? {};
  saved.providers[id] = { key, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  if (!saved.active) saved.active = id;
  // a key that looks connected but is gone on the next visit would be worse than saying so now
  if (!persist()) throw new Error("The key works, but this browser wouldn't keep it — its storage is full, or blocked in a private window.");
  return connections();
}

async function removeKey(id: ProviderId): Promise<ConnectionsResponse> {
  delete saved.providers[id];
  if (saved.active === id) saved.active = null;
  core.forget(id);
  persist();
  return connections();
}

async function selectModel(id: ProviderId, model: string): Promise<ConnectionsResponse> {
  const p = saved.providers[id];
  if (p) { p.model = model; persist(); }
  core.modelChanged(id);
  return connections();
}

async function selectEffort(id: ProviderId, effort: Effort): Promise<ConnectionsResponse> {
  const p = saved.providers[id];
  if (p) { p.effort = effort; persist(); }
  return connections();
}

async function setActive(id: ProviderId): Promise<ConnectionsResponse> {
  // A service without a key cannot answer: switching to it would only look
  // like a switch, so it is refused — the console then opens Connections.
  if (!saved.providers[id]) throw new Error(`${PROVIDERS[id].name} isn't connected.`);
  saved.active = id;
  persist();
  return connections();
}

async function status(): Promise<StatusResponse> {
  return core.status();
}

async function ask(body: AskRequest, onDelta: (full: string) => void, onStatus: (s: AskStatus) => void, signal?: AbortSignal): Promise<string> {
  const q = await core.prepare(body);
  const ac = new AbortController();
  signal?.addEventListener("abort", () => ac.abort(), { once: true });
  let out = "";
  onStatus("thinking");
  try {
    await core.answer(q, (ev) => {
      if (ev.t === "text") { out += ev.delta; onDelta(out); }
      else if (ev.t === "status") onStatus(ev.status);
    }, ac.signal);
  } catch (err) {
    if (ac.signal.aborted) throw err;
    // The friendly line is the error; the service's own words stay in the browser's console.
    console.warn(`[${q.id}] ${q.model}:`, err instanceof Error && err.cause !== undefined ? err.cause : err);
    if (!out) throw err;
  }
  return out.trim();
}

async function transcribe(audio: Blob): Promise<string> {
  return (await core.hear(audio)).text;
}

/** One line, 16-bit PCM at SPEECH_RATE, piece by piece as the service makes it. */
async function speak(body: SpeakRequest): Promise<AsyncIterable<Uint8Array>> {
  return (await core.speak(body)).pieces;
}

/** The key saved in this browser, for the Copy button beside it. */
function keyOf(id: ProviderId): string | null {
  return saved.providers[id]?.key ?? null;
}

export const browserCore = { connections, saveKey, removeKey, selectModel, selectEffort, setActive, keyOf, ask, transcribe, status, speak };

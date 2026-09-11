/** Typed wrappers over the console's own API. */

import type {
  AskEvent,
  AskRequest,
  AskStatus,
  ConnectionsResponse,
  ProviderId,
  ScanResponse,
  SpeakRequest,
  StatusResponse,
  TelemetryResponse,
  WorldResponse,
} from "../shared/types.js";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return (await r.json()) as T;
}

/** Marks a request as coming from the console itself; the server refuses writes without it. */
const CONSOLE = { "x-jarvis": "1" } as const;

async function postJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...CONSOLE },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!r.ok) {
    const msg =
      (parsed as { message?: string; error?: string } | null)?.message ??
      (parsed as { error?: string } | null)?.error ??
      `${r.status}`;
    throw new Error(msg);
  }
  return parsed as T;
}

export const api = {
  status: () => getJson<StatusResponse>("/api/status"),
  telemetry: () => getJson<TelemetryResponse>("/api/telemetry"),
  world: () => getJson<WorldResponse>("/api/world"),
  scan: (run = false) => getJson<ScanResponse>(`/api/scan${run ? "?run=1" : ""}`),

  connections: (revalidate = false) =>
    getJson<ConnectionsResponse>(`/api/connections${revalidate ? "?revalidate=1" : ""}`),
  saveKey: (id: ProviderId, apiKey: string) =>
    postJson<ConnectionsResponse>(`/api/connections/${id}`, { apiKey }),
  removeKey: (id: ProviderId) =>
    postJson<ConnectionsResponse>(`/api/connections/${id}`, undefined, "DELETE"),
  selectModel: (id: ProviderId, model: string) =>
    postJson<ConnectionsResponse>(`/api/connections/${id}/model`, { model }),
  setActive: (provider: ProviderId) =>
    postJson<ConnectionsResponse>("/api/connections/active", { provider }),

  /** Recorded speech in, text out — transcribed server-side. */
  transcribe: async (audio: Blob): Promise<string> => {
    const r = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "content-type": audio.type || "audio/webm", ...CONSOLE },
      body: audio,
    });
    const body = (await r.json().catch(() => ({}))) as { text?: string; message?: string };
    if (!r.ok) throw new Error(body.message ?? `transcribe ${r.status}`);
    return (body.text ?? "").trim();
  },

  speak: async (body: SpeakRequest): Promise<Blob> => {
    const r = await fetch("/api/speak", {
      method: "POST",
      headers: { "content-type": "application/json", ...CONSOLE },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`speak ${r.status}`);
    return r.blob();
  },

  /**
   * Streams the reply as newline-delimited events: `onDelta` for the growing
   * text, `onStatus` for why we are waiting (a web search takes seconds).
   */
  ask: async (
    body: AskRequest,
    onDelta: (full: string) => void,
    onStatus: (s: AskStatus) => void,
    signal?: AbortSignal,
  ): Promise<string> => {
    const r = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json", ...CONSOLE },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!r.ok || !r.body) {
      const text = await r.text().catch(() => "");
      let msg = `ask ${r.status}`;
      try {
        msg = (JSON.parse(text) as { message?: string }).message ?? msg;
      } catch {
        /* keep the status */
      }
      throw new Error(msg);
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let out = "";
    let failure: string | null = null;

    const handle = (line: string): void => {
      if (!line.trim()) return;
      let ev: AskEvent;
      try {
        ev = JSON.parse(line) as AskEvent;
      } catch {
        return;
      }
      if (ev.t === "text") {
        out += ev.delta;
        onDelta(out);
      } else if (ev.t === "status") {
        onStatus(ev.status);
      } else if (ev.t === "error") {
        failure = ev.message;
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) handle(line);
    }
    if (buf) handle(buf);

    if (failure && !out) throw new Error(failure);
    return out.trim();
  },

};

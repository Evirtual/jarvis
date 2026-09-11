/**
 * J.A.R.V.I.S. Console — server.
 *
 * Serves the built client, streams speech from the local Kokoro model, exposes
 * real machine and network telemetry, and brokers the reasoning cores so API
 * keys never reach the browser.
 */

import http from "node:http";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AskEvent,
  AskRequest,
  ConnectionsResponse,
  ProviderId,
  ProviderStatus,
  ProviderView,
  SaveKeyRequest,
  SelectModelRequest,
  SetActiveRequest,
  SpeakRequest,
  StatusResponse,
  TelemetryResponse,
  Turn,
} from "../shared/types.js";
import { PROVIDER_IDS } from "../shared/types.js";

import {
  ROOT,
  clearKey,
  allowedOrigin,
  getActive,
  getModel,
  getVoice,
  loadConfig,
  maskKey,
  resolveKey,
  setActive,
  setKey,
  setModel,
  setVoice,
} from "./config.js";
import {
  PROVIDERS,
  activeModelFor,
  adapterFor,
  personaFor,
  cachedValidation,
  humanise,
  validate,
} from "./providers.js";
import { DEFAULT_VOICE, DTYPE, hasVoice, kokoro, loadKokoro, synthesize, voices } from "./kokoro.js";
import { gateway, snapshot, startSampler } from "./system.js";
import { runScan, scanState } from "./scan.js";
import { refreshWorld, startWorld, world } from "./world.js";
import { transcribe, transcriptionAvailable } from "./transcribe.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 7823);

// Built client in production; Vite serves it on 5173 in dev.
const CLIENT_DIR = path.resolve(HERE, "..", "client");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function json(res: http.ServerResponse, code: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

async function readBody(req: http.IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

async function readRaw(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

async function readJson<T>(req: http.IncomingMessage, limit?: number): Promise<T | null> {
  try {
    return JSON.parse(await readBody(req, limit)) as T;
  } catch {
    return null;
  }
}

function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && (PROVIDER_IDS as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ *
 * Connections
 * ------------------------------------------------------------------ */

/**
 * The last account-level failure per service — out of credit, no access to the
 * model — so the Connections card can say "connected, but…". A key can list
 * models perfectly well on an account that can't answer a single question.
 * Cleared by the next answer that succeeds.
 */
const lastProblem = new Map<ProviderId, string>();

async function providerView(id: ProviderId, revalidate: boolean): Promise<ProviderView> {
  const meta = PROVIDERS[id];
  const resolved = resolveKey(id);
  if (!resolved) return { ...meta, status: { state: "unconfigured" } };

  const masked = maskKey(resolved.key);
  const v = revalidate
    ? await validate(id, resolved.key, true)
    : (cachedValidation(id, resolved.key) ?? (await validate(id, resolved.key)));

  const status: ProviderStatus = v.ok
    ? {
        state: "ready",
        maskedKey: masked,
        models: v.models,
        model: getModel(id) ?? v.models[0] ?? "",
        source: resolved.source,
        ...(lastProblem.has(id) ? { problem: lastProblem.get(id)! } : {}),
      }
    : {
        state: "error",
        maskedKey: masked,
        message: v.message ?? "Unknown error",
        source: resolved.source,
      };
  return { ...meta, status };
}

async function connections(revalidate = false): Promise<ConnectionsResponse> {
  const providers = await Promise.all(PROVIDER_IDS.map((id) => providerView(id, revalidate)));
  let active = getActive();
  // Never advertise a core that cannot answer.
  const ready = providers.filter((p) => p.status.state === "ready").map((p) => p.id);
  if (!active || !ready.includes(active)) active = ready[0] ?? null;
  return { providers, active };
}

/** The machine's readings right now, as the console shows them. */
function telemetryNow(): TelemetryResponse {
  return {
    at: snapshot.at,
    host: snapshot.host,
    cpu: snapshot.cpu,
    mem: snapshot.mem,
    gpu: snapshot.gpu,
    net: snapshot.win?.net ?? null,
    battery: snapshot.win?.battery ?? null,
    disks: snapshot.win?.disks ?? [],
    anchors: world.anchors,
  };
}

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */

const server = http.createServer((req, res) => {
  void handle(req, res).catch((err: unknown) => {
    console.error("[server]", err);
    if (!res.headersSent) json(res, 500, { error: "internal" });
    else res.end();
  });
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;

  // No CORS, with one exception: the console is served from this origin (in
  // dev Vite proxies /api), so the browser never makes a cross-origin call —
  // unless the page is published elsewhere, in which case that one origin is
  // named in config.json and answered with its cookies (an access check in
  // front of the tunnel needs them). Anything that changes state must also
  // come from the console itself — any other site can't forge the header
  // without a preflight it is never granted.
  const origin = req.headers.origin;
  const allowed = allowedOrigin();
  if (origin && allowed && origin === allowed) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("vary", "origin");
    if (req.method === "OPTIONS") {
      res.setHeader("access-control-allow-methods", "GET, POST, DELETE");
      res.setHeader("access-control-allow-headers", "content-type, x-jarvis");
      res.setHeader("access-control-max-age", "86400");
      res.writeHead(204).end();
      return;
    }
  } else if (req.method === "OPTIONS") {
    res.writeHead(403).end();
    return;
  }
  if (p.startsWith("/api/") && req.method !== "GET" && !fromConsole(req)) {
    json(res, 403, { error: "forbidden", message: "Requests must come from the console." });
    return;
  }

  /* ---- status ---- */
  if (p === "/api/status") {
    const conn = await connections();
    const body: StatusResponse = {
      kokoro: kokoro.state,
      kokoroError: kokoro.error,
      dtype: DTYPE,
      voices: voices(),
      active: conn.active,
      anyProviderReady: conn.providers.some((x) => x.status.state === "ready"),
      transcription: transcriptionAvailable(),
    };
    json(res, 200, body);
    return;
  }

  /* ---- connections ---- */
  if (p === "/api/connections" && req.method === "GET") {
    json(res, 200, await connections(url.searchParams.has("revalidate")));
    return;
  }

  const keyMatch = p.match(/^\/api\/connections\/([a-z]+)$/);
  if (keyMatch) {
    const id = keyMatch[1];
    if (!isProviderId(id)) {
      json(res, 404, { error: "unknown_provider" });
      return;
    }
    if (req.method === "POST") {
      const body = await readJson<SaveKeyRequest>(req);
      const apiKey = body?.apiKey?.trim();
      if (!apiKey) {
        json(res, 400, { error: "missing_key", message: "Paste the key first." });
        return;
      }
      const v = await validate(id, apiKey, true);
      if (!v.ok) {
        json(res, 400, { error: "invalid_key", message: v.message });
        return;
      }
      await setKey(id, apiKey);
      if (!getModel(id) && v.models[0]) await setModel(id, v.models[0]);
      json(res, 200, await connections());
      return;
    }
    if (req.method === "DELETE") {
      await clearKey(id);
      json(res, 200, await connections());
      return;
    }
  }

  const modelMatch = p.match(/^\/api\/connections\/([a-z]+)\/model$/);
  if (modelMatch && req.method === "POST") {
    const id = modelMatch[1];
    if (!isProviderId(id)) {
      json(res, 404, { error: "unknown_provider" });
      return;
    }
    const body = await readJson<SelectModelRequest>(req);
    if (!body?.model) {
      json(res, 400, { error: "missing_model" });
      return;
    }
    await setModel(id, body.model);
    // a different model may be usable; out of credit is account-wide and stays
    if (lastProblem.get(id)?.includes("can't use that model")) lastProblem.delete(id);
    json(res, 200, await connections());
    return;
  }

  if (p === "/api/connections/active" && req.method === "POST") {
    const body = await readJson<SetActiveRequest>(req);
    if (!body || !isProviderId(body.provider)) {
      json(res, 400, { error: "unknown_provider" });
      return;
    }
    await setActive(body.provider);
    json(res, 200, await connections());
    return;
  }

  /* ---- telemetry ---- */
  if (p === "/api/telemetry") {
    json(res, 200, telemetryNow());
    return;
  }

  /* ---- everything live, pushed ----
     One open connection instead of the console asking every second: readings,
     the sweep's state and the world each arrive only when they have changed
     (each is compared to what this connection was last sent). The console
     closes it while its tab is hidden and reopens it when looked at again. */
  if (p === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      connection: "keep-alive",
    });
    const sent = new Map<string, string>();
    const push = (event: string, value: unknown): void => {
      const body = JSON.stringify(value);
      if (sent.get(event) === body) return;
      sent.set(event, body);
      res.write(`event: ${event}\ndata: ${body}\n\n`);
    };
    const tick = (): void => {
      push("telemetry", telemetryNow());
      push("scan", { ...scanState, gateway: scanState.gateway ?? gateway() });
      push("world", world);
    };
    tick();
    const timer = setInterval(tick, 1000);
    const beat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
    req.on("close", () => { clearInterval(timer); clearInterval(beat); });
    return;
  }

  /* ---- perimeter ---- */
  if (p === "/api/scan") {
    if (url.searchParams.has("run") && !scanState.running) {
      void runScan(gateway()).catch((e: unknown) => console.error("[scan]", e));
    }
    json(res, 200, { ...scanState, gateway: scanState.gateway ?? gateway() });
    return;
  }

  /* ---- world ---- */
  if (p === "/api/world") {
    if (url.searchParams.has("refresh")) await refreshWorld();
    json(res, 200, world);
    return;
  }

  /* ---- speech to text ---- */
  if (p === "/api/transcribe" && req.method === "POST") {
    if (!transcriptionAvailable()) {
      json(res, 503, { error: "no_transcriber", message: "Speech recognition needs ChatGPT connected — add it in Config." });
      return;
    }
    let audio: Buffer;
    try {
      audio = await readRaw(req, 12 * 1024 * 1024);
    } catch {
      json(res, 413, { error: "too_large", message: "That recording is too long — keep it under a minute." });
      return;
    }
    if (audio.length < 1200) {
      json(res, 200, { text: "" });
      return;
    }
    const t0 = Date.now();
    try {
      const out = await transcribe(audio, String(req.headers["content-type"] ?? "audio/webm"));
      console.log(`[hear] ${out.model} ${((Date.now() - t0) / 1000).toFixed(2)}s "${out.text.slice(0, 60)}"`);
      json(res, 200, { text: out.text });
    } catch (err) {
      const message = humanise("openai", err);
      console.error("[hear]", message);
      json(res, 502, { error: "transcribe_failed", message });
    }
    return;
  }

  /* ---- speech ---- */
  if (p === "/api/speak" && req.method === "POST") {
    if (kokoro.state !== "ready") {
      json(res, 503, { error: kokoro.state === "loading" ? "model_loading" : "model_failed" });
      return;
    }
    const body = await readJson<SpeakRequest>(req);
    if (!body) {
      json(res, 400, { error: "bad_json" });
      return;
    }
    const text = String(body.text ?? "").trim().slice(0, 800);
    const voice = String(body.voice ?? DEFAULT_VOICE);
    const speed = Math.min(1.4, Math.max(0.6, Number(body.speed) || 1));
    if (!text) {
      json(res, 400, { error: "empty_text" });
      return;
    }
    if (!hasVoice(voice)) {
      json(res, 400, { error: "unknown_voice" });
      return;
    }
    if (voice !== getVoice()) void setVoice(voice);

    const t0 = Date.now();
    try {
      const wav = await synthesize(text, voice, speed);
      console.log(
        `[speak] ${voice} ${((Date.now() - t0) / 1000).toFixed(2)}s "${text.slice(0, 48)}${text.length > 48 ? "…" : ""}"`,
      );
      res.writeHead(200, {
        "content-type": "audio/wav",
        "content-length": wav.length,
        "cache-control": "no-store",
      });
      res.end(wav);
    } catch (err) {
      console.error("[kokoro] synthesis failed:", err);
      json(res, 500, { error: "synthesis_failed" });
    }
    return;
  }

  /* ---- ask ---- */
  if (p === "/api/ask" && req.method === "POST") {
    // A conversation is up to 24 turns of up to 4,000 characters plus the console
    // snapshot — comfortably over the 64 KB default, so this route allows 1 MB.
    const body = await readJson<AskRequest>(req, 1024 * 1024);
    if (!body) {
      json(res, 400, { error: "bad_json" });
      return;
    }

    const conn = await connections();
    const id = isProviderId(body.provider) ? body.provider : conn.active;
    if (!id) {
      json(res, 503, { error: "no_provider", message: "No reasoning core is connected." });
      return;
    }
    const resolved = resolveKey(id);
    if (!resolved) {
      json(res, 503, { error: "no_key", message: `${PROVIDERS[id].name} has no key.` });
      return;
    }
    const model = await activeModelFor(id);
    if (!model) {
      json(res, 503, { error: "no_model", message: `No model selected for ${PROVIDERS[id].name}.` });
      return;
    }

    const turns: Turn[] = (Array.isArray(body.turns) ? body.turns : [])
      .slice(-12)
      .map((t) => ({
        role: t.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: String(t.content ?? "").slice(0, 4000),
      }))
      .filter((t) => t.content.length > 0)
      // Console replies are kept in history too, so two assistant turns can sit
      // side by side. Providers want strict alternation starting with the user.
      .reduce<Turn[]>((acc, t) => {
        const prev = acc[acc.length - 1];
        if (prev && prev.role === t.role) prev.content = `${prev.content}\n\n${t.content}`;
        else acc.push({ ...t });
        return acc;
      }, []);
    while (turns[0]?.role === "assistant") turns.shift();
    if (!turns.length || turns[turns.length - 1]!.role !== "user") {
      json(res, 400, { error: "no_turns" });
      return;
    }

    // Live readings ride along with the newest question only, never the history.
    const last = turns[turns.length - 1]!;
    if (body.context) last.content = `${last.content}\n\n${body.context}`;

    const ac = new AbortController();
    req.on("close", () => ac.abort());

    const t0 = Date.now();
    let wrote = 0;
    let searched = false;

    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    const send = (ev: AskEvent): void => {
      if (ev.t === "text") wrote += ev.delta.length;
      if (ev.t === "status" && ev.status === "searching") searched = true;
      res.write(`${JSON.stringify(ev)}\n`);
    };

    try {
      send({ t: "status", status: "thinking" });
      await adapterFor(id).stream(resolved.key, model, turns, send, ac.signal, personaFor(body.address === "madam" ? "madam" : "sir"));
      console.log(
        `[${id}] ${model} ${((Date.now() - t0) / 1000).toFixed(1)}s ${wrote} chars${searched ? " (web)" : ""}`,
      );
      lastProblem.delete(id);
      send({ t: "done" });
      res.end();
    } catch (err) {
      const message = humanise(id, err);
      if (/out of credit|can't use that model/.test(message)) lastProblem.set(id, message);
      // The friendly line goes to the console; the provider's own words stay in
      // this log (keys are never part of them), for working out what went wrong.
      const raw = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      console.error(`[${id}] ${model}: ${message}${raw && raw !== message ? `\n  ↳ ${raw}` : ""}`);
      send({ t: "error", message });
      res.end();
    }
    return;
  }

  await serveStatic(url, res);
}

/* ------------------------------------------------------------------ *
 * Who is asking
 * ------------------------------------------------------------------ */

/** A state-changing request from the console's own page, not from some other site. */
function fromConsole(req: http.IncomingMessage): boolean {
  if (req.headers["x-jarvis"] !== "1") return false;
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches may omit it; the header already proves intent
  if (origin === allowedOrigin()) return true; // the page, published elsewhere
  try {
    const o = new URL(origin);
    const host = String(req.headers.host ?? "").split(":")[0];
    return o.hostname === host || o.hostname === "localhost" || o.hostname === "127.0.0.1" || o.hostname === "[::1]";
  } catch {
    return false;
  }
}

async function serveStatic(url: URL, res: http.ServerResponse): Promise<void> {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.join(CLIENT_DIR, path.normalize(rel).replace(/^[/\\]+/, ""));
  // inside the client folder itself, not merely a folder whose name starts the same
  if (file !== CLIENT_DIR && !file.startsWith(CLIENT_DIR + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end(
      "Not found. Run `npm run build` first, or use `npm run dev` and open http://localhost:5173",
    );
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

server.listen(PORT, () => {
  loadConfig();
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log("  J.A.R.V.I.S. Console");
  console.log(`  http://localhost:${PORT}`);
  console.log("");

  void connections().then((c) => {
    for (const prov of c.providers) {
      const mark = prov.status.state === "ready" ? "●" : "○";
      const detail =
        prov.status.state === "ready"
          ? `${prov.status.model} (${prov.status.source})`
          : prov.status.state === "error"
            ? prov.status.message
            : `no key — add one in Connections`;
      console.log(`  ${mark} ${prov.name.padEnd(8)} ${detail}`);
    }
    console.log(`${line}\n`);
  });

  startSampler();
  startWorld(gateway);
  // Seed the perimeter panel as soon as the console comes online. Later sweeps
  // remain on demand, so the network is not polled continuously.
  void runScan(gateway()).catch((e: unknown) => console.error("[scan]", e));

  void loadKokoro();
});

process.on("SIGINT", () => {
  console.log("\n[jarvis] shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
});

/**
 * J.A.R.V.I.S. Console — server.
 *
 * Serves the built client, brokers the connected services — answers, hearing
 * and speech — so API keys never reach the browser, and exposes real machine
 * and network telemetry.
 */

import http from "node:http";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AskEvent,
  AskRequest,
  SaveKeyRequest,
  SelectModelRequest,
  SetActiveRequest,
  SpeakRequest,
  TelemetryResponse,
} from "../shared/types.js";
import { isProviderId } from "../shared/types.js";

import { clearKey, loadConfig, setActive, setKey, setModel } from "./config.js";
import { CoreError, SPEECH_RATE, core } from "./services.js";
import { gateway, snapshot, startSampler } from "./system.js";
import { runScan, scanState } from "./scan.js";
import { refreshWorld, startWorld, world } from "./world.js";

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

/** The status each of the core's refusals is sent with. */
const STATUS_OF: Record<CoreError["code"], number> = {
  no_provider: 503, no_key: 503, no_hearing: 503, no_voice: 503,
  no_turns: 400, unknown_voice: 400, empty_text: 400,
  ask_failed: 502, hear_failed: 502, speak_failed: 502,
};

function json(res: http.ServerResponse, code: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

/** The core said no: its reason, in the user's words, with the status that fits. */
function refuse(res: http.ServerResponse, err: unknown): void {
  if (err instanceof CoreError) json(res, STATUS_OF[err.code], { error: err.code, message: err.message });
  else throw err;
}

/** The whole request body, up to a limit — rejected, and the connection dropped, past it. */
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

async function readJson<T>(req: http.IncomingMessage, limit = 64 * 1024): Promise<T | null> {
  try {
    return JSON.parse((await readRaw(req, limit)).toString("utf8")) as T;
  } catch {
    return null;
  }
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

  // No CORS: the console is served from this origin, and in dev Vite proxies
  // /api, so the browser never makes a cross-origin call. Anything that
  // changes state must also come from the console itself — a page on another
  // site can't forge the header without a preflight we never grant.
  if (req.method === "OPTIONS") {
    res.writeHead(403).end();
    return;
  }
  if (p.startsWith("/api/") && req.method !== "GET" && !fromConsole(req)) {
    json(res, 403, { error: "forbidden", message: "Requests must come from the console." });
    return;
  }

  /* ---- status ---- */
  if (p === "/api/status") {
    json(res, 200, await core.status());
    return;
  }

  /* ---- connections ---- */
  if (p === "/api/connections" && req.method === "GET") {
    json(res, 200, await core.connections(url.searchParams.has("revalidate")));
    return;
  }

  // Before the per-service routes: "/api/connections/active" would otherwise
  // read as a key for a service called "active".
  if (p === "/api/connections/active" && req.method === "POST") {
    const body = await readJson<SetActiveRequest>(req);
    if (!body || !isProviderId(body.provider)) {
      json(res, 400, { error: "unknown_provider" });
      return;
    }
    await setActive(body.provider);
    json(res, 200, await core.connections());
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
      const v = await core.validate(id, apiKey, true);
      if (!v.ok) {
        json(res, 400, { error: "invalid_key", message: v.message });
        return;
      }
      await setKey(id, apiKey);
      json(res, 200, await core.connections());
      return;
    }
    if (req.method === "DELETE") {
      await clearKey(id);
      core.forget(id);
      json(res, 200, await core.connections());
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
    core.modelChanged(id);
    json(res, 200, await core.connections());
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

  /* ---- hearing: through the active service ---- */
  if (p === "/api/transcribe" && req.method === "POST") {
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
      const heard = await core.hear(new Blob([audio], { type: String(req.headers["content-type"] ?? "audio/webm") }));
      console.log(`[hear] ${heard.via} ${((Date.now() - t0) / 1000).toFixed(2)}s "${heard.text.slice(0, 60)}"`);
      json(res, 200, { text: heard.text });
    } catch (err) {
      if (err instanceof CoreError && err.code === "hear_failed") console.error(`[hear] ${err.message}`);
      refuse(res, err);
    }
    return;
  }

  /* ---- speech: through a connected service ---- */
  if (p === "/api/speak" && req.method === "POST") {
    const body = await readJson<SpeakRequest>(req);
    if (!body) {
      json(res, 400, { error: "bad_json" });
      return;
    }
    // The samples go to the page as the service makes them: the first arrive
    // within a second, and he starts talking while the rest is still coming.
    const t0 = Date.now();
    let first: number | null = null;
    try {
      const said = await core.speak(body);
      for await (const bytes of said.pieces) {
        if (first === null) {
          first = Date.now() - t0;
          res.writeHead(200, { "content-type": `audio/L16; rate=${SPEECH_RATE}`, "cache-control": "no-store", "x-content-type-options": "nosniff" });
        }
        res.write(Buffer.from(bytes));
      }
      const text = String(body.text ?? "").trim();
      console.log(`[speak] ${said.via} ${said.voice} first sound ${((first ?? 0) / 1000).toFixed(2)}s, done ${((Date.now() - t0) / 1000).toFixed(2)}s "${text.slice(0, 48)}${text.length > 48 ? "…" : ""}"`);
      res.end();
    } catch (err) {
      if (err instanceof CoreError && err.code === "speak_failed") console.error(`[speak] ${err.message}`);
      if (first === null) refuse(res, err);
      else res.end(); // what was made has been played; the rest is lost, and the page says so
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
    let q;
    try {
      q = await core.prepare(body);
    } catch (err) {
      refuse(res, err);
      return;
    }

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
      await core.answer(q, send, ac.signal);
      console.log(`[${q.id}] ${q.model} ${((Date.now() - t0) / 1000).toFixed(1)}s ${wrote} chars${searched ? " (web)" : ""}`);
      send({ t: "done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The friendly line goes to the console; the service's own words stay in
      // this log (keys are never part of them), for working out what went wrong.
      const raw = err instanceof Error && err.cause !== undefined ? String(err.cause instanceof Error ? err.cause.message : err.cause).slice(0, 300) : "";
      console.error(`[${q.id}] ${q.model}: ${message}${raw && raw !== message ? `\n  ↳ ${raw}` : ""}`);
      send({ t: "error", message });
    }
    res.end();
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

  void core.connections().then((c) => {
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
});

process.on("SIGINT", () => {
  console.log("\n[jarvis] shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
});

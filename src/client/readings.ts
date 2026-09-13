/**
 * The instruments: the live readings painted, and received.
 *
 * The deck's chips are always painted; a panel's body only while it is open,
 * and from rows (panel-rows.ts), so the PC's readings and what a browser can
 * measure are the same panels with their own words — no element serves two
 * meanings.
 */

import type { ScanResponse, TelemetryResponse, WorldResponse } from "../shared/types.js";
import { api } from "./api.js";
import { $, esc, fmtRate, gib, gib0, hhmm, setPill } from "./dom.js";
import { radar, panels } from "./state.js";
import { notice, paintCoreState } from "./say.js";
import { fitDockIfChanged } from "./deck.js";
import { SERVERLESS } from "./server.js";
import { locate, startSensors, sweepServices } from "./sensors.js";
import { levelOf, paintRows, type Row } from "./panel-rows.js";

/* ===================================================================== *
 * The latest readings, owned here and read everywhere
 * ===================================================================== */

export let T: TelemetryResponse | null = null;
export let W: WorldResponse = { uplink: null, weather: null, error: null, at: 0 };
export let S: ScanResponse = { running: false, at: 0, durationMs: 0, subnet: null, self: null, gateway: null, hosts: [] };

/** The last minute of throughput (the PC) or round trips (the web), newest last. */
const sparkRx: number[] = [];
const sparkTx: number[] = [];
const SPARK_N = 60;
/** The last reading the round-trip trace took a point from, so a repeated one isn't drawn twice. */
let lastRttAt = 0;

const fmtBytes = (b: number | null | undefined): string =>
  b == null ? "—" : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`;

const kv = (key: string, label: string, value: string, more: { gold?: boolean; title?: string } = {}): Row => ({ kind: "kv", key, label, value, ...more });
const meter = (key: string, label: string, value: string, unit: string, pct: number | null, level?: "" | "warn" | "crit"): Row =>
  ({ kind: "meter", key, label, value, unit, pct, ...(level !== undefined ? { level } : {}) });

/** Whatever is on the uplink, from the world: the public address and the carrier. */
function worldRows(): Row[] {
  return [
    kv("ip", "Public IP", W.uplink?.ip ?? "—"),
    kv("isp", "Carrier", W.uplink ? `${W.uplink.isp}${W.uplink.asn ? ` · ${W.uplink.asn}` : ""}` : "—", { title: W.uplink?.isp ?? "" }),
  ];
}

/* ---------------- the PC: the machine's own readings ---------------- */

function paintPc(t: TelemetryResponse): void {
  if (t.cpu) {
    $("pCpu").textContent = `${t.cpu.avg}%`;
    setPill($("pillCpu"), t.cpu.avg >= 75, t.cpu.avg >= 92);
    $("cpuCount").textContent = `${t.cpu.cores.length} cores${t.cpu.speedMhz ? ` · ${(t.cpu.speedMhz / 1000).toFixed(1)} GHz` : ""}`;
  }
  if (panels.isOpen("compute")) {
    paintRows($("computeBody"), [
      kv("cpu", "Processor", t.cpu?.model ?? "—", { title: t.cpu?.model ?? "" }),
      ...(t.cpu ? [{ kind: "cores", key: "cores", cores: t.cpu.cores } as Row] : []),
      meter("load", "Aggregate load", t.cpu ? String(t.cpu.avg) : "—", "%", t.cpu?.avg ?? null),
      meter("mem", "Memory", t.mem ? `${gib(t.mem.usedBytes)} / ${gib(t.mem.totalBytes)}` : "—", "GB", t.mem?.pct ?? null),
    ]);
  }

  if (t.gpu) {
    $("pGpu").textContent = `${t.gpu.utilPct ?? 0}% · ${t.gpu.tempC != null ? `${t.gpu.tempC}°` : "—"}`;
    setPill($("pillGpu"), (t.gpu.tempC ?? 0) >= 78, (t.gpu.tempC ?? 0) >= 88);
    $("gpuTemp").textContent = t.gpu.tempC != null ? `${t.gpu.tempC}°C` : "";
  }
  if (panels.isOpen("graphics")) {
    const g = t.gpu;
    paintRows($("graphicsBody"), g ? [
      kv("name", "Adapter", g.name, { title: g.name }),
      meter("util", "Utilisation", String(g.utilPct ?? 0), "%", g.utilPct),
      meter("vram", "VRAM", g.vramTotalMb && g.vramUsedMb != null ? `${(g.vramUsedMb / 1024).toFixed(1)} / ${(g.vramTotalMb / 1024).toFixed(1)}` : "—", "GB",
        g.vramTotalMb && g.vramUsedMb != null ? (g.vramUsedMb / g.vramTotalMb) * 100 : null),
      kv("power", "Power draw", g.powerW != null ? `${g.powerW.toFixed(1)} W` : "—", { gold: true }),
      kv("clock", "Core clock", g.clockMhz != null ? `${g.clockMhz} MHz` : "—"),
      kv("fan", "Fan", g.fanPct != null ? `${g.fanPct} %` : "passive"),
    ] : [kv("name", "Adapter", "No NVIDIA adapter detected")]);
  }

  if (t.disks.length) {
    const d0 = t.disks[0]!;
    const dp = d0.totalBytes ? Math.round((d0.usedBytes / d0.totalBytes) * 100) : 0;
    $("pDisk").textContent = `${dp}%`;
    setPill($("pillDisk"), dp >= 85, dp >= 95);
  }
  if (panels.isOpen("storage")) {
    paintRows($("storageBody"), t.disks.map((d) => {
      const pct = d.totalBytes ? (d.usedBytes / d.totalBytes) * 100 : 0;
      return meter(d.id, d.id, `${gib0(d.usedBytes)} / ${gib0(d.totalBytes)}`, "GB", pct);
    }));
  }

  if (t.net) {
    $("pNet").textContent = fmtRate(t.net.rxBps);
    if (t.net.rxBps != null) {
      sparkRx.push(t.net.rxBps);
      sparkTx.push(t.net.txBps ?? 0);
      while (sparkRx.length > SPARK_N) { sparkRx.shift(); sparkTx.shift(); }
    }
    if (t.net.wifi) $("wifiSig").textContent = `${t.net.wifi.signal}%`;
  }
  if (panels.isOpen("uplink")) {
    const n = t.net;
    const wifi = n?.wifi;
    paintRows($("uplinkBody"), [
      kv("net", "Network", wifi ? wifi.ssid || "—" : "Wired / unknown", { title: wifi ? `Link rate: ${wifi.rxMbps} / ${wifi.txMbps} Mbps` : "" }),
      kv("radio", "Radio", wifi ? [wifi.radio, wifi.channel ? `ch ${wifi.channel}` : null].filter(Boolean).join(" · ") || "—" : "—"),
      { kind: "spark", key: "spark", label: "Network throughput, last 60 seconds", rx: sparkRx, tx: sparkTx },
      kv("rate", "Down / Up", n ? `${fmtRate(n.rxBps)}  ↓ / ↑  ${fmtRate(n.txBps)}` : "—"),
      kv("gw", "Gateway", n?.gateway ?? "—"),
      kv("dns", "Resolvers", n?.dns.slice(0, 2).join(", ") || "—", { title: n?.dns.join(", ") ?? "" }),
      ...worldRows(),
      kv("latency", "Latency", t.anchors.length ? t.anchors.map((a) => `${a.label.split(" ")[0]} ${a.ms == null ? "—" : `${a.ms}ms`}`).join(" · ") : "—"),
    ]);
  }
}

/* ---------------- the web: what a browser can measure (sensors.ts) ---------------- */

function paintWeb(t: TelemetryResponse): void {
  const w = t.web!;

  // compute
  if (w.load != null) {
    $("pCpu").textContent = `${w.load}%`;
    setPill($("pillCpu"), w.load >= 75, w.load >= 92);
  }
  $("cpuCount").textContent = [w.cores ? `${w.cores} cores` : null, w.pressure].filter(Boolean).join(" · ") || "—";
  if (panels.isOpen("compute")) {
    paintRows($("computeBody"), [
      kv("device", "Device", w.platform, { title: w.platform }),
      meter("load", "Load, estimated", w.load != null ? String(w.load) : "—", "%", w.load),
      w.heapUsed != null && w.heapLimit
        ? meter("mem", "App memory", `${Math.round(w.heapUsed / 1e6)} / ${Math.round(w.heapLimit / 1e6)}`, "MB", (w.heapUsed / w.heapLimit) * 100)
        : kv("mem", "Device memory", w.deviceMemGb ? `${w.deviceMemGb} GB` : "—"),
    ]);
  }

  // graphics: frames held, against what the display can show
  if (w.fps != null) {
    $("pGpu").textContent = `${w.fps} fps`;
    const ratio = w.refreshHz ? w.fps / w.refreshHz : 1;
    setPill($("pillGpu"), ratio < 0.75, ratio < 0.4);
  }
  $("gpuTemp").textContent = w.refreshHz ? `${w.refreshHz} Hz` : "—";
  if (panels.isOpen("graphics")) {
    const pct = w.fps != null && w.refreshHz ? Math.min(100, (w.fps / w.refreshHz) * 100) : 0;
    paintRows($("graphicsBody"), [
      kv("name", "Adapter", w.renderer ?? "Not named by this browser", { title: w.renderer ?? "" }),
      // a low frame rate is the worry here, so the colours run the other way
      meter("fps", "Frame rate", w.fps != null ? String(w.fps) : "—", "fps", pct, pct < 40 ? "crit" : pct < 75 ? "warn" : ""),
      kv("screen", "Screen", w.screen),
      kv("colour", "Colour", `${w.hdr ? "HDR" : "SDR"} · ${w.gamut}`),
      kv("api", "Renders with", w.graphicsApi ?? "—"),
    ]);
  }

  // storage: what this app keeps on the device
  if (w.storageUsed != null || w.boardBytes) {
    // what the browser counts (files, caches) plus the board's own saves, which it leaves out
    $("pDisk").textContent = fmtBytes((w.storageUsed ?? 0) + w.boardBytes);
    const full = w.storageQuota ? ((w.storageUsed ?? 0) / w.storageQuota) * 100 : 0;
    setPill($("pillDisk"), full >= 75, full >= 90);
  }
  if (panels.isOpen("storage")) {
    const LOCAL_LIMIT = 5 * 1024 * 1024; // what browsers allow a site's local storage
    const row = (key: string, name: string, used: number | null, total: number | null): Row => {
      const pct = used != null && total ? (used / total) * 100 : 0;
      return meter(key, name, `${fmtBytes(used)} / ${fmtBytes(total)}`, "", Math.max(pct, used ? 0.5 : 0), levelOf(pct));
    };
    paintRows($("storageBody"), [
      row("files", "Files and caches", w.storageUsed, w.storageQuota),
      row("board", "Board, threads and settings", w.boardBytes, LOCAL_LIMIT),
      kv("kept", "Kept when space is short", w.persisted == null ? "—" : w.persisted ? "yes" : "no — the browser may clear it"),
    ]);
  }

  // uplink: the connection as the browser sees it, and the measured round trip
  $("pNet").textContent = !w.online ? "offline" : w.rttMs != null ? `${w.rttMs} ms` : "—";
  setPill($("pillNet"), !w.online || (w.rttMs ?? 0) >= 300, !w.online);
  if (w.rttMs != null && t.at !== lastRttAt) {
    lastRttAt = t.at;
    sparkRx.push(w.rttMs);
    sparkTx.push(0);
    while (sparkRx.length > SPARK_N) { sparkRx.shift(); sparkTx.shift(); }
  }
  $("wifiSig").textContent = w.rttMs != null ? `${w.rttMs} ms` : "—";
  if (panels.isOpen("uplink")) {
    const c = w.connection;
    const kind = c?.type && c.type !== "unknown" ? c.type.replace("wifi", "Wi-Fi").replace("cellular", "mobile data") : null;
    paintRows($("uplinkBody"), [
      kv("conn", "Connection", !w.online ? "Offline" : kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Online"),
      // the browser's own speed estimate: a class ("4G" means fast, on any connection) and a rounded downlink
      kv("estimate", "Estimate", c ? [c.downlinkMbps != null ? `~${c.downlinkMbps} Mbps` : null, c.effective ? `${c.effective.toUpperCase()} class` : null].filter(Boolean).join(" · ") || "—" : "not offered by this browser"),
      { kind: "spark", key: "spark", label: "Round trip to the internet, last minute", rx: sparkRx, tx: sparkTx },
      kv("rtt", "Round trip", w.rttMs != null ? `${w.rttMs} ms` : "—"),
      kv("status", "Status", w.online ? "online" : "offline"),
      kv("saver", "Data saver", c ? (c.saveData ? "on" : "off") : "—"),
      ...worldRows(),
      kv("latency", "Latency", t.anchors.length ? t.anchors.map((a) => `${a.label === "This page's host" ? "Host" : a.label} ${a.ms == null ? "—" : `${a.ms}ms`}`).join(" · ") : "—"),
    ]);
  }

  // environment: how it knows where you are
  const loc = w.location;
  $("locBy").textContent = loc ? `Located by GPS · ±${loc.accuracyM} m`
    : w.locationState === "asking" ? "Locating…"
      : w.locationState === "denied" ? "Located by IP address · GPS not allowed"
        : w.locationState === "unavailable" ? "Located by IP address · GPS unavailable"
          : "Located by IP address";
  ($("locateBtn") as HTMLButtonElement).hidden = !!loc || w.locationState === "asking";
}

export function paintTelemetry(): void {
  if (!T) return;
  if (T.web) paintWeb(T);
  else paintPc(T);
  fitDockIfChanged();
}

function paintWorld(): void {
  if (W.uplink) $("wxPlace").textContent = [W.uplink.city, W.uplink.country].filter(Boolean).join(", ");
  if (W.weather) {
    const w = W.weather;
    $("wxIcon").textContent = w.icon;
    $("wxTemp").textContent = w.tempC != null ? `${Math.round(w.tempC)}°C` : "—";
    $("pWx").textContent = w.tempC != null ? `${w.icon} ${Math.round(w.tempC)}°` : "—";
    $("wxText").textContent = w.text;
    $("wxFeels").textContent = w.feelsC != null ? `${Math.round(w.feelsC)}°C` : "—";
    $("wxHum").textContent = w.humidity != null ? `${w.humidity}%` : "—";
    $("wxWind").textContent = w.windKph != null ? `${w.windKph} km/h` : "—";
    $("wxPress").textContent = w.pressure != null ? `${Math.round(w.pressure)} hPa` : "—";
    $("wxRise").textContent = hhmm(w.sunrise);
    $("wxSet").textContent = hhmm(w.sunset);
  } else if (W.error) {
    $("wxText").textContent = "no uplink data";
  }
  paintTelemetry(); // the uplink panel carries the public address and the carrier
}

export function paintHosts(): void {
  const wrap = $("hosts");
  if (!S.hosts.length) {
    wrap.innerHTML = SERVERLESS
      ? '<div class="host"><span class="tag">Not swept yet — press Sweep to measure the round trip to every service I rely on.</span></div>'
      : '<div class="host"><span class="tag">No sweep yet — press Sweep, or say “scan the network”.</span></div>';
    return;
  }
  wrap.innerHTML = S.hosts
    .map((h) => {
      const cls = ["host", h.gateway ? "gw" : "", h.self ? "self" : "", radar.hoverIp === h.ip ? "lit" : ""]
        .filter(Boolean).join(" ");
      const label = [h.hostname, h.vendor].filter(Boolean).join(" · ") || h.mac || "unidentified";
      const role = SERVERLESS ? "" : h.gateway ? "router · " : h.self ? "this console · " : "";
      return (
        `<div class="${cls}" data-ip="${esc(h.ip)}">` +
        `<span class="ip">${esc(h.ip)}</span><span class="ms">${Math.round(h.rttMs)} ms</span>` +
        `<span class="tag">${esc(role + label)}</span></div>`
      );
    })
    .join("");
}

/* ===================================================================== *
 * Receiving the readings: one pushed stream, open only while the tab is
 * looked at. The server sends each reading only when it has changed.
 * ===================================================================== */

let events: EventSource | null = null;
/** A sweep the user asked for is announced when it finishes. */
let sweepPending = false;

function applyTelemetry(next: TelemetryResponse): void {
  T = next;
  paintTelemetry();
}

function applyWorld(next: WorldResponse): void {
  W = next;
  paintWorld();
}

function applyScan(next: ScanResponse): void {
  const changed = next.at !== S.at;
  const wasRunning = S.running;
  S = next;
  if (changed) { radar.layout(S.hosts); paintHosts(); }
  $("hostCount").textContent = String(S.hosts.length);
  $("pLan").textContent = S.hosts.length ? String(S.hosts.length) : "—";
  $("subnetLbl").textContent = S.subnet ?? "—";
  const btn = $("sweepBtn") as HTMLButtonElement;
  btn.disabled = S.running;
  btn.textContent = S.running ? "Sweeping" : "Sweep";
  paintCoreState();
  paintScanAge();
  if (sweepPending && wasRunning && !S.running) {
    sweepPending = false;
    notice(SERVERLESS ? `Sweep complete — ${S.hosts.length} services answering.` : `Sweep complete — ${S.hosts.length} hosts responding.`);
  }
}

function paintScanAge(): void {
  $("scanAge").textContent = S.at ? `${Math.round((Date.now() - S.at) / 1000)}s ago` : "not swept";
}

function openStream(): void {
  if (events || document.hidden) return;
  events = new EventSource("/api/events");
  events.addEventListener("telemetry", (e) => applyTelemetry(JSON.parse((e as MessageEvent<string>).data) as TelemetryResponse));
  events.addEventListener("scan", (e) => applyScan(JSON.parse((e as MessageEvent<string>).data) as ScanResponse));
  events.addEventListener("world", (e) => applyWorld(JSON.parse((e as MessageEvent<string>).data) as WorldResponse));
  // On an error the browser reconnects by itself; nothing to do here.
}

function closeStream(): void {
  events?.close();
  events = null;
}

/** Start receiving. Paused while the tab is hidden, resumed the moment it is looked at. */
export function startReadings(): void {
  if (SERVERLESS) {
    // No server: the browser measures, and pauses itself while out of sight.
    // the services it sweeps are across the internet: a radar scaled to match
    radar.scale = { maxMs: 1000, rings: [10, 50, 200, 1000] };
    applyScan(S);
    startSensors(applyTelemetry, applyWorld, applyScan);
    $("locateBtn").addEventListener("click", locate);
    return;
  }
  openStream();
  // A glance at another tab shouldn't drop the stream: close only after the
  // tab has been out of sight for a few seconds; reopen the moment it is back.
  let away: number | null = null;
  document.addEventListener("visibilitychange", () => {
    if (away) { clearTimeout(away); away = null; }
    if (document.hidden) away = window.setTimeout(() => { away = null; if (document.hidden) closeStream(); }, 5000);
    else openStream();
  });
  // only a label; no request
  setInterval(() => { if (!document.hidden && panels.isOpen("perimeter")) paintScanAge(); }, 5000);
}

/** Start a sweep — only ever on request; its results arrive on the stream. */
async function pollScan(run = false): Promise<void> {
  if (SERVERLESS) { if (run) await sweepServices(applyScan); return; }
  try {
    applyScan(await api.scan(run));
  } catch { /* ignored */ }
}

export function sweep(): void {
  sweepPending = true;
  void pollScan(true);
}

/** The radar's hover lights the host in the list; the Sweep button sweeps. */
export function wireReadings(): void {
  radar.onHover = paintHosts;
  $("sweepBtn").addEventListener("click", sweep);
}

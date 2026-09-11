/**
 * The instruments: painting the live readings, and receiving them.
 */

import type { ProviderId, ScanResponse, TelemetryResponse, VoiceOption, WorldResponse } from "../shared/types.js";
import { api } from "./api.js";
import {
  NEEDS_CONFIRMATION, extractDirectives, intentOf, parseUtterance, type Action, type ConfigTab, type ParseContext, type ProviderWord,
} from "./commands.js";
import { addressed, getAddress, setAddress, type Address } from "./address.js";
import { ICON, instrumentIcon as icon } from "./icons.js";
import { $, esc, fmtRate, gib, gib0, hhmm, recall, setMeter, setPill, store } from "./dom.js";
import { computeLinks, linkKey, relatedness, type Link } from "./links.js";
import { type PanelName } from "./panels.js";
import { line, type Thread } from "./stage.js";
import { clip, editDistance } from "./text.js";
import { GENERAL_ID, threadRef, type Group } from "./workspace.js";
import { conn, graph, hud, input, panels, reduceMotion, voice, ws } from "./state.js";
import { paintCoreState, sys } from "./say.js";
import { fitDockIfChanged } from "./deck.js";
import { SERVERLESS } from "./server.js";
import { locate, startSensors, sweepServices } from "./sensors.js";

/* ===================================================================== *
 * Painting the HUD
 * ===================================================================== */

/** The latest readings, owned here and read everywhere. */
export let T: TelemetryResponse | null = null;
export let W: WorldResponse = { uplink: null, weather: null, error: null, at: 0 };
export let S: ScanResponse = { running: false, at: 0, durationMs: 0, subnet: null, self: null, gateway: null, hosts: [] };

let coreCells: { box: HTMLElement; fill: HTMLElement }[] = [];

function buildCores(n: number): void {
  const wrap = $("cores");
  wrap.replaceChildren();
  coreCells = [];
  wrap.style.gridTemplateColumns = `repeat(${Math.min(8, Math.max(4, Math.ceil(n / 2)))}, 1fr)`;
  for (let i = 0; i < n; i++) {
    const c = document.createElement("div");
    c.className = "core";
    const f = document.createElement("i");
    c.append(f);
    c.title = `Core ${i}`;
    wrap.append(c);
    coreCells.push({ box: c, fill: f });
  }
}

const sparkRx: number[] = [];
const sparkTx: number[] = [];
const SPARK_N = 60;

function drawSpark(): void {
  if (sparkRx.length < 2) return;
  const max = Math.max(...sparkRx, ...sparkTx, 1);
  // Newest reading at the right edge, older ones scrolling off to the left, so
  // the graph reads as a live trace from the first second rather than filling
  // in from the left over a minute.
  const xAt = (i: number, n: number): number => 260 - ((n - 1 - i) / (SPARK_N - 1)) * 260;
  const path = (arr: number[]): string =>
    arr
      .map((v, i) => {
        const y = 33 - (v / max) * 31;
        return `${i ? "L" : "M"}${xAt(i, arr.length).toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  const firstX = xAt(0, sparkRx.length).toFixed(1);
  $("spark").innerHTML =
    `<path d="${path(sparkRx)} L260 34 L${firstX} 34 Z" fill="rgba(111,240,255,.13)"/>` +
    `<path d="${path(sparkRx)}" fill="none" stroke="#6ff0ff" stroke-width="1.2"/>` +
    `<path d="${path(sparkTx)}" fill="none" stroke="#ffb648" stroke-width="1" stroke-dasharray="3 2" opacity=".8"/>`;
}

export function paintTelemetry(): void {
  if (!T) return;
  hud.telemetry = T;
  if (T.web) { paintWeb(T); fitDockIfChanged(); return; }
  // The readings in the deck are always painted; a panel's body only while
  // it is open (and again the moment it opens — see deck.ts).
  const open = { compute: panels.isOpen("compute"), graphics: panels.isOpen("graphics"), storage: panels.isOpen("storage"), uplink: panels.isOpen("uplink") };

  if (T.cpu) {
    $("pCpu").textContent = `${T.cpu.avg}%`;
    setPill($("pillCpu"), T.cpu.avg >= 75, T.cpu.avg >= 92);
  }
  if (T.cpu && open.compute) {
    $("cpuModel").textContent = T.cpu.model;
    $("cpuModel").title = T.cpu.model;
    $("cpuCount").textContent =
      `${T.cpu.cores.length} cores${T.cpu.speedMhz ? ` · ${(T.cpu.speedMhz / 1000).toFixed(1)} GHz` : ""}`;
    if (coreCells.length !== T.cpu.cores.length) buildCores(T.cpu.cores.length);
    T.cpu.cores.forEach((v, i) => {
      const c = coreCells[i];
      if (!c) return;
      c.fill.style.height = `${v}%`;
      c.box.classList.toggle("hot", v >= 60 && v < 88);
      c.box.classList.toggle("max", v >= 88);
      c.box.title = `Core ${i}: ${v}%`;
    });
    $("cpuAvgN").innerHTML = `${T.cpu.avg}<span class="u">%</span>`;
    setMeter($("cpuAvg"), T.cpu.avg);
  }

  if (T.mem && open.compute) {
    $("memN").innerHTML = `${gib(T.mem.usedBytes)} / ${gib(T.mem.totalBytes)}<span class="u">GB</span>`;
    setMeter($("memBar"), T.mem.pct);
  }

  if (T.gpu) {
    $("pGpu").textContent = `${T.gpu.utilPct ?? 0}% · ${T.gpu.tempC != null ? `${T.gpu.tempC}°` : "—"}`;
    setPill($("pillGpu"), (T.gpu.tempC ?? 0) >= 78, (T.gpu.tempC ?? 0) >= 88);
  }
  if (T.gpu && open.graphics) {
    $("gpuName").textContent = T.gpu.name;
    $("gpuName").title = T.gpu.name;
    $("gpuTemp").textContent = T.gpu.tempC != null ? `${T.gpu.tempC}°C` : "";
    $("gpuUtilN").innerHTML = `${T.gpu.utilPct ?? 0}<span class="u">%</span>`;
    setMeter($("gpuUtil"), T.gpu.utilPct);
    if (T.gpu.vramTotalMb && T.gpu.vramUsedMb != null) {
      $("gpuVramN").innerHTML =
        `${(T.gpu.vramUsedMb / 1024).toFixed(1)} / ${(T.gpu.vramTotalMb / 1024).toFixed(1)}<span class="u">GB</span>`;
      setMeter($("gpuVram"), (T.gpu.vramUsedMb / T.gpu.vramTotalMb) * 100);
    }
    $("gpuPwr").textContent = T.gpu.powerW != null ? `${T.gpu.powerW.toFixed(1)} W` : "—";
    $("gpuClock").textContent = T.gpu.clockMhz != null ? `${T.gpu.clockMhz} MHz` : "—";
    $("gpuFan").textContent = T.gpu.fanPct != null ? `${T.gpu.fanPct} %` : "passive";
  } else if (!T.gpu && open.graphics) {
    $("gpuName").textContent = "No NVIDIA adapter detected";
  }

  if (T.disks.length) {
    const d0 = T.disks[0]!;
    const dp = d0.totalBytes ? Math.round((d0.usedBytes / d0.totalBytes) * 100) : 0;
    $("pDisk").textContent = `${dp}%`;
    setPill($("pillDisk"), dp >= 85, dp >= 95);
    if (open.storage) $("disks").innerHTML = T.disks
      .map((d) => {
        const pct = d.totalBytes ? (d.usedBytes / d.totalBytes) * 100 : 0;
        const cls = pct >= 90 ? " crit" : pct >= 75 ? " warn" : "";
        return (
          `<div class="meter"><div class="row"><span class="nm">${esc(d.id)}</span>` +
          `<span class="nu">${gib0(d.usedBytes)} / ${gib0(d.totalBytes)}<span class="u">GB</span></span></div>` +
          `<div class="track"><div class="fill${cls}" style="width:${pct.toFixed(1)}%"></div></div></div>`
        );
      })
      .join("");
  }

  if (T.net) {
    $("pNet").textContent = fmtRate(T.net.rxBps);
    if (T.net.rxBps != null) {
      sparkRx.push(T.net.rxBps);
      sparkTx.push(T.net.txBps ?? 0);
      while (sparkRx.length > SPARK_N) { sparkRx.shift(); sparkTx.shift(); }
    }
  }
  if (T.net && open.uplink) {
    if (T.net.wifi) {
      $("ssid").textContent = T.net.wifi.ssid || "—";
      $("ssid").title = `Link rate: ${T.net.wifi.rxMbps} / ${T.net.wifi.txMbps} Mbps`;
      $("radio").textContent = [T.net.wifi.radio, T.net.wifi.channel ? `ch ${T.net.wifi.channel}` : null]
        .filter(Boolean).join(" · ") || "—";
      $("wifiSig").textContent = `${T.net.wifi.signal}%`;
    } else {
      $("ssid").textContent = "Wired / unknown";
      $("radio").textContent = "—";
    }
    $("rate").textContent = `${fmtRate(T.net.rxBps)}  ↓ / ↑  ${fmtRate(T.net.txBps)}`;
    $("gw").textContent = T.net.gateway ?? "—";
    $("dns").textContent = T.net.dns.slice(0, 2).join(", ") || "—";
    $("dns").title = T.net.dns.join(", ");
    drawSpark();
  }

  if (T.anchors.length && open.uplink) {
    $("anchors").textContent = T.anchors
      .map((a) => `${a.label.split(" ")[0]} ${a.ms == null ? "—" : `${a.ms}ms`}`)
      .join(" · ");
  }
  fitDockIfChanged();
}

const fmtBytes = (b: number | null | undefined): string =>
  b == null ? "—" : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`;

/** The same instruments, from what the browser measures (see sensors.ts). */
function paintWeb(t: TelemetryResponse): void {
  const w = t.web!;
  const open = { compute: panels.isOpen("compute"), graphics: panels.isOpen("graphics"), storage: panels.isOpen("storage"), uplink: panels.isOpen("uplink") };

  // compute
  if (w.load != null) {
    $("pCpu").textContent = `${w.load}%`;
    setPill($("pillCpu"), w.load >= 75, w.load >= 92);
  }
  if (open.compute) {
    $("cpuModel").textContent = w.platform;
    $("cpuModel").title = w.platform;
    $("cpuCount").textContent = [w.cores ? `${w.cores} cores` : null, w.pressure].filter(Boolean).join(" · ") || "—";
    $("cpuAvgN").innerHTML = w.load != null ? `${w.load}<span class="u">%</span>` : "—";
    setMeter($("cpuAvg"), w.load);
    if (w.heapUsed != null && w.heapLimit) {
      $("memN").innerHTML = `${Math.round(w.heapUsed / 1e6)} / ${Math.round(w.heapLimit / 1e6)}<span class="u">MB</span>` +
        (w.deviceMemGb ? ` <span class="u">· device ${w.deviceMemGb} GB</span>` : "");
      setMeter($("memBar"), (w.heapUsed / w.heapLimit) * 100);
    } else {
      $("memN").innerHTML = w.deviceMemGb ? `device ${w.deviceMemGb}<span class="u">GB</span>` : "—";
    }
  }

  // graphics: frames held, against what the display can show
  if (w.fps != null) {
    $("pGpu").textContent = `${w.fps} fps`;
    const ratio = w.refreshHz ? w.fps / w.refreshHz : 1;
    setPill($("pillGpu"), ratio < 0.75, ratio < 0.4);
  }
  if (open.graphics) {
    $("gpuName").textContent = w.renderer ?? "Not named by this browser";
    $("gpuName").title = w.renderer ?? "";
    $("gpuTemp").textContent = w.refreshHz ? `${w.refreshHz} Hz` : "—";
    $("gpuUtilN").innerHTML = w.fps != null ? `${w.fps}<span class="u">fps</span>` : "—";
    const fill = $("gpuUtil");
    const pct = w.fps != null && w.refreshHz ? Math.min(100, (w.fps / w.refreshHz) * 100) : 0;
    fill.style.width = `${pct}%`;
    fill.classList.toggle("warn", pct < 75 && pct >= 40);
    fill.classList.toggle("crit", pct < 40);
    $("gpuPwr").textContent = w.screen;
    $("gpuClock").textContent = `${w.hdr ? "HDR" : "SDR"} · ${w.gamut}`;
    $("gpuFan").textContent = w.graphicsApi ?? "—";
  }

  // storage: what this app keeps on the device
  if (w.storageUsed != null || w.boardBytes) {
    // what the browser counts (files, caches) plus the board's own saves, which it leaves out
    $("pDisk").textContent = fmtBytes((w.storageUsed ?? 0) + w.boardBytes);
    const full = w.storageQuota ? ((w.storageUsed ?? 0) / w.storageQuota) * 100 : 0;
    setPill($("pillDisk"), full >= 75, full >= 90);
  }
  if (open.storage) {
    const LOCAL_LIMIT = 5 * 1024 * 1024; // what browsers allow a site's local storage
    const rows: [string, number | null, number | null][] = [
      ["Files and caches", w.storageUsed, w.storageQuota],
      ["Board, threads and settings", w.boardBytes, LOCAL_LIMIT],
    ];
    $("disks").innerHTML = rows.map(([name, used, total]) => {
      const pct = used != null && total ? (used / total) * 100 : 0;
      const cls = pct >= 90 ? " crit" : pct >= 75 ? " warn" : "";
      return `<div class="meter"><div class="row"><span class="nm">${esc(name)}</span>` +
        `<span class="nu">${fmtBytes(used)} / ${fmtBytes(total)}</span></div>` +
        `<div class="track"><div class="fill${cls}" style="width:${Math.max(pct, used ? 0.5 : 0).toFixed(1)}%"></div></div></div>`;
    }).join("") +
      `<div class="kv"><span class="k">Kept when space is short</span><span class="v">${w.persisted == null ? "—" : w.persisted ? "yes" : "no — the browser may clear it"}</span></div>`;
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
  if (open.uplink) {
    const c = w.connection;
    const kind = c?.type && c.type !== "unknown" ? c.type.replace("wifi", "Wi-Fi").replace("cellular", "mobile data") : null;
    $("ssid").textContent = !w.online ? "Offline" : kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Online";
    // the browser's own speed estimate: a class ("4G" means fast, on any connection) and a rounded downlink
    $("radio").textContent = c
      ? [c.downlinkMbps != null ? `~${c.downlinkMbps} Mbps` : null, c.effective ? `${c.effective.toUpperCase()} class` : null].filter(Boolean).join(" · ") || "—"
      : "not offered by this browser";
    $("wifiSig").textContent = w.rttMs != null ? `${w.rttMs} ms` : "—";
    $("rate").textContent = w.rttMs != null ? `${w.rttMs} ms` : "—";
    $("gw").textContent = w.online ? "online" : "offline";
    $("dns").textContent = c ? (c.saveData ? "on" : "off") : "—";
    drawSpark();
    if (t.anchors.length) {
      $("anchors").textContent = t.anchors.map((a) => `${a.label === "This page's host" ? "Host" : a.label} ${a.ms == null ? "—" : `${a.ms}ms`}`).join(" · ");
    }
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
let lastRttAt = 0;

export function paintWorld(): void {
  if (W.uplink) {
    $("pubip").textContent = W.uplink.ip;
    $("isp").textContent = `${W.uplink.isp}${W.uplink.asn ? ` · ${W.uplink.asn}` : ""}`;
    $("isp").title = W.uplink.isp;
    $("wxPlace").textContent = [W.uplink.city, W.uplink.country].filter(Boolean).join(", ");
  }
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
      const cls = ["host", h.gateway ? "gw" : "", h.self ? "self" : "", hud.hoverIp === h.ip ? "lit" : ""]
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
hud.onHover = paintHosts;

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
  if (changed) { hud.layout(S.hosts); paintHosts(); }
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
    sys(SERVERLESS ? `Sweep complete — ${S.hosts.length} services answering.` : `Sweep complete — ${S.hosts.length} hosts responding.`);
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
export async function pollScan(run = false): Promise<void> {
  if (SERVERLESS) { if (run) await sweepServices(applyScan); return; }
  try {
    applyScan(await api.scan(run));
  } catch { /* ignored */ }
}

export function sweep(): void {
  sweepPending = true;
  void pollScan(true);
}
$("sweepBtn").addEventListener("click", sweep);

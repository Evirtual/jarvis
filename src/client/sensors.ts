/**
 * The instruments, measured by the browser — for when the console runs on its
 * own, published as a web page, with no server to read the machine.
 *
 * No browser can read a CPU's temperature, a disk, or the devices on the
 * local network, so each instrument measures the nearest thing a browser
 * genuinely can (see WebReadings). Nothing here is simulated:
 *   • compute   how much slower a fixed task runs now than at its quickest
 *   • graphics  the adapter the browser names, and the frame rate it holds
 *   • storage   what this app keeps on the device, and what it's allowed
 *   • perimeter the services JARVIS relies on, each placed by its round trip
 *   • uplink    the connection as the browser sees it, and measured latency
 *   • environment  the weather, where the IP address — or, when asked, GPS — says you are
 * Everything pauses while the page is out of sight.
 */

import type {
  Anchor, BatteryReading, LocationReading, ScanHost, ScanResponse, TelemetryResponse, UplinkReading, WebReadings, WorldResponse,
} from "../shared/types.js";
import { weatherAt } from "../shared/weather.js";

type Nav = Navigator & {
  userAgentData?: { platform?: string; mobile?: boolean };
  brave?: unknown;
  deviceMemory?: number;
  connection?: { type?: string; effectiveType?: string; downlink?: number; saveData?: boolean; addEventListener?: (t: string, f: () => void) => void };
  getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (t: string, f: () => void) => void }>;
  gpu?: { requestAdapter: () => Promise<{ info?: { vendor?: string; architecture?: string; description?: string } } | null> };
};
const nav = navigator as Nav;

/* ---------------- the device ---------------- */

function platformName(): string {
  const ua = navigator.userAgent;
  let os = nav.userAgentData?.platform ||
    (/iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
      : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "Unknown");
  if (os === "macOS" && navigator.maxTouchPoints > 1) os = "iPad"; // iPadOS asks for the desktop site
  const browser = nav.brave ? "Brave" : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const app = matchMedia("(display-mode: standalone)").matches ? " app" : "";
  return `${os} · ${browser}${app}`;
}

/** "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x…) Direct3D11 …)" → "NVIDIA GeForce RTX 4060 Laptop GPU". */
function cleanRenderer(raw: string): string {
  const angle = raw.match(/^ANGLE \(([^,]+),\s*(.+?)(?:\s*\(0x[0-9a-f]+\))?(?:\s+Direct3D.*|\s+OpenGL.*|\s+Metal.*|\s+Vulkan.*)?(?:,\s*[^,]*)?\)$/i);
  return (angle?.[2] ?? raw).replace(/\s+/g, " ").trim();
}

function graphicsInfo(): { renderer: string | null; api: string | null } {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return { renderer: null, api: nav.gpu ? "WebGPU" : null };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const raw = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const api = nav.gpu ? "WebGPU" : typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? "WebGL 2" : "WebGL";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { renderer: cleanRenderer(raw), api };
  } catch {
    return { renderer: null, api: null };
  }
}

const web: WebReadings = {
  platform: "",
  cores: null,
  load: null,
  pressure: null,
  deviceMemGb: null,
  heapUsed: null,
  heapLimit: null,
  renderer: null,
  graphicsApi: null,
  fps: null,
  refreshHz: null,
  screen: "",
  hdr: false,
  gamut: "sRGB",
  storageUsed: null,
  storageQuota: null,
  persisted: null,
  boardBytes: 0,
  online: true,
  connection: null,
  rttMs: null,
  location: null,
  locationState: "off",
};

/* ---------------- compute: a fixed task, timed ---------------- */

// A small worker counts how much fixed arithmetic fits in a 20 ms window every
// two seconds — off the page's own thread, so it never costs a frame. A busy
// device (other apps, other tabs, a throttled chip) fits less in; the most
// ever fitted is the device at rest. Counting within a window, rather than
// timing a short task, is what keeps it accurate under a browser's coarse
// clock.
const PROBE = `
let sink = 0;
function run() {
  const end = performance.now() + 20;
  let n = 0, x = sink;
  while (performance.now() < end) {
    for (let i = 0; i < 2000; i++) x = (x + Math.sqrt(i + x)) % 1e9;
    n++;
  }
  sink = x;
  postMessage(n);
}
onmessage = run;
`;
let prober: Worker | null = null;
let most = 0;
const recent: number[] = [];

function onProbe(n: number): void {
  // let the best drift down slowly, so one lucky window doesn't read as load for ever after
  most = Math.max(most * 0.996, n);
  recent.push(Math.max(0, Math.min(100, (1 - n / most) * 100)));
  if (recent.length > 3) recent.shift();
  web.load = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}

function measureLoad(): void {
  if (!prober) {
    try {
      prober = new Worker(URL.createObjectURL(new Blob([PROBE], { type: "text/javascript" })));
      prober.onmessage = (e: MessageEvent<number>) => onProbe(e.data);
    } catch { return; } // workers not allowed here: no estimate, rather than a wrong one
  }
  prober.postMessage(0);
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (mem) { web.heapUsed = mem.usedJSHeapSize; web.heapLimit = mem.jsHeapSizeLimit; }
}

/* ---------------- graphics: frames held ---------------- */

let frames = 0;
let fastest = 0;
const RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240];
// One counting loop at a time: each start begins a new one and retires the last,
// or a page shown and hidden quickly would count every frame several times over.
let frameLoop = 0;
function countFrames(): void {
  const mine = ++frameLoop;
  const count = (): void => {
    if (mine !== frameLoop || document.hidden) return;
    frames++;
    requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
}
function sampleFrames(elapsedMs: number): void {
  // No frames at all means the page isn't being drawn (a covered window, a
  // backgrounded app) — nothing to measure, rather than a frame rate of zero.
  if (!frames) return;
  const fps = Math.round((frames * 1000) / elapsedMs);
  frames = 0;
  if (elapsedMs < 500) return; // too short a window to say
  web.fps = fps;
  fastest = Math.max(fastest * 0.995, fps);
  // the display's refresh rate: the nearest standard rate to the most frames ever held
  web.refreshHz = RATES.reduce((best, r) => (Math.abs(r - fastest) < Math.abs(best - fastest) ? r : best), 60);
}

/* ---------------- storage ---------------- */

async function measureStorage(): Promise<void> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (e) { web.storageUsed = e.usage ?? null; web.storageQuota = e.quota ?? null; }
    web.persisted = (await navigator.storage?.persisted?.()) ?? null;
  } catch { /* not offered */ }
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      bytes += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2; // UTF-16
    }
  } catch { /* private mode */ }
  web.boardBytes = bytes;
}

/* ---------------- the connection ---------------- */

function readConnection(): void {
  web.online = navigator.onLine;
  const c = nav.connection;
  web.connection = c
    ? { type: c.type ?? null, effective: c.effectiveType ?? null, downlinkMbps: c.downlink ?? null, saveData: !!c.saveData }
    : null;
}

/**
 * Something to time a round trip against: an address that answers cleanly
 * without a key — 200 or 204, nothing refused — so no request shows as an
 * error and no browser has reason to block it (Brave's shields block
 * Cloudflare's /cdn-cgi/trace, for one). `read`: the reply is one the page is
 * allowed to read (the service allows it), so it's asked for openly; otherwise
 * only its timing is taken.
 */
interface Probe { url: string; read?: boolean; accept?: string }

/** One round trip, in ms: the second of two requests, so the connection is already open. */
async function roundTrip(p: Probe): Promise<number | null> {
  const init: RequestInit = {
    mode: p.read ? "cors" : "no-cors",
    cache: "no-store",
    credentials: "omit",
    ...(p.accept ? { headers: { accept: p.accept } } : {}),
  };
  const once = async (): Promise<number> => {
    const t0 = performance.now();
    const r = await fetch(p.url, { ...init, signal: AbortSignal.timeout(6000) });
    if (p.read && !r.ok) throw new Error(String(r.status));
    return performance.now() - t0;
  };
  try {
    await once();
    return Math.round(await once());
  } catch {
    return null;
  }
}

const PAGE: Probe = { url: `${location.origin}${import.meta.env.BASE_URL}robots.txt`, read: true };
const CLOUDFLARE: Probe = { url: "https://cloudflare-dns.com/dns-query?name=example.com&type=A", read: true, accept: "application/dns-json" };
const GOOGLE: Probe = { url: "https://www.google.com/generate_204" };

/** This page's own host, and two reference points on the internet. */
const ANCHORS: { label: string; probe: Probe }[] = [
  { label: "This page's host", probe: PAGE },
  { label: "Cloudflare", probe: CLOUDFLARE },
  { label: "Google", probe: GOOGLE },
];
let anchors: Anchor[] = [];

let anchorsAt = 0;
async function measureAnchors(): Promise<void> {
  // at most every 15 s, however often the page is hidden and shown again
  if (Date.now() - anchorsAt < 15_000) return;
  anchorsAt = Date.now();
  anchors = await Promise.all(ANCHORS.map(async (a) => ({ label: a.label, ip: new URL(a.probe.url).host, ms: await roundTrip(a.probe) })));
  const ms = anchors.map((a) => a.ms).filter((m): m is number => m != null).sort((a, b) => a - b);
  web.rttMs = ms.length ? ms[Math.floor(ms.length / 2)]! : null;
}

/* ---------------- the battery ---------------- */

/** Kept current by the browser's battery events, which `startSensors` listens to. */
let battery: BatteryReading | null = null;

/* ---------------- perimeter: the services JARVIS relies on ---------------- */

const SERVICES: { name: string; role: string; probe: Probe; self?: boolean }[] = [
  { name: location.hostname.endsWith("github.io") ? "GitHub Pages" : location.host, role: "serves this page", probe: PAGE, self: true },
  { name: "Gemini", role: "reasoning core · Google", probe: { url: "https://generativelanguage.googleapis.com/generate_204" } },
  { name: "ChatGPT", role: "reasoning core · OpenAI", probe: { url: "https://api.openai.com/healthz" } },
  { name: "Open-Meteo", role: "weather", probe: { url: "https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0", read: true } },
  { name: "GeoJS", role: "where you are, by IP", probe: { url: "https://get.geojs.io/v1/ip.json", read: true } },
  { name: "Cloudflare", role: "reference · 1.1.1.1 resolver", probe: CLOUDFLARE },
  { name: "Google", role: "reference", probe: GOOGLE },
];

export let scan: ScanResponse = { running: false, at: 0, durationMs: 0, subnet: "the internet", self: null, gateway: location.host, hosts: [] };

/** Measure the round trip to every service JARVIS relies on — only when asked, as the PC only sweeps when asked. */
export async function sweepServices(onChange: (s: ScanResponse) => void): Promise<void> {
  if (scan.running) return;
  const t0 = performance.now();
  scan = { ...scan, running: true };
  onChange(scan);
  const hosts: ScanHost[] = [];
  await Promise.all(SERVICES.map(async (s) => {
    const ms = await roundTrip(s.probe);
    if (ms == null) return;
    hosts.push({ ip: new URL(s.probe.url).host, rttMs: ms, mac: null, vendor: s.role, hostname: s.name, self: false, gateway: !!s.self, lastSeen: Date.now() });
  }));
  hosts.sort((a, b) => Number(b.gateway) - Number(a.gateway) || a.rttMs - b.rttMs);
  scan = { ...scan, running: false, at: Date.now(), durationMs: Math.round(performance.now() - t0), hosts };
  onChange(scan);
}

/* ---------------- environment: where you are, and the weather there ---------------- */

export let world: WorldResponse = { uplink: null, weather: null, error: null, at: 0 };

interface GeoJs { ip?: string; city?: string; region?: string; country?: string; organization_name?: string; organization?: string; asn?: number; latitude?: string; longitude?: string; timezone?: string }
interface IpWho { ip?: string; success?: boolean; city?: string; region?: string; country?: string; latitude?: number; longitude?: number; connection?: { isp?: string; asn?: number }; timezone?: { id?: string } }

async function lookUpIp(): Promise<UplinkReading> {
  try {
    const r = await fetch("https://get.geojs.io/v1/ip/geo.json", { signal: AbortSignal.timeout(8000) });
    const g = (await r.json()) as GeoJs;
    if (!g.ip || g.latitude == null) throw new Error("geojs: no answer");
    return {
      ip: g.ip, city: g.city ?? "", region: g.region ?? "", country: g.country ?? "",
      isp: (g.organization_name ?? g.organization?.replace(/^AS\d+\s*/, "") ?? "").replace(/\.\s*$/, ""), asn: g.asn ? `AS${g.asn}` : null,
      lat: Number(g.latitude), lon: Number(g.longitude), timezone: g.timezone ?? "",
    };
  } catch {
    const r = await fetch("https://ipwho.is/", { signal: AbortSignal.timeout(8000) });
    const g = (await r.json()) as IpWho;
    if (!g.success || !g.ip) throw new Error("no IP lookup answered");
    return {
      ip: g.ip, city: g.city ?? "", region: g.region ?? "", country: g.country ?? "",
      isp: g.connection?.isp ?? "", asn: g.connection?.asn ? `AS${g.connection.asn}` : null,
      lat: g.latitude ?? 0, lon: g.longitude ?? 0, timezone: g.timezone?.id ?? "",
    };
  }
}

async function refreshWorld(onWorld: (w: WorldResponse) => void): Promise<void> {
  try {
    const uplink = await lookUpIp();
    // GPS, once the user has asked to be located, is better than the IP's guess.
    const at = web.location ?? { lat: uplink.lat, lon: uplink.lon };
    world = { uplink, weather: await weatherAt(at.lat, at.lon), error: null, at: Date.now() };
  } catch (err) {
    world = { ...world, error: err instanceof Error ? err.message : String(err) };
  }
  onWorld(world);
}

let watch: number | null = null;
let worldCb: ((w: WorldResponse) => void) | null = null;

function onFix(p: GeolocationPosition): void {
  const first = !web.location;
  const moved = web.location ? Math.hypot(p.coords.latitude - web.location.lat, p.coords.longitude - web.location.lon) > 0.05 : true;
  const loc: LocationReading = {
    lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy),
    altitudeM: p.coords.altitude != null ? Math.round(p.coords.altitude) : null,
    speedMps: p.coords.speed, heading: p.coords.heading, at: p.timestamp,
  };
  web.location = loc;
  web.locationState = "on";
  // the weather follows you when you've moved far enough for it to differ (~5 km)
  if ((first || moved) && worldCb) void refreshWorld(worldCb);
}

function onFixError(e: GeolocationPositionError): void {
  web.locationState = e.code === e.PERMISSION_DENIED ? "denied" : "unavailable";
  if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; }
}

/** Use the device's own position — GPS on a phone. Only ever on request; the browser asks the user first. */
export function locate(): void {
  if (!("geolocation" in navigator)) { web.locationState = "unavailable"; return; }
  if (watch != null) return;
  web.locationState = web.location ? "on" : "asking";
  watch = navigator.geolocation.watchPosition(onFix, onFixError, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 });
}

function stopLocating(): void {
  if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; }
}

/* ---------------- running it ---------------- */

/** Read what doesn't change, and start listening for what does. Once, when the sensors start. */
function init(): void {
  web.platform = platformName();
  web.cores = navigator.hardwareConcurrency || null;
  web.deviceMemGb = nav.deviceMemory ?? null;
  const g = graphicsInfo();
  web.renderer = g.renderer;
  web.graphicsApi = g.api;
  web.screen = `${screen.width}×${screen.height} @${Math.round((devicePixelRatio || 1) * 100) / 100}x`;
  web.hdr = matchMedia("(dynamic-range: high)").matches;
  web.gamut = matchMedia("(color-gamut: rec2020)").matches ? "Rec. 2020" : matchMedia("(color-gamut: p3)").matches ? "Display P3" : "sRGB";
  // A browser that hides the adapter's name ("Apple GPU", or nothing) may still say more through WebGPU.
  if (nav.gpu && (!web.renderer || /^(apple gpu|webkit webgl)$/i.test(web.renderer))) {
    void nav.gpu.requestAdapter().then((a) => {
      const i = a?.info;
      const name = i?.description || [i?.vendor, i?.architecture].filter(Boolean).join(" ");
      if (name) web.renderer = name.replace(/^\w/, (c) => c.toUpperCase());
    }).catch(() => undefined);
  }
  // Where the browser offers its own reading of CPU pressure (Chromium on the desktop), take it too.
  type PressureRecord = { state: WebReadings["pressure"] };
  const PO = (window as unknown as { PressureObserver?: new (cb: (r: PressureRecord[]) => void) => { observe: (s: string, o?: object) => Promise<void> } }).PressureObserver;
  if (PO) {
    try {
      void new PO((records) => { web.pressure = records[records.length - 1]?.state ?? null; }).observe("cpu", { sampleInterval: 2000 }).catch(() => undefined);
    } catch { /* not allowed here */ }
  }
  // The board lives in this browser's storage. Ask for it to be kept even when
  // the device runs short of space — Chromium and Safari decide quietly (yes for
  // an installed app); Firefox would ask with a prompt, so it isn't asked there.
  if (!/Firefox\//.test(navigator.userAgent)) void navigator.storage?.persist?.().catch(() => undefined);
  void nav.getBattery?.().then((b) => {
    const read = (): void => { battery = { pct: Math.round(b.level * 100), onAc: b.charging }; };
    read();
    b.addEventListener("levelchange", read);
    b.addEventListener("chargingchange", read);
  }).catch(() => undefined);
}

export function startSensors(onTelemetry: (t: TelemetryResponse) => void, onWorld: (w: WorldResponse) => void, onScan: (s: ScanResponse) => void): void {
  worldCb = onWorld;
  init();
  readConnection();
  nav.connection?.addEventListener?.("change", readConnection);
  addEventListener("online", readConnection);
  addEventListener("offline", readConnection);

  // Already allowed to locate on an earlier visit: pick up where it left off.
  void navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((p) => { if (p.state === "granted") locate(); }).catch(() => undefined);

  let timers: number[] = [];
  let last = performance.now();
  let ticks = 0;
  const tick = (): void => {
    const now = performance.now();
    sampleFrames(now - last);
    last = now;
    if (ticks++ % 2 === 0) measureLoad();
    onTelemetry({
      at: Date.now(),
      host: { hostname: "this device", platform: web.platform, arch: "", uptimeSec: Math.round(performance.now() / 1000) },
      cpu: null, mem: null, gpu: null, net: null, battery, disks: [], anchors, web: { ...web },
    });
  };
  const start = (): void => {
    if (timers.length) return;
    frames = 0;
    last = performance.now();
    countFrames();
    void measureStorage();
    void measureAnchors();
    if (Date.now() - world.at > 10 * 60 * 1000) void refreshWorld(onWorld);
    timers = [
      window.setInterval(tick, 1000),
      window.setInterval(() => void measureAnchors(), 20_500),
      window.setInterval(() => void measureStorage(), 30_000),
      window.setInterval(() => void refreshWorld(onWorld), 10 * 60 * 1000),
    ];
    if (web.locationState === "on" && watch == null) locate();
    // A sweep here only measures round trips to public services, so the first one needn't wait to be asked.
    if (!scan.at) void sweepServices(onScan);
    tick();
  };
  const stop = (): void => {
    for (const t of timers) clearInterval(t);
    timers = [];
    stopLocating(); // no GPS while nobody is looking
  };
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  if (!document.hidden) start();
}

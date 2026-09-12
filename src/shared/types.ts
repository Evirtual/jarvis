/**
 * The contract between the console and its server.
 *
 * Both sides import from this file, so a change to a payload shape breaks the
 * build rather than surfacing as an undefined at three in the morning.
 */

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

// OpenRouter first: its free models are the quickest way in for someone new
export const PROVIDER_IDS = ["openrouter", "openai", "anthropic", "gemini"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderMeta {
  id: ProviderId;
  /** What a person calls it. */
  name: string;
  /** One line under the name in the Connections screen. */
  blurb: string;
  /** Where to get a key, linked directly from the setup card. */
  keyUrl: string;
  /** What the key looks like, so we can catch a paste error before the network does. */
  keyHint: string;
  keyPrefix: string;
  /** Plain-language cost, because "it depends" helps nobody. */
  cost: string;
  /** True when this provider has a genuinely free tier. */
  free: boolean;
}

export type ProviderStatus =
  | { state: "unconfigured" }
  | { state: "checking" }
  | {
      state: "ready"; maskedKey: string; models: string[]; model: string; source: KeySource;
      /** The key works, but the last request failed for a reason on the account (no credit, no access). Cleared by the next success. */
      problem?: string;
    }
  | { state: "error"; maskedKey: string; message: string; source: KeySource };

/** Where the credential came from — the UI says so, so nothing is mysterious. */
export type KeySource = "saved" | "environment";

export interface ProviderView extends ProviderMeta {
  status: ProviderStatus;
}

export interface ConnectionsResponse {
  providers: ProviderView[];
  /** Which provider answers questions right now, if any. */
  active: ProviderId | null;
}

export interface SaveKeyRequest {
  apiKey: string;
}

export interface SelectModelRequest {
  model: string;
}

export interface SetActiveRequest {
  provider: ProviderId;
}

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface AskRequest {
  turns: Turn[];
  /** Live machine readings, injected as context for the current question only. */
  context?: string;
  provider?: ProviderId;
  /** How JARVIS addresses the user: "sir" (default) or "madam" (said as “ma'am”). */
  address?: "sir" | "madam";
}

/**
 * `/api/ask` streams newline-delimited JSON rather than raw text, so the console
 * can say *why* it is waiting — a web search adds several seconds before the
 * first word arrives, and silence in a voice interface reads as a fault.
 */
export type AskStatus = "thinking" | "searching" | "writing";

export type AskEvent =
  | { t: "status"; status: AskStatus }
  | { t: "text"; delta: string }
  | { t: "error"; message: string }
  | { t: "done" };

/* ------------------------------------------------------------------ *
 * Speech
 * ------------------------------------------------------------------ */

export type KokoroState = "loading" | "ready" | "failed";

export interface VoiceOption {
  id: string;
  name: string;
  note: string;
}

export interface SpeakRequest {
  text: string;
  voice: string;
  speed: number;
}

export interface StatusResponse {
  kokoro: KokoroState;
  kokoroError: string | null;
  dtype: string;
  voices: VoiceOption[];
  active: ProviderId | null;
  anyProviderReady: boolean;
  /** True when the server can turn recorded speech into text. */
  transcription: boolean;
  /** JARVIS's own hearing (Moonshine, on the device): "none" where it hasn't been downloaded. */
  hearing: "none" | "loading" | "ready" | "failed";
}

/* ------------------------------------------------------------------ *
 * Telemetry — every field below is measured, never simulated
 * ------------------------------------------------------------------ */

export interface CpuReading {
  model: string;
  speedMhz: number | null;
  /** One entry per logical core, 0-100. */
  cores: number[];
  avg: number;
}

export interface MemReading {
  totalBytes: number;
  usedBytes: number;
  pct: number;
}

export interface GpuReading {
  name: string;
  utilPct: number | null;
  tempC: number | null;
  vramUsedMb: number | null;
  vramTotalMb: number | null;
  powerW: number | null;
  clockMhz: number | null;
  fanPct: number | null;
}

export interface WifiReading {
  ssid: string;
  signal: number;
  rxMbps: number;
  txMbps: number;
  channel: number;
  radio: string;
}

export interface NetReading {
  rxBps: number | null;
  txBps: number | null;
  totalRx: number;
  totalTx: number;
  wifi: WifiReading | null;
  gateway: string | null;
  dns: string[];
}

export interface DiskReading {
  id: string;
  usedBytes: number;
  totalBytes: number;
}

export interface BatteryReading {
  pct: number;
  onAc: boolean;
}

export interface HostReading {
  hostname: string;
  platform: string;
  arch: string;
  uptimeSec: number;
}

export interface Anchor {
  label: string;
  ip: string;
  ms: number | null;
}

export interface TelemetryResponse {
  at: number;
  host: HostReading;
  cpu: CpuReading | null;
  mem: MemReading | null;
  gpu: GpuReading | null;
  net: NetReading | null;
  battery: BatteryReading | null;
  disks: DiskReading[];
  anchors: Anchor[];
  /** Set when the console runs on its own in a browser: what the browser can measure instead. */
  web?: WebReadings;
}

/** Where the device is, when the user has asked to be located. */
export interface LocationReading {
  lat: number;
  lon: number;
  accuracyM: number;
  altitudeM: number | null;
  speedMps: number | null;
  heading: number | null;
  at: number;
}

/**
 * What a browser can genuinely measure of the device it runs on — the
 * console's readings when it runs on its own, published as a web page. No
 * browser can read CPU temperatures, a disk, or the devices on the network, so
 * each of those instruments measures the nearest thing a browser can.
 */
export interface WebReadings {
  /** "Windows · Brave", "iPhone · Safari". */
  platform: string;
  cores: number | null;
  /** 0-100: how much slower a fixed task runs now than at its quickest. */
  load: number | null;
  /** The browser's own CPU pressure state, where it offers one. */
  pressure: "nominal" | "fair" | "serious" | "critical" | null;
  /** Approximate device memory, as the browser rounds it. */
  deviceMemGb: number | null;
  /** This page's JavaScript memory, where the browser reports it. */
  heapUsed: number | null;
  heapLimit: number | null;
  /** The graphics adapter as the browser names it. */
  renderer: string | null;
  graphicsApi: string | null;
  fps: number | null;
  refreshHz: number | null;
  screen: string;
  hdr: boolean;
  gamut: string;
  /** Storage this app uses, and what the browser allows it. */
  storageUsed: number | null;
  storageQuota: number | null;
  persisted: boolean | null;
  /** The console's own saves — the board, its threads — in local storage. */
  boardBytes: number;
  online: boolean;
  /** The browser's view of the connection, where it offers one (Chromium). */
  connection: { type: string | null; effective: string | null; downlinkMbps: number | null; saveData: boolean } | null;
  /** Measured round trip to the internet, the median of the anchors. */
  rttMs: number | null;
  location: LocationReading | null;
  locationState: "off" | "asking" | "on" | "denied" | "unavailable";
}

/* ------------------------------------------------------------------ *
 * Perimeter scan
 * ------------------------------------------------------------------ */

export interface ScanHost {
  ip: string;
  rttMs: number;
  mac: string | null;
  vendor: string | null;
  hostname: string | null;
  self: boolean;
  gateway: boolean;
  lastSeen: number;
}

export interface ScanResponse {
  running: boolean;
  at: number;
  durationMs: number;
  subnet: string | null;
  self: string | null;
  gateway: string | null;
  hosts: ScanHost[];
}

/* ------------------------------------------------------------------ *
 * The world outside
 * ------------------------------------------------------------------ */

export interface UplinkReading {
  ip: string;
  city: string;
  region: string;
  country: string;
  isp: string;
  asn: string | null;
  lat: number;
  lon: number;
  timezone: string;
}

export interface WeatherReading {
  tempC: number | null;
  feelsC: number | null;
  humidity: number | null;
  windKph: number | null;
  pressure: number | null;
  isDay: boolean;
  text: string;
  icon: string;
  sunrise: string | null;
  sunset: string | null;
}

export interface WorldResponse {
  uplink: UplinkReading | null;
  weather: WeatherReading | null;
  error: string | null;
  at: number;
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export interface ApiError {
  error: string;
  message?: string;
}

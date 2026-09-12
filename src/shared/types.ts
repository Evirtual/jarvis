/**
 * The contract between the console and its server.
 *
 * Both sides import from this file, so a change to a payload shape breaks the
 * build rather than surfacing as an undefined at three in the morning.
 */

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

/**
 * The services JARVIS can connect to. One key each, and everything comes
 * through it: his reasoning, his hearing and his voice. Gemini first — its
 * free tier is the way in for someone new.
 */
export const PROVIDER_IDS = ["gemini", "openai"] as const;
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

/** A voice a service can speak with. */
export interface VoiceOption {
  id: string;
  name: string;
  note: string;
}

/**
 * What a key can reach on its account, found by asking the service: the
 * models for each job, newest and most capable first, and the voices.
 * Nothing about model names is hardcoded, so a retired model can never
 * silently break the console.
 */
export interface Catalogue {
  /** Answers questions. */
  chat: string[];
  /** Turns text into speech. */
  speech: string[];
  /** Turns recorded speech into text. */
  hearing: string[];
  voices: VoiceOption[];
}

export type ProviderStatus =
  | { state: "unconfigured" }
  | { state: "checking" }
  | {
      state: "ready";
      maskedKey: string;
      source: KeySource;
      /** The chat models on the account, and the one in use. */
      models: string[];
      model: string;
      /** The voices this service can speak with — empty when it can't speak. Which one is chosen in Configuration → Voice. */
      voices: VoiceOption[];
      /** Whether this service can turn recorded speech into text. */
      hears: boolean;
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

export interface SpeakRequest {
  text: string;
  /** The connected service that makes the speech. */
  via: ProviderId;
  voice: string;
  /** 1 is natural; the Cadence slider in Configuration → Voice. */
  speed: number;
}

export interface StatusResponse {
  active: ProviderId | null;
  anyProviderReady: boolean;
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

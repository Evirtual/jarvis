/**
 * Everything beyond the front door: the public uplink, where it lands, real
 * latency to a few internet anchors, and the actual weather there.
 *
 * Two outbound services, both keyless, both named in the README because they
 * see the machine's IP:
 *   • ip-api.com     — public IP, ISP, ASN, city, coordinates
 *   • open-meteo.com — weather and sun times for those coordinates
 *
 * Set JARVIS_OFFLINE=1 to disable both; the console then reports that it has no
 * uplink data rather than inventing any.
 */

import { execFile } from "node:child_process";
import { setDefaultResultOrder } from "node:dns";

import type { Anchor, WorldResponse } from "../shared/types.js";

// Some networks resolve these hosts to an unreachable IPv6 address first, which
// surfaces as a 10 s connect timeout. Prefer A records.
setDefaultResultOrder("ipv4first");

const OFFLINE = process.env.JARVIS_OFFLINE === "1";

const exec = (cmd: string, args: string[], timeout = 5000): Promise<string> =>
  new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout }, (err, stdout) =>
      resolve(err ? "" : String(stdout)),
    );
  });

async function getJson<T>(url: string, ms = 8000): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return (await r.json()) as T;
}

interface GeoResponse {
  status: string;
  query: string;
  city: string;
  regionName: string;
  country: string;
  isp: string;
  as: string;
  lat: number;
  lon: number;
  timezone: string;
}

interface MeteoResponse {
  current?: Record<string, number>;
  daily?: { sunrise?: string[]; sunset?: string[] };
}

/** WMO weather codes to what a butler would actually call it. */
const WMO: Record<number, [string, string]> = {
  0: ["Clear", "☀"], 1: ["Mainly clear", "☀"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁"],
  45: ["Fog", "🌫"], 48: ["Rime fog", "🌫"],
  51: ["Light drizzle", "🌦"], 53: ["Drizzle", "🌦"], 55: ["Heavy drizzle", "🌦"],
  56: ["Freezing drizzle", "🌧"], 57: ["Freezing drizzle", "🌧"],
  61: ["Light rain", "🌦"], 63: ["Rain", "🌧"], 65: ["Heavy rain", "🌧"],
  66: ["Freezing rain", "🌧"], 67: ["Freezing rain", "🌧"],
  71: ["Light snow", "🌨"], 73: ["Snow", "🌨"], 75: ["Heavy snow", "🌨"], 77: ["Snow grains", "🌨"],
  80: ["Rain showers", "🌦"], 81: ["Rain showers", "🌧"], 82: ["Violent showers", "⛈"],
  85: ["Snow showers", "🌨"], 86: ["Snow showers", "🌨"],
  95: ["Thunderstorm", "⛈"], 96: ["Thunderstorm, hail", "⛈"], 99: ["Thunderstorm, hail", "⛈"],
};

export const world: WorldResponse & { anchors: Anchor[] } = {
  uplink: null,
  weather: null,
  anchors: [],
  error: null,
  at: 0,
};

async function pingMs(ip: string): Promise<number | null> {
  const out = await exec("ping", ["-n", "1", "-w", "1200", ip], 4000);
  const m = out.match(/[=<]\s*(\d+)\s*ms/i);
  return m?.[1] ? Number(m[1]) : null;
}

/** Latency to the router and a couple of public resolvers. Genuinely measured. */
export async function measureAnchors(gateway: string | null): Promise<Anchor[]> {
  const targets: { label: string; ip: string }[] = [
    ...(gateway ? [{ label: "Gateway", ip: gateway }] : []),
    { label: "Cloudflare", ip: "1.1.1.1" },
    { label: "Google DNS", ip: "8.8.8.8" },
  ];
  world.anchors = await Promise.all(
    targets.map(async (t) => ({ ...t, ms: await pingMs(t.ip) })),
  );
  return world.anchors;
}

export async function refreshWorld(): Promise<WorldResponse> {
  if (OFFLINE) {
    world.error = "offline mode (JARVIS_OFFLINE=1)";
    return world;
  }
  try {
    const geo = await getJson<GeoResponse>(
      "http://ip-api.com/json/?fields=status,query,city,regionName,country,isp,as,lat,lon,timezone",
    );
    if (geo.status !== "success") throw new Error("ip-api lookup failed");

    world.uplink = {
      ip: geo.query,
      city: geo.city,
      region: geo.regionName,
      country: geo.country,
      isp: geo.isp,
      asn: geo.as?.split(" ")[0] ?? null,
      lat: geo.lat,
      lon: geo.lon,
      timezone: geo.timezone,
    };

    const w = await getJson<MeteoResponse>(
      "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${geo.lat}&longitude=${geo.lon}` +
        "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code," +
        "wind_speed_10m,surface_pressure,is_day" +
        "&daily=sunrise,sunset&timezone=auto",
    );

    const c = w.current ?? {};
    const [text, icon] = WMO[c.weather_code ?? -1] ?? ["Unknown", "•"];
    world.weather = {
      tempC: c.temperature_2m ?? null,
      feelsC: c.apparent_temperature ?? null,
      humidity: c.relative_humidity_2m ?? null,
      windKph: c.wind_speed_10m ?? null,
      pressure: c.surface_pressure ?? null,
      isDay: c.is_day === 1,
      text,
      icon,
      sunrise: w.daily?.sunrise?.[0] ?? null,
      sunset: w.daily?.sunset?.[0] ?? null,
    };

    world.error = null;
    world.at = Date.now();
  } catch (err) {
    world.error = err instanceof Error ? err.message : String(err);
  }
  return world;
}

export function startWorld(getGateway: () => string | null): void {
  void refreshWorld();
  setInterval(() => void refreshWorld(), 10 * 60 * 1000).unref();

  const anchors = (): void => {
    void measureAnchors(getGateway()).catch(() => undefined);
  };
  anchors();
  setInterval(anchors, 20 * 1000).unref();
}

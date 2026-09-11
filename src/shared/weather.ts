/**
 * The weather, from open-meteo.com — keyless, and reachable from the server
 * and from a browser alike.
 */

import type { WeatherReading } from "./types.js";

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

interface MeteoResponse {
  current?: Record<string, number>;
  daily?: { sunrise?: string[]; sunset?: string[] };
}

/** The weather at these coordinates right now. */
export async function weatherAt(lat: number, lon: number, ms = 8000): Promise<WeatherReading> {
  const r = await fetch(
    "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lat}&longitude=${lon}` +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code," +
      "wind_speed_10m,surface_pressure,is_day" +
      "&daily=sunrise,sunset&timezone=auto",
    { signal: AbortSignal.timeout(ms) },
  );
  if (!r.ok) throw new Error(`open-meteo -> ${r.status}`);
  const w = (await r.json()) as MeteoResponse;
  const c = w.current ?? {};
  const [text, icon] = WMO[c.weather_code ?? -1] ?? ["Unknown", "•"];
  return {
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
}

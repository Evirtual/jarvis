/**
 * Questions answered from live readings, never from a model.
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
import { addMsg, jarvis } from "./say.js";
import { S, T, W } from "./readings.js";
import { SERVERLESS } from "./server.js";

/* ===================================================================== *
 * Local commands — answered from live readings, never invented
 * ===================================================================== */

export const partOfDay = (): string => {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
};

const HELP = [
  ...(SERVERLESS
    ? [
        "status — this device: load, memory, frame rate, storage, right now",
        "power — battery and charging, where the browser shares them",
        "scan — measure the round trip to every service I rely on",
        "devices — what the last sweep found",
        "uplink — connection, public IP, provider, latency",
        "weather — real conditions where you are (Environment → Use GPS for more precision)",
      ]
    : [
        "status — CPU, memory, GPU, thermals, right now",
        "power — battery, mains, GPU draw",
        "scan — sweep the local network (only when you ask)",
        "devices — what the last sweep found",
        "uplink — Wi-Fi, gateway, public IP, carrier, latency",
        "weather — real conditions where this machine is",
      ]),
  "time · date — the obvious",
  "Operate the console in plain words, alone or mid-sentence:",
  "  new thread … · branch off … (a subthread) · close this chat (put away) · restore … · go back to …",
  "  connect A with B (puts them in one bubble) · move A into Travel · new group called … · collapse Research",
  "  show the radar · open the weather · show the threads · close all panels",
  "  switch to OpenRouter / Gemini · use the Lewis voice · speak faster · mute / unmute",
  "  paste an API key here and I'll connect it — it never reaches a model",
  "Anything else goes to the connected service, with live readings and web search.",
].join("\n");

export function localCommand(raw: string): boolean {
  const q = raw.toLowerCase().trim().replace(/[?!.]+$/, "");
  const words = q.split(/\s+/).filter(Boolean).length;
  const short = words <= 5;
  const elsewhere = /\b(?:in|at|for|near)\s+(?!here\b|home\b)[a-z]/.test(q);

  if (/^(help|commands|what can you do|what can i say)$/.test(q)) {
    jarvis("Here's what I answer to directly, sir — and you can ask me to operate anything on this console in plain words:");
    setTimeout(() => addMsg("sys", HELP), reduceMotion ? 0 : 420);
    return true;
  }
  if (short && /^(?:what(?:'s| is) the )?time(?: is it)?$|^what time is it$/.test(q)) {
    const d = new Date();
    jarvis(`It's ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${W.uplink ? ` in ${W.uplink.city}` : ""}, sir.`);
    return true;
  }
  if (short && /^(?:what(?:'s| is) )?(?:the |today's )?date(?: today)?$|^what day is it$/.test(q)) {
    jarvis(`Today is ${new Date().toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" })}, sir.`);
    return true;
  }
  if (words <= 3 && /^(?:hi|hey|hello|yo|hiya|jarvis|good (?:morning|afternoon|evening))\b/.test(q)) {
    jarvis(`Good ${partOfDay()}, sir. I'm at your disposal.`);
    return true;
  }
  if (short && /\b(?:status|diagnostics?|systems? check|how are (?:you|the systems))\b/.test(q)) {
    hud.flash();
    if (T?.web) {
      const w = T.web;
      const bits = [`This device is at ${w.load ?? 0} percent load${w.cores ? ` across ${w.cores} cores` : ""}`];
      if (w.fps != null) bits.push(`holding ${w.fps} frames a second${w.refreshHz ? ` on a ${w.refreshHz} hertz display` : ""}`);
      const kept = (w.storageUsed ?? 0) + w.boardBytes;
      bits.push(`and I keep ${kept < 1e6 ? "under a megabyte" : `${Math.round(kept / 1e6)} megabytes`} on it`);
      jarvis(`${bits.join(", ")}. ${(w.load ?? 0) > 80 ? "Rather busy, sir." : "All well within tolerance, sir."}`);
      return true;
    }
    if (!T?.cpu || !T.mem) { jarvis("Telemetry hasn't attached yet, sir. Give me a moment."); return true; }
    const bits = [
      `Processor is at ${T.cpu.avg} percent across ${T.cpu.cores.length} cores`,
      `memory ${gib(T.mem.usedBytes)} of ${gib(T.mem.totalBytes)} gigabytes`,
    ];
    if (T.gpu) bits.push(`the ${T.gpu.name.replace(/NVIDIA GeForce /, "")} at ${T.gpu.utilPct} percent and ${T.gpu.tempC} degrees, drawing ${T.gpu.powerW} watts`);
    const d0 = T.disks[0];
    if (d0) bits.push(`drive ${d0.id} ${Math.round((d0.usedBytes / d0.totalBytes) * 100)} percent full`);
    jarvis(`${bits.join(", ")}. ${T.cpu.avg > 80 ? "Rather busy, sir." : "All well within tolerance, sir."}`);
    return true;
  }
  if (short && /\b(?:power|battery|thermals?|temps?|gpu temp(?:erature)?)\b/.test(q)) {
    hud.flash();
    let l = T?.battery
      ? `Battery is at ${T.battery.pct} percent, ${T.battery.onAc ? "running on mains" : "on the cell"}`
      : T?.web ? "This browser doesn't share the battery with me, sir" : "No battery here, sir — running on mains";
    if (T?.gpu) l += `. The graphics card is at ${T.gpu.tempC} degrees drawing ${T.gpu.powerW} watts`;
    jarvis(`${l}.`);
    return true;
  }
  if (short && /\b(?:devices|hosts|neighbou?rs|(?:who|what)(?:'s| is) on (?:the|my) (?:network|wifi))\b/.test(q)) {
    if (SERVERLESS) {
      if (!S.hosts.length) { jarvis("A browser can't see the devices on your network, sir — but say scan and I'll measure the round trip to every service I rely on."); return true; }
      const far = S.hosts.filter((h) => !h.gateway).slice(0, 4).map((h) => `${h.hostname} in ${Math.round(h.rttMs)} milliseconds`);
      jarvis(`${S.hosts.length} services answering, sir — ${far.join(", ")}.`);
      return true;
    }
    if (!S.hosts.length) { jarvis("I haven't swept the network, sir — I only do that when asked. Say scan and I'll have a look."); return true; }
    const named = S.hosts.filter((h) => h.vendor && h.vendor !== "Randomised MAC");
    jarvis(
      `${S.hosts.length} devices answering on ${S.subnet}, sir. The router is at ${S.gateway ?? "the usual place"}. ` +
      (named.length
        ? `I can identify ${named.length} of them — ${named.slice(0, 4).map((h) => h.vendor).join(", ")}.`
        : "Most are using randomised addresses."),
    );
    setTimeout(() => {
      addMsg("sys", S.hosts
        .map((h) => `${h.ip.padEnd(16)}${`${Math.round(h.rttMs)}ms`.padStart(6)}  ${h.hostname ?? h.vendor ?? h.mac ?? "unidentified"}`)
        .join("\n"));
    }, 500);
    return true;
  }
  if (short && /\b(?:uplink|wi-?fi|my ip|ip address|isp|am i online|connection status|internet (?:status|connection|speed))\b/.test(q)) {
    const l: string[] = [];
    if (T?.net?.wifi) l.push(`Connected to ${T.net.wifi.ssid} on ${T.net.wifi.radio}, signal ${T.net.wifi.signal} percent`);
    const c = T?.web?.connection;
    if (T?.web && !T.web.online) l.push("We're offline");
    else if (c?.type && c.type !== "unknown") {
      const kind = c.type === "wifi" ? "Wi-Fi" : c.type === "cellular" ? "mobile data" : c.type;
      l.push(`On ${kind}${c.effective ? `, ${c.effective.toUpperCase()} class` : ""}`);
    }
    if (W.uplink) l.push(`public address ${W.uplink.ip} via ${W.uplink.isp} in ${W.uplink.city}`);
    const cf = T?.anchors.find((a) => /cloud/i.test(a.label));
    const rtt = T?.web ? T.web.rttMs : cf?.ms;
    if (rtt != null) l.push(`round trip to the wider internet is ${rtt} milliseconds`);
    const said = l.join(", ");
    jarvis(l.length ? `${said.charAt(0).toUpperCase()}${said.slice(1)}, sir.` : "I've no uplink readings yet, sir.");
    return true;
  }
  // Only the weather *here, now* is local; anywhere else, or a forecast, is a
  // question for the core and its web search.
  if (short && !elsewhere && !/\b(?:tomorrow|forecast|week|weekend)\b/.test(q) && /\b(?:weather|outside|raining|is it (?:hot|cold))\b/.test(q)) {
    const w = W.weather;
    if (!w || w.tempC == null) { jarvis("No weather uplink at the moment, sir — I won't invent one."); return true; }
    jarvis(
      `${w.text} in ${W.uplink?.city ?? "your area"}, ${Math.round(w.tempC)} degrees` +
      (w.feelsC != null && Math.abs(w.feelsC - w.tempC) > 1.5 ? `, though it feels like ${Math.round(w.feelsC)}` : "") +
      `. Humidity ${w.humidity} percent, wind ${w.windKph} kilometres per hour. Sunset at ${hhmm(w.sunset)}, sir.`,
    );
    return true;
  }
  if (short && /\b(?:your voice|which voice|what voice)\b/.test(q)) {
    jarvis(`${voice.describe().text} Ask me for another by name — George, Fable, Lewis, Daniel, Emma — or say "speak faster".`);
    return true;
  }
  if (words <= 4 && /\b(?:thank|thanks|cheers)\b/.test(q)) { jarvis("Always a pleasure, sir."); return true; }
  return false;
}

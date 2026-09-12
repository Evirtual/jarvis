/**
 * Perimeter scan — real device discovery on the local subnet.
 *
 * This is what replaces the old random-dot radar. Every contact on screen is a
 * machine that actually answered:
 *   • ICMP sweep of the /24 (64 at a time) → which hosts are up, and the real
 *     round-trip time, which becomes the blip's distance from centre
 *   • arp -a                              → the MAC address of each responder
 *   • MAC OUI prefix                      → who made it
 *   • reverse DNS                         → its hostname where the router publishes one
 *
 * Discovery only: ICMP, ARP and rDNS. No port scanning of other people's
 * devices — this is meant to show you your own network, not probe it.
 */

import os from "node:os";
import dns from "node:dns/promises";

import type { ScanResponse } from "../shared/types.js";
import { exec } from "./exec.js";

/** Common home-network OUI prefixes. Enough to name most things on a LAN. */
const OUI: Record<string, string> = {
  "2c-c8-1b": "Cisco/Linksys", "0c-80-63": "TP-Link", "e0-37-bf": "TP-Link",
  "50-c7-bf": "TP-Link", "a4-2b-b0": "TP-Link", "b0-be-76": "TP-Link",
  "3c-84-6a": "TP-Link", "60-a4-b7": "TP-Link", "98-da-c4": "TP-Link",
  "d8-0d-17": "TP-Link", "1c-61-b4": "TP-Link", "ac-84-c6": "TP-Link",
  "00-1a-11": "Google", "f4-f5-e8": "Google", "3c-5a-b4": "Google",
  "da-a1-19": "Google", "1c-f2-9a": "Google", "6c-ad-f8": "Google",
  "44-07-0b": "Google", "54-60-09": "Google",
  "fc-a1-83": "Amazon", "44-65-0d": "Amazon", "68-37-e9": "Amazon",
  "f0-d2-f1": "Amazon", "50-dc-e7": "Amazon", "ac-63-be": "Amazon",
  "b8-27-eb": "Raspberry Pi", "dc-a6-32": "Raspberry Pi", "e4-5f-01": "Raspberry Pi",
  "d8-3a-dd": "Raspberry Pi", "2c-cf-67": "Raspberry Pi",
  "ac-de-48": "Apple", "f0-18-98": "Apple", "a4-83-e7": "Apple", "3c-15-c2": "Apple",
  "bc-52-b7": "Apple", "d0-81-7a": "Apple", "f4-5c-89": "Apple", "8c-85-90": "Apple",
  "a8-66-7f": "Apple", "70-70-0d": "Apple", "dc-a9-04": "Apple", "b8-e8-56": "Apple",
  "94-e9-79": "Apple", "6c-4d-73": "Apple", "9c-e6-5e": "Apple",
  "00-16-6c": "Samsung", "5c-0a-5b": "Samsung", "e8-50-8b": "Samsung",
  "78-1f-db": "Samsung", "8c-77-12": "Samsung", "d0-17-6a": "Samsung",
  "34-23-87": "Samsung", "a0-21-95": "Samsung", "ac-5f-3e": "Samsung",
  "f8-04-2e": "Samsung", "cc-07-ab": "Samsung",
  "8c-de-52": "Xiaomi", "64-b4-73": "Xiaomi", "f8-a4-5f": "Xiaomi",
  "28-6c-07": "Xiaomi", "78-11-dc": "Xiaomi", "50-8f-4c": "Xiaomi",
  "24-6f-28": "Espressif (ESP32)", "30-ae-a4": "Espressif (ESP32)",
  "8c-aa-b5": "Espressif (ESP32)", "3c-71-bf": "Espressif (ESP32)",
  "a4-cf-12": "Espressif (ESP32)", "cc-50-e3": "Espressif (ESP32)",
  "b4-e6-2d": "Espressif (ESP32)", "84-f3-eb": "Espressif (ESP32)",
  "00-1d-72": "Wistron", "00-50-56": "VMware", "08-00-27": "VirtualBox",
  "00-15-5d": "Hyper-V", "52-54-00": "QEMU/KVM",
  "00-e0-4c": "Realtek", "48-5d-60": "Azurewave", "9c-b6-d0": "Rivet/Killer",
  "e4-54-e8": "Dell", "18-db-f2": "Dell", "d4-be-d9": "Dell",
  "70-85-c2": "ASUSTek", "1c-87-2c": "ASUSTek", "04-d9-f5": "ASUSTek",
  "b0-6e-bf": "ASUSTek", "2c-fd-a1": "ASUSTek",
  "00-1b-63": "Apple", "5c-51-4f": "Intel", "94-e2-3c": "Intel",
  "a4-c3-f0": "Intel", "34-13-e8": "Intel", "8c-55-4a": "Intel",
  "e8-2a-44": "Lenovo", "54-e1-ad": "Lenovo", "48-2a-e3": "Lenovo",
  "00-09-0f": "Fortinet", "c8-3a-35": "Tenda", "d8-32-14": "Tenda",
  "ec-08-6b": "Huawei", "48-46-fb": "Huawei", "00-e0-fc": "Huawei",
  "80-b6-86": "Huawei", "20-0b-c7": "Huawei",
  "18-31-bf": "ASUSTek", "40-16-7e": "ASUSTek",
  "d4-6e-0e": "TP-Link", "bc-46-99": "TP-Link",
};

function vendorFor(mac: string | null): string | null {
  if (!mac) return null;
  const hit = OUI[mac.slice(0, 8).toLowerCase()];
  if (hit) return hit;
  // Bit 1 of the first octet marks a locally-administered address: phones and
  // laptops rotate these for privacy, so there is no manufacturer to look up.
  const first = Number.parseInt(mac.slice(0, 2), 16);
  if (Number.isFinite(first) && (first & 0x02) !== 0) return "Randomised MAC";
  return null;
}

/** Every IPv4 /24 this machine sits on, plus our own address. */
interface Subnet { iface: string; address: string; mac: string; base: string; }

function localSubnets(): Subnet[] {
  const out: Subnet[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const parts = a.address.split(".");
      if (parts.length !== 4) continue;
      out.push({ iface: name, address: a.address, mac: a.mac, base: parts.slice(0, 3).join(".") });
    }
  }
  return out;
}

/** One ICMP echo. Resolves the round-trip in ms, or null if nothing answered. */
async function ping(ip: string, waitMs = 500): Promise<number | null> {
  const out = await exec("ping", ["-n", "1", "-w", String(waitMs), ip], waitMs + 2500);
  const m = out.match(/[=<]\s*(\d+)\s*ms/i);
  if (m) return Math.max(0.4, Number(m[1]));
  return /TTL=/i.test(out) ? 0.4 : null;
}

async function arpTable(): Promise<Map<string, string>> {
  const out = await exec("arp", ["-a"], 6000);
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    const m = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-fA-F]{2}(?:[-:][\da-fA-F]{2}){5})/);
    if (!m?.[1] || !m[2]) continue;
    const mac = m[2].toLowerCase().replace(/:/g, "-");
    if (mac === "ff-ff-ff-ff-ff-ff") continue;
    map.set(m[1], mac);
  }
  return map;
}

async function reverseDns(ip: string): Promise<string | null> {
  try {
    const names = await dns.reverse(ip);
    return names?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Run `jobs` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i] as T, i);
    }
  });
  await Promise.all(runners);
  return results;
}

export const scanState: ScanResponse = {
  running: false,
  at: 0,
  durationMs: 0,
  subnet: null,
  self: null,
  gateway: null,
  hosts: [],
};

/**
 * Sweep the primary /24. Takes roughly a second for the whole range.
 */
export async function runScan(gateway: string | null = null): Promise<ScanResponse> {
  if (scanState.running) return scanState;
  scanState.running = true;
  const t0 = Date.now();

  try {
    const nets = localSubnets();
    const primary = nets.find((n) => gateway && gateway.startsWith(`${n.base}.`)) || nets[0];
    if (!primary) {
      scanState.hosts = [];
      scanState.subnet = null;
      return scanState;
    }

    const ips = Array.from({ length: 254 }, (_, i) => `${primary.base}.${i + 1}`);
    const times = await pool(ips, 64, (ip) => ping(ip));

    const alive: { ip: string; rttMs: number }[] = [];
    for (let i = 0; i < ips.length; i++) {
      const ms = times[i];
      if (ms != null) alive.push({ ip: ips[i]!, rttMs: ms });
    }

    // ARP is populated by the sweep we just ran.
    const arp = await arpTable();
    const names = await pool(alive, 16, (h) => reverseDns(h.ip));

    scanState.hosts = alive.map((h, i) => {
      const mac = arp.get(h.ip) || null;
      const isSelf = h.ip === primary.address;
      const isGateway = gateway ? h.ip === gateway : h.ip.endsWith(".1");
      return {
        ip: h.ip,
        rttMs: h.rttMs,
        mac,
        vendor: isSelf ? "This machine" : vendorFor(mac),
        hostname: names[i] ?? null,
        self: isSelf,
        gateway: isGateway,
        lastSeen: Date.now(),
      };
    });

    scanState.subnet = `${primary.base}.0/24`;
    scanState.self = primary.address;
    scanState.gateway = gateway;
    scanState.at = Date.now();
    scanState.durationMs = Date.now() - t0;
    return scanState;
  } finally {
    scanState.running = false;
  }
}

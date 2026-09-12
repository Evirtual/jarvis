/**
 * Real machine telemetry.
 *
 * Nothing here is simulated. Sources, in order of cost:
 *   • node:os        — CPU per-core times, RAM, uptime   (free, every second)
 *   • nvidia-smi     — GPU load, temp, VRAM, power, clock (~150 ms, every 2 s)
 *   • one PowerShell — battery, Wi-Fi, NIC counters, disks (~400 ms, every 4 s)
 *
 * A background sampler keeps a snapshot warm so no HTTP request ever waits on a
 * process spawn.
 */

import os from "node:os";

import type {
  BatteryReading,
  CpuReading,
  DiskReading,
  GpuReading,
  HostReading,
  MemReading,
  NetReading,
  WifiReading,
} from "../shared/types.js";
import { exec } from "./exec.js";

/* ------------------------------------------------------------------ *
 * CPU — real per-core utilisation from cumulative tick deltas
 * ------------------------------------------------------------------ */

interface CoreTicks {
  idle: number;
  total: number;
}
let prevCores: CoreTicks[] | null = null;

function cpuSample(): CpuReading {
  const cpus = os.cpus();
  const now: CoreTicks[] = cpus.map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });

  let cores = new Array<number>(now.length).fill(0);
  if (prevCores && prevCores.length === now.length) {
    cores = now.map((c, i) => {
      const prev = prevCores![i]!;
      const dTotal = c.total - prev.total;
      const dIdle = c.idle - prev.idle;
      if (dTotal <= 0) return 0;
      return Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100));
    });
  }
  prevCores = now;

  const avg = cores.length ? cores.reduce((a, b) => a + b, 0) / cores.length : 0;
  return {
    model: (cpus[0]?.model ?? "unknown").replace(/\s+/g, " ").trim(),
    speedMhz: cpus[0]?.speed ?? null,
    cores: cores.map((v) => Math.round(v)),
    avg: Math.round(avg),
  };
}

function memSample(): MemReading {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    totalBytes: total,
    usedBytes: total - free,
    pct: Math.round(((total - free) / total) * 100),
  };
}

/* ------------------------------------------------------------------ *
 * GPU
 * ------------------------------------------------------------------ */

let gpuAvailable = true;

async function gpuSample(): Promise<GpuReading | null> {
  if (!gpuAvailable) return null;
  const out = await exec(
    "nvidia-smi",
    [
      "--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,clocks.sm,fan.speed",
      "--format=csv,noheader,nounits",
    ],
    5000,
  );
  if (!out.trim()) {
    gpuAvailable = false;
    return null;
  }
  const f = out.trim().split("\n")[0]!.split(",").map((s) => s.trim());
  const num = (v: string | undefined): number | null => {
    const n = Number.parseFloat(v ?? "");
    return Number.isFinite(n) ? n : null;
  };
  return {
    name: f[0] || "GPU",
    utilPct: num(f[1]),
    tempC: num(f[2]),
    vramUsedMb: num(f[3]),
    vramTotalMb: num(f[4]),
    powerW: num(f[5]),
    clockMhz: num(f[6]),
    fanPct: num(f[7]),
  };
}

/* ------------------------------------------------------------------ *
 * Windows extras — one PowerShell round trip returns all of it as JSON
 * ------------------------------------------------------------------ */

const PS_PROBE = String.raw`
$ErrorActionPreference='SilentlyContinue'
$bat = Get-CimInstance Win32_Battery | Select-Object -First 1
$battery = if ($bat) { @{ pct = [int]$bat.EstimatedChargeRemaining; status = [int]$bat.BatteryStatus } } else { $null }

$wifiRaw = netsh wlan show interfaces 2>$null
$wifi = $null
if ($wifiRaw -match 'SSID') {
  $get = { param($p) ($wifiRaw | Select-String $p | Select-Object -First 1) -replace '^[^:]+:\s*','' }
  $sig = (& $get '^\s*Signal') -replace '%',''
  $wifi = @{
    ssid    = (& $get '^\s*SSID')
    signal  = [int]($sig -as [int])
    rxMbps  = [double]((& $get 'Receive rate') -as [double])
    txMbps  = [double]((& $get 'Transmit rate') -as [double])
    channel = [int]((& $get '^\s*Channel') -as [int])
    radio   = (& $get 'Radio type')
  }
}

$nics = @(Get-NetAdapterStatistics | Where-Object { $_.ReceivedBytes -gt 0 } |
  ForEach-Object { @{ name = $_.Name; rx = [double]$_.ReceivedBytes; tx = [double]$_.SentBytes } })

$disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' |
  ForEach-Object { @{ id = $_.DeviceID; used = [double]($_.Size - $_.FreeSpace); total = [double]$_.Size } })

$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).NextHop
$dns = @((Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object ServerAddresses).ServerAddresses | Select-Object -Unique)

@{ battery=$battery; wifi=$wifi; nics=$nics; disks=$disks; gateway=$gw; dns=$dns } | ConvertTo-Json -Depth 5 -Compress
`;

interface RawWin {
  battery?: { pct: number; status: number } | null;
  wifi?: (WifiReading & { band?: string }) | null;
  nics?: { name: string; rx: number; tx: number }[] | { name: string; rx: number; tx: number };
  disks?: { id: string; used: number; total: number }[] | { id: string; used: number; total: number };
  gateway?: string | null;
  dns?: string[] | string;
}

export interface WinReading {
  battery: BatteryReading | null;
  net: NetReading;
  disks: DiskReading[];
}

let prevNics: { rx: number; tx: number } | null = null;
let prevNicAt = 0;

const asArray = <T,>(v: T[] | T | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);

async function windowsSample(): Promise<WinReading | null> {
  const out = await exec(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS_PROBE],
    9000,
  );
  if (!out.trim()) return null;

  let raw: RawWin;
  try {
    raw = JSON.parse(out) as RawWin;
  } catch {
    return null;
  }

  // Byte counters are cumulative — turn them into a real per-second rate.
  const now = Date.now();
  const nics = asArray(raw.nics);
  const totals = nics.reduce((a, n) => ({ rx: a.rx + (n.rx || 0), tx: a.tx + (n.tx || 0) }), { rx: 0, tx: 0 });
  let rxBps: number | null = null;
  let txBps: number | null = null;
  if (prevNics && now > prevNicAt) {
    const dt = (now - prevNicAt) / 1000;
    rxBps = Math.max(0, (totals.rx - prevNics.rx) / dt);
    txBps = Math.max(0, (totals.tx - prevNics.tx) / dt);
  }
  prevNics = totals;
  prevNicAt = now;

  return {
    // BatteryStatus 1 = discharging; anything else means external power.
    battery: raw.battery ? { pct: raw.battery.pct, onAc: raw.battery.status !== 1 } : null,
    net: {
      rxBps,
      txBps,
      totalRx: totals.rx,
      totalTx: totals.tx,
      wifi: raw.wifi?.ssid ? (raw.wifi as WifiReading) : null,
      gateway: raw.gateway ?? null,
      dns: asArray(raw.dns),
    },
    disks: asArray(raw.disks).map((d) => ({ id: d.id, usedBytes: d.used, totalBytes: d.total })),
  };
}

/* ------------------------------------------------------------------ *
 * Snapshot + background sampler
 * ------------------------------------------------------------------ */

export interface Snapshot {
  at: number;
  host: HostReading;
  cpu: CpuReading | null;
  mem: MemReading | null;
  gpu: GpuReading | null;
  win: WinReading | null;
}

export const snapshot: Snapshot = {
  at: 0,
  host: {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    uptimeSec: 0,
  },
  cpu: null,
  mem: null,
  gpu: null,
  win: null,
};

let started = false;

export function startSampler(): void {
  if (started) return;
  started = true;

  cpuSample(); // prime the tick deltas

  setInterval(() => {
    snapshot.cpu = cpuSample();
    snapshot.mem = memSample();
    snapshot.host.uptimeSec = Math.floor(os.uptime());
    snapshot.at = Date.now();
  }, 1000).unref();

  const pump = async <K extends "gpu" | "win">(
    fn: () => Promise<Snapshot[K] | null>,
    key: K,
    everyMs: number,
  ): Promise<void> => {
    const tick = async (): Promise<void> => {
      try {
        const v = await fn();
        // A failed sample keeps the previous one rather than blanking the HUD.
        if (v !== null) snapshot[key] = v;
      } catch {
        /* ignored on purpose */
      }
    };
    await tick();
    setInterval(() => void tick(), everyMs).unref();
  };

  void pump(gpuSample, "gpu", 2000);
  // The PowerShell probe takes about two seconds of a spawned shell each time.
  // Wi-Fi signal, battery, disks and the gateway change over minutes, not
  // seconds, so it runs every 20 s rather than keeping a shell alive half the time.
  void pump(windowsSample, "win", 20_000);
}

export function gateway(): string | null {
  return snapshot.win?.net.gateway ?? null;
}

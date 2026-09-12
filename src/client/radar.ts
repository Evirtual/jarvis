/**
 * The radar in the Perimeter panel.
 *
 * It plots real hosts, not a pattern on a clock: bearing is a stable hash of
 * the address so a device keeps its position between sweeps, and the radius is
 * its genuine round-trip time on a log scale.
 */

import type { ScanHost } from "../shared/types.js";
import { reduceMotion } from "./motion.js";

export interface Plotted {
  host: ScanHost;
  a: number;
  r: number;
  lit: number;
  x: number;
  y: number;
}

export class Radar {
  private dctx: CanvasRenderingContext2D;
  private readonly DS = 260;
  private sweep = 0;

  plotted: Plotted[] = [];
  hoverIp: string | null = null;
  onHover: (() => void) | null = null;
  /** Whether the radar can be seen at all — the Perimeter panel is open. Nothing is drawn otherwise. */
  visible = false;
  /**
   * The radar's scale: the round trip at its rim, and the rings marked on it.
   * Devices on a home network answer in 1–100 ms; the services the web
   * version sweeps, across the internet, in 10 ms to a second.
   */
  scale: { maxMs: number; rings: number[] } = { maxMs: 100, rings: [1, 5, 20, 100] };

  constructor(radar: HTMLCanvasElement) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    radar.width = this.DS * dpr;
    radar.height = this.DS * dpr;
    const dc = radar.getContext("2d");
    if (!dc) throw new Error("no 2d context");
    dc.scale(dpr, dpr);
    this.dctx = dc;

    radar.addEventListener("mousemove", (e) => {
      const rect = radar.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * this.DS;
      const y = ((e.clientY - rect.top) / rect.height) * this.DS;
      let best: string | null = null;
      let bd = 12;
      for (const p of this.plotted) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) {
          bd = d;
          best = p.host.ip;
        }
      }
      if (best !== this.hoverIp) {
        this.hoverIp = best;
        radar.title = best ?? "";
        this.onHover?.();
      }
    });
    radar.addEventListener("mouseleave", () => {
      this.hoverIp = null;
      this.onHover?.();
    });

    // Keeps running while hidden but draws nothing then; with less motion
    // asked for, the sweep holds still and the hosts are still plotted.
    const frame = (): void => {
      if (this.visible) this.drawRadar();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  layout(hosts: ScanHost[]): void {
    this.plotted = hosts.map((h) => ({
      host: h,
      a: h.gateway ? -Math.PI / 2 : bearing(h.ip),
      r: h.gateway ? 20 : radiusFor(h.rttMs, 104, this.scale.maxMs),
      lit: 0,
      x: 0,
      y: 0,
    }));
  }

  private drawRadar(): void {
    const ctx = this.dctx;
    const cx = this.DS / 2;
    const cy = this.DS / 2;
    const R = 104;
    ctx.clearRect(0, 0, this.DS, this.DS);

    ctx.strokeStyle = "#12313f";
    ctx.lineWidth = 1;
    // the rings sit where a host that far away would be plotted, and the rim
    const rings = this.scale.rings.map((ms) => ({ ms, r: radiusFor(ms, R, this.scale.maxMs) }));
    for (const rr of [...rings.map((x) => x.r), R]) {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();

    // Ring labels are real latency bands, so the distances mean something.
    ctx.font = "8px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "#1f5164";
    for (const { ms, r } of rings) {
      ctx.fillText(ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`, cx + 3, cy - r + 9);
    }

    if (!reduceMotion) this.sweep += 0.017;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    grad.addColorStop(0, "rgba(111,240,255,.26)");
    grad.addColorStop(1, "rgba(111,240,255,0)");
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, this.sweep - 0.5, this.sweep);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(this.sweep) * R, cy + Math.sin(this.sweep) * R);
    ctx.strokeStyle = "rgba(111,240,255,.7)";
    ctx.lineWidth = 1.3;
    ctx.stroke();

    const beam = ((this.sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    for (const p of this.plotted) {
      const pa = ((p.a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      let d = Math.abs(pa - beam);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < 0.09) p.lit = 1;
      p.lit = Math.max(0, p.lit - 0.006);

      p.x = cx + Math.cos(p.a) * p.r;
      p.y = cy + Math.sin(p.a) * p.r;
      const col = p.host.gateway ? "255,182,72" : p.host.self ? "86,227,159" : "111,240,255";
      const hover = this.hoverIp === p.host.ip;

      ctx.beginPath();
      ctx.arc(p.x, p.y, hover ? 4 : 2.7, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${col},${(0.34 + p.lit * 0.66).toFixed(2)})`;
      ctx.fill();

      if (p.lit > 0.3 || hover) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.7 + (1 - p.lit) * 9, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${col},${(Math.max(p.lit, hover ? 0.6 : 0) * 0.5).toFixed(2)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (hover) {
        ctx.font = "9px 'IBM Plex Mono', monospace";
        ctx.fillStyle = "#d6f2fa";
        const name = /^\d+\.\d+\.\d+\.\d+$/.test(p.host.ip) ? p.host.ip.split(".").pop() : (p.host.hostname ?? p.host.ip);
        ctx.fillText(`${name} · ${Math.round(p.host.rttMs)}ms`, p.x + 7, p.y - 5);
      }
    }

    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#1d5468";
    ctx.fill();
  }
}

/**
 * A host's bearing: fixed for its address, so it keeps its place between
 * sweeps, and well mixed (FNV-1a, then a finaliser), so neighbouring
 * addresses — 192.168.0.3, .22, .23 — land all round the dish rather than in
 * one corner of it.
 */
function bearing(ip: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < ip.length; i++) h = Math.imul(h ^ ip.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 0x100000000) * Math.PI * 2;
}

function radiusFor(ms: number, R: number, maxMs: number): number {
  const t = Math.log10(Math.max(0.4, ms) + 1) / Math.log10(maxMs + 1);
  return 20 + Math.min(1, t) * (R - 26);
}

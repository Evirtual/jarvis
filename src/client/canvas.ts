/**
 * The two canvases.
 *
 * Both are driven by measured values, not by a clock:
 *   • the reactor's charge ring is real battery, its glow real CPU load, and
 *     the amber core's brightness real GPU utilisation
 *   • the radar plots real hosts — bearing is a stable hash of the address so a
 *     device keeps its position between sweeps, and the radius is its genuine
 *     round-trip time on a log scale
 */

import type { ScanHost, TelemetryResponse } from "../shared/types.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface Plotted {
  host: ScanHost;
  a: number;
  r: number;
  lit: number;
  x: number;
  y: number;
}

export class Hud {
  private rctx: CanvasRenderingContext2D | null = null;
  private dctx: CanvasRenderingContext2D;
  private readonly RS = 128;
  private readonly DS = 260;
  private sweep = 0;
  private pulse = 0;

  plotted: Plotted[] = [];
  hoverIp: string | null = null;
  telemetry: TelemetryResponse | null = null;
  onHover: (() => void) | null = null;
  /** Whether the radar can be seen at all — the Perimeter panel is open. Nothing is drawn otherwise. */
  visible = false;
  /**
   * The radar's scale: the round trip at its rim, and the rings marked on it.
   * Devices on a home network answer in 1–100 ms; the services the web
   * version sweeps, across the internet, in 10 ms to a second.
   */
  scale: { maxMs: number; rings: number[] } = { maxMs: 100, rings: [1, 5, 20, 100] };

  /** Live audio level, 0-1 — the globe breathes with this, not with a timer. */
  amplitude = 0;
  /** "idle" barely moves; the loop only earns attention when something happens. */
  activity: "idle" | "listening" | "speaking" | "thinking" = "idle";

  constructor(radar: HTMLCanvasElement, reactor?: HTMLCanvasElement | null) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // The main globe lives in the conversation graph now; this small reactor is
    // optional and only present in layouts that still show one.
    if (reactor) {
      reactor.width = this.RS * dpr;
      reactor.height = this.RS * dpr;
      const rc = reactor.getContext("2d");
      if (rc) {
        rc.scale(dpr, dpr);
        this.rctx = rc;
      }
    }

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

    const frame = (t: number): void => {
      if (this.rctx) this.drawReactor(t);
      if (this.visible) this.drawRadar();
      if (!reduceMotion) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  flash(v = 1): void {
    this.pulse = Math.max(this.pulse, v);
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

  /* ---------------- reactor ---------------- */

  private drawReactor(t: number): void {
    const ctx = this.rctx;
    if (!ctx) return;
    const cx = this.RS / 2;
    const cy = this.RS / 2;
    ctx.clearRect(0, 0, this.RS, this.RS);

    const T = this.telemetry;
    // in a browser: its load estimate, and how far the frame rate falls short of the display
    const w = T?.web;
    const cpuLoad = T?.cpu ? T.cpu.avg / 100 : w?.load != null ? w.load / 100 : 0;
    const gpuLoad = T?.gpu?.utilPct != null ? T.gpu.utilPct / 100 : w?.fps != null && w.refreshHz ? Math.max(0, 1 - w.fps / w.refreshHz) : 0;
    const boost = Math.max(0, this.pulse);
    const amp = Math.max(0, Math.min(1, this.amplitude));

    // Idle should be nearly still. A ring that spins forever is noise, not
    // information — the motion has to mean something is actually happening.
    const idle = this.activity === "idle";
    const spin = idle ? 0.12 : this.activity === "thinking" ? 1 : 0.55 + amp * 1.6;

    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0;
      ctx.rotate((Math.PI * 2) / 60);
      ctx.beginPath();
      ctx.moveTo(0, -60);
      ctx.lineTo(0, major ? -54 : -57);
      ctx.strokeStyle = major ? "#2e7f96" : "#12313f";
      ctx.lineWidth = major ? 1.3 : 1;
      ctx.stroke();
    }
    ctx.restore();

    const ring = (radius: number, rot: number, segs: number, gap: number, colour: string, w: number): void => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.lineWidth = w;
      ctx.strokeStyle = colour;
      const span = (Math.PI * 2) / segs;
      for (let s = 0; s < segs; s++) {
        ctx.beginPath();
        ctx.arc(0, 0, radius, s * span, s * span + span - gap);
        ctx.stroke();
      }
      ctx.restore();
    };
    // Rotation tracks real CPU load, scaled by whether anything is happening.
    const sp = t * spin;
    ring(48, sp / (2600 - cpuLoad * 1600), 6, 0.3, "#2e7f96", 2);
    ring(40, -sp / (1700 - cpuLoad * 1000), 4, 0.55, "#6ff0ff", 1.4);
    ring(32, sp / 3400, 12, 0.12, "#1d5468", 1);

    // The core swells with the actual waveform while speaking or listening.
    const glowR = 27 + cpuLoad * 6 + boost * 10 + amp * 16;
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, glowR);
    glow.addColorStop(0, "rgba(214,242,250,.95)");
    glow.addColorStop(0.22, `rgba(111,240,255,${(0.4 + cpuLoad * 0.25 + boost * 0.25 + amp * 0.45).toFixed(2)})`);
    glow.addColorStop(0.6, "rgba(46,127,150,.2)");
    glow.addColorStop(1, "rgba(4,8,13,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    // A ring of bars around the core: the live spectrum while it talks.
    if (amp > 0.01) {
      ctx.save();
      ctx.translate(cx, cy);
      const bars = 48;
      for (let i = 0; i < bars; i++) {
        const a = (i / bars) * Math.PI * 2;
        const wob = 0.55 + 0.45 * Math.sin(i * 1.7 + t / 90);
        const len = 4 + amp * 20 * wob;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 22, Math.sin(a) * 22);
        ctx.lineTo(Math.cos(a) * (22 + len), Math.sin(a) * (22 + len));
        ctx.strokeStyle = `rgba(111,240,255,${(0.18 + amp * 0.5).toFixed(2)})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Triangle brightness tracks real GPU utilisation.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(t / 5200) * 0.08);
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + k * ((Math.PI * 2) / 3);
      const x = Math.cos(a) * 16;
      const y = Math.sin(a) * 16;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = "#ffb648";
    ctx.lineWidth = 1.8;
    ctx.shadowColor = "rgba(255,182,72,.9)";
    ctx.shadowBlur = 5 + gpuLoad * 22 + boost * 12;
    ctx.stroke();
    ctx.restore();

    // Outer arc = real battery charge.
    const pct = T?.battery?.pct ?? 100;
    const low = T?.battery ? !T.battery.onAc && pct < 20 : false;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.beginPath();
    ctx.arc(0, 0, 56, 0, Math.PI * 2 * (pct / 100));
    ctx.strokeStyle = low ? "#ff4f5f" : "#6ff0ff";
    ctx.lineWidth = 2.4;
    ctx.shadowColor = low ? "rgba(255,79,95,.6)" : "rgba(111,240,255,.55)";
    ctx.shadowBlur = 7;
    ctx.stroke();
    ctx.restore();

    if (this.pulse > 0) this.pulse -= 0.018;
  }

  /* ---------------- radar ---------------- */

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
        const name = /^d+.d+.d+.d+$/.test(p.host.ip) ? p.host.ip.split(".").pop() : (p.host.hostname ?? p.host.ip);
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

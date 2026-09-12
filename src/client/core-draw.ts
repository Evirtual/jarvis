/**
 * JARVIS himself, drawn: the aurora behind the board and the core's rings,
 * plasma, spectrum and battery arc. Pure drawing — everything it shows is
 * handed in — so the stage decides what, and this decides how.
 */

import { reduceMotion } from "./motion.js";

/** The core is designed at DESIGN_R and drawn at CORE_R. */
export const CORE_R = 52;
export const DESIGN_R = 74;

export type Activity = "idle" | "listening" | "speaking" | "thinking";

/** What the core reflects: the machine, the voice, and a pulse when a thread is focused. */
export interface CoreLook {
  activity: Activity;
  cpuLoad: number;
  gpuLoad: number;
  battery: number;
  onAc: boolean;
  pulse: number;
}

/** One field of colour: a group's hue and where its bubble sits. */
export interface AuroraField { hue: string; hx: number; hy: number }

/**
 * Slow fields of colour drifting behind everything, tinted by the groups on
 * the board. They are what stops the screen feeling like a set of boxes.
 */
export function drawAurora(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number, amp: number, fields: AuroraField[]): void {
  const time = reduceMotion ? 0 : t / 1000;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  fields.forEach(({ hue, hx, hy }, i) => {
    // drift between the core and the bubble, slowly, each on its own path
    const wob = Math.sin(time * 0.21 + i * 1.7) * 26, wob2 = Math.cos(time * 0.17 + i * 2.3) * 22;
    const x = cx + (hx - cx) * 0.55 + wob;
    const y = cy + (hy - cy) * 0.55 + wob2;
    const r = 170 + Math.sin(time * 0.13 + i) * 26 + amp * 30;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, withAlpha(hue, 0.055));
    grad.addColorStop(0.55, withAlpha(hue, 0.02));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

export function drawCore(ctx: CanvasRenderingContext2D, sp: number, t: number, amp: number, idle: boolean, s: CoreLook): void {
  // tick ring
  ctx.save();
  for (let i = 0; i < 72; i++) {
    const major = i % 6 === 0;
    ctx.rotate((Math.PI * 2) / 72);
    ctx.beginPath();
    ctx.moveTo(0, -DESIGN_R);
    ctx.lineTo(0, major ? -DESIGN_R + 8 : -DESIGN_R + 4);
    ctx.strokeStyle = major ? "#2e7f96" : "#12313f";
    ctx.lineWidth = major ? 1.3 : 1;
    ctx.stroke();
  }
  ctx.restore();

  const ring = (radius: number, rot: number, segs: number, gap: number, colour: string, w: number): void => {
    ctx.save();
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
  ring(60, sp / (2600 - s.cpuLoad * 1600), 6, 0.3, "#2e7f96", 2);
  ring(50, -sp / (1700 - s.cpuLoad * 1000), 4, 0.55, "#6ff0ff", 1.5);
  ring(40, sp / 3400, 12, 0.12, "#1d5468", 1);

  // the plasma at the centre: a soft body that swells with sound and breathes at rest
  const breath = reduceMotion ? 0 : Math.sin(t / 2200) * 2.5;
  const glowR = 32 + s.cpuLoad * 6 + amp * 22 + s.pulse * 6 + breath;
  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, glowR);
  glow.addColorStop(0, "rgba(214,242,250,.95)");
  glow.addColorStop(0.22, `rgba(111,240,255,${(0.4 + s.cpuLoad * 0.2 + amp * 0.5).toFixed(2)})`);
  glow.addColorStop(0.6, "rgba(46,127,150,.2)");
  glow.addColorStop(1, "rgba(4,8,13,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, glowR, 0, Math.PI * 2);
  ctx.fill();

  // live spectrum — only when there is genuinely sound
  if (amp > 0.01) {
    const bars = 64;
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2;
      const wob = 0.55 + 0.45 * Math.sin(i * 1.7 + t / 90);
      const len = 4 + amp * 26 * wob;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 26, Math.sin(a) * 26);
      ctx.lineTo(Math.cos(a) * (26 + len), Math.sin(a) * (26 + len));
      ctx.strokeStyle = s.activity === "listening"
        ? `rgba(255,120,130,${(0.2 + amp * 0.5).toFixed(2)})`
        : `rgba(111,240,255,${(0.18 + amp * 0.5).toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  if (s.activity === "thinking" && !reduceMotion) {
    ctx.save();
    ctx.rotate((t / 320) % (Math.PI * 2));
    ctx.beginPath();
    ctx.arc(0, 0, DESIGN_R - 6, 0, 0.9);
    ctx.strokeStyle = "#ffb648";
    ctx.lineWidth = 2.2;
    ctx.shadowColor = "rgba(255,182,72,.7)";
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.rotate(Math.sin(t / 5200) * 0.08);
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + k * ((Math.PI * 2) / 3);
    ctx.lineTo(Math.cos(a) * 19, Math.sin(a) * 19);
  }
  ctx.closePath();
  ctx.strokeStyle = "#ffb648";
  ctx.lineWidth = 1.9;
  ctx.shadowColor = "rgba(255,182,72,.9)";
  ctx.shadowBlur = 5 + s.gpuLoad * 22 + amp * 14;
  ctx.stroke();
  ctx.restore();

  // outer arc = real battery charge
  const low = !s.onAc && s.battery < 20;
  ctx.save();
  ctx.rotate(-Math.PI / 2);
  ctx.beginPath();
  ctx.arc(0, 0, DESIGN_R + 6, 0, Math.PI * 2 * (s.battery / 100));
  ctx.strokeStyle = low ? "#ff4f5f" : idle ? "#1d5468" : "#6ff0ff";
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.restore();
}

/** "#6ff0ff" at 40% → "rgba(111,240,255,.4)". */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(2)})`;
}

/**
 * The canvas JARVIS is drawn on, and where he is: the middle of the deck at
 * the bottom, always. He is the console's one fixed point — the board
 * arranges itself around him. This measures the stage, keeps clear of a
 * phone's own bars over the page's edges, draws him each frame, and
 * publishes where he is for the styles to follow.
 */

import { CORE_R, DESIGN_R, drawCore, type Activity } from "./core-draw.js";
import { reduceMotion } from "./motion.js";
import { clamp } from "./num.js";

/** How far above the deck's bottom edge his ring sits. */
const CORE_BOTTOM_GAP = 20;
/** The deck at the bottom: readings, JARVIS, controls. */
export const DECK_H = 96;
/** The title row across the top (threads, the JARVIS title, configuration): the board starts below it. Matches --header-h. */
export const HEADER_H = 56;
/** Room above his ring for the status line and a notice. */
const CORE_STATUS_ROOM = 44;

/** What the core reflects each frame. */
export interface CoreLook {
  activity: Activity;
  amplitude: number;
  cpuLoad: number;
  gpuLoad: number;
  pulse: number;
}

export class CoreCanvas {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = 0;
  h = 0;
  /**
   * The phone's own bars over the page's edges — the clock and the gesture
   * bar — where the page is drawn under them (viewport-fit=cover). Two empty
   * elements the size of each inset are measured, since the canvas can't
   * read env() itself.
   */
  inset = { top: 0, bottom: 0 };

  constructor(private readonly root: HTMLElement, private readonly canvas: HTMLCanvasElement) {
    const c = canvas.getContext("2d");
    if (!c) throw new Error("no 2d context");
    this.ctx = c;
  }

  /** Where the usable stage ends at the bottom: above the gesture bar, when there is one. */
  get floor(): number { return this.h - this.inset.bottom; }

  /** Where the core is drawn: sitting in the deck, rising a little above it. */
  core(): { cx: number; cy: number } {
    return { cx: this.w / 2, cy: this.floor - CORE_R - CORE_BOTTOM_GAP };
  }

  /** The top of his outermost ring. */
  get coreTop(): number {
    return this.core().cy - (CORE_R * (DESIGN_R + 8)) / DESIGN_R;
  }

  /**
   * The top of the space kept clear above JARVIS: his ring rises above the
   * deck, and his status line and notices sit just over it. Anything in his
   * column stops here, so nothing on the board ever covers him.
   */
  get coreFloor(): number {
    return this.coreTop - CORE_STATUS_ROOM;
  }

  /** Whether a point on the page is on him. */
  onCore(clientX: number, clientY: number): boolean {
    const r = this.root.getBoundingClientRect();
    const { cx, cy } = this.core();
    return Math.hypot(clientX - r.left - cx, clientY - r.top - cy) <= CORE_R + 14;
  }

  /** Measure the stage and size the canvas to it. */
  resize(): void {
    const r = this.root.getBoundingClientRect();
    this.w = Math.max(280, r.width);
    this.h = Math.max(240, r.height);
    const probe = (edge: string): number => this.root.querySelector<HTMLElement>(`.safe-probe[data-edge="${edge}"]`)?.offsetHeight ?? 0;
    this.inset = { top: probe("top"), bottom: probe("bottom") };
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * Publish where the core is, so the glow and the layout can follow it:
   *   --status-y   the one line just above JARVIS where everything he says in
   *                passing appears — his status word, the line, the bin;
   *   --core-clear how far up from the bottom anything opening over the deck
   *                must stop so it never covers him.
   */
  publish(): void {
    const { cx } = this.core();
    const s = this.root.style;
    s.setProperty("--core-x", `${cx}px`);
    s.setProperty("--deck-h", `${DECK_H + this.inset.bottom}px`); // the deck grows by the inset, so its buttons keep their place beside the core
    s.setProperty("--status-y", `${Math.round(this.coreTop - 10)}px`);
    s.setProperty("--core-clear", `${Math.round(this.h - this.coreTop + 8)}px`);
  }

  /** One frame: JARVIS as he is right now. */
  draw(t: number, look: CoreLook): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const { cx, cy } = this.core();
    const amp = clamp(look.amplitude, 0, 1);
    const idle = look.activity === "idle";
    const spin = reduceMotion ? 0 : idle ? 0.12 : look.activity === "thinking" ? 1 : 0.55 + amp * 1.6;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(CORE_R / DESIGN_R, CORE_R / DESIGN_R);
    drawCore(ctx, t * spin, t, amp, idle, { activity: look.activity, cpuLoad: look.cpuLoad, gpuLoad: look.gpuLoad, pulse: look.pulse });
    ctx.restore();
  }
}

/**
 * The context web: everything that shares a thread's context, blooming out
 * around it. Strong connections sit close and bright, passing ones far and
 * faint; the whole thing drifts with the pointer, so it reads as depth rather
 * than a diagram. Each node is a small version of the thread's own window.
 *
 * It knows nothing of the board's internals: the stage gives it a host that
 * answers for threads, colours, relatedness and the board's edges.
 */

import { reduceMotion } from "./motion.js";
import { threadRef, type Thread } from "./workspace.js";

/** What the web shows about another thread. */
export interface Related { id: string; score: number; why: string[] }

export interface WebHost {
  root: HTMLElement;
  thread(id: string | undefined): Thread | undefined;
  /** A thread's own colour (a valid hex), falling back to its group's. */
  hueOf(t: Thread): string;
  related(id: string): Related[];
  /** The board's top and bottom edges, in stage pixels. */
  board(): { top: number; bottom: number };
  /** A card was tapped: go to that thread. */
  pick(id: string): void;
}


export class ContextWeb {
  readonly el: HTMLElement;
  /** The thread the web is open for, if any. */
  openFor: string | null = null;

  constructor(private readonly host: WebHost) {
    this.el = document.createElement("div");
    this.el.className = "web veil";
    this.el.hidden = true;
    this.el.innerHTML =
      `<div class="web-head"><span>Context web</span><b></b><em>tap a thread to go to it · anywhere else to close</em></div>` +
      `<svg class="web-strands" aria-hidden="true"></svg><div class="web-nodes"></div>`;
    // Depth without 3D: the nodes and the strands behind them move at
    // different rates as the pointer wanders, so the web has a near and a far.
    this.el.addEventListener("pointermove", (e) => {
      if (reduceMotion) return;
      const r = this.el.getBoundingClientRect();
      this.el.style.setProperty("--px", (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3));
      this.el.style.setProperty("--py", (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3));
    });
    this.el.addEventListener("pointerdown", (e) => {
      const node = (e.target as HTMLElement).closest<HTMLElement>(".web-node");
      if (!node) { this.close(); return; }
      const id = node.dataset.id!;
      this.close();
      this.host.pick(id);
    });
    host.root.append(this.el);
  }

  /**
   * Everything that shares this thread's context, blooming out around it.
   * Strong connections sit close and bright, passing ones far and faint; the
   * whole thing drifts with the pointer, so it reads as depth rather than a
   * diagram.
   */
  open(id: string): void {
    const me = this.host.thread(id);
    if (!me) return;
    const W = this.host.root.clientWidth, H = this.host.root.clientHeight;
    const narrow = W < 860;
    const board = this.host.board();
    // a phone lists what fits under the thread; a wide screen takes four a side
    const fits = narrow ? Math.max(1, Math.floor((board.bottom - board.top - 150) / 118)) : 8;
    const related = this.host.related(id).slice(0, Math.min(fits, narrow ? 4 : 8));
    const nodes = this.el.querySelector(".web-nodes") as HTMLElement;
    const svg = this.el.querySelector("svg") as SVGSVGElement;
    this.openFor = id;
    (this.el.querySelector(".web-head b") as HTMLElement).textContent = me.title;
    // shown (still transparent) before anything is placed, so cards can be measured
    this.el.hidden = false;
    this.el.classList.toggle("narrow", narrow);

    const top = Math.max(...related.map((r) => r.score), 1);
    nodes.replaceChildren();
    const strands: string[] = [];
    const hueOfThread = (t: Thread): string => this.host.hueOf(t);

    // Each node is a small version of the thread's own window: same glass,
    // same colour, same tag, with what it last said and what it shares.
    const node = (t: Thread, why: string[] | null): HTMLElement => {
      const el = document.createElement("div");
      el.className = `web-node glass${why ? "" : " me"}`;
      el.dataset.id = t.id;
      el.style.setProperty("--hue", hueOfThread(t));
      el.innerHTML = `<header><i></i><b></b><small></small></header><p></p><div class="web-why"></div>`;
      (el.querySelector("b") as HTMLElement).textContent = t.title;
      (el.querySelector("small") as HTMLElement).textContent = `#${threadRef(t)}`;
      const lastA = [...t.turns].reverse().find((x) => x.role === "assistant")?.content ?? t.turns[t.turns.length - 1]?.content ?? "";
      (el.querySelector("p") as HTMLElement).textContent = lastA.replace(/\[\[media:[^\]]*\]\]/g, "").replace(/\s+/g, " ").trim() || "Nothing said yet.";
      const chips = el.querySelector(".web-why") as HTMLElement;
      for (const w of why ?? ["this thread"]) {
        const s = document.createElement("span");
        s.textContent = w;
        chips.append(s);
      }
      nodes.append(el);
      return el;
    };

    // Where the thread you opened sits and where each connection goes: like a
    // mind map on a wide screen (four a side, strongest nearest the middle
    // row), and a list hanging off it on a phone. Nothing overlaps either way.
    const place = (el: HTMLElement, x: number, y: number): { x: number; y: number; hw: number; hh: number } => {
      const hw = el.offsetWidth / 2, hh = el.offsetHeight / 2;
      const px = Math.round(Math.max(hw + 12, Math.min(W - hw - 12, x)));
      const py = Math.round(Math.max(board.top + hh, Math.min(board.bottom - hh, y)));
      el.style.left = `${px}px`;
      el.style.top = `${py}px`;
      return { x: px, y: py, hw, hh };
    };
    const c = place(node(me, null), W / 2, narrow ? board.top + 60 : (board.top + board.bottom) / 2);

    const sides = { left: [] as number[], right: [] as number[] };
    related.forEach((_, i) => (i % 2 ? sides.right : sides.left).push(i));
    const middleOut = (k: number): number[] =>
      Array.from({ length: k }, (_, j) => j).sort((a, b) => Math.abs(a - (k - 1) / 2) - Math.abs(b - (k - 1) / 2) || a - b);

    related.forEach((r, i) => {
      const t = this.host.thread(r.id);
      if (!t) return;
      const strength = Math.min(1, r.score / top);
      const el = node(t, r.why.slice(0, 3));
      el.style.setProperty("--near", strength.toFixed(2));
      el.style.setProperty("--delay", `${(90 + i * 55).toFixed(0)}ms`);
      const hue = hueOfThread(t);
      let d: string;
      if (narrow) {
        const top0 = c.y + c.hh + 22;
        const step = (board.bottom - top0) / Math.max(related.length, 1);
        const p = place(el, W / 2 + 10, top0 + step * (i + 0.5));
        // a rail down the left of the thread you opened, branching to each card
        const sx = c.x - c.hw + 18, sy = c.y + c.hh, ex = p.x - p.hw, ey = p.y;
        d = `M${sx} ${sy} C${sx} ${ey} ${sx} ${ey} ${ex} ${ey}`;
      } else {
        const side = i % 2 ? 1 : -1;
        const list = i % 2 ? sides.right : sides.left;
        const slot = middleOut(list.length)[list.indexOf(i)] ?? 0;
        const step = Math.min(176, (board.bottom - board.top) / list.length);
        const reach = Math.min(W / 2 - 150, 250 + c.hw);
        const p = place(el, c.x + side * (reach - strength * 24), c.y + (slot - (list.length - 1) / 2) * step);
        // an S-curve from the side of the thread you opened to the card
        const sx = c.x + side * c.hw, sy = c.y + (slot - (list.length - 1) / 2) * 14, ex = p.x - side * p.hw, ey = p.y;
        const mx = (sx + ex) / 2;
        d = `M${sx} ${sy} C${mx} ${sy} ${mx} ${ey} ${ex} ${ey}`;
      }
      // the strand wears the connected thread's colour; brighter and thicker when closer
      strands.push(
        `<g style="color:${hue};--near:${strength.toFixed(2)};--delay:${(i * 55).toFixed(0)}ms"><path d="${d}"/></g>`,
      );
    });

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = strands.join("");
    if (!related.length) {
      const none = document.createElement("div");
      none.className = "web-none";
      none.textContent = "Nothing else on the board shares this thread's context yet.";
      none.style.left = `${c.x}px`;
      none.style.top = `${c.y + c.hh + 40}px`;
      nodes.append(none);
    }
    requestAnimationFrame(() => this.el.classList.add("in"));
  }

  close(): boolean {
    if (this.el.hidden) return false;
    this.el.classList.remove("in");
    this.openFor = null;
    window.setTimeout(() => { if (!this.el.classList.contains("in")) this.el.hidden = true; }, reduceMotion ? 0 : 200);
    return true;
  }

  get isOpen(): boolean { return !this.el.hidden; }
}

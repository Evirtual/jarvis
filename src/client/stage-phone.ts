/**
 * The board on a phone: one list under the core. Threads share the list's
 * height by what they hold, the order is yours to drag them into, and the
 * thread in front has a grip for a height of its own. The stage draws the
 * list; this sizes and orders it.
 */

import { clamp } from "./num.js";
import { KEY, recall, store } from "./storage.js";
import { gestures } from "./surface.js";
import type { Card, Bubble } from "./stage.js";
import type { Thread, Workspace } from "./workspace.js";

/** What the phone list needs of the stage. */
export interface PhoneHost {
  root: HTMLElement;
  layer: HTMLElement;
  ws: Workspace;
  compact(): boolean;
  card(id: string): Card | undefined;
  cards(): Iterable<[string, Card]>;
  bubbles(): Iterable<Bubble>;
  /** The top of the space kept clear above JARVIS. */
  coreFloor(): number;
  focus(id: string): void;
  commit(): void;
  save(): void;
}

/** A thread being dragged up or down the list by its title bar. */
interface Drag {
  id: string; sy: number; scroll0: number; started: boolean; wasActive: boolean;
  list: HTMLElement; index: number; target: number; h: number;
}

/** A thread with anything in it keeps at least this much of the list (its title bar and a few lines). */
const PHONE_MIN = 150;

export class PhoneList {
  /** The order you've dragged the list into (thread ids). Anything newer than that order goes on top, newest first. */
  private order: string[] = (() => {
    try {
      const v = JSON.parse(recall(KEY.phoneOrder) ?? "[]") as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch { return []; }
  })();
  private fitPending = 0;
  private fitted = false;

  constructor(private readonly host: PhoneHost) {}

  /** The order you dragged threads into, with anything newer on top, newest first. */
  sorted(list: Thread[]): Thread[] {
    if (!this.host.compact()) return list;
    const rank = new Map(this.order.map((id, i) => [id, i] as const));
    return [...list].sort((a, b) => {
      const ra = rank.get(a.id), rb = rank.get(b.id);
      if (ra === undefined && rb === undefined) return b.createdAt - a.createdAt;
      if (ra === undefined) return -1;
      if (rb === undefined) return 1;
      return ra - rb;
    });
  }

  /** Bring the window in front into view in the list. */
  reveal(id: string): void {
    if (!this.host.compact()) return;
    this.host.card(id)?.el.scrollIntoView({ block: "nearest" });
  }

  /* ---------------- sharing the list's height ---------------- */

  scheduleFit(): void {
    if (this.fitPending) return;
    const run = (): void => { this.fitPending = 0; this.fit(); };
    // Animation frames stop while the page is hidden (another app in front on a phone); a timer doesn't.
    this.fitPending = document.hidden ? window.setTimeout(run, 0) : requestAnimationFrame(run);
  }

  /**
   * On a phone every thread is a flex item that starts from nothing and grows
   * equally with the others (styles.css, .m-compact .chatwin) — up to a limit,
   * which is its own natural height, measured here: a short exchange keeps its
   * size and the room it doesn't need goes to the long ones; two long ones
   * split the space; one alone may take all of it, if it has that much to
   * show. The limits are set in pixels because a browser sizes a nested flex
   * column from its items' minimums, not from what they hold. Past the
   * minimums the list scrolls. On a wide screen the limits come off.
   */
  fit(): void {
    if (!this.host.compact()) {
      if (!this.fitted) return;
      for (const [, c] of this.host.cards()) { c.el.style.maxHeight = ""; c.el.style.minHeight = ""; }
      for (const b of this.host.bubbles()) { b.el.style.maxHeight = ""; b.el.style.minHeight = ""; }
      this.fitted = false;
      return;
    }
    this.fitted = true;
    const ws = this.host.ws;
    // Everything is measured first and set after, so the layout is read once.
    const px = (v: string): number => Number.parseFloat(v) || 0;
    /** What a window's body holds, however the body is stretched or squeezed right now: its lines, their margins, the gaps, its own padding. */
    const held = (body: HTMLElement): number => {
      const cs = getComputedStyle(body);
      let h = px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
      let n = 0;
      for (const k of body.children) {
        if (!(k instanceof HTMLElement) || k.hidden) continue;
        const ks = getComputedStyle(k);
        h += k.getBoundingClientRect().height + px(ks.marginTop) + px(ks.marginBottom);
        n += 1;
      }
      return h + Math.max(0, n - 1) * px(cs.rowGap);
    };
    const cards = new Map<HTMLElement, { max: number; min: number }>();
    for (const [id, c] of this.host.cards()) {
      if (c.el.offsetHeight === 0) continue; // not shown
      const t = ws.thread(id);
      if (t?.mh && ws.isOpen(t)) { cards.set(c.el, { max: t.mh, min: t.mh }); continue; } // a height of the reader's own
      const chrome = c.el.offsetHeight - c.body.offsetHeight; // title bar, borders, padding
      const max = Math.ceil(chrome + held(c.body));
      cards.set(c.el, { max, min: Math.min(PHONE_MIN, max) });
    }
    const groups = new Map<HTMLElement, { max: number; min: number } | null>();
    for (const b of this.host.bubbles()) {
      if (b.el.offsetHeight === 0 || b.el.classList.contains("collapsed") || b.list.offsetHeight === 0) { groups.set(b.el, null); continue; }
      const kids = [...b.list.children].filter((k): k is HTMLElement => k instanceof HTMLElement && k.offsetHeight > 0);
      const bs = getComputedStyle(b.el), ls = getComputedStyle(b.list);
      const gaps = Math.max(0, kids.length - 1) * px(ls.rowGap);
      // The group's name and frame, from their own measures — never from the
      // bubble's current height, which may be stretched (see held()).
      const head = b.el.querySelector<HTMLElement>(".bb-head");
      const chrome = px(bs.paddingTop) + px(bs.paddingBottom) + px(bs.borderTopWidth) + px(bs.borderBottomWidth)
        + px(ls.paddingTop) + px(ls.paddingBottom) + px(ls.borderTopWidth) + px(ls.borderBottomWidth)
        + (head && head.offsetHeight > 0 ? head.offsetHeight + px(getComputedStyle(head).marginTop) + px(getComputedStyle(head).marginBottom) : 0);
      let max = chrome + gaps, min = chrome + gaps;
      for (const k of kids) { const n = cards.get(k); max += n?.max ?? k.offsetHeight; min += n?.min ?? k.offsetHeight; }
      groups.set(b.el, { max: Math.ceil(max), min: Math.ceil(min) });
    }
    for (const [el, n] of cards) { el.style.maxHeight = `${n.max}px`; el.style.minHeight = `${n.min}px`; }
    for (const [el, n] of groups) { el.style.maxHeight = n ? `${n.max}px` : ""; el.style.minHeight = n ? `${n.min}px` : ""; }
  }

  /** The reader let the thread in front share the list again. */
  releaseHeight(id: string): void {
    const t = this.host.ws.thread(id);
    if (!t?.mh) return;
    delete t.mh;
    this.host.save();
    this.scheduleFit();
  }

  /* ---------------- the grip: a height of your own ---------------- */

  /** The grip at the bottom of the thread in front, dragged for a height of its own (kept: Thread.mh). */
  beginSize(e: PointerEvent, t: Thread, card: HTMLElement): void {
    const h0 = card.offsetHeight;
    card.classList.add("sizing");
    e.preventDefault();
    gestures.begin(e, {
      travel: 0,
      move: (_ev, _dx, dy) => {
        const c = this.host.card(t.id);
        if (!c) return;
        // no smaller than its title bar and a line or two, no taller than the list itself
        const room = this.host.layer.clientHeight - PHONE_MIN;
        t.mh = Math.round(clamp(h0 + dy, 110, room));
        c.el.style.minHeight = c.el.style.maxHeight = `${t.mh}px`;
      },
      end: () => { card.classList.remove("sizing"); this.host.save(); this.scheduleFit(); },
    });
  }

  /* ---------------- dragging a thread up or down the list ---------------- */

  /** The title bar dragged moves the thread up or down the list; a tap folds or focuses it. */
  beginDrag(e: PointerEvent, t: Thread, list: HTMLElement): void {
    const d: Drag = {
      id: t.id, sy: e.clientY, scroll0: this.host.layer.scrollTop, started: false,
      wasActive: t.id === this.host.ws.activeId, list, index: 0, target: 0, h: 0,
    };
    gestures.begin(e, {
      travel: 8,
      move: (ev) => this.moveDrag(d, ev),
      end: (_ev, moved) => this.endDrag(d, moved),
    });
  }

  private cardsIn(list: HTMLElement): HTMLElement[] {
    return ([...list.children] as HTMLElement[]).filter((el) => el.classList.contains("chatwin"));
  }

  /** Follow a thread being dragged up or down its list; the others make way. */
  private moveDrag(d: Drag, e: PointerEvent): void {
    const c = this.host.card(d.id);
    if (!c) return;
    const layer = this.host.layer;
    if (!d.started) {
      d.started = true;
      const all = this.cardsIn(d.list);
      d.index = d.target = all.indexOf(c.el);
      d.h = c.el.offsetHeight + (parseFloat(getComputedStyle(d.list).rowGap) || 8);
      c.el.classList.add("reordering");
      d.list.classList.add("reorder");
      this.host.root.classList.add("carrying");
    }
    // Near the top or bottom of the list, it scrolls along.
    const box = layer.getBoundingClientRect();
    if (e.clientY < box.top + 48) layer.scrollTop -= 12;
    else if (e.clientY > this.host.coreFloor() - 24) layer.scrollTop += 12;
    const dy = e.clientY - d.sy + (layer.scrollTop - d.scroll0);
    c.el.style.transform = `translateY(${Math.round(dy)}px)`;
    // Where it would land: past the middle of each neighbour it has crossed.
    const all = this.cardsIn(d.list);
    const mid = c.el.offsetTop + c.el.offsetHeight / 2 + dy;
    d.target = all.filter((el) => el !== c.el && el.offsetTop + el.offsetHeight / 2 < mid).length;
    all.forEach((el, j) => {
      if (el === c.el) return;
      const shift = j > d.index && j <= d.target ? -d.h : j < d.index && j >= d.target ? d.h : 0;
      el.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  }

  /** Let go of a thread — a tap folds or focuses it, a drag puts it where it was heading. */
  private endDrag(d: Drag, moved: boolean): void {
    const ws = this.host.ws;
    const t = ws.thread(d.id);
    if (!t) return;
    if (!moved) {
      if (!d.wasActive) this.host.focus(t.id);
      else { ws.setOpen(t.id, !ws.isOpen(t)); this.host.commit(); }
      return;
    }
    const all = this.cardsIn(d.list);
    const ids = all.map((el) => el.dataset.id ?? "").filter((id) => id && id !== d.id);
    ids.splice(d.target, 0, d.id);
    // no easing back: the list is simply redrawn in its new order
    d.list.classList.remove("reorder");
    for (const el of all) el.style.transform = "";
    this.host.card(d.id)?.el.classList.remove("reordering");
    this.host.root.classList.remove("carrying");
    this.order = [...ids, ...this.order.filter((id) => !ids.includes(id))];
    store(KEY.phoneOrder, JSON.stringify(this.order));
    if (!d.wasActive) ws.focus(t.id);
    this.host.commit();
  }
}

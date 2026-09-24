/**
 * The stage: JARVIS in the middle, everything he is working on around him.
 *
 *   core ──> bubble (a group)
 *              ├─ thread
 *              └─ thread
 *
 * Nothing here is a grid. Bubbles are soft fields that glide when they move;
 * loose windows are placed on their own. Windows are real DOM — selectable,
 * scrollable text — over a canvas that draws the core. This draws the board
 * from the workspace and places what is on it; the parts it is made of are
 * beside it:
 *
 *   board-store.ts    the workspace, loaded and saved
 *   core-canvas.ts    JARVIS drawn, and where he is
 *   stage-pointer.ts  carrying, sizing and dropping on the desktop
 *   stage-phone.ts    the list a phone shows instead
 *   web.ts            what else is about a thread, on demand
 */

import { seat, separate, shown, type Rect, type Room } from "./board-geometry.js";
import { BoardStore } from "./board-store.js";
import { CoreCanvas, DECK_H, HEADER_H } from "./core-canvas.js";
import { type Activity } from "./core-draw.js";
import { ICON } from "./icons.js";
import { line } from "./message.js";
import { reduceMotion } from "./motion.js";
import { forget, raise, stackKey, track } from "./stack.js";
import { PhoneList } from "./stage-phone.js";
import { BoardPointer } from "./stage-pointer.js";
import { rectAt, roomBetween, sizeOf, type BoxSize, type Place } from "./board-places.js";
import { gestures, sizeLimits } from "./surface.js";
import { planTidy, type TidyItem } from "./tidy.js";
import { ContextWeb, type Related } from "./web.js";
import { averageHues, GENERAL_ID, THREAD_HUES, threadRef, type Group, type Thread, type Workspace, isHexColour } from "./workspace.js";

export type { Thread, Group } from "./workspace.js";
export type { Activity } from "./core-draw.js";
export type { Related } from "./web.js";

/** Half the width of the column kept clear above JARVIS (his ring, status line and notices). */
const CORE_ZONE = 150;

/** A thread's window on the board. */
export interface Card {
  el: HTMLElement;
  body: HTMLElement;
  title: HTMLElement;
  reference: HTMLElement;
  count: HTMLElement;
  /** What the body was last drawn from, so it's only redrawn when that changes. */
  sig: string;
}

/** A group's bubble on the board. */
export interface Bubble {
  el: HTMLElement;
  title: HTMLElement;
  count: HTMLElement;
  list: HTMLElement;
  node: HTMLElement;
}

export class Stage {
  private readonly root: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly store: BoardStore;
  private readonly canvas: CoreCanvas;
  private readonly pointer: BoardPointer;
  private readonly phone: PhoneList;
  private readonly web: ContextWeb;
  private readonly cards = new Map<string, Card>();
  private readonly bubbles = new Map<string, Bubble>();
  /** Where each bubble is actually drawn, in stage pixels. */
  private readonly boxes = new Map<string, Rect>();
  /** Lines that belong to a thread's window but not (yet) to its history. */
  private readonly liveEls = new Map<string, HTMLElement[]>();

  readonly ws: Workspace;
  amplitude = 0;
  activity: Activity = "idle";
  /** The thread receiving an answer right now. */
  streamingId: string | null = null;
  cpuLoad = 0;
  gpuLoad = 0;
  /** Phone layout: the bubbles become a list under the core. */
  compact = false;

  onFocus: ((id: string) => void) | null = null;
  /** Draws the body of a window that holds no conversation (a thread of a kind: the readiness card). */
  bodyPainter: ((t: Thread, body: HTMLElement) => void) | null = null;
  onChange: (() => void) | null = null;
  onCoreTap: (() => void) | null = null;
  onArchive: ((id: string) => void) | null = null;
  onBranch: ((id: string) => void) | null = null;
  onNewThread: ((groupId: string) => void) | null = null;
  /** A thread or a whole bubble was dropped on the bin. */
  onDropDelete: ((kind: "thread" | "group", id: string) => void) | null = null;
  /** What shares context with a thread — the web asks this when it opens. */
  relatedFor: ((id: string) => Related[]) | null = null;
  /** After every save of the board: whether the browser kept it, and its size in characters (memory.ts). */
  set onSaved(f: ((kept: boolean, size: number) => void) | null) { this.store.onSaved = f; }

  private pulse = 0;
  private placeQueued = false;
  private readonly sizer = new ResizeObserver(() => this.queuePlace());
  private readonly stick = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const b = target as HTMLElement;
      if (b.dataset.pinned !== "0") b.scrollTop = b.scrollHeight;
    }
  });
  /** The thread last brought to the top for being the active one. */
  private raisedFor = "";
  /** Threads already on the board, so a new one can be scrolled to on a phone. */
  private known: Set<string> | null = null;

  constructor(root: HTMLElement, canvas: HTMLCanvasElement, layer: HTMLElement) {
    this.root = root;
    this.layer = layer;
    this.store = new BoardStore();
    this.ws = this.store.ws;
    this.canvas = new CoreCanvas(root, canvas);

    this.pointer = new BoardPointer({
      root, ws: this.ws,
      card: (id) => this.cards.get(id), cards: () => this.cards.entries(),
      bubble: (gid) => this.bubbles.get(gid), bubbles: () => this.bubbles.entries(),
      boxOf: (gid) => this.boxes.get(gid),
      room: () => this.room, shown: (r) => this.shown(r), onCore: (x, y) => this.canvas.onCore(x, y),
      focus: (id) => this.focus(id), commit: () => this.commit(), save: () => this.save(),
      place: () => this.place(), renderAll: () => this.renderAll(), setFolded: (gid, f) => this.setFolded(gid, f),
      applySize: (id) => this.applySize(id), applyGroupSize: (gid) => this.applyGroupSize(gid),
      dropDelete: (kind, id) => this.onDropDelete?.(kind, id),
    });
    this.phone = new PhoneList({
      root, layer, ws: this.ws, compact: () => this.compact,
      card: (id) => this.cards.get(id), cards: () => this.cards.entries(), bubbles: () => this.bubbles.values(),
      coreFloor: () => this.canvas.coreFloor,
      focus: (id) => this.focus(id), commit: () => this.commit(), save: () => this.save(),
    });
    this.web = new ContextWeb({
      root,
      thread: (id) => this.ws.thread(id),
      hueOf: (t) => { const c = t.color ?? this.hueOf(this.ws.groupOf(t)); return isHexColour(c) ? c : THREAD_HUES[0]; },
      related: (id) => this.relatedFor?.(id) ?? [],
      board: () => ({ top: HEADER_H + this.canvas.inset.top + 8, bottom: this.canvas.floor - DECK_H - 24 }),
      pick: (id) => { this.focus(id); this.reveal(id); },
    });

    this.canvas.resize();
    this.store.anchorToCorner(this.canvas.w || root.clientWidth, this.canvas.h || root.clientHeight);
    this.save();
    new ResizeObserver(() => { this.canvas.resize(); this.place(); }).observe(root);
    // A phone's list shares its height by what each thread holds (stage-phone.ts):
    // measured again whenever anything in the list changes or finishes loading.
    new MutationObserver(() => this.phone.scheduleFit()).observe(layer, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden"] });
    layer.addEventListener("load", () => this.phone.scheduleFit(), true);

    // Every press begins a gesture (surface.ts follows it to its end).
    root.addEventListener("pointerdown", (e) => this.onDown(e));
    root.addEventListener("dblclick", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".chatwin");
      if (card) { this.openWeb(card.dataset.id!); return; }
      if (this.compact || (e.target as HTMLElement).closest(".bubble, .cmd, .panel, .deck, .topbar")) return;
      if (this.canvas.onCore(e.clientX, e.clientY)) return;
      this.onNewThread?.(GENERAL_ID);
    });

    this.renderAll();
    // Every frame while something moves; every other frame at rest — the
    // breathing is slow, and half the drawing is half the battery on a phone.
    let skip = false;
    const frame = (t: number): void => {
      const resting = this.activity === "idle" && this.pulse <= 0 && !gestures.busy;
      skip = resting && !skip;
      if (!skip) {
        this.canvas.draw(t, { activity: this.activity, amplitude: this.amplitude, cpuLoad: this.cpuLoad, gpuLoad: this.gpuLoad, pulse: this.pulse });
        if (this.pulse > 0) this.pulse -= 0.02;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* ---------------- the board as data ---------------- */

  save(): void { this.store.save(); }

  /** Save, redraw and tell the console the board changed. */
  commit(): void {
    this.save();
    this.renderAll();
    this.onChange?.();
  }

  get threads(): Thread[] { return this.ws.live; }
  get activeId(): string { return this.ws.activeId; }
  get active(): Thread | undefined { return this.ws.active; }

  /** The surface a thread is shown in — its own window, or its group's bubble. */
  private surfaceKey(id: string): string | null {
    const t = this.ws.thread(id);
    if (!t) return null;
    return t.groupId === GENERAL_ID ? stackKey.thread(t.id) : stackKey.group(t.groupId);
  }

  /** Bring a thread to the top of everything on the board, panels included. */
  raise(id = this.ws.activeId): void {
    const key = this.surfaceKey(id);
    if (key) raise(key);
  }

  focus(id: string): void {
    this.raise(id);
    if (id === this.ws.activeId) return;
    if (!this.ws.focus(id)) return;
    this.pulse = 1;
    this.save();
    this.renderAll();
    this.onFocus?.(id);
  }

  /** On a phone, bring the window in front into view in the list. */
  reveal(id = this.ws.activeId): void { this.phone.reveal(id); }

  /**
   * Tidy the board: every thread is folded to its title bar, then everything
   * is seated by the plan in tidy.ts — one column down the middle, more to a
   * row when one is too tall, widths coming down only when a row is too wide.
   * `fold: false` tries it with the windows left open first, and folds them
   * only if they don't fit. `clear`: boxes (panels) to tidy between, not over.
   */
  tidy(opts: { fold?: boolean; clear?: Rect[] } = {}): { seated: number; folded: boolean } {
    const fold = opts.fold ?? true;
    if (this.compact) return { seated: 0, folded: false }; // a phone's board is already a list
    const hold = [...this.cards.values(), ...this.bubbles.values()].map((x) => x.el);
    // Measured with their easing held, or a window still changing size would
    // be measured at the size it is leaving.
    for (const el of hold) el.classList.add("sizing");
    const THREAD_MIN_W = 260; // a folded title bar still shows its name and buttons

    // Fold, give back what an earlier tidy took, and measure what's left.
    for (const t of this.ws.live) {
      if (fold && this.ws.isOpen(t)) this.ws.setOpen(t.id, false);
      delete t.fit;
    }
    for (const g of this.ws.groups) delete g.fit;
    this.renderAll();
    type Measured = TidyItem & { fit: (w: number) => void; place: (x: number, y: number) => void };
    const items: Measured[] = [];
    for (const g of this.ws.visibleGroups) {
      if (g.id === GENERAL_ID) continue;
      const el = this.bubbles.get(g.id)?.el;
      if (!el) continue;
      const shut = el.classList.contains("collapsed");
      items.push({
        w: el.offsetWidth, h: el.offsetHeight, minW: shut ? el.offsetWidth : Math.min(el.offsetWidth, THREAD_MIN_W + 30),
        weight: this.ws.treeOrder(g.id).reduce((sum, t) => sum + 1 + t.turns.length, 0), at: g.createdAt,
        fit: (w) => { g.fit = { w, h: 0 }; }, place: (x, y) => { g.x = x; g.y = y; },
      });
    }
    for (const t of this.ws.treeOrder(GENERAL_ID)) {
      const el = this.cards.get(t.id)?.el;
      if (!el) continue;
      items.push({
        w: el.offsetWidth, h: el.offsetHeight, minW: Math.min(el.offsetWidth, THREAD_MIN_W),
        weight: t.turns.length, at: t.createdAt,
        fit: (w) => { t.fit = { w, h: 0 }; }, place: (x, y) => { t.x = x; t.y = y; },
      });
    }

    const plan = planTidy(items, opts.clear?.length ? roomBetween(this.room, opts.clear) : this.room);
    if (!plan.fitted && !fold) return this.tidy({ ...opts, fold: true });
    items.forEach((it, i) => {
      if (plan.widths[i]! < it.w) it.fit(plan.widths[i]!);
      it.place(plan.seats[i]!.x, plan.seats[i]!.y);
    });
    this.commit();
    requestAnimationFrame(() => { for (const el of hold) el.classList.remove("sizing"); });
    return { seated: items.length, folded: fold };
  }

  /* ---------------- the board in words (board-places.ts) ---------------- */

  /** Each loose window and each group as drawn: where it is and how big. None on a phone, whose board is a list. */
  surfaces(): { kind: "thread" | "group"; id: string; rect: Rect }[] {
    if (this.compact) return [];
    const out: { kind: "thread" | "group"; id: string; rect: Rect }[] = [];
    for (const [gid, r] of this.boxes) {
      const el = this.bubbles.get(gid)?.el;
      if (el) out.push({ kind: "group", id: gid, rect: { x: r.x, y: r.y, w: el.offsetWidth, h: el.offsetHeight } });
    }
    for (const t of this.ws.treeOrder(GENERAL_ID)) {
      const el = this.cards.get(t.id)?.el;
      if (!el?.offsetWidth || !el.style.left) continue;
      out.push({ kind: "thread", id: t.id, rect: { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.offsetWidth, h: el.offsetHeight } });
    }
    return out;
  }

  /**
   * A loose window or a group put at a place on the board, given a size, or
   * both — as dragging it there by hand would. Given a size, it opens: a
   * size is asked for to read it. Without a place it keeps its top-left
   * corner; without a size, its size.
   */
  put(what: { thread: Thread } | { group: Group }, at?: Place, size?: BoxSize): void {
    const lim = sizeLimits(this.room);
    if ("thread" in what) {
      const t = what.thread;
      const c = this.cards.get(t.id);
      if (!c || t.groupId !== GENERAL_ID) return;
      let w = c.el.offsetWidth, h = c.el.offsetHeight;
      if (size) {
        // a window's size is its body's; its title bar sits on top of that (as stage-pointer.ts sizes it)
        const head = c.el.querySelector<HTMLElement>(".cw-head")?.offsetHeight ?? 40;
        ({ w, h } = sizeOf(size, { ...lim, maxH: Math.max(lim.minH, lim.maxH - 50) + head }));
        t.size = { w, h: Math.max(lim.minH, h - head) };
        delete t.fit;
        this.ws.setOpen(t.id, true);
      }
      const r = at ? rectAt(at, w, h, this.room) : null;
      if (r) { t.x = r.x; t.y = r.y; }
    } else {
      const g = what.group;
      const el = this.bubbles.get(g.id)?.el;
      if (!el) return;
      let w = el.offsetWidth, h = el.offsetHeight;
      if (size) {
        ({ w, h } = sizeOf(size, lim));
        g.size = { w, h };
        delete g.fit;
        this.ws.setCollapsed(g.id, false);
      }
      const r = at ? rectAt(at, w, h, this.room) : null;
      if (r) { g.x = r.x; g.y = r.y; }
    }
    this.commit();
    // on top where it lands, as anything carried there by hand is
    raise("thread" in what ? stackKey.thread(what.thread.id) : stackKey.group(what.group.id));
  }

  /* ---------------- thread windows ---------------- */

  /** The message container of the window in front, if there is one. */
  activeBody(): HTMLElement | null {
    const t = this.ws.active;
    return t ? this.card(t).body : null;
  }

  /** The message container of any thread's window. */
  bodyOf(id: string): HTMLElement | null {
    const t = this.ws.thread(id);
    return t && !t.archivedAt ? this.card(t).body : null;
  }

  /**
   * Keep an element in a thread's window across redraws until it's detached —
   * a reply still being written, or an approval waiting for an answer.
   */
  attachLive(id: string, el: HTMLElement): void {
    const list = this.liveEls.get(id) ?? [];
    if (!list.includes(el)) list.push(el);
    this.liveEls.set(id, list);
  }

  detachLive(id: string, el: HTMLElement): void {
    const list = (this.liveEls.get(id) ?? []).filter((x) => x !== el);
    if (list.length) this.liveEls.set(id, list);
    else this.liveEls.delete(id);
  }

  /**
   * Draw a thread's conversation afresh from its history on the next commit —
   * after messages were taken out of it (cleared). A window otherwise redraws
   * only when its history grows or shrinks from what it last drew, which a
   * removal can happen to match.
   */
  redraw(id: string): void {
    const c = this.cards.get(id);
    if (c) c.sig = "";
  }

  private card(t: Thread): Card {
    let c = this.cards.get(t.id);
    if (c) return c;
    const el = document.createElement("section");
    el.className = "chatwin glass";
    el.dataset.id = t.id;
    el.innerHTML =
      `<header class="cw-head" title="Click to fold this thread away; drag it onto another to group them">` +
      `<span class="cw-dot"></span><span class="cw-title"></span><span class="cw-ref"></span><span class="cw-count"></span>` +
      `<span class="cw-chev" aria-hidden="true">${ICON.chev}</span>` +
      `<button class="cw-w" type="button" title="What else is about this — open its web" aria-label="Show this thread's web">${ICON.web}</button>` +
      `<button class="cw-b" type="button" title="Branch: a new thread carrying this one's context" aria-label="Branch">${ICON.branch}</button>` +
      `<button class="cw-x" type="button" title="Put away — recoverable from the Threads list" aria-label="Close thread">${ICON.close}</button>` +
      `<button class="cw-del" type="button" title="Delete this thread permanently" aria-label="Delete thread permanently">${ICON.delete}</button>` +
      `</header><div class="cw-body" aria-live="polite"></div>` +
      ["n", "s", "e", "w", "nw", "ne", "sw", "se"].map((corner) => `<span class="cw-grip" data-corner="${corner}" title="Drag to resize · double-click to reset" aria-hidden="true"></span>`).join("") +
      // phone: the grip at the bottom of the thread in front — drag for a height of your own, double-tap to let it share again
      `<span class="cw-grip-m" aria-hidden="true"><svg viewBox="0 0 14 14"><path d="M13.5 1.5L1.5 13.5M13.5 6.5L6.5 13.5M13.5 11.5L11.5 13.5"/></svg></span>`;
    c = {
      el,
      body: el.querySelector(".cw-body")!,
      title: el.querySelector(".cw-title")!,
      reference: el.querySelector(".cw-ref")!,
      count: el.querySelector(".cw-count")!,
      sig: "",
    };
    el.querySelector(".cw-x")!.addEventListener("click", (e) => { e.stopPropagation(); this.onArchive?.(t.id); });
    el.querySelector(".cw-del")!.addEventListener("click", (e) => { e.stopPropagation(); this.onDropDelete?.("thread", t.id); });
    el.querySelector(".cw-b")!.addEventListener("click", (e) => { e.stopPropagation(); this.onBranch?.(t.id); });
    el.querySelector(".cw-w")!.addEventListener("click", (e) => { e.stopPropagation(); this.openWeb(t.id); });
    // Every grip resets on a double-click, as each one's tooltip promises.
    el.querySelector(".cw-grip-m")?.addEventListener("dblclick", (e) => { e.stopPropagation(); this.phone.releaseHeight(t.id); });
    for (const grip of el.querySelectorAll(".cw-grip")) grip.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const th = this.ws.thread(t.id);
      if (!th) return;
      delete th.size;
      delete th.fit;
      this.applySize(t.id);
      this.commit();
    });
    this.sizer.observe(el);
    // Keep the newest line in view when the window changes size — unless you've
    // scrolled up to read something, in which case it stays where you are.
    // Only a person scrolling (wheel, touch, dragging the bar) can unpin it; a
    // scroll the layout causes on its own never does.
    const body = c.body;
    let handTimer = 0;
    const byHand = (): void => {
      body.dataset.hand = "1";
      clearTimeout(handTimer);
      handTimer = window.setTimeout(() => { delete body.dataset.hand; }, 1200);
    };
    for (const ev of ["wheel", "touchstart", "pointerdown", "keydown"]) body.addEventListener(ev, byHand, { passive: true });
    body.addEventListener("scroll", () => {
      const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
      if (atEnd) body.dataset.pinned = "1";
      else if (body.dataset.hand === "1") body.dataset.pinned = "0";
    }, { passive: true });
    this.stick.observe(c.body);
    this.cards.set(t.id, c);
    this.applySize(t.id);
    return c;
  }

  /**
   * A loose window the reader has sized stays that size, and one Tidy up
   * shrank keeps what it was given; inside a group, the group's size rules.
   */
  private applySize(id: string): void {
    const c = this.cards.get(id);
    const t = this.ws.thread(id);
    if (!c) return;
    if (t && (t.size || t.fit) && !this.compact && t.groupId === GENERAL_ID) {
      const cap = t.fit?.h || Infinity;
      c.el.style.width = `${Math.round(Math.min(t.size?.w ?? Infinity, t.fit?.w ?? Infinity))}px`;
      // a size is a fixed height; a fit alone only caps it, so the window still grows with what's said
      c.body.style.height = t.size ? `${Math.round(Math.min(t.size.h, cap))}px` : "";
      c.body.style.maxHeight = t.size ? "none" : cap === Infinity ? "" : `${Math.round(cap)}px`;
      c.el.classList.add("sized");
    } else {
      c.el.style.width = "";
      c.body.style.height = "";
      c.body.style.maxHeight = "";
      c.el.classList.remove("sized");
    }
  }

  /** A bubble the reader has sized keeps that width, and scrolls inside it. */
  private applyGroupSize(id: string): void {
    const b = this.bubbles.get(id);
    const g = this.ws.group(id);
    if (!b) return;
    if (g && (g.size || g.fit) && !this.compact && !b.el.classList.contains("collapsed")) {
      b.el.style.width = `${Math.round(Math.min(g.size?.w ?? Infinity, g.fit?.w ?? Infinity))}px`;
      // A dragged height is the bubble's own height — its list scrolls inside
      // it — so it follows the corner up as well as down. Tidy up's fit only
      // caps the list, and the bubble stays as tall as what it holds.
      const cap = g.size ? Infinity : g.fit?.h || Infinity;
      b.el.style.height = g.size ? `${Math.round(Math.min(g.size.h, g.fit?.h || Infinity))}px` : "";
      b.list.style.maxHeight = cap === Infinity ? "" : `${Math.round(cap)}px`;
      b.el.classList.add("sized");
    } else {
      b.el.style.width = "";
      b.el.style.height = "";
      b.list.style.maxHeight = "";
      b.el.classList.remove("sized");
    }
  }

  private paintHead(t: Thread): void {
    const c = this.card(t);
    c.title.textContent = t.title;
    c.reference.textContent = `#${threadRef(t)}`;
    const n = t.turns.filter((x) => x.role === "user").length;
    c.count.textContent = n ? String(n) : "";
    c.el.style.setProperty("--hue", t.color ?? THREAD_HUES[0]);
  }

  private bubble(g: Group): Bubble {
    let b = this.bubbles.get(g.id);
    if (b) return b;
    const el = document.createElement("section");
    // Hidden until it has a seat: shown at (0,0) first, it would glide in from the corner.
    el.className = "bubble glass unplaced";
    el.dataset.gid = g.id;
    el.innerHTML =
      `<header class="bb-head" title="Drag to move this group"><span class="bb-dot"></span><span class="bb-title"></span><span class="bb-count"></span>` +
      `<button class="bb-add" type="button" title="New thread in this group" aria-label="New thread in this group">${ICON.plus}</button>` +
      `<button class="bb-fold" type="button" title="Fold this group" aria-label="Fold this group">${ICON.chev}</button></header>` +
      `<div class="bb-list"></div>` +
      ["n", "s", "e", "w", "nw", "ne", "sw", "se"].map((corner) => `<span class="bb-grip" data-corner="${corner}" title="Drag to resize · double-click to reset" aria-hidden="true"></span>`).join("") +
      `<button class="bb-node" type="button"><b></b><span></span></button>`;
    this.layer.append(el);
    b = {
      el,
      title: el.querySelector(".bb-title")!,
      count: el.querySelector(".bb-count")!,
      list: el.querySelector(".bb-list")!,
      node: el.querySelector(".bb-node")!,
    };
    el.querySelector(".bb-add")!.addEventListener("click", (e) => { e.stopPropagation(); this.onNewThread?.(g.id); });
    el.querySelector(".bb-fold")!.addEventListener("click", (e) => { e.stopPropagation(); this.setFolded(g.id, true); });
    for (const grip of el.querySelectorAll(".bb-grip")) grip.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const grp = this.ws.group(g.id);
      if (!grp) return;
      delete grp.size;
      delete grp.fit;
      this.applyGroupSize(g.id);
      this.commit();
    });
    this.sizer.observe(el);
    this.bubbles.set(g.id, b);
    this.applyGroupSize(g.id);
    return b;
  }

  hueOf(g: Group): string {
    return averageHues(this.ws.treeOrder(g.id).map((t) => t.color ?? THREAD_HUES[0]));
  }

  setFolded(groupId: string, folded: boolean): void {
    // Folding the bubble you're working in moves you to the newest thread
    // that is in the open — loose, or in a group that isn't folded. Never
    // into a folded group: focusing a thread opens its group, and folding
    // one group must not open another.
    if (folded && this.ws.active?.groupId === groupId && this.ws.visibleGroups.length > 1) {
      const open = new Set(this.ws.visibleGroups.filter((g) => g.id === GENERAL_ID || !g.collapsed).map((g) => g.id));
      const elsewhere = this.ws.live.filter((t) => t.groupId !== groupId && open.has(t.groupId)).sort((a, b) => b.createdAt - a.createdAt)[0];
      if (elsewhere) this.ws.focus(elsewhere.id);
    }
    this.ws.setCollapsed(groupId, folded);
    this.commit();
    this.onFocus?.(this.ws.activeId);
  }

  /** Rebuild the board from the workspace. Cheap: only what changed is redrawn. */
  renderAll(): void {
    const visible = this.ws.visibleGroups;
    const seen = new Set<string>();
    for (const g of visible) {
      const b = this.bubble(g);
      seen.add(g.id);
      const members = this.phone.sorted(this.ws.treeOrder(g.id));
      // Threads that belong to no group aren't a group: no name, no shell —
      // each just hangs off the core on its own.
      const loose = g.id === GENERAL_ID;
      b.el.classList.toggle("loose", loose);
      // A folded group stays folded, the thread in front inside it or not: asking it something opens it (focus).
      const folded = !loose && !!g.collapsed;
      b.el.classList.toggle("collapsed", folded);
      b.el.classList.toggle("here", members.some((t) => t.id === this.ws.activeId));
      b.el.style.setProperty("--hue", this.hueOf(g));
      b.title.textContent = g.title;
      b.count.textContent = String(members.length);
      (b.node.querySelector("b") as HTMLElement).textContent = g.title;
      (b.node.querySelector("span") as HTMLElement).textContent = `${members.length} thread${members.length === 1 ? "" : "s"}`;

      this.applyGroupSize(g.id);
      // A group stacks as one surface; loose windows each stack on their own.
      if (loose) b.el.style.zIndex = "";
      else track(stackKey.group(g.id), b.el);
      const ids = new Set(members.map((t) => t.id));
      for (const el of [...b.list.children] as HTMLElement[]) if (!ids.has(el.dataset.id ?? "")) el.remove();
      let i = 0;
      for (const t of members) {
        const c = this.card(t);
        // Being carried: leave it exactly where it is (and keep counting it, so
        // no neighbour is shuffled — moving an element reloads a video in it).
        if (c.el.classList.contains("lifted")) { if (b.list.children[i] === c.el) i++; continue; }
        // Loose windows carry their saved board coordinates as inline left/top
        // styles. Once grouped those offsets must be cleared, otherwise the
        // cards remain hundreds of pixels down and to the right inside the
        // bubble's scrolling list.
        if (!loose) { c.el.style.left = ""; c.el.style.top = ""; c.el.style.zIndex = ""; }
        else track(stackKey.thread(t.id), c.el);
        this.applySize(t.id); // a size of its own only while loose
        if (b.list.children[i] !== c.el) b.list.insertBefore(c.el, b.list.children[i] ?? null);
        i++;
      }
    }
    for (const [id, b] of this.bubbles) if (!seen.has(id)) { b.el.remove(); this.bubbles.delete(id); this.boxes.delete(id); forget(stackKey.group(id)); }
    for (const [id, c] of this.cards) {
      const t = this.ws.thread(id);
      if (!t || t.archivedAt) { c.el.remove(); this.cards.delete(id); this.liveEls.delete(id); forget(stackKey.thread(id)); }
    }

    for (const t of this.ws.live) this.paintCard(t);
    // Whichever thread has just become the one you're in — however it got
    // there (a click, a new thread, a command, JARVIS moving on to it) — comes
    // to the top of everything.
    if (this.ws.activeId && this.ws.activeId !== this.raisedFor) {
      this.raisedFor = this.ws.activeId;
      this.raise(this.ws.activeId);
    }
    if (this.web.openFor && !this.ws.thread(this.web.openFor)) this.closeWeb();
    this.place();

    // A thread that has just appeared: on a phone, take the list up to it.
    const fresh = this.known ? this.ws.live.filter((t) => !this.known!.has(t.id)) : [];
    this.known = new Set(this.ws.live.map((t) => t.id));
    const newest = fresh.sort((a, b) => b.createdAt - a.createdAt)[0];
    if (this.compact && newest) {
      const el = this.cards.get(newest.id)?.el;
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" }));
    }
  }

  private paintCard(t: Thread): void {
    const c = this.card(t);
    const on = t.id === this.ws.activeId;
    // Open is the reader's choice and stays that way, on a phone as on the
    // desktop; "on" only says where what you type goes. Opening one window
    // never folds another.
    const open = this.ws.isOpen(t);
    c.el.classList.toggle("on", on);
    c.el.classList.toggle("shut", !open);
    this.paintHead(t);

    c.el.dataset.kind = t.kind ?? "";
    if (t.kind) {
      // no conversation in it: its body is drawn by whoever owns the kind, whenever it is (re)opened or redrawn
      const sig = `${open ? 1 : 0}|${t.kind}`;
      if (sig === c.sig) return;
      c.sig = sig;
      c.body.replaceChildren();
      if (open) this.bodyPainter?.(t, c.body);
      return;
    }
    const live = this.liveEls.get(t.id) ?? [];
    const last = t.turns[t.turns.length - 1];
    const sig = `${open ? 1 : 0}|${t.turns.length}|${last?.content.length ?? 0}|${live.length}`;
    if (sig === c.sig) return;
    c.sig = sig;

    c.body.replaceChildren();
    if (open) {
      if (!t.turns.length && !live.length) c.body.append(line("sys", "Nothing said yet. Ask me something."));
      for (const turn of t.turns) c.body.append(line(turn.role === "user" ? "user" : "jarvis", turn.content));
      for (const el of live) c.body.append(el);
    }
    // Folded away, a window is just its title bar; the body isn't drawn at all.
    c.body.scrollTop = c.body.scrollHeight;
  }

  /* ---------------- placing ---------------- */

  private queuePlace(): void {
    if (this.placeQueued) return;
    this.placeQueued = true;
    requestAnimationFrame(() => { this.placeQueued = false; this.place(); });
  }

  /** Stage bounds the board must stay inside: the whole stage above the deck. */
  private get bounds(): Room["bounds"] {
    // the same 16px edge margin as the title row, the deck and the panels (--edge)
    return { top: HEADER_H + this.canvas.inset.top + 4, bottom: this.canvas.floor - DECK_H - 8, left: 16, right: this.canvas.w - 16 };
  }

  /** The board as it is right now: its edges, and the column kept clear above JARVIS. Panels sit by it too. */
  get room(): Room {
    return { bounds: this.bounds, cx: this.canvas.core().cx, coreZone: CORE_ZONE, coreFloor: this.canvas.coreFloor };
  }

  /** Where a window or bubble is actually shown: inside the board, clear of the deck and of JARVIS. */
  private shown(r: Rect): Rect {
    return shown(r, this.room);
  }

  /** Open instruments reserve their screen area for new conversations. */
  private panelObstacles(): Rect[] {
    const root = this.root.getBoundingClientRect();
    return [...this.root.querySelectorAll<HTMLElement>(".panel.float")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height }));
  }

  private place(): void {
    this.canvas.publish();
    if (this.compact) {
      for (const b of this.bubbles.values()) { b.el.style.transform = ""; b.el.classList.remove("unplaced"); }
      this.boxes.clear();
      this.phone.scheduleFit();
      return;
    }
    this.phone.fit(); // back on a wide screen: the phone's limits come off
    const placed: { id: string; b: Bubble; r: Rect; here: boolean }[] = [];
    const unseated: Group[] = [];
    for (const g of this.ws.visibleGroups) {
      // General is a transparent, stage-sized host for independent windows.
      // It has no position of its own.
      if (g.id === GENERAL_ID) continue;
      const b = this.bubbles.get(g.id);
      if (!b) continue;
      if (g.x === undefined || g.y === undefined) { unseated.push(g); continue; }
      const w = b.el.offsetWidth;
      const r = this.shown({ x: g.x, y: g.y, w, h: b.el.offsetHeight });
      placed.push({ id: g.id, b, r, here: b.el.classList.contains("here") });
    }
    let seated = false;
    // Loose windows are placed after groups, but a new group must still keep
    // clear of the ones already on the board.
    const loose = unseated.length ? this.looseRects() : [];
    for (const g of unseated) {
      const b = this.bubbles.get(g.id)!;
      const w = b.el.offsetWidth, h = b.el.offsetHeight;
      if (!w || !h) continue; // not laid out yet; try again next frame
      const r = seat(w, h, [...placed.map((p) => p.r), ...loose, ...this.panelObstacles()], this.room);
      g.x = Math.round(r.x);
      g.y = Math.round(r.y);
      placed.push({ id: g.id, b, r, here: b.el.classList.contains("here") });
      seated = true;
    }
    // Reflow only newly seated groups. A manual resize must never shove other
    // conversations down the board; their saved positions remain their own.
    if (seated) separate(placed, this.room);
    for (const p of placed) {
      p.b.el.style.transform = `translate3d(${p.r.x}px, ${p.r.y}px, 0)`;
      if (p.b.el.classList.contains("unplaced")) {
        void p.b.el.offsetWidth; // take the seat before transitions come back on
        p.b.el.classList.remove("unplaced");
      }
      this.boxes.set(p.id, p.r);
    }
    this.bubbles.get(GENERAL_ID)?.el.classList.remove("unplaced");
    this.boxes.delete(GENERAL_ID);
    this.placeLoose(placed.map((p) => p.r));
    if (seated) this.save();
  }

  /** Where the loose windows that already have a seat are shown. */
  private looseRects(): Rect[] {
    const out: Rect[] = [];
    for (const t of this.ws.treeOrder(GENERAL_ID)) {
      const c = this.cards.get(t.id);
      if (!c || t.x === undefined || t.y === undefined || !c.el.offsetWidth) continue;
      out.push(this.shown({ x: t.x, y: t.y, w: c.el.offsetWidth, h: c.el.offsetHeight }));
    }
    return out;
  }

  /** Place independent windows on the board; once dragged, each keeps its seat. */
  private placeLoose(taken: Rect[]): void {
    let changed = false;
    // Windows that already have a seat are placed first, so a new one is
    // seated clear of every one of them, not just those listed before it.
    const order = this.ws.treeOrder(GENERAL_ID);
    const seated = order.filter((t) => t.x !== undefined && t.y !== undefined);
    for (const t of [...seated, ...order.filter((t) => !seated.includes(t))]) {
      const c = this.cards.get(t.id);
      if (!c || c.el.classList.contains("lifted")) continue;
      const w = c.el.offsetWidth, h = c.el.offsetHeight;
      if (!w || !h) continue;
      let r: Rect;
      if (t.x === undefined || t.y === undefined) {
        r = seat(w, h, [...taken, ...this.panelObstacles()], this.room);
        t.x = Math.round(r.x);
        t.y = Math.round(r.y);
        changed = true;
      } else r = this.shown({ x: t.x, y: t.y, w, h });
      c.el.style.left = `${r.x}px`;
      c.el.style.top = `${r.y}px`;
      taken.push(r);
    }
    if (changed) this.save();
  }

  /* ---------------- the web: what else is about this ---------------- */

  openWeb(id: string): void { this.web.open(id); }
  closeWeb(): boolean { return this.web.close(); }
  get webOpen(): boolean { return this.web.isOpen; }

  /* ---------------- a press: what was pressed, and who follows it ---------------- */

  private onDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest(".web")) return;
    const overUi = target.closest(".bubble, .cmd, .panel, .deck, .topbar");

    // JARVIS himself: the one control that is always in the same place.
    if (!overUi && this.canvas.onCore(e.clientX, e.clientY)) { e.preventDefault(); this.onCoreTap?.(); return; }

    // Whatever you touch comes to the top — above other threads and panels.
    const surface = target.closest<HTMLElement>(".chatwin, .bubble:not(.loose)");
    if (surface?.dataset.id) this.raise(surface.dataset.id);
    else if (surface?.dataset.gid) raise(stackKey.group(surface.dataset.gid));

    if (this.compact) { this.onDownCompact(e, target); return; }

    // A corner or an edge: size the window, or the bubble.
    const grip = target.closest<HTMLElement>(".cw-grip, .bb-grip");
    if (grip) { this.pointer.size(e, grip); return; }

    // A bubble, by its name bar or — folded — by the orb itself.
    const bubEl = target.closest<HTMLElement>(".bubble");
    const onHead = target.closest(".bb-head") && !target.closest("button");
    const onNode = target.closest(".bb-node");
    if (bubEl && (onHead || onNode)) { this.pointer.carryGroup(e, bubEl, !!onNode); return; }

    // A thread window: click to bring it forward, its title bar to fold it,
    // and drag that bar to move or group it.
    const card = target.closest<HTMLElement>(".chatwin");
    if (!card || target.closest(".cw-x, .cw-del, .cw-b, .cw-w")) return;
    this.pointer.carryCard(e, card, !!target.closest(".cw-head"));
  }

  /**
   * A phone follows the desktop's rules, with taps for clicks: tap a window
   * to bring it forward, tap the title bar of the one you're in to fold it
   * or open it again, drag that bar to move it up or down the list, drag the
   * grip at its bottom for a height of its own, tap a group's name to fold or
   * open the group.
   */
  private onDownCompact(e: PointerEvent, target: HTMLElement): void {
    if (target.closest("button")) return;
    const card = target.closest<HTMLElement>(".chatwin");
    if (card) {
      const t = this.ws.thread(card.dataset.id);
      if (!t) return;
      if (target.closest(".cw-head") && card.parentElement) { this.phone.beginDrag(e, t, card.parentElement); return; }
      if (target.closest(".cw-grip-m")) { this.phone.beginSize(e, t, card); return; }
      if (t.id !== this.ws.activeId) this.focus(t.id);
      return;
    }
    const bub = target.closest<HTMLElement>(".bubble");
    const g = bub ? this.ws.group(bub.dataset.gid) : undefined;
    if (g && g.id !== GENERAL_ID && target.closest(".bb-head, .bb-node")) this.setFolded(g.id, !g.collapsed);
  }
}

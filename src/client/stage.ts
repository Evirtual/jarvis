/**
 * The stage: JARVIS in the middle, everything he is working on drifting around
 * him.
 *
 *   core ──flowing spoke──> bubble (a group)
 *                             ├─ thread
 *                             └─ thread
 *
 * Nothing here is a grid. Bubbles are soft fields that hang off the core on
 * curved, moving spokes; they drift a little at rest and glide when they move.
 * The light behind the core is fixed where he is (styles.css), so it never
 * slides when the window resizes. Windows and bubbles can be resized from any
 * edge or corner, dragged between bubbles, or dropped on the bin that rises
 * when you pick one up.
 *
 * Threads are shown flat inside their bubble — no nesting, no wires strung
 * across the board. What connects them is shown on demand instead: open a
 * thread's web (⌗, or double-click it) and everything that shares its context
 * blooms out around it, near and bright for a strong connection, far and faint
 * for a passing one.
 *
 * Windows are real DOM — selectable, scrollable text — over a canvas that draws
 * the core, the aurora and the spokes. On a phone the bubbles become a list
 * under the core.
 */

import { seat, separate, shown, type Rect, type Room } from "./board-geometry.js";
import { recall, store } from "./dom.js";
import { reduceMotion } from "./motion.js";
import { CORE_R, DESIGN_R, drawAurora, drawCore, type Activity } from "./core-draw.js";
import { ICON } from "./icons.js";
import { line } from "./message.js";
import { ContextWeb } from "./web.js";
import { forget, raise, stackKey, track } from "./stack.js";
import { planTidy, type TidyItem } from "./tidy.js";
import { averageHues, GENERAL_ID, Workspace, migrate, THREAD_HUES, threadRef, type Group, type Thread } from "./workspace.js";

export type { Thread, Group } from "./workspace.js";
export type { Activity } from "./core-draw.js";

/** How big JARVIS is on screen, and the size the core was drawn at. */
const CORE_BOTTOM_GAP = 20;
/** The deck at the bottom: readings, JARVIS, controls. */
const DECK_H = 96;
/** The title row across the top (threads, the JARVIS title, configuration): the board starts below it. Matches --header-h. */
export const HEADER_H = 56;
/** Half the width of the column kept clear above JARVIS (his ring, status line and notices). */
const CORE_ZONE = 150;
/** Room above his ring for the status line and a notice. */
const CORE_STATUS_ROOM = 44;
const STORE_KEY = "jarvis.workspace";
const MIN_W = 210, MIN_H = 90;

import type { Related } from "./web.js";
export type { Related } from "./web.js";

interface Card {
  el: HTMLElement;
  body: HTMLElement;
  title: HTMLElement;
  reference: HTMLElement;
  count: HTMLElement;
  /** What the body was last drawn from, so it's only redrawn when that changes. */
  sig: string;
}

interface Bubble {
  el: HTMLElement;
  title: HTMLElement;
  count: HTMLElement;
  list: HTMLElement;
  node: HTMLElement;
  /** Where it is drifting to, and its own phase so no two move alike. */
  phase: number;
}

export class Stage {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private layer: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private cards = new Map<string, Card>();
  private bubbles = new Map<string, Bubble>();
  /** Where each bubble is actually drawn, in stage pixels. */
  private boxes = new Map<string, Rect>();
  /** Lines that belong to a thread's window but not (yet) to its history. */
  private liveEls = new Map<string, HTMLElement[]>();

  ws: Workspace;
  amplitude = 0;
  activity: Activity = "idle";
  /** The thread receiving an answer right now — its spoke carries a pulse. */
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
  /** After every save of the board: whether the browser kept it, and its size in characters (memory.ts). */
  onSaved: ((kept: boolean, size: number) => void) | null = null;
  onArchive: ((id: string) => void) | null = null;
  onBranch: ((id: string) => void) | null = null;
  onNewThread: ((groupId: string) => void) | null = null;
  /** A thread or a whole bubble was dropped on the bin. */
  onDropDelete: ((kind: "thread" | "group", id: string) => void) | null = null;
  /** What shares context with a thread — the web asks this when it opens. */
  relatedFor: ((id: string) => Related[]) | null = null;

  private bin: HTMLElement;
  private web: ContextWeb;
  private pulse = 0;
  private placeQueued = false;
  private groupDrag: { id: string; dx: number; dy: number; pid: number; sx: number; sy: number; moved: boolean; node: boolean } | null = null;
  private cardDrag: { id: string; pid: number; sx: number; sy: number; ox: number; oy: number; lifted: boolean; onHead: boolean; wasActive: boolean } | null = null;
  /**
   * A corner being dragged. `x`/`y` are where the surface started (stage-centre
   * offsets), so a left or top corner can move the surface while it grows and
   * the opposite corner stays where it was.
   */
  private sizeDrag: {
    kind: "thread" | "group"; id: string; pid: number; sx: number; sy: number;
    w: number; h: number; ex: number; ey: number; x?: number; y?: number;
  } | null = null;
  private sizer = new ResizeObserver(() => this.queuePlace());
  private stick = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const b = target as HTMLElement;
      if (b.dataset.pinned !== "0") b.scrollTop = b.scrollHeight;
    }
  });
  /**
   * Phone: the order you've dragged the list into (thread ids). Anything newer
   * than that order goes on top, newest first.
   */
  private phoneOrder: string[] = (() => {
    try {
      const v = JSON.parse(recall("jarvis.phoneOrder") ?? "[]") as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch { return []; }
  })();
  /** The thread last brought to the top for being the active one. */
  private raisedFor = "";
  /** Threads already on the board, so a new one can be scrolled to on a phone. */
  private known: Set<string> | null = null;
  /** Phone: a thread being given a height of its own by the grip at its bottom. */
  private phoneSize: { id: string; pid: number; sy: number; h0: number } | null = null;
  /** Phone: a thread being dragged up or down the list by its title bar. */
  private phoneDrag: {
    id: string; pid: number; sy: number; scroll0: number; moved: boolean; wasActive: boolean;
    list: HTMLElement; index: number; target: number; h: number;
  } | null = null;
  /** While a window is carried: where the pointer is, and what it would drop on. */
  private hitAt: { x: number; y: number; id: string } | null = null;
  private hitQueued = false;
  private dropCard: string | null = null;
  private dropGroup: string | null = null;

  constructor(root: HTMLElement, canvas: HTMLCanvasElement, layer: HTMLElement) {
    this.root = root;
    this.canvas = canvas;
    this.layer = layer;
    const c = canvas.getContext("2d");
    if (!c) throw new Error("no 2d context");
    this.ctx = c;

    this.bin = document.createElement("div");
    this.bin.className = "bin";
    this.bin.hidden = true;
    this.bin.innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">` +
      `<path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 12.2h9l1-12.2M10 10.5v6M14 10.5v6"/></svg><span>Drop to delete</span>`;
    root.append(this.bin);

    this.web = new ContextWeb({
      root,
      thread: (id) => this.ws.thread(id),
      hueOf: (t) => { const c = t.color ?? this.hueOf(this.ws.groupOf(t)); return /^#[0-9a-f]{6}$/i.test(c) ? c : THREAD_HUES[0]; },
      related: (id) => this.relatedFor?.(id) ?? [],
      board: () => ({ top: HEADER_H + this.inset.top + 8, bottom: this.floor - DECK_H - 24 }),
      pick: (id) => { this.focus(id); this.reveal(id); },
    });

    this.ws = new Workspace(this.load());
    this.resize();
    this.anchorToCorner();
    this.save();
    new ResizeObserver(() => { this.resize(); this.place(); }).observe(root);
    // A phone's list shares its height by what each thread holds (fitList):
    // measured again whenever anything in the list changes or finishes loading.
    new MutationObserver(() => this.scheduleFit()).observe(layer, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden"] });
    layer.addEventListener("load", () => this.scheduleFit(), true);

    root.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => this.onUp(e));
    root.addEventListener("dblclick", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".chatwin");
      if (card) { this.openWeb(card.dataset.id!); return; }
      if (this.compact || (e.target as HTMLElement).closest(".bubble, .cmd, .panel, .deck, .topbar")) return;
      if (this.onCore(e.clientX, e.clientY)) return;
      this.onNewThread?.(GENERAL_ID);
    });

    this.renderAll();
    // Every frame while something moves; every other frame at rest — the
    // breathing is slow, and half the drawing is half the battery on a phone.
    let skip = false;
    const frame = (t: number): void => {
      const resting = this.activity === "idle" && this.pulse <= 0 && !this.cardDrag && !this.groupDrag && !this.sizeDrag && !this.phoneDrag;
      skip = resting && !skip;
      if (!skip) this.draw(t);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* ---------------- persistence ---------------- */

  /**
   * The saved workspace, or the older flat list of threads brought forward.
   * The old key is left untouched, so nothing is ever lost to a migration.
   */
  private load() {
    try {
      const raw = recall(STORE_KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch { /* corrupt — fall through to the older save */ }
    try {
      const legacy = recall("jarvis.threads");
      if (legacy) return migrate(JSON.parse(legacy), recall("jarvis.activeThread"));
    } catch { /* nothing usable */ }
    return migrate(null);
  }

  save(): void {
    const json = JSON.stringify(this.ws.data);
    this.onSaved?.(store(STORE_KEY, json), json.length);
    this.paintRoom();
  }

  /** Whether the board is clear (styles.css draws the clean screen). Kept current on every save. */
  private paintRoom(): void {
    this.root.classList.toggle("clear", this.ws.empty);
  }

  /**
   * Older saves measured positions from the stage centre, so every window
   * slid about whenever the screen changed width. Measure from the top-left
   * corner instead — as the instrument panels do — converting once, where
   * things are on this screen now.
   */
  private anchorToCorner(): void {
    const d = this.ws.data;
    if (d.anchor === "corner") return;
    const dx = Math.round((this.w || this.root.clientWidth) / 2), dy = Math.round((this.h || this.root.clientHeight) / 2);
    for (const p of [...d.groups, ...d.threads]) {
      if (p.x !== undefined) p.x += dx;
      if (p.y !== undefined) p.y += dy;
    }
    d.anchor = "corner";
  }

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

  parentOf(t: Thread): Thread | null {
    return this.ws.parentOf(t) ?? null;
  }

  /** Name a thread after the subject of its first question, not the instruction. */
  titleFrom(text: string, id = this.ws.activeId): void {
    const t = this.ws.thread(id);
    if (!t || t.named) return;
    // Name it for its subject: "What is the latest on the Baltic cable damage?"
    // becomes "Baltic cable damage", "show me images of the Eagle S" becomes
    // "Eagle S".
    let name = text
      // greetings and his name, however many of them open the sentence
      .replace(/^(?:(?:ok(?:ay)?|so|please|jarvis|hey|hi|hello|good (?:morning|afternoon|evening))[,!.\s]+)+/gi, "")
      .replace(/^(?:can you|could you|would you|please)\s+/i, "")
      .replace(/^(?:show|find|get|give|bring)(?:\s+me)?\s+(?:some\s+)?(?:images?|pictures?|photos?|videos?|clips?|footage)\s+(?:of|about|on|from)\s+/i, "")
      .replace(/^(?:what(?:'s| is| are)|tell me|give me)\s+(?:the\s+)?(?:latest(?:\s+news)?|news|updates?|current situation|state of play)\s+(?:on|about|with|in|regarding)\s+/i, "")
      .replace(/^(?:what(?:'s| is)\s+(?:happening|going on)|what happened)\s+(?:with|in|to|at|on)\s+/i, "")
      .replace(/^(?:search(?:\s+for)?|find(?:\s+me)?(?:\s+on\s+(?:the\s+)?internet)?|look\s+up|tell\s+me(?:\s+about)?|google)\s+/i, "")
      .replace(/^the\s+/i, "")
      .replace(/[.?!]+$/, "")
      .trim() || text;
    if (!/[\p{L}\p{N}]/u.test(name)) return; // nothing to name it after yet
    name = name.charAt(0).toUpperCase() + name.slice(1);
    t.title = name.length > 30 ? `${name.slice(0, 28).trim()}…` : name;
    t.named = true;
    // only a stand-in: JARVIS names it properly with his first answer (ask.ts)
    t.provisional = true;
    this.save();
    this.paintHead(t);
    this.onChange?.();
  }

  /**
   * Tidy the board: every thread is folded to its title bar, then everything
   * is seated by the plan in tidy.ts — one column down the middle, more to a
   * row when one is too tall, widths coming down only when a row is too wide.
   */
  tidy(): { seated: number } {
    if (this.compact) return { seated: 0 }; // a phone's board is already a list
    const hold = [...this.cards.values(), ...this.bubbles.values()].map((x) => x.el);
    // Measured with their easing held, or a window still changing size would
    // be measured at the size it is leaving.
    for (const el of hold) el.classList.add("sizing");
    const THREAD_MIN_W = 260; // a folded title bar still shows its name and buttons

    // Fold, give back what an earlier tidy took, and measure what's left.
    for (const t of this.ws.live) {
      if (this.ws.isOpen(t)) this.ws.setOpen(t.id, false);
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

    const plan = planTidy(items, this.room);
    items.forEach((it, i) => {
      if (plan.widths[i]! < it.w) it.fit(plan.widths[i]!);
      it.place(plan.seats[i]!.x, plan.seats[i]!.y);
    });
    this.commit();
    requestAnimationFrame(() => { for (const el of hold) el.classList.remove("sizing"); });
    return { seated: items.length };
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
   * after messages were taken out of it (cleared, or moved to a thread of
   * their own). A window otherwise redraws only when its history grows or
   * shrinks from what it last drew, which a removal can happen to match.
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
    // Every corner resets on a double-click, as each one's tooltip promises.
    el.querySelector(".cw-grip-m")?.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const th = this.ws.thread(t.id);
      if (!th?.mh) return;
      delete th.mh;
      this.save();
      this.scheduleFit();
    });
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
      const cap = Math.min(g.size?.h ?? Infinity, g.fit?.h || Infinity);
      b.list.style.maxHeight = cap === Infinity ? "" : `${Math.round(cap)}px`;
      b.el.classList.add("sized");
    } else {
      b.el.style.width = "";
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
      phase: Math.random() * Math.PI * 2,
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
      const members = this.phoneSorted(this.ws.treeOrder(g.id));
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
    this.paintRoom();
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

  /** On a phone: the order you dragged threads into, with anything newer on top, newest first. */
  private phoneSorted(list: Thread[]): Thread[] {
    if (!this.compact) return list;
    const rank = new Map(this.phoneOrder.map((id, i) => [id, i] as const));
    return [...list].sort((a, b) => {
      const ra = rank.get(a.id), rb = rank.get(b.id);
      if (ra === undefined && rb === undefined) return b.createdAt - a.createdAt;
      if (ra === undefined) return -1;
      if (rb === undefined) return 1;
      return ra - rb;
    });
  }

  /** Phone: follow a thread being dragged up or down its list; the others make way. */
  private movePhoneDrag(e: PointerEvent): void {
    const d = this.phoneDrag!;
    const c = this.cards.get(d.id);
    if (!c) return;
    if (!d.moved) {
      if (Math.abs(e.clientY - d.sy) < 8) return;
      d.moved = true;
      const all = this.phoneCards(d.list);
      d.index = d.target = all.indexOf(c.el);
      d.h = c.el.offsetHeight + (parseFloat(getComputedStyle(d.list).rowGap) || 8);
      c.el.classList.add("reordering");
      d.list.classList.add("reorder");
      this.root.classList.add("carrying");
    }
    // Near the top or bottom of the list, it scrolls along.
    const box = this.layer.getBoundingClientRect();
    if (e.clientY < box.top + 48) this.layer.scrollTop -= 12;
    else if (e.clientY > this.coreFloor - 24) this.layer.scrollTop += 12;
    const dy = e.clientY - d.sy + (this.layer.scrollTop - d.scroll0);
    c.el.style.transform = `translateY(${Math.round(dy)}px)`;
    // Where it would land: past the middle of each neighbour it has crossed.
    const all = this.phoneCards(d.list);
    const mid = c.el.offsetTop + c.el.offsetHeight / 2 + dy;
    d.target = all.filter((el) => el !== c.el && el.offsetTop + el.offsetHeight / 2 < mid).length;
    all.forEach((el, j) => {
      if (el === c.el) return;
      const shift = j > d.index && j <= d.target ? -d.h : j < d.index && j >= d.target ? d.h : 0;
      el.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  }

  private phoneCards(list: HTMLElement): HTMLElement[] {
    return ([...list.children] as HTMLElement[]).filter((el) => el.classList.contains("chatwin"));
  }

  /** Phone: let go of a thread — a tap folds or focuses it, a drag puts it where it was heading. */
  private endPhoneDrag(): void {
    const d = this.phoneDrag!;
    this.phoneDrag = null;
    const t = this.ws.thread(d.id);
    if (!t) return;
    if (!d.moved) {
      if (!d.wasActive) this.focus(t.id);
      else { this.ws.setOpen(t.id, !this.ws.isOpen(t)); this.commit(); }
      return;
    }
    const all = this.phoneCards(d.list);
    const ids = all.map((el) => el.dataset.id ?? "").filter((id) => id && id !== d.id);
    ids.splice(d.target, 0, d.id);
    // no easing back: the list is simply redrawn in its new order
    d.list.classList.remove("reorder");
    for (const el of all) el.style.transform = "";
    this.cards.get(d.id)?.el.classList.remove("reordering");
    this.root.classList.remove("carrying");
    this.phoneOrder = [...ids, ...this.phoneOrder.filter((id) => !ids.includes(id))];
    store("jarvis.phoneOrder", JSON.stringify(this.phoneOrder));
    if (!d.wasActive) this.ws.focus(t.id);
    this.commit();
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

  /* ---------------- placing bubbles ---------------- */

  private queuePlace(): void {
    if (this.placeQueued) return;
    this.placeQueued = true;
    requestAnimationFrame(() => { this.placeQueued = false; this.place(); });
  }

  /**
   * Where the core is drawn: the middle of the deck at the bottom, always. He
   * is the console's one fixed point — the board arranges itself around him
   * instead of him getting out of its way.
   */
  private core(): { cx: number; cy: number } {
    // Sitting in the deck, rising a little above it.
    return { cx: this.w / 2, cy: this.floor - CORE_R - CORE_BOTTOM_GAP };
  }

  /** Stage bounds the board must stay inside: the whole stage above the deck. */
  private get bounds(): { top: number; bottom: number; left: number; right: number } {
    // the same 16px edge margin as the title row, the deck and the panels (--edge)
    return { top: HEADER_H + this.inset.top + 4, bottom: this.floor - DECK_H - 8, left: 16, right: this.w - 16 };
  }

  /**
   * The top of the space kept clear above JARVIS: his ring rises above the
   * deck, and his status line and notices sit just over it. Anything in his
   * column stops here, so nothing on the board ever covers him.
   */
  private get coreFloor(): number {
    const { cy } = this.core();
    return cy - (CORE_R * (DESIGN_R + 8)) / DESIGN_R - CORE_STATUS_ROOM;
  }

  /** The board as the geometry sees it: its edges, and the column kept clear above JARVIS. */
  private get room(): Room {
    return { bounds: this.bounds, cx: this.core().cx, coreZone: CORE_ZONE, coreFloor: this.coreFloor };
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
    this.placeLabel();
    if (this.compact) {
      for (const b of this.bubbles.values()) { b.el.style.transform = ""; b.el.classList.remove("unplaced"); }
      this.boxes.clear();
      this.scheduleFit();
      return;
    }
    if (this.fitted) this.fitList(); // back on a wide screen: the phone's limits come off
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
      const r = this.seat(w, h, [...placed.map((p) => p.r), ...loose, ...this.panelObstacles()]);
      g.x = Math.round(r.x);
      g.y = Math.round(r.y);
      placed.push({ id: g.id, b, r, here: b.el.classList.contains("here") });
      seated = true;
    }
    // Reflow only newly seated groups. A manual resize must never shove other
    // conversations down the board; their saved positions remain their own.
    if (seated) this.separate(placed);
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
        r = this.seat(w, h, [...taken, ...this.panelObstacles()]);
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

  /** Nudge overlapping bubbles apart for display; the one you're working in stays still. */
  private separate(placed: { r: Rect; here: boolean }[]): void {
    separate(placed, this.room);
  }

  /** A free seat begins in the board's centre, then works outward. */
  private seat(w: number, h: number, taken: Rect[]): Rect {
    return seat(w, h, taken, this.room);
  }

  /**
   * Publish where the core is, so the glow and the layout can follow it:
   *   --status-y   the one line just above JARVIS where everything he says in
   *                passing appears — his status word, a notice, the bin;
   *   --core-clear how far up from the bottom anything opening over the deck
   *                must stop so it never covers him.
   */
  private placeLabel(): void {
    const { cx, cy } = this.core();
    const s = this.root.style;
    // His outermost ring.
    const coreTop = cy - (CORE_R * (DESIGN_R + 8)) / DESIGN_R;
    s.setProperty("--core-x", `${cx}px`);
    s.setProperty("--core-y", `${cy}px`);
    s.setProperty("--deck-h", `${DECK_H + this.inset.bottom}px`); // the deck grows by the inset, so its buttons keep their place beside the core
    s.setProperty("--status-y", `${Math.round(coreTop - 10)}px`);
    s.setProperty("--core-clear", `${Math.round(this.h - coreTop + 8)}px`);
  }

  private onCore(clientX: number, clientY: number): boolean {
    const r = this.root.getBoundingClientRect();
    const { cx, cy } = this.core();
    return Math.hypot(clientX - r.left - cx, clientY - r.top - cy) <= CORE_R + 14;
  }

  /* ---------------- the web: what else is about this ---------------- */

  openWeb(id: string): void { this.web.open(id); }
  closeWeb(): boolean { return this.web.close(); }
  get webOpen(): boolean { return this.web.isOpen; }


  /* ---------------- phone: threads share the list's height ---------------- */

  /** A thread with anything in it keeps at least this much of the list (its title bar and a few lines). */
  private static readonly PHONE_MIN = 150;
  private fitPending = 0;
  private fitted = false;

  private scheduleFit(): void {
    if (this.fitPending) return;
    const run = (): void => { this.fitPending = 0; this.fitList(); };
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
   * minimums the list scrolls.
   */
  private fitList(): void {
    if (!this.compact) {
      if (!this.fitted) return;
      for (const c of this.cards.values()) { c.el.style.maxHeight = ""; c.el.style.minHeight = ""; }
      for (const b of this.bubbles.values()) { b.el.style.maxHeight = ""; b.el.style.minHeight = ""; }
      this.fitted = false;
      return;
    }
    this.fitted = true;
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
    for (const [id, c] of this.cards) {
      if (c.el.offsetHeight === 0) continue; // not shown
      const t = this.ws.thread(id);
      if (t?.mh && this.ws.isOpen(t)) { cards.set(c.el, { max: t.mh, min: t.mh }); continue; } // a height of the reader's own
      const chrome = c.el.offsetHeight - c.body.offsetHeight; // title bar, borders, padding
      const max = Math.ceil(chrome + held(c.body));
      cards.set(c.el, { max, min: Math.min(Stage.PHONE_MIN, max) });
    }
    const groups = new Map<HTMLElement, { max: number; min: number } | null>();
    for (const b of this.bubbles.values()) {
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

  /** On a phone, bring the window in front into view in the list. */
  reveal(id = this.ws.activeId): void {
    if (!this.compact) return;
    this.cards.get(id)?.el.scrollIntoView({ block: "nearest" });
  }

  /* ---------------- pointer ---------------- */

  private onDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest(".web")) return;
    const overUi = target.closest(".bubble, .cmd, .panel, .deck, .topbar");

    // JARVIS himself: the one control that is always in the same place.
    if (!overUi && this.onCore(e.clientX, e.clientY)) { e.preventDefault(); this.onCoreTap?.(); return; }

    // Whatever you touch comes to the top — above other threads and panels.
    const surface = target.closest<HTMLElement>(".chatwin, .bubble:not(.loose)");
    if (surface?.dataset.id) this.raise(surface.dataset.id);
    else if (surface?.dataset.gid) raise(stackKey.group(surface.dataset.gid));

    // A phone follows the desktop's rules, with taps for clicks: tap a window
    // to bring it forward, tap the title bar of the one you're in to fold it
    // or open it again, tap a group's name to fold or open the group.
    if (this.compact) {
      if (target.closest("button")) return;
      const card = target.closest<HTMLElement>(".chatwin");
      if (card) {
        const t = this.ws.thread(card.dataset.id);
        if (!t) return;
        // The title bar: a tap folds or focuses it (on release), a drag moves it
        // up or down the list.
        if (target.closest(".cw-head") && card.parentElement) {
          this.phoneDrag = {
            id: t.id, pid: e.pointerId, sy: e.clientY, scroll0: this.layer.scrollTop, moved: false,
            wasActive: t.id === this.ws.activeId, list: card.parentElement, index: 0, target: 0, h: 0,
          };
          return;
        }
        if (target.closest(".cw-grip-m")) {
          this.phoneSize = { id: t.id, pid: e.pointerId, sy: e.clientY, h0: card.offsetHeight };
          card.classList.add("sizing");
          e.preventDefault();
          return;
        }
        if (t.id !== this.ws.activeId) this.focus(t.id);
        return;
      }
      const bub = target.closest<HTMLElement>(".bubble");
      const g = bub ? this.ws.group(bub.dataset.gid) : undefined;
      if (g && g.id !== GENERAL_ID && target.closest(".bb-head, .bb-node")) this.setFolded(g.id, !g.collapsed);
      return;
    }

    // A corner: resize the window, or the bubble.
    const grip = target.closest<HTMLElement>(".cw-grip, .bb-grip");
    if (grip) {
      const corner = grip.dataset.corner ?? "se";
      // a corner moves on both axes, an edge on one: w/e horizontally, n/s vertically
      const ex = corner.includes("w") ? -1 : corner.includes("e") ? 1 : 0;
      const ey = corner.includes("n") ? -1 : corner.includes("s") ? 1 : 0;
      if (grip.classList.contains("bb-grip")) {
        const bub = grip.closest<HTMLElement>(".bubble")!;
        const b = this.bubbles.get(bub.dataset.gid!);
        const g = this.ws.group(bub.dataset.gid);
        if (!b || !g) return;
        const box = this.boxes.get(g.id);
        this.sizeDrag = {
          kind: "group", id: g.id, pid: e.pointerId, sx: e.clientX, sy: e.clientY,
          w: b.el.offsetWidth, h: b.list.offsetHeight, ex, ey,
          ...(box ? { x: box.x, y: box.y } : {}),
        };
        bub.classList.add("sizing");
      } else {
        const card = grip.closest<HTMLElement>(".chatwin")!;
        const c = this.cards.get(card.dataset.id!);
        const t = this.ws.thread(card.dataset.id);
        // Only a loose window is sized by hand; one inside a group takes the
        // group's width, and it is the group that is resized.
        if (!c || !t || t.groupId !== GENERAL_ID) return;
        this.sizeDrag = {
          kind: "thread", id: t.id, pid: e.pointerId, sx: e.clientX, sy: e.clientY,
          w: c.el.offsetWidth, h: c.body.offsetHeight, ex, ey, x: c.el.offsetLeft, y: c.el.offsetTop,
        };
        card.classList.add("sizing");
      }
      e.preventDefault();
      return;
    }

    // A bubble, by its name bar or — folded — by the orb itself.
    const bubEl = target.closest<HTMLElement>(".bubble");
    const onHead = target.closest(".bb-head") && !target.closest("button");
    const onNode = target.closest(".bb-node");
    if (bubEl && (onHead || onNode)) {
      const g = this.ws.group(bubEl.dataset.gid);
      if (!g) return;
      const box = bubEl.getBoundingClientRect();
      // Nothing is written to the group until the pointer actually travels —
      // a click on the name must not nudge the bubble.
      this.groupDrag = {
        id: g.id, dx: box.left - e.clientX, dy: box.top - e.clientY,
        pid: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, node: !!onNode,
      };
      e.preventDefault();
      return;
    }

    // A thread window: click to bring it forward, its title bar to fold it,
    // and drag that bar to move or group it.
    const card = target.closest<HTMLElement>(".chatwin");
    if (!card || target.closest(".cw-x, .cw-del, .cw-b, .cw-w")) return;
    const id = card.dataset.id!;
    const wasActive = id === this.ws.activeId;
    if (!wasActive) this.focus(id);
    const onCardHead = !!target.closest(".cw-head");
    const box = card.getBoundingClientRect();
    this.cardDrag = {
      id, pid: e.pointerId, sx: e.clientX, sy: e.clientY,
      ox: e.clientX - box.left, oy: e.clientY - box.top, lifted: false, onHead: onCardHead, wasActive,
    };
    if (onCardHead) e.preventDefault();
  }

  private onMove(e: PointerEvent): void {
    if (this.phoneDrag && e.pointerId === this.phoneDrag.pid) { this.movePhoneDrag(e); return; }
    if (this.phoneSize && e.pointerId === this.phoneSize.pid) {
      const d = this.phoneSize;
      const t = this.ws.thread(d.id);
      const c = this.cards.get(d.id);
      if (!t || !c) return;
      // no smaller than its title bar and a line or two, no taller than the list itself
      const room = this.layer.clientHeight - Stage.PHONE_MIN;
      t.mh = Math.round(Math.max(110, Math.min(room, d.h0 + (e.clientY - d.sy))));
      c.el.style.minHeight = c.el.style.maxHeight = `${t.mh}px`;
      return;
    }
    const r = this.root.getBoundingClientRect();
    if (this.sizeDrag && e.pointerId === this.sizeDrag.pid) {
      const d = this.sizeDrag;
      const size = {
        w: Math.max(MIN_W, Math.min(760, d.w + (e.clientX - d.sx) * d.ex)),
        // never taller than fits above JARVIS (title bar and frame take ~50px)
        h: Math.max(MIN_H, Math.min(this.coreFloor - this.bounds.top - 50, d.h + (e.clientY - d.sy) * d.ey)),
      };
      // Dragging a left or top corner moves that edge; the opposite one stays put.
      const x = d.x === undefined ? undefined : Math.round(d.x - (d.ex < 0 ? size.w - d.w : 0));
      const y = d.y === undefined ? undefined : Math.round(d.y - (d.ey < 0 ? size.h - d.h : 0));
      if (d.kind === "group") {
        const g = this.ws.group(d.id);
        if (!g) return;
        g.size = size;
        delete g.fit;
        if (x !== undefined) g.x = x;
        if (y !== undefined) g.y = y;
        this.applyGroupSize(d.id);
      } else {
        const t = this.ws.thread(d.id);
        if (!t) return;
        t.size = size;
        delete t.fit;
        if (x !== undefined) t.x = x;
        if (y !== undefined) t.y = y;
        this.applySize(d.id);
      }
      if (d.ex < 0 || d.ey < 0) this.place();
      return;
    }
    if (this.groupDrag && e.pointerId === this.groupDrag.pid) {
      const d = this.groupDrag;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
      if (!d.moved) { this.showBin(true); this.bubbles.get(d.id)?.el.classList.add("dragging"); }
      d.moved = true;
      const g = this.ws.group(d.id);
      if (!g) return;
      g.x = Math.round(e.clientX + d.dx - r.left);
      g.y = Math.round(e.clientY + d.dy - r.top);
      this.overBin(e.clientX, e.clientY);
      this.place();
      return;
    }
    if (this.cardDrag && e.pointerId === this.cardDrag.pid) {
      const d = this.cardDrag;
      const c = this.cards.get(d.id);
      if (!c) return;
      if (!d.lifted) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 7) return;
        d.lifted = true;
        c.el.classList.add("lifted");
        // Carried where it is, by a transform. Moving the window to another
        // parent would reload anything in it — a video would stop and restart.
        c.el.closest(".bubble")?.classList.add("carrying");
        this.root.classList.add("carrying");
        this.showBin(true);
      }
      c.el.style.transform = `translate(${Math.round(e.clientX - d.sx)}px, ${Math.round(e.clientY - d.sy)}px)`;
      // What it would land on — another thread (making a group), a bubble, the
      // bin — is worked out once a frame, not on every pointer event: measuring
      // every window that often makes a heavy one (a playing video) stutter.
      this.hitAt = { x: e.clientX, y: e.clientY, id: d.id };
      if (!this.hitQueued) {
        this.hitQueued = true;
        requestAnimationFrame(() => {
          this.hitQueued = false;
          const h = this.hitAt;
          if (!h || !this.cardDrag) return;
          const ontoCard = this.cardAt(h.x, h.y, h.id);
          const over = ontoCard ? null : this.bubbleAt(h.x, h.y);
          const dropGroup = over && over !== this.ws.thread(h.id)?.groupId ? over : null;
          if (ontoCard !== this.dropCard) {
            if (this.dropCard) this.cards.get(this.dropCard)?.el.classList.remove("drop");
            if (ontoCard) this.cards.get(ontoCard)?.el.classList.add("drop");
            this.dropCard = ontoCard;
          }
          if (dropGroup !== this.dropGroup) {
            if (this.dropGroup) this.bubbles.get(this.dropGroup)?.el.classList.remove("drop");
            if (dropGroup) this.bubbles.get(dropGroup)?.el.classList.add("drop");
            this.dropGroup = dropGroup;
          }
          this.overBin(h.x, h.y);
        });
      }
      return;
    }
    // JARVIS is a button, and says so under the pointer.
    const t = e.target as HTMLElement | null;
    if (t instanceof Element && this.root.contains(t) && !t.closest(".bubble, .cmd, .panel, .web, .deck, .topbar")) {
      this.root.style.cursor = this.onCore(e.clientX, e.clientY) ? "pointer" : "";
    }
  }

  private onUp(e: PointerEvent): void {
    if (this.phoneDrag && e.pointerId === this.phoneDrag.pid) { this.endPhoneDrag(); return; }
    if (this.phoneSize && e.pointerId === this.phoneSize.pid) {
      this.cards.get(this.phoneSize.id)?.el.classList.remove("sizing");
      this.phoneSize = null;
      this.save();
      this.scheduleFit();
      return;
    }
    if (this.sizeDrag && e.pointerId === this.sizeDrag.pid) {
      const d = this.sizeDrag;
      (d.kind === "group" ? this.bubbles.get(d.id)?.el : this.cards.get(d.id)?.el)?.classList.remove("sizing");
      this.sizeDrag = null;
      this.commit();
      return;
    }
    if (this.groupDrag && e.pointerId === this.groupDrag.pid) {
      const d = this.groupDrag;
      this.groupDrag = null;
      this.bubbles.get(d.id)?.el.classList.remove("dragging");
      const binned = d.moved && this.overBin(e.clientX, e.clientY);
      this.showBin(false);
      if (binned) { this.onDropDelete?.("group", d.id); return; }
      if (!d.moved && d.node) { this.setFolded(d.id, false); return; }
      this.save();
      return;
    }
    if (this.cardDrag && e.pointerId === this.cardDrag.pid) {
      const d = this.cardDrag;
      this.cardDrag = null;
      const c = this.cards.get(d.id);
      for (const b of this.bubbles.values()) b.el.classList.remove("drop");
      for (const x of this.cards.values()) x.el.classList.remove("drop");
      this.hitAt = null; this.dropCard = null; this.dropGroup = null;
      if (!c) { this.showBin(false); return; }

      // The first click on an inactive card only focuses it. Folding is a
      // separate, deliberate second click on the active title bar.
      if (!d.lifted) {
        this.showBin(false);
        if (!d.onHead || !d.wasActive) return;
        const t = this.ws.thread(d.id);
        if (!t) return;
        this.ws.setOpen(t.id, !this.ws.isOpen(t));
        this.commit();
        return;
      }

      // Put down without a glide back from where it was carried: the move to
      // its new seat below is instant, then transitions come back.
      c.el.classList.add("settling");
      c.el.classList.remove("lifted");
      c.el.style.transform = "";
      c.el.closest(".bubble")?.classList.remove("carrying");
      this.root.classList.remove("carrying");
      requestAnimationFrame(() => requestAnimationFrame(() => c.el.classList.remove("settling")));
      const binned = this.overBin(e.clientX, e.clientY);
      this.showBin(false);
      const t = this.ws.thread(d.id);
      if (!t) { this.renderAll(); return; }
      if (binned) { this.renderAll(); this.onDropDelete?.("thread", t.id); return; }

      const ontoCard = this.cardAt(e.clientX, e.clientY, d.id);
      const over = this.bubbleAt(e.clientX, e.clientY);
      const dropAt = (): void => {
        const r = this.root.getBoundingClientRect();
        const shown = this.shown({
          x: e.clientX - r.left - d.ox,
          y: e.clientY - r.top - d.oy,
          w: c.el.offsetWidth,
          h: c.el.offsetHeight,
        });
        t.x = Math.round(shown.x);
        t.y = Math.round(shown.y);
      };
      if (this.onCore(e.clientX, e.clientY)) {
        // Dropped on JARVIS himself: out of its group, loose on the board.
        this.ws.moveThread(t.id, GENERAL_ID);
        delete t.x; delete t.y;
      } else if (ontoCard) {
        // Dropped on another thread: the two of them become a group.
        const g = this.ws.groupThreads(t.id, ontoCard);
        if (g && (g.x === undefined || g.y === undefined)) {
          const box = this.cards.get(ontoCard)?.el.getBoundingClientRect();
          const r = this.root.getBoundingClientRect();
          if (box) { g.x = Math.round(box.left - r.left - 12); g.y = Math.round(Math.max(this.bounds.top, box.top - r.top - 46)); }
        }
      } else if (over && over !== t.groupId) {
        this.ws.moveThread(t.id, over);
      } else if (!over) {
        // Open space: it becomes (or stays) an independently placed window.
        this.ws.moveThread(t.id, GENERAL_ID);
        dropAt();
      }
      this.commit();
    }
  }

  /** The bin rises while something is being carried. */
  private showBin(on: boolean): void {
    this.bin.hidden = !on;
    this.bin.classList.toggle("in", on);
    if (!on) this.bin.classList.remove("hot");
  }

  private overBin(x: number, y: number): boolean {
    if (this.bin.hidden) return false;
    const r = this.bin.getBoundingClientRect();
    const over = x >= r.left - 30 && x <= r.right + 30 && y >= r.top - 30 && y <= r.bottom + 30;
    this.bin.classList.toggle("hot", over);
    return over;
  }

  /** The thread window under a point, ignoring the one being carried. */
  private cardAt(x: number, y: number, except: string): string | null {
    // The browser's own hit test: one call, and it answers with the window
    // actually on top there, not whichever happens to be listed first.
    for (const el of document.elementsFromPoint(x, y)) {
      const card = (el as HTMLElement).closest<HTMLElement>(".chatwin");
      if (!card || card.classList.contains("lifted")) continue;
      const id = card.dataset.id ?? "";
      return id && id !== except && this.cards.has(id) ? id : null;
    }
    return null;
  }

  /** The bubble under a point, if any. */
  private bubbleAt(x: number, y: number): string | null {
    for (const [gid, b] of this.bubbles) {
      if (gid === GENERAL_ID) continue;
      const r = b.el.getBoundingClientRect();
      if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) return gid;
    }
    return null;
  }

  /* ---------------- canvas ---------------- */

  /**
   * The phone's own bars over the page's edges — the clock and the gesture
   * bar — where the page is drawn under them (viewport-fit=cover). Two empty
   * elements the size of each inset are measured, since the canvas can't
   * read env() itself.
   */
  private inset = { top: 0, bottom: 0 };
  /** Where the usable stage ends at the bottom: above the gesture bar, when there is one. */
  private get floor(): number { return this.h - this.inset.bottom; }

  private resize(): void {
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

  private draw(t: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const { cx, cy } = this.core();

    const amp = Math.max(0, Math.min(1, this.amplitude));
    const idle = this.activity === "idle";
    const spin = reduceMotion ? 0 : idle ? 0.12 : this.activity === "thinking" ? 1 : 0.55 + amp * 1.6;

    const fields = this.ws.visibleGroups.slice(0, 4).map((g) => {
      const box = this.boxes.get(g.id);
      return { hue: this.hueOf(g), hx: box ? box.x + box.w / 2 : cx, hy: box ? box.y + box.h / 2 : cy };
    });
    drawAurora(ctx, t, cx, cy, amp, fields);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(CORE_R / DESIGN_R, CORE_R / DESIGN_R);
    drawCore(ctx, t * spin, t, amp, idle, {
      activity: this.activity, cpuLoad: this.cpuLoad, gpuLoad: this.gpuLoad, pulse: this.pulse,
    });
    ctx.restore();
    if (this.pulse > 0) this.pulse -= 0.02;
  }


}



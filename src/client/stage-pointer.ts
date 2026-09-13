/**
 * Carrying, sizing and dropping on the desktop board. Every box — a window,
 * a bubble — is carried, sized and folded the way every box on the board is
 * (surface.ts); what is particular to the stage is what a drop means: on
 * another window, a group; on a bubble, membership; on the bin, deletion;
 * on JARVIS, out of its group. The stage decides what was pressed and hands
 * the press here.
 */

import type { Rect, Room } from "./board-geometry.js";
import { gestures, resized, sidesOf, sizeLimits } from "./surface.js";
import type { Card, Bubble } from "./stage.js";
import { GENERAL_ID, type Workspace } from "./workspace.js";

/** What the pointer needs of the stage. */
export interface PointerHost {
  root: HTMLElement;
  ws: Workspace;
  card(id: string): Card | undefined;
  cards(): Iterable<[string, Card]>;
  bubble(gid: string): Bubble | undefined;
  bubbles(): Iterable<[string, Bubble]>;
  /** Where a bubble is actually drawn, in stage pixels. */
  boxOf(gid: string): Rect | undefined;
  room(): Room;
  /** Where a box is actually shown: inside the board, clear of the deck and of JARVIS. */
  shown(r: Rect): Rect;
  onCore(clientX: number, clientY: number): boolean;
  focus(id: string): void;
  commit(): void;
  save(): void;
  place(): void;
  renderAll(): void;
  setFolded(gid: string, folded: boolean): void;
  applySize(id: string): void;
  applyGroupSize(gid: string): void;
  /** A thread or a whole bubble was dropped on the bin. */
  dropDelete(kind: "thread" | "group", id: string): void;
}

export class BoardPointer {
  private readonly bin: HTMLElement;
  /** The window being carried right now, for the drop targets worked out each frame. */
  private carrying: string | null = null;
  /** While a window is carried: where the pointer is, and what it would drop on. */
  private hitAt: { x: number; y: number; id: string } | null = null;
  private hitQueued = false;
  private dropCard: string | null = null;
  private dropGroup: string | null = null;

  constructor(private readonly host: PointerHost) {
    this.bin = document.createElement("div");
    this.bin.className = "bin";
    this.bin.hidden = true;
    this.bin.innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">` +
      `<path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 12.2h9l1-12.2M10 10.5v6M14 10.5v6"/></svg><span>Drop to delete</span>`;
    host.root.append(this.bin);
    // JARVIS is a button, and says so under the pointer — the one thing watched between gestures.
    window.addEventListener("pointermove", (e) => this.cursorAt(e));
  }

  /** A window or a bubble sized from a corner or an edge, within the board's limits, the opposite side staying put. */
  size(e: PointerEvent, grip: HTMLElement): void {
    const sides = sidesOf(grip.dataset.corner ?? "se");
    const isGroup = grip.classList.contains("bb-grip");
    const el = grip.closest<HTMLElement>(isGroup ? ".bubble" : ".chatwin")!;
    const id = isGroup ? el.dataset.gid! : el.dataset.id!;
    const ws = this.host.ws;
    const t = isGroup ? undefined : ws.thread(id);
    const c = isGroup ? undefined : this.host.card(id);
    // Only a loose window is sized by hand; one inside a group takes the
    // group's width, and it is the group that is resized.
    if (!isGroup && (!t || !c || t.groupId !== GENERAL_ID)) return;
    const box = isGroup ? this.host.boxOf(id) : undefined;
    // What the drag sets: a bubble's own height; a window's body, with its
    // title bar on top of that.
    const start = isGroup
      ? { x: box?.x ?? 0, y: box?.y ?? 0, w: el.offsetWidth, h: el.offsetHeight }
      : { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: c!.body.offsetHeight };
    const lim = sizeLimits(this.host.room());
    if (!isGroup) lim.maxH = Math.max(lim.minH, lim.maxH - 50);
    el.classList.add("sizing");
    e.preventDefault();
    gestures.begin(e, {
      travel: 0,
      move: (_ev, dx, dy) => {
        const r = resized(start, sides, dx, dy, lim);
        if (isGroup) {
          const g = ws.group(id);
          if (!g) return;
          g.size = { w: r.w, h: r.h };
          delete g.fit;
          if (box) { g.x = Math.round(r.x); g.y = Math.round(r.y); }
          this.host.applyGroupSize(id);
        } else {
          t!.size = { w: r.w, h: r.h };
          delete t!.fit;
          t!.x = Math.round(r.x);
          t!.y = Math.round(r.y);
          this.host.applySize(id);
        }
        if (sides.ex < 0 || sides.ey < 0) this.host.place();
      },
      end: () => { el.classList.remove("sizing"); this.host.commit(); },
    });
  }

  /**
   * A bubble carried by its name bar — wherever the pointer takes it, over
   * the edge included, as a window is — and put down inside the board
   * (place → shown). A tap on the name bar folds it; a tap on the folded
   * orb opens it — as a thread's title bar folds and opens it.
   */
  carryGroup(e: PointerEvent, bubEl: HTMLElement, onNode: boolean): void {
    const g = this.host.ws.group(bubEl.dataset.gid);
    if (!g) return;
    const box = bubEl.getBoundingClientRect();
    const dx0 = box.left - e.clientX, dy0 = box.top - e.clientY;
    e.preventDefault();
    let lifted = false;
    gestures.begin(e, {
      travel: 5,
      move: (ev) => {
        if (!lifted) { lifted = true; this.showBin(true); bubEl.classList.add("dragging"); }
        const r = this.host.root.getBoundingClientRect();
        g.x = Math.round(ev.clientX + dx0 - r.left);
        g.y = Math.round(ev.clientY + dy0 - r.top);
        bubEl.style.transform = `translate3d(${g.x}px, ${g.y}px, 0)`;
        this.overBin(ev.clientX, ev.clientY);
      },
      end: (ev, moved) => {
        bubEl.classList.remove("dragging");
        const binned = moved && this.overBin(ev.clientX, ev.clientY);
        this.showBin(false);
        if (binned) { this.host.dropDelete("group", g.id); return; }
        if (!moved) { this.host.setFolded(g.id, !onNode); return; }
        this.host.place();
        this.host.save();
      },
    });
  }

  /**
   * A window: the first click on an inactive one only brings it forward;
   * the title bar of the one you're in folds it. Carried past a few pixels
   * it lifts, and where it is let go decides what happens (putDown).
   */
  carryCard(e: PointerEvent, card: HTMLElement, onHead: boolean): void {
    const id = card.dataset.id!;
    const wasActive = id === this.host.ws.activeId;
    if (!wasActive) this.host.focus(id);
    const box = card.getBoundingClientRect();
    const ox = e.clientX - box.left, oy = e.clientY - box.top;
    if (onHead) e.preventDefault();
    gestures.begin(e, {
      travel: 7,
      move: (ev, dx, dy) => {
        const c = this.host.card(id);
        if (!c) return;
        if (this.carrying !== id) {
          this.carrying = id;
          c.el.classList.add("lifted");
          // Carried where it is, by a transform. Moving the window to another
          // parent would reload anything in it — a video would stop and restart.
          c.el.closest(".bubble")?.classList.add("carrying");
          this.host.root.classList.add("carrying");
          this.showBin(true);
        }
        c.el.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
        // What it would land on — another thread (making a group), a bubble, the
        // bin — is worked out once a frame, not on every pointer event: measuring
        // every window that often makes a heavy one (a playing video) stutter.
        this.hitAt = { x: ev.clientX, y: ev.clientY, id };
        if (!this.hitQueued) {
          this.hitQueued = true;
          requestAnimationFrame(() => {
            this.hitQueued = false;
            const h = this.hitAt;
            if (!h || this.carrying !== h.id) return;
            const ontoCard = this.cardAt(h.x, h.y, h.id);
            const over = ontoCard ? null : this.bubbleAt(h.x, h.y);
            const dropGroup = over && over !== this.host.ws.thread(h.id)?.groupId ? over : null;
            if (ontoCard !== this.dropCard) {
              if (this.dropCard) this.host.card(this.dropCard)?.el.classList.remove("drop");
              if (ontoCard) this.host.card(ontoCard)?.el.classList.add("drop");
              this.dropCard = ontoCard;
            }
            if (dropGroup !== this.dropGroup) {
              if (this.dropGroup) this.host.bubble(this.dropGroup)?.el.classList.remove("drop");
              if (dropGroup) this.host.bubble(dropGroup)?.el.classList.add("drop");
              this.dropGroup = dropGroup;
            }
            this.overBin(h.x, h.y);
          });
        }
      },
      end: (ev, moved) => this.putDown(ev, id, moved, onHead, wasActive, ox, oy),
    });
  }

  /** What letting go of a window means: a fold, a new group, a new home, the bin, or a new seat. */
  private putDown(e: PointerEvent, id: string, moved: boolean, onHead: boolean, wasActive: boolean, ox: number, oy: number): void {
    const host = this.host, ws = host.ws;
    this.carrying = null;
    const c = host.card(id);
    for (const [, b] of host.bubbles()) b.el.classList.remove("drop");
    for (const [, x] of host.cards()) x.el.classList.remove("drop");
    this.hitAt = null; this.dropCard = null; this.dropGroup = null;
    if (!c) { this.showBin(false); return; }

    // The first click on an inactive card only focuses it. Folding is a
    // separate, deliberate second click on the active title bar.
    if (!moved) {
      this.showBin(false);
      if (!onHead || !wasActive) return;
      const t = ws.thread(id);
      if (!t) return;
      ws.setOpen(t.id, !ws.isOpen(t));
      host.commit();
      return;
    }

    // What it was let go over — judged while it is still lifted, so the hit
    // test passes over the carried window itself (it glides back afterwards,
    // and would otherwise be found under the pointer in its own place).
    const binned = this.overBin(e.clientX, e.clientY);
    const ontoCard = this.cardAt(e.clientX, e.clientY, id);
    const over = this.bubbleAt(e.clientX, e.clientY);
    // Let go: its carry (transform) and its place (left/top, set below) ease
    // back together over the same time, so from where it was dropped it glides
    // to where it is put down — as a bubble and a panel do.
    c.el.classList.remove("lifted");
    c.el.style.transform = "";
    c.el.closest(".bubble")?.classList.remove("carrying");
    host.root.classList.remove("carrying");
    this.showBin(false);
    const t = ws.thread(id);
    if (!t) { host.renderAll(); return; }
    if (binned) { host.renderAll(); host.dropDelete("thread", t.id); return; }

    const dropAt = (): void => {
      const r = host.root.getBoundingClientRect();
      const seat = host.shown({
        x: e.clientX - r.left - ox,
        y: e.clientY - r.top - oy,
        w: c.el.offsetWidth,
        h: c.el.offsetHeight,
      });
      t.x = Math.round(seat.x);
      t.y = Math.round(seat.y);
    };
    if (host.onCore(e.clientX, e.clientY)) {
      // Dropped on JARVIS himself: out of its group, loose on the board.
      ws.moveThread(t.id, GENERAL_ID);
      delete t.x; delete t.y;
    } else if (ontoCard) {
      // Dropped on another thread: the two of them become a group.
      const g = ws.groupThreads(t.id, ontoCard);
      if (g && (g.x === undefined || g.y === undefined)) {
        const box = host.card(ontoCard)?.el.getBoundingClientRect();
        const r = host.root.getBoundingClientRect();
        if (box) { g.x = Math.round(box.left - r.left - 12); g.y = Math.round(Math.max(host.room().bounds.top, box.top - r.top - 46)); }
      }
    } else if (over && over !== t.groupId) {
      ws.moveThread(t.id, over);
    } else if (!over) {
      // Open space: it becomes (or stays) an independently placed window.
      ws.moveThread(t.id, GENERAL_ID);
      dropAt();
    }
    host.commit();
  }

  /** JARVIS is a button, and says so under the pointer. */
  private cursorAt(e: PointerEvent): void {
    if (gestures.busy) return;
    const t = e.target as HTMLElement | null;
    const root = this.host.root;
    if (t instanceof Element && root.contains(t) && !t.closest(".bubble, .cmd, .panel, .web, .deck, .topbar")) {
      root.style.cursor = this.host.onCore(e.clientX, e.clientY) ? "pointer" : "";
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
      if (!id || id === except || !this.host.card(id)) continue;
      return id;
    }
    return null;
  }

  /** The bubble under a point, if any. */
  private bubbleAt(x: number, y: number): string | null {
    for (const [gid, b] of this.host.bubbles()) {
      if (gid === GENERAL_ID) continue;
      const r = b.el.getBoundingClientRect();
      if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) return gid;
    }
    return null;
  }
}

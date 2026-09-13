/**
 * The workspace: what the console is working on, as data.
 *
 *   threads — one line of enquiry each, loose on the board
 *   groups  — two or more threads put together; a group of one dissolves
 *
 * General is not a group you see: it is where loose threads live. Threads
 * JARVIS connects are put in the same group rather than strung across the
 * screen; what else relates to a thread is shown on demand in its web.
 *
 * Lifecycle words mean different things and are kept apart:
 *   close / archive — put away, recoverable from the Threads list
 *   clear           — empty a thread's history (asks first)
 *   delete          — gone for good (asks first; never done by the model)
 *
 * Pure data: no DOM, no storage — so it can be tested, and so the stage and
 * the command router share one source of truth.
 */

import type { Turn } from "../shared/types.js";
import { capitalise, editDistance } from "./text.js";

/** Each new conversation gets its own colour; groups blend their members. */
export const THREAD_HUES = ["#6ff0ff", "#ffb648", "#b48cff", "#56e39f", "#ff7ab6", "#7fb2ff", "#e6e36a"] as const;

/** A short, stable reference for choosing between threads with the same title. */
export function threadRef(thread: Pick<Thread, "id">): string {
  return thread.id.slice(-4).toUpperCase();
}

export function averageHues(colors: readonly string[]): string {
  const rgb = colors
    .map((color) => isHexColour(color) ? Number.parseInt(color.slice(1), 16) : null)
    .filter((color): color is number => color !== null);
  if (!rgb.length) return THREAD_HUES[0];
  const mean = (shift: number): number => Math.round(rgb.reduce((sum, color) => sum + ((color >> shift) & 255), 0) / rgb.length);
  return `#${[16, 8, 0].map((shift) => mean(shift).toString(16).padStart(2, "0")).join("")}`;
}

/** A colour the console will draw with: six hex digits, nothing else. */
export const isHexColour = (c: string | undefined): c is string => /^#[0-9a-f]{6}$/i.test(c ?? "");

export interface Thread {
  id: string;
  title: string;
  turns: Turn[];
  createdAt: number;
  groupId: string;
  /** A subthread: it hangs off this thread and inherits its context. */
  parentId?: string;
  /** True once the thread has a real name (from its first question or given one). */
  named?: boolean;
  /**
   * The name is only its first question, cut short — until JARVIS or the
   * user gives it a proper one. Any rename clears it.
   */
  provisional?: boolean;
  /** Deliberate connections to other threads, with the reason. */
  ties?: { to: string; why: string }[];
  /** Set when put away; the thread is kept and can be restored. */
  archivedAt?: number;
  /** A size the reader dragged the window to, when they wanted more room than the default. */
  size?: { w: number; h: number };
  /** On a phone: a height the reader dragged the window to, instead of its share of the list (stage.ts fitList). */
  mh?: number;
  /** Not a conversation: the readiness card (readiness.ts) — drawn as a window, left out of everything else. */
  kind?: "setup";
  /**
   * What Tidy up shrank it to so the board fits on the screen: a width and a
   * cap on the conversation's height (0: no cap). Tidy up clears it before it
   * starts again, so on a bigger screen the window gets its room back.
   */
  fit?: { w: number; h: number };
  /** A loose window's top-left corner on the board, in pixels from the board's top-left. */
  x?: number;
  y?: number;
  /** The thread's own accent colour. A group's colour is derived from its members. */
  color?: string;
  /**
   * Whether the window shows its conversation or just its title bar. It stays
   * as you leave it: opening another thread never folds this one away.
   */
  open?: boolean;
}

export interface Group {
  id: string;
  title: string;
  createdAt: number;
  origin: "system" | "user" | "jarvis";
  /** Bubble's top-left corner, in pixels from the board's top-left. Unset until seated. */
  x?: number;
  y?: number;
  /** Folded to a single bubble on the board. */
  collapsed?: boolean;
  /** A size the reader dragged the bubble to. */
  size?: { w: number; h: number };
  /** What Tidy up shrank it to (see Thread.fit). */
  fit?: { w: number; h: number };
}

export interface WorkspaceData {
  version: 2;
  groups: Group[];
  threads: Thread[];
  activeId: string;
  /**
   * Where x/y are measured from. "corner" is the board's top-left, so a window
   * stays put when the screen changes width, as the instrument panels do.
   * Older saves measured from the centre; the stage converts them once.
   */
  anchor?: "corner";
}

export type Match =
  | { kind: "one"; thread: Thread }
  | { kind: "many"; threads: Thread[] }
  | { kind: "none" };

export const GENERAL_ID = "g-general";
const TITLE_MAX = 40;
/** A name cut to fit: at a word boundary where there is one, marked with an ellipsis. */
function fitTitle(s: string): string {
  const t = s.trim();
  if (t.length <= TITLE_MAX) return t;
  const cut = t.slice(0, TITLE_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > TITLE_MAX * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

let seq = 0;
const uid = (p: string): string => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Words that decorate a spoken name without being part of it. */
const NAME_NOISE = /\b(?:the|thread|threads|chat|window|conversation|one|group|bubble|about)\b/g;
const norm = (s: string): string => s.toLowerCase().replace(NAME_NOISE, " ").replace(/[“”"'’.,!?]/g, "").replace(/\s+/g, " ").trim();

/** A name exactly as written (case and punctuation aside) — so a thread called "One" or "Group" can still be named. */
const plain = (s: string): string => s.toLowerCase().replace(/[“”"'’.,!?]/g, "").replace(/\s+/g, " ").trim();

function general(): Group {
  return { id: GENERAL_ID, title: "General", createdAt: 0, origin: "system" };
}

/* ===================================================================== *
 * Loading — and bringing older saves forward without losing anything
 * ===================================================================== */

interface LegacyThread {
  id?: unknown;
  title?: unknown;
  turns?: unknown;
  createdAt?: unknown;
  parentId?: unknown;
  named?: unknown;
  ties?: unknown;
}

function asTurns(v: unknown): Turn[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((t): t is { role: unknown; content: unknown } => !!t && typeof t === "object")
    .map((t) => ({ role: t.role === "assistant" ? ("assistant" as const) : ("user" as const), content: String(t.content ?? "") }));
}

function asTies(v: unknown): { to: string; why: string }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((x): x is { to: unknown; why: unknown } => !!x && typeof x === "object")
    .map((x) => ({ to: String(x.to ?? ""), why: String(x.why ?? "related") }))
    .filter((x) => x.to);
  return out.length ? out : undefined;
}

/**
 * Accept whatever is in storage and return a valid workspace.
 *
 *   • version 2 — checked and repaired (dangling parents, missing groups, a
 *     vanished active thread);
 *   • version 1 — the flat list of threads from before groups existed. Threads
 *     that were deliberately tied together become a group named for what ties
 *     them; branches go wherever their parent goes; the rest stay in General.
 *     Every thread and every message is carried over.
 *   • anything else — a clean workspace with no threads at all.
 */
export function migrate(raw: unknown, activeHint?: string | null): WorkspaceData {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as { version?: unknown }).version === 2) {
    return repair(raw as WorkspaceData);
  }
  if (Array.isArray(raw) && raw.length) return fromV1(raw as LegacyThread[], activeHint ?? null);
  // A clean screen: the core alone, until there's something to talk about.
  return { version: 2, groups: [general()], threads: [], activeId: "", anchor: "corner" };
}

function fromV1(list: LegacyThread[], activeHint: string | null): WorkspaceData {
  const threads: Thread[] = list
    .filter((t) => t && typeof t === "object" && typeof t.id === "string" && t.id)
    .map((t, index) => ({
      id: String(t.id),
      title: String(t.title ?? "Thread").slice(0, TITLE_MAX) || "Thread",
      turns: asTurns(t.turns),
      createdAt: Number(t.createdAt) || Date.now(),
      groupId: GENERAL_ID,
      color: THREAD_HUES[index % THREAD_HUES.length],
      ...(typeof t.parentId === "string" && t.parentId ? { parentId: t.parentId } : {}),
      named: t.named === undefined ? String(t.title ?? "") !== "New thread" : Boolean(t.named),
      ...(asTies(t.ties) ? { ties: asTies(t.ties)! } : {}),
    }));
  if (!threads.length) return migrate(null);
  const ids = new Set(threads.map((t) => t.id));
  for (const t of threads) if (t.parentId && !ids.has(t.parentId)) delete t.parentId;

  // Union threads joined by a tie or a branch; a set joined by at least one
  // deliberate tie becomes its own group.
  const up = new Map(threads.map((t) => [t.id, t.id]));
  const find = (x: string): string => {
    let r = x;
    while (up.get(r) !== r) r = up.get(r)!;
    up.set(x, r);
    return r;
  };
  const join = (a: string, b: string): void => { up.set(find(a), find(b)); };
  for (const t of threads) {
    if (t.parentId) join(t.id, t.parentId);
    for (const tie of t.ties ?? []) if (ids.has(tie.to) && tie.to !== t.id) join(t.id, tie.to);
  }
  const sets = new Map<string, Thread[]>();
  for (const t of threads) {
    const r = find(t.id);
    sets.set(r, [...(sets.get(r) ?? []), t]);
  }

  const groups: Group[] = [general()];
  for (const members of sets.values()) {
    const whys = members.flatMap((t) => (t.ties ?? []).filter((x) => ids.has(x.to)).map((x) => x.why));
    if (!whys.length || members.length < 2) continue;
    // Name it for what ties it together, or failing that for its oldest thread.
    const counts = new Map<string, number>();
    for (const w of whys) if (!/^related$/i.test(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const oldest = members.slice().sort((a, b) => a.createdAt - b.createdAt)[0]!;
    const title = capitalise((best ?? oldest.title).slice(0, 28));
    const g: Group = { id: uid("g"), title, createdAt: oldest.createdAt, origin: "jarvis" };
    groups.push(g);
    for (const m of members) m.groupId = g.id;
  }

  const activeId = threads.some((t) => t.id === activeHint) ? activeHint! : threads[0]!.id;
  // nothing from before groups has a position yet
  return repair({ version: 2, groups, threads, activeId, anchor: "corner" });
}

/** Make any version-2 data internally consistent. */
function repair(d: WorkspaceData): WorkspaceData {
  const all = (Array.isArray(d.groups) ? d.groups : []).filter((g) => g && typeof g.id === "string");
  // A group nothing is in any more doesn't come back with the workspace.
  const threadsIn = (id: string): boolean => (Array.isArray(d.threads) ? d.threads : []).some((t) => t?.groupId === id);
  const groups = all.filter((g) => g.id === GENERAL_ID || threadsIn(g.id));
  if (!groups.some((g) => g.id === GENERAL_ID)) groups.unshift(general());
  const gids = new Set(groups.map((g) => g.id));
  const threads = (Array.isArray(d.threads) ? d.threads : [])
    .filter((t) => t && typeof t.id === "string")
    .map((t, index) => {
      // Previous releases could create special-purpose threads. Keep their
      // history, but return them to ordinary conversations — except the
      // readiness card, which is a kind of its own and stays one.
      const { kind: _kind, codeSession: _codeSession, ...plain } = t as Omit<Thread, "kind"> & { kind?: string; codeSession?: string };
      return {
      ...plain,
      ...(_kind === "setup" ? { kind: "setup" as const } : {}),
      title: _kind === "code" && plain.title === "Claude Code" ? "Previous conversation" : plain.title,
      turns: asTurns(t.turns),
      groupId: gids.has(t.groupId) ? t.groupId : GENERAL_ID,
      color: isHexColour(t.color ?? "") ? t.color : THREAD_HUES[index % THREAD_HUES.length],
      };
    });
  const tids = new Set(threads.map((t) => t.id));
  for (const t of threads) {
    if (t.parentId && (!tids.has(t.parentId) || t.parentId === t.id)) delete t.parentId;
    if (t.ties) t.ties = t.ties.filter((x) => tids.has(x.to) && x.to !== t.id);
  }
  const live = threads.filter((t) => !t.archivedAt);
  const activeId = live.some((t) => t.id === d.activeId) ? d.activeId : (live[0]?.id ?? "");
  return { version: 2, groups, threads, activeId, ...(d.anchor === "corner" ? { anchor: "corner" as const } : {}) };
}

/* ===================================================================== *
 * Operations
 * ===================================================================== */

export class Workspace {
  data: WorkspaceData;

  constructor(data: WorkspaceData = migrate(null)) {
    this.data = data;
  }

  /* ---------------- reading ---------------- */

  /** Every thread, including archived ones. */
  get all(): Thread[] { return this.data.threads; }
  /** Threads on the board. */
  get live(): Thread[] { return this.data.threads.filter((t) => !t.archivedAt); }
  get archived(): Thread[] { return this.data.threads.filter((t) => !!t.archivedAt).sort((a, b) => b.archivedAt! - a.archivedAt!); }
  get groups(): Group[] { return this.data.groups; }
  get activeId(): string { return this.data.activeId; }
  /** The thread in front — or nothing at all, on a clean screen. */
  get active(): Thread | undefined { return this.thread(this.data.activeId) ?? this.live[0]; }
  get empty(): boolean { return this.live.length === 0; }

  thread(id: string | undefined): Thread | undefined {
    return id ? this.data.threads.find((t) => t.id === id) : undefined;
  }
  group(id: string | undefined): Group | undefined {
    return id ? this.data.groups.find((g) => g.id === id) : undefined;
  }
  groupOf(t: Thread): Group {
    return this.group(t.groupId) ?? this.group(GENERAL_ID)!;
  }
  parentOf(t: Thread): Thread | undefined {
    const p = this.thread(t.parentId);
    return p && !p.archivedAt ? p : undefined;
  }
  /** Everything that hangs below a thread, however deep. */
  descendants(id: string, includeArchived = false): Thread[] {
    const pool = includeArchived ? this.all : this.live;
    const out: Thread[] = [];
    const walk = (pid: string): void => {
      for (const c of pool.filter((t) => t.parentId === pid)) {
        if (out.includes(c)) continue;
        out.push(c);
        walk(c.id);
      }
    };
    walk(id);
    return out;
  }
  depth(t: Thread): number {
    let d = 0;
    let cur = this.parentOf(t);
    while (cur && d < 12) { d++; cur = this.parentOf(cur); }
    return d;
  }
  /** Live threads in a group, parents before their subthreads, oldest first. */
  treeOrder(groupId: string): Thread[] {
    const members = this.live.filter((t) => t.groupId === groupId);
    const inGroup = new Set(members.map((t) => t.id));
    const roots = members.filter((t) => !t.parentId || !inGroup.has(t.parentId)).sort((a, b) => a.createdAt - b.createdAt);
    const out: Thread[] = [];
    const walk = (t: Thread): void => {
      out.push(t);
      for (const c of members.filter((x) => x.parentId === t.id).sort((a, b) => a.createdAt - b.createdAt)) walk(c);
    };
    for (const r of roots) walk(r);
    return out;
  }
  /**
   * The conversation the reasoning core hears for a thread: that thread's own
   * turns and nothing else — except for a subthread that has only just begun,
   * which also hears the tail of the thread it grew from. Other threads reach
   * the core only as one-line summaries in the console snapshot, so two lines
   * of enquiry never bleed into each other.
   */
  historyFor(thread: Thread, limit = 14): Turn[] {
    const parent = this.parentOf(thread);
    const inherited = parent && thread.turns.length <= 6 ? parent.turns.slice(-6) : [];
    return [...inherited, ...thread.turns].slice(-limit);
  }

  /** Groups with something in them. An empty one isn't drawn. */
  get visibleGroups(): Group[] {
    return this.data.groups.filter((g) => this.live.some((t) => t.groupId === g.id));
  }

  /**
   * Find a thread by a spoken or typed name. Returns every candidate when the
   * name fits more than one equally well, so the caller can ask which.
   */
  findThread(name: string, opts: { archived?: boolean } = {}): Match {
    const n = norm(name);
    const pool = opts.archived ? this.archived : this.live;
    const pick = (list: Thread[]): Match | null =>
      list.length === 1 ? { kind: "one", thread: list[0]! } : list.length > 1 ? { kind: "many", threads: list } : null;
    // The whole name, word for word, first: filler words ("the", "one") are only
    // filler around a name, not when they are the name.
    const literal = pick(pool.filter((t) => plain(t.title) === plain(name)));
    if (literal) return literal;
    if (!n) return { kind: "none" };
    const reference = name.match(/#([a-z0-9]{4})\b/i)?.[1]?.toUpperCase();
    if (reference) {
      const byReference = pick(pool.filter((t) => threadRef(t) === reference));
      if (byReference) return byReference;
    }
    const exact = pool.filter((t) => norm(t.title) === n);
    const byExact = pick(exact);
    if (byExact) return byExact;
    const partial = pool.filter((t) => { const tt = norm(t.title); return !!tt && (tt.includes(n) || n.includes(tt)); });
    const byPartial = pick(partial);
    if (byPartial) return byPartial;
    const near = pool
      .map((t) => ({ t, d: editDistance(norm(t.title), n) }))
      .filter((x) => x.d <= 2)
      .sort((a, b) => a.d - b.d);
    if (!near.length) return { kind: "none" };
    const best = near.filter((x) => x.d === near[0]!.d).map((x) => x.t);
    return pick(best) ?? { kind: "none" };
  }

  findGroup(name: string): Group | undefined {
    const n = norm(name);
    const literal = this.data.groups.find((g) => plain(g.title) === plain(name));
    if (literal) return literal;
    if (!n) return undefined;
    return (
      this.data.groups.find((g) => norm(g.title) === n) ??
      this.data.groups.find((g) => { const gt = norm(g.title); return !!gt && (gt.includes(n) || n.includes(gt)); }) ??
      this.data.groups.find((g) => editDistance(norm(g.title), n) <= 1)
    );
  }

  /* ---------------- threads ---------------- */

  createThread(opts: { title?: string; parentId?: string; groupId?: string } = {}): Thread {
    const parent = this.thread(opts.parentId);
    const groupId = parent ? parent.groupId : this.group(opts.groupId) ? opts.groupId! : GENERAL_ID;
    const title = fitTitle(opts.title ?? "New thread") || "New thread";
    const t: Thread = {
      id: uid("t"), title, turns: [], createdAt: Date.now(), groupId,
      color: THREAD_HUES[this.data.threads.length % THREAD_HUES.length],
      named: title !== "New thread",
      ...(parent && !parent.archivedAt ? { parentId: parent.id } : {}),
    };
    this.data.threads.push(t);
    this.data.activeId = t.id;
    this.expandGroup(groupId);
    return t;
  }

  focus(id: string): boolean {
    const t = this.thread(id);
    if (!t || t.archivedAt) return false;
    this.data.activeId = id;
    this.expandGroup(t.groupId);
    return true;
  }

  /** Show or fold away a thread's conversation. Each window keeps its own state. */
  setOpen(id: string, open: boolean): void {
    const t = this.thread(id);
    if (t) t.open = open;
  }

  isOpen(t: Thread): boolean {
    return t.open !== false;
  }

  /**
   * Put two threads together — what dropping one window onto another means.
   * If either is already in a group, the other joins it; otherwise a new group
   * is made for the pair, named after the thread they were dropped onto.
   */
  groupThreads(dragged: string, onto: string, title?: string): Group | null {
    const a = this.thread(dragged), b = this.thread(onto);
    if (!a || !b || a.id === b.id) return null;
    const target = b.groupId !== GENERAL_ID ? this.group(b.groupId)! : a.groupId !== GENERAL_ID ? this.group(a.groupId)! : null;
    // Two loose threads make a new group — never one that happens to share the
    // name (two "New thread" windows once joined every earlier pair's group).
    const g = target ?? this.newGroup(title ?? b.title, "user");
    if (a.groupId !== g.id) this.moveThread(a.id, g.id);
    if (b.groupId !== g.id) this.moveThread(b.id, g.id);
    return g;
  }

  /**
   * One thread is not a group. When a bubble is down to its last thread — or
   * none — it dissolves and the thread goes loose again.
   */
  dissolveIfSingle(groupId: string): boolean {
    const group = this.group(groupId);
    if (groupId === GENERAL_ID || !group) return false;
    const members = this.live.filter((t) => t.groupId === groupId);
    if (members.length > 1) return false;
    // A remaining window leaves a dissolved bubble exactly where the bubble was.
    for (const t of members) {
      t.groupId = GENERAL_ID;
      if (group.x !== undefined) t.x = group.x;
      if (group.y !== undefined) t.y = group.y;
    }
    // Put-away threads go with it, so restoring one brings it back loose
    // rather than resurrecting a group of one.
    for (const t of this.data.threads) if (t.groupId === groupId) t.groupId = GENERAL_ID;
    this.data.groups = this.data.groups.filter((g) => g.id !== groupId);
    return true;
  }

  rename(id: string, title: string): void {
    const t = this.thread(id);
    if (!t) return;
    t.title = fitTitle(title) || t.title;
    t.named = true;
    delete t.provisional;
  }

  /**
   * The last question and its answer turned out to be about something else:
   * move them into a thread of their own, named for that subject, which
   * becomes the one in front. Null when there's nothing to leave behind.
   */
  splitLast(id: string, title: string): Thread | null {
    const t = this.thread(id);
    if (!t || t.turns.length <= 2) return null;
    const moved = t.turns.splice(-2);
    const fresh = this.createThread({ title });
    fresh.turns = moved;
    return fresh;
  }

  /** Empty a thread's history. The thread stays where it is. */
  clear(id: string): number {
    const t = this.thread(id);
    if (!t) return 0;
    const n = t.turns.length;
    t.turns = [];
    return n;
  }

  /**
   * Put a thread away — with everything branched off it, so a line of
   * research is archived whole. Recoverable with restore().
   */
  archive(id: string): Thread[] {
    const t = this.thread(id);
    if (!t || t.archivedAt) return [];
    const at = Date.now();
    const gone = [t, ...this.descendants(id)];
    for (const x of gone) x.archivedAt = at;
    this.afterRemoval();
    this.dissolveIfSingle(t.groupId);
    return gone;
  }

  /** Bring an archived thread back, with the subthreads that were put away with it. */
  restore(id: string): Thread[] {
    const t = this.thread(id);
    if (!t?.archivedAt) return [];
    const at = t.archivedAt;
    const back = [t, ...this.descendants(id, true).filter((x) => x.archivedAt === at)];
    for (const x of back) delete x.archivedAt;
    if (!this.group(t.groupId)) t.groupId = GENERAL_ID;
    if (t.parentId && !this.parentOf(t)) delete t.parentId;
    this.data.activeId = t.id;
    this.expandGroup(t.groupId);
    return back;
  }

  /**
   * Permanently remove one thread. Its subthreads are not lost: they move up
   * to its parent (or become top-level). Callers must confirm with the user.
   */
  remove(id: string): Thread | undefined {
    const t = this.thread(id);
    if (!t) return undefined;
    for (const c of this.data.threads) {
      if (c.parentId === id) {
        if (t.parentId) c.parentId = t.parentId;
        else delete c.parentId;
      }
      if (c.ties) c.ties = c.ties.filter((x) => x.to !== id);
    }
    this.data.threads = this.data.threads.filter((x) => x.id !== id);
    this.afterRemoval();
    this.pruneGroups(new Set([t.groupId]));
    this.dissolveIfSingle(t.groupId);
    return t;
  }

  /** Keep the focus on a live thread — or on nothing, if the board is now clear. */
  private afterRemoval(): void {
    if (this.live.some((t) => t.id === this.data.activeId)) return;
    this.data.activeId = this.live.slice().sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? "";
  }

  /* ---------------- groups ---------------- */

  /** A group that is certainly new: the name gets a number if one has it already. */
  newGroup(title: string, origin: Group["origin"] = "user"): Group {
    const base = capitalise(title.trim().slice(0, 26)) || "Group";
    let name = base;
    for (let n = 2; this.data.groups.some((g) => norm(g.title) === norm(name)); n++) name = `${base} ${n}`;
    const g: Group = { id: uid("g"), title: name, createdAt: Date.now(), origin };
    this.data.groups.push(g);
    return g;
  }

  /** A group by that name, made if it doesn't exist yet. */
  ensureGroup(title: string, origin: Group["origin"] = "user"): Group {
    const clean = capitalise(title.trim().slice(0, 28)) || "Group";
    const found = this.data.groups.find((g) => norm(g.title) === norm(clean));
    if (found) return found;
    const g: Group = { id: uid("g"), title: clean, createdAt: Date.now(), origin };
    this.data.groups.push(g);
    return g;
  }

  /**
   * Move a thread — and everything branched off it — into a group. A subthread
   * moved away from its parent's group becomes a thread of its own there, with
   * a tie back so the connection isn't forgotten.
   */
  moveThread(id: string, groupId: string): Thread[] {
    const t = this.thread(id);
    const g = this.group(groupId);
    if (!t || !g || t.groupId === g.id) return [];
    const moved = [t, ...this.descendants(id)];
    const left = new Set(moved.map((x) => x.groupId));
    for (const x of moved) {
      x.groupId = g.id;
      // Window coordinates only apply while a thread is loose on the board.
      if (g.id !== GENERAL_ID) { delete x.x; delete x.y; }
    }
    const parent = this.parentOf(t);
    if (parent && parent.groupId !== g.id) {
      delete t.parentId;
      t.ties = [...(t.ties ?? []).filter((x) => x.to !== parent.id), { to: parent.id, why: "branched from" }];
    }
    this.expandGroup(g.id);
    this.pruneGroups(left);
    // A bubble the thread just left may now hold only one: it isn't a group any more.
    for (const id of left) if (id !== g.id) this.dissolveIfSingle(id);
    return moved;
  }

  /**
   * A group its last thread has just left — not even a put-away one remains —
   * is dissolved. Only groups something left are checked, so a group made a
   * moment ago for threads about to arrive is never swept away.
   */
  private pruneGroups(ids: Set<string>): void {
    this.data.groups = this.data.groups.filter(
      (g) => g.id === GENERAL_ID || !ids.has(g.id) || this.data.threads.some((t) => t.groupId === g.id),
    );
  }

  renameGroup(id: string, title: string): void {
    const g = this.group(id);
    if (g) g.title = capitalise(title.trim().slice(0, 28)) || g.title;
  }

  /** Everything gone — the board and the archive alike. Callers confirm first. */
  wipe(): void {
    this.data.threads = [];
    this.data.groups = this.data.groups.filter((g) => g.id === GENERAL_ID);
    this.data.activeId = "";
  }

  /** Dissolve a group; its threads return to General. General itself stays. */
  removeGroup(id: string): void {
    const group = this.group(id);
    if (id === GENERAL_ID || !group) return;
    let offset = 0;
    for (const t of this.data.threads) if (t.groupId === id) {
      t.groupId = GENERAL_ID;
      if (!t.archivedAt) {
        if (group.x !== undefined) t.x = group.x + offset;
        if (group.y !== undefined) t.y = group.y + offset;
        offset += 20;
      }
    }
    this.data.groups = this.data.groups.filter((g) => g.id !== id);
  }

  setCollapsed(id: string, collapsed: boolean): void {
    // Loose threads have no shell to fold.
    if (id === GENERAL_ID) return;
    const g = this.group(id);
    if (g) g.collapsed = collapsed;
  }

  private expandGroup(id: string): void {
    const g = this.group(id);
    if (g) g.collapsed = false;
  }

  /**
   * Connect two threads on purpose. The connection is recorded with its reason,
   * and the threads are brought into one bubble so the board doesn't turn into
   * a web of wires:
   *   • both in General           → a new group, named for what connects them;
   *   • one in General            → it joins the other's group;
   *   • already in the same group → nothing moves;
   *   • in two different groups   → both stay put; the link is drawn through
   *                                  the core when either is selected.
   */
  tie(aId: string, bId: string, why = "related"): { group: Group | null; moved: Thread[] } {
    const A = this.thread(aId), B = this.thread(bId);
    if (!A || !B || A.id === B.id) return { group: null, moved: [] };
    const reason = why.trim().slice(0, 40) || "related";
    A.ties = [...(A.ties ?? []).filter((x) => x.to !== B.id), { to: B.id, why: reason }];

    if (A.groupId === B.groupId && A.groupId !== GENERAL_ID) return { group: this.groupOf(A), moved: [] };
    const rootOf = (t: Thread): Thread => { let r = t; while (this.parentOf(r)) r = this.parentOf(r)!; return r; };
    if (A.groupId === GENERAL_ID && B.groupId === GENERAL_ID) {
      // A reason names a subject, and a subject's group may already exist; a
      // thread's own title never does — the pair gets a group of its own.
      const g = /^related$/i.test(reason) ? this.newGroup(rootOf(A).title, "jarvis") : this.ensureGroup(reason, "jarvis");
      const moved = [...this.moveThread(rootOf(A).id, g.id), ...this.moveThread(rootOf(B).id, g.id)];
      return { group: g, moved };
    }
    if (A.groupId === GENERAL_ID) return { group: this.groupOf(B), moved: this.moveThread(rootOf(A).id, B.groupId) };
    if (B.groupId === GENERAL_ID) return { group: this.groupOf(A), moved: this.moveThread(rootOf(B).id, A.groupId) };
    return { group: null, moved: [] };
  }

  toJSON(): WorkspaceData {
    return this.data;
  }
}

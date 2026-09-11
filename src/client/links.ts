/**
 * The web between threads — a detective's board.
 *
 * Threads are linked when they turn out to be about the same things: the same
 * people, places, organisations, rare terms. Each link carries the words that
 * justify it, so the board says *why* two lines of enquiry meet.
 *
 * Kept deliberately unmessy:
 *   • only distinctive terms count — names over common words, and anything
 *     most threads mention (dates, "today", "sir") is ignored as noise;
 *   • a term mentioned once in passing counts for less than one that recurs;
 *   • at most two links per thread, strongest first.
 *
 * Runs locally and instantly — no model call, no network.
 */

import type { Turn } from "../shared/types.js";

export interface LinkThread {
  id: string;
  title: string;
  turns: Turn[];
  parentId?: string | undefined;
  /** Connections made on purpose — by JARVIS or by asking him — with the reason. */
  ties?: { to: string; why: string }[];
}

export interface Link {
  a: string;
  b: string;
  score: number;
  /** The shared terms that made the link, most telling first. */
  why: string[];
  /** Made deliberately rather than found by matching. */
  manual?: boolean;
}

const STOP = new Set(
  (
    "a an and are as at be been being but by can could did do does doing done for from had has have having he her here hers him his how i if in into is it its just me more most my no not now of off on once only or our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours " +
    "about above after again against all am any because before below between both down during each few further ok okay other also just like well yes yet via per " +
    "sir jarvis stark today todays yesterday tomorrow tonight morning evening afternoon week weekend month year years day days time times " +
    "january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday " +
    "according reported reports report said says saying told tell tells asked ask latest current currently recent recently new news headline headlines story stories " +
    "search searched find found look looking thing things really quite rather going get got make made one two three first second last next " +
    "please thanks thank sure right left good great best better much many little lot lots way ways part parts point points kind sort " +
    "answer question information info details detail sources source page official site online web internet live today's it's that's there's here's " +
    "however although though therefore meanwhile including include includes around across within without among upon onto"
  ).split(/\s+/),
);

/** Words a sentence often starts with that are not names. */
const LEAD = new Set(
  "the a an it this that these those in on at if when what why how who where there here one some many most other another each every sunlight light".split(" "),
);

interface Term { key: string; show: string; weight: number }

/** Distinctive terms in one thread, each with a weight. */
function termsOf(turns: Turn[]): Map<string, Term> {
  const counts = new Map<string, { show: string; base: number; n: number }>();
  const add = (raw: string, base: number): void => {
    // "Cambodia's" and "Cambodia" are the same lead.
    const show = raw.trim().replace(/['’]s$/i, "");
    const key = show.toLowerCase();
    if (key.length < 3 || STOP.has(key)) return;
    const c = counts.get(key);
    if (c) { c.n += 1; c.base = Math.max(c.base, base); }
    else counts.set(key, { show, base, n: 1 });
  };

  for (const t of turns) {
    // What the user asked about is the strongest signal of what a thread is for.
    const boost = t.role === "user" ? 1.3 : 1;
    const text = t.content.replace(/https?:\/\/\S+/g, " ");

    // Names: runs of capitalised words — "Phnom Penh", "Vilnius Old Town".
    for (const m of text.matchAll(/\b([A-Z][\p{Ll}'’-]+(?:\s+[A-Z][\p{Ll}'’-]+){0,3})\b/gu)) {
      const phrase = m[1]!;
      const words = phrase.split(/\s+/);
      if (words.length === 1 && LEAD.has(phrase.toLowerCase())) continue;
      if (words.length > 1) add(phrase, 1.1 * boost);
      for (const w of words) if (!LEAD.has(w.toLowerCase())) add(w, 1 * boost);
    }
    // Acronyms: AP, LRT, NATO, GPU.
    for (const m of text.matchAll(/\b([A-Z]{2,6})\b/g)) {
      if (!/^(SIR|JARVIS|OK|AM|PM|UTC|GMT)$/.test(m[1]!)) add(m[1]!, 0.9 * boost);
    }
    // Rarer ordinary words carry a little weight too.
    for (const m of text.toLowerCase().matchAll(/\b([\p{Ll}]{7,})\b/gu)) add(m[1]!, 0.35 * boost);
  }

  const out = new Map<string, Term>();
  for (const [key, c] of counts) {
    // Once in passing is worth less than a recurring theme.
    const weight = c.base * Math.min(1.25, 0.6 + 0.25 * c.n);
    out.set(key, { key, show: c.show, weight });
  }
  return out;
}

/**
 * How every other thread relates to this one, strongest first — no limit on
 * how many, because this is what the context web shows when you open a thread.
 * Score is the weight of what they share; `why` names it.
 */
export function relatedness(threads: LinkThread[], id: string): { id: string; score: number; why: string[] }[] {
  const me = threads.find((t) => t.id === id);
  if (!me) return [];
  const live = threads.filter((t) => t.turns.length > 0 || t.id === id);
  const terms = new Map(live.map((t) => [t.id, termsOf(t.turns)]));
  const mine = terms.get(id);
  if (!mine) return [];

  // A term nearly every thread mentions says nothing about any pair.
  const df = new Map<string, number>();
  for (const m of terms.values()) for (const k of m.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const common = (k: string): boolean => live.length >= 4 && (df.get(k) ?? 0) / live.length > 0.7;

  // Connections made on purpose, from either end, with the reason given.
  const tied = new Map<string, string>();
  for (const x of me.ties ?? []) tied.set(x.to, x.why);
  for (const t of threads) for (const x of t.ties ?? []) if (x.to === id) tied.set(t.id, x.why);

  const out: { id: string; score: number; why: string[] }[] = [];
  for (const other of live) {
    if (other.id === id) continue;
    const theirs = terms.get(other.id)!;
    const shared: { t: Term; w: number }[] = [];
    for (const [k, t] of mine) {
      const u = theirs.get(k);
      if (!u || common(k)) continue;
      shared.push({ t, w: Math.min(t.weight, u.weight) });
    }
    shared.sort((x, y) => y.w - x.w || y.t.show.length - x.t.show.length);
    const kept: typeof shared = [];
    for (const s of shared) {
      const k = s.t.key;
      if (kept.some((q) => q.t.key.includes(k) || k.includes(q.t.key))) continue;
      kept.push(s);
    }
    let score = kept.reduce((sum, s) => sum + s.w, 0);
    const why = kept.slice(0, 3).map((s) => s.t.show);
    // A branch and a deliberate connection are relationships in their own right.
    if (other.parentId === id || me.parentId === other.id) { score += 3; why.unshift("branch"); }
    const onPurpose = tied.get(other.id);
    if (onPurpose) { score += 3; why.unshift(onPurpose); }
    if (score >= 0.8) out.push({ id: other.id, score, why: [...new Set(why)].slice(0, 3) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Work out the whole board. */
export function computeLinks(threads: LinkThread[]): Link[] {
  // Deliberate connections always stand, and don't count against the limit.
  const ids = new Set(threads.map((t) => t.id));
  const manual: Link[] = [];
  const tied = new Set<string>();
  for (const t of threads) {
    for (const tie of t.ties ?? []) {
      if (!ids.has(tie.to) || tie.to === t.id) continue;
      const k = linkKey({ a: t.id, b: tie.to });
      if (tied.has(k)) continue;
      tied.add(k);
      manual.push({ a: t.id, b: tie.to, score: 99, why: [tie.why], manual: true });
    }
  }
  const auto = computeAutoLinks(threads).filter((l) => !tied.has(linkKey(l)));
  return [...manual, ...auto];
}

function computeAutoLinks(threads: LinkThread[]): Link[] {
  const live = threads.filter((t) => t.turns.length > 0);
  if (live.length < 2) return [];

  const terms = new Map(live.map((t) => [t.id, termsOf(t.turns)]));

  // A term most threads share says nothing about any particular pair.
  const df = new Map<string, number>();
  for (const m of terms.values()) for (const k of m.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const common = (k: string): boolean => live.length >= 3 && (df.get(k) ?? 0) / live.length > 0.6;

  const candidates: Link[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const A = live[i]!, B = live[j]!;
      // A branch is already tied to its parent; don't string it twice.
      if (A.parentId === B.id || B.parentId === A.id) continue;
      const ta = terms.get(A.id)!, tb = terms.get(B.id)!;
      const shared: { t: Term; w: number }[] = [];
      for (const [k, t] of ta) {
        const u = tb.get(k);
        if (!u || common(k)) continue;
        shared.push({ t, w: Math.min(t.weight, u.weight) });
      }
      // Collapse "Vilnius" + "Vilnius Old Town" into the phrase, so one idea isn't counted twice.
      shared.sort((x, y) => y.w - x.w || y.t.show.length - x.t.show.length);
      const kept: typeof shared = [];
      for (const s of shared) {
        const k = s.t.key;
        if (kept.some((q) => q.t.key.includes(k) || k.includes(q.t.key))) continue;
        kept.push(s);
      }
      const score = kept.reduce((sum, s) => sum + s.w, 0);
      if (score >= 1) {
        candidates.push({ a: A.id, b: B.id, score, why: kept.slice(0, 2).map((s) => s.t.show) });
      }
    }
  }

  // Strongest first; nobody gets more than two strings.
  candidates.sort((x, y) => y.score - x.score);
  const degree = new Map<string, number>();
  const links: Link[] = [];
  for (const c of candidates) {
    if ((degree.get(c.a) ?? 0) >= 2 || (degree.get(c.b) ?? 0) >= 2) continue;
    links.push(c);
    degree.set(c.a, (degree.get(c.a) ?? 0) + 1);
    degree.set(c.b, (degree.get(c.b) ?? 0) + 1);
  }
  return links;
}

export const linkKey = (l: { a: string; b: string }): string => (l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`);

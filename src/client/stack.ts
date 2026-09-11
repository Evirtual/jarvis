/**
 * One stacking order for everything that floats on the board — loose thread
 * windows, groups and instrument panels alike.
 *
 * Whatever you touched last is on top of everything else; the one before it
 * sits just under it, and so on down, whatever kind each is. The order is
 * remembered, so a reload puts them back the way you left them.
 *
 * Surfaces take z-indexes from BASE upward, one step per surface. The console's
 * own furniture (deck, status line, notices, the web, dialogs) sits well above
 * that range, so no window can ever cover it.
 */

import { recall, store } from "./dom.js";

const BASE = 20;
const KEEP = 80;
const KEY = "jarvis.stack";

let order: string[] = (() => {
  try {
    const v = JSON.parse(recall(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string").slice(-KEEP) : [];
  } catch { return []; }
})();
const els = new Map<string, HTMLElement>();

function paint(): void {
  order.forEach((k, i) => {
    const el = els.get(k);
    if (el) el.style.zIndex = String(BASE + i);
  });
}

/** Keys for the three kinds of surface, so they never collide. */
export const stackKey = {
  thread: (id: string): string => `t:${id}`,
  group: (id: string): string => `g:${id}`,
  panel: (name: string): string => `p:${name}`,
};

/**
 * Tell the stack which element a key is drawn as (elements are rebuilt, so
 * this is called again whenever one is). Something never touched goes under
 * everything that has been.
 */
export function track(key: string, el: HTMLElement): void {
  els.set(key, el);
  const i = order.indexOf(key);
  el.style.zIndex = i < 0 ? String(BASE - 1) : String(BASE + i);
}

/** Bring a surface to the top of everything. */
export function raise(key: string): void {
  if (order[order.length - 1] === key) return;
  order = order.filter((k) => k !== key);
  order.push(key);
  if (order.length > KEEP) order = order.slice(-KEEP);
  paint();
  store(KEY, JSON.stringify(order));
}

/** Forget a surface that no longer exists. */
export function forget(key: string): void {
  els.delete(key);
  if (!order.includes(key)) return;
  order = order.filter((k) => k !== key);
  paint();
  store(KEY, JSON.stringify(order));
}

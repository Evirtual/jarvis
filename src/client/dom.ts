/** Small DOM and formatting helpers shared across the console. */

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

/**
 * Keep a value in this browser's storage. False when it was refused — the
 * storage is full, or blocked (some private windows) — so a caller that
 * matters can say so rather than lose it quietly.
 */
export function store(k: string, v: string): boolean {
  try {
    localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
}

/**
 * A value kept in this browser's storage — under its name, or under a name
 * it had before (`older`), so a setting saved by an earlier version is not
 * lost when its key is renamed.
 */
export function recall(k: string, ...older: string[]): string | null {
  try {
    for (const key of [k, ...older]) {
      const v = localStorage.getItem(key);
      if (v !== null) return v;
    }
    return null;
  } catch {
    return null;
  }
}

// Windows reports storage and memory in binary units — match Explorer so the
// numbers here agree with the ones the user can check elsewhere.
const GiB = 1024 ** 3;
export const gib = (b: number): string => (b / GiB).toFixed(1);
export const gib0 = (b: number): string => String(Math.round(b / GiB));

export function fmtRate(bps: number | null | undefined): string {
  if (bps == null) return "—";
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = String(iso).split("T")[1];
  return t ? t.slice(0, 5) : "—";
}

export function setMeter(fill: HTMLElement, pct: number | null | undefined): void {
  const v = Math.max(0, Math.min(100, pct ?? 0));
  fill.style.width = `${v}%`;
  fill.classList.toggle("warn", v >= 75 && v < 90);
  fill.classList.toggle("crit", v >= 90);
}

export function setPill(el: HTMLElement, warn: boolean, crit: boolean): void {
  el.classList.toggle("warn", warn && !crit);
  el.classList.toggle("crit", crit);
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

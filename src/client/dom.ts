/** Small DOM and formatting helpers shared across the console. */

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

export function store(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

export function recall(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

export const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

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

export function fmtDur(sec: number | null | undefined): string {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor(sec / 60) % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${pad(m)}m`;
  return `${m}m ${pad(Math.floor(sec) % 60)}s`;
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

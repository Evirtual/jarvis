/**
 * An instrument panel's body, drawn from rows: a reading, a meter, the
 * grid of cores, a trace. Each row is an element made once and kept — found
 * again by its key on the next tick — so a meter's fill still eases and
 * nothing flickers as the readings change.
 */

import { clamp } from "./num.js";

export type Row =
  | { kind: "kv"; key: string; label: string; value: string; gold?: boolean; title?: string }
  | { kind: "meter"; key: string; label: string; value: string; unit?: string; pct: number | null; level?: "" | "warn" | "crit" }
  | { kind: "cores"; key: string; cores: number[] }
  | { kind: "spark"; key: string; label: string; rx: number[]; tx: number[] };

/** A meter's colour for how full it is: nothing until three quarters, then warn, then crit. */
export const levelOf = (pct: number | null): "" | "warn" | "crit" => (pct == null ? "" : pct >= 90 ? "crit" : pct >= 75 ? "warn" : "");

const SPARK_N = 60;

function make(r: Row): HTMLElement {
  const el = document.createElement("div");
  el.dataset.row = r.key;
  el.dataset.kind = r.kind;
  switch (r.kind) {
    case "kv":
      el.className = "kv";
      el.innerHTML = `<span class="k"></span><span class="v"></span>`;
      break;
    case "meter":
      el.className = "meter";
      el.innerHTML = `<div class="row"><span class="nm"></span><span class="nu"><span class="n"></span><span class="u"></span></span></div><div class="track"><div class="fill"></div></div>`;
      break;
    case "cores":
      el.className = "cores";
      break;
    case "spark":
      el.className = "spark-row";
      el.innerHTML = `<svg class="spark" viewBox="0 0 260 34" preserveAspectRatio="none"></svg>`;
      break;
  }
  return el;
}

function update(el: HTMLElement, r: Row): void {
  switch (r.kind) {
    case "kv": {
      el.querySelector(".k")!.textContent = r.label;
      const v = el.querySelector<HTMLElement>(".v")!;
      v.textContent = r.value;
      v.classList.toggle("gold", !!r.gold);
      v.title = r.title ?? "";
      break;
    }
    case "meter": {
      el.querySelector(".nm")!.textContent = r.label;
      el.querySelector(".n")!.textContent = r.value;
      el.querySelector(".u")!.textContent = r.unit ?? "";
      const fill = el.querySelector<HTMLElement>(".fill")!;
      const pct = r.pct == null ? 0 : clamp(r.pct, 0, 100);
      fill.style.width = `${pct}%`;
      const level = r.level ?? levelOf(r.pct);
      fill.classList.toggle("warn", level === "warn");
      fill.classList.toggle("crit", level === "crit");
      break;
    }
    case "cores": {
      const n = r.cores.length;
      if (el.childElementCount !== n) {
        el.replaceChildren();
        el.style.gridTemplateColumns = `repeat(${Math.min(8, Math.max(4, Math.ceil(n / 2)))}, 1fr)`;
        for (let i = 0; i < n; i++) {
          const c = document.createElement("div");
          c.className = "core";
          c.append(document.createElement("i"));
          el.append(c);
        }
      }
      r.cores.forEach((v, i) => {
        const c = el.children[i] as HTMLElement;
        (c.firstElementChild as HTMLElement).style.height = `${v}%`;
        c.classList.toggle("hot", v >= 60 && v < 88);
        c.classList.toggle("max", v >= 88);
        c.title = `Core ${i}: ${v}%`;
      });
      break;
    }
    case "spark": {
      const svg = el.querySelector("svg")!;
      svg.setAttribute("aria-label", r.label);
      if (r.rx.length < 2) { svg.innerHTML = ""; break; }
      const max = Math.max(...r.rx, ...r.tx, 1);
      // Newest reading at the right edge, older ones scrolling off to the left, so
      // the graph reads as a live trace from the first second rather than filling
      // in from the left over a minute.
      const xAt = (i: number, n: number): number => 260 - ((n - 1 - i) / (SPARK_N - 1)) * 260;
      const path = (arr: number[]): string =>
        arr.map((v, i) => `${i ? "L" : "M"}${xAt(i, arr.length).toFixed(1)} ${(33 - (v / max) * 31).toFixed(1)}`).join(" ");
      const firstX = xAt(0, r.rx.length).toFixed(1);
      svg.innerHTML =
        `<path d="${path(r.rx)} L260 34 L${firstX} 34 Z" fill="rgba(111,240,255,.13)"/>` +
        `<path d="${path(r.rx)}" fill="none" stroke="#6ff0ff" stroke-width="1.2"/>` +
        `<path d="${path(r.tx)}" fill="none" stroke="#ffb648" stroke-width="1" stroke-dasharray="3 2" opacity=".8"/>`;
      break;
    }
  }
}

/** Draw the rows into a panel body, keeping the elements that are already there. */
export function paintRows(body: HTMLElement, rows: Row[]): void {
  const keep = new Set<string>();
  rows.forEach((r, i) => {
    keep.add(r.key);
    let el = body.querySelector<HTMLElement>(`:scope > [data-row="${r.key}"]`);
    if (el && el.dataset.kind !== r.kind) { el.remove(); el = null; }
    if (!el) el = make(r);
    if (body.children[i] !== el) body.insertBefore(el, body.children[i] ?? null);
    update(el, r);
  });
  for (const el of [...body.children] as HTMLElement[]) if (!keep.has(el.dataset.row ?? "")) el.remove();
}

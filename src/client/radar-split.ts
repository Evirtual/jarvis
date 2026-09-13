/**
 * The line under the radar: drag it and the radar grows or shrinks (it stays
 * square), the list of hosts taking the rest of the panel. The panel's own
 * corners still size the panel; this sizes what is inside it. Remembered.
 */

import { $ } from "./dom.js";
import { KEY, recall, store } from "./storage.js";
import { clamp } from "./num.js";

export function wireRadarSplit(): void {
  const split = $("radarSplit");
  const panel = split.closest<HTMLElement>(".panel")!;
  const radar = $("radar");

  const apply = (h: number | null): void => {
    if (h === null) panel.style.removeProperty("--radar-h");
    else panel.style.setProperty("--radar-h", `${Math.round(h)}px`);
  };

  const saved = Number.parseFloat(recall(KEY.radarH) ?? "");
  if (saved >= 80) apply(saved);

  let drag: { pid: number; y0: number; h0: number } | null = null;
  split.addEventListener("pointerdown", (e) => {
    e.stopPropagation(); // not the panel's drag, not a corner
    e.preventDefault();
    drag = { pid: e.pointerId, y0: e.clientY, h0: radar.getBoundingClientRect().height };
    split.classList.add("on");
    split.setPointerCapture(e.pointerId);
  });
  split.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    // no smaller than a glance, no wider than the panel (it is square)
    const max = panel.clientWidth - 2 * Number.parseFloat(getComputedStyle(panel).paddingLeft || "0");
    apply(clamp(drag.h0 + (e.clientY - drag.y0), 80, max));
  });
  const end = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pid) return;
    drag = null;
    split.classList.remove("on");
    store(KEY.radarH, panel.style.getPropertyValue("--radar-h").replace("px", ""));
  };
  split.addEventListener("pointerup", end);
  split.addEventListener("pointercancel", end);
  // double-click: back to the full width
  split.addEventListener("dblclick", () => { apply(null); store(KEY.radarH, ""); });
}

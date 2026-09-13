/**
 * The configuration drawer and its tabs.
 */

import { type ConfigTab } from "../shared/directives.js";
import { $ } from "./dom.js";
import { conn } from "./state.js";

/* ===================================================================== *
 * Drawer
 * ===================================================================== */

export function setDrawer(open: boolean, tab?: ConfigTab): void {
  $("drawer").classList.toggle("open", open);
  $("scrim").classList.toggle("open", open);
  if (open && tab) showTab(tab);
}
$("openDrawer").addEventListener("click", () => { setDrawer(true); void conn.refresh(); });
$("closeDrawer").addEventListener("click", () => setDrawer(false));
$("scrim").addEventListener("click", () => setDrawer(false));

function showTab(name: string): void {
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
  document.querySelectorAll<HTMLElement>("[data-pane]").forEach((pane) => {
    pane.hidden = pane.dataset.pane !== name;
  });
}
document.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showTab(tab.dataset.tab ?? "connections"));
});

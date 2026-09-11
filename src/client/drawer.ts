/**
 * The configuration drawer and its tabs.
 */

import type { ProviderId, ScanResponse, TelemetryResponse, VoiceOption, WorldResponse } from "../shared/types.js";
import { api } from "./api.js";
import {
  NEEDS_CONFIRMATION, extractDirectives, intentOf, parseUtterance, type Action, type ConfigTab, type ParseContext, type ProviderWord,
} from "./commands.js";
import { addressed, getAddress, setAddress, type Address } from "./address.js";
import { ICON, instrumentIcon as icon } from "./icons.js";
import { $, esc, fmtRate, gib, gib0, hhmm, recall, setMeter, setPill, store } from "./dom.js";
import { computeLinks, linkKey, relatedness, type Link } from "./links.js";
import { type PanelName } from "./panels.js";
import { line, type Thread } from "./stage.js";
import { clip, editDistance } from "./text.js";
import { GENERAL_ID, threadRef, type Group } from "./workspace.js";
import { conn, graph, hud, input, panels, reduceMotion, voice, ws } from "./state.js";

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

export function showTab(name: string): void {
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
  document.querySelectorAll<HTMLElement>("[data-pane]").forEach((pane) => {
    pane.hidden = pane.dataset.pane !== name;
  });
}
document.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showTab(tab.dataset.tab ?? "connections"));
});

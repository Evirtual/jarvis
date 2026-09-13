/**
 * The Threads panel — the whole board as a list: every group, its threads
 * as a tree, and what's been put away, with restore and delete.
 */

import { $, esc } from "./dom.js";
import { GENERAL_ID, threadRef, type Group } from "./workspace.js";
import { graph, panels, ws } from "./state.js";
import { notice } from "./say.js";
import { deleteThread } from "./confirm.js";
import { runAction } from "./actions.js";
import { colour } from "./palette.js";
import { bringBack, paintThread } from "./threads.js";

export function paintThreadList(): void {
  if (!panels.isOpen("threads")) return;
  const hue = (g: Group): string => getComputedStyle(document.querySelector<HTMLElement>(`.bubble[data-gid="${g.id}"]`) ?? document.body).getPropertyValue("--hue") || colour("ice");
  const rows: string[] = [];
  for (const g of ws.visibleGroups) {
    const members = ws.treeOrder(g.id);
    // On the board these have no shell and no name; in the list they need a heading.
    const heading = g.id === GENERAL_ID ? "Loose threads" : g.title;
    rows.push(`<div class="tl-g"><i style="background:${esc(hue(g).trim())}"></i>${esc(heading)}<span class="n">${members.length}</span></div>`);
    for (const t of members) {
      rows.push(
        `<div class="tl-row${t.id === ws.activeId ? " on" : ""}" style="--depth:${Math.min(4, ws.depth(t))}" data-id="${esc(t.id)}">` +
        `<span class="nm">${esc(t.title)} <small class="tl-ref">#${threadRef(t)}</small></span>` +
        `<span class="sub">${t.turns.filter((x) => x.role === "user").length || ""}</span>` +
        (ws.live.length > 1 ? `<button type="button" data-act="archive" title="Put away">Put away</button>` : "") +
        `</div>`,
      );
    }
  }
  const away = ws.archived;
  rows.push(`<div class="tl-g"><i style="background:${colour("ice-dim")}"></i>Put away<span class="n">${away.length}</span></div>`);
  if (!away.length) rows.push(`<div class="tl-empty">Nothing put away. Closing a thread puts it here, not in the bin.</div>`);
  for (const t of away.slice(0, 40)) {
    rows.push(
      `<div class="tl-row" data-id="${esc(t.id)}"><span class="nm">${esc(t.title)} <small class="tl-ref">#${threadRef(t)}</small></span>` +
      `<button type="button" data-act="restore">Restore</button><button type="button" class="del" data-act="delete">Delete</button></div>`,
    );
  }
  if (ws.live.length || away.length) {
    rows.push(
      `<div class="tl-foot">` +
      (ws.live.length > 1 ? `<button type="button" data-all="tidy">Tidy up</button>` : "") +
      (ws.live.length ? `<button type="button" data-all="archive">Put all away</button>` : "") +
      (away.length ? `<button type="button" class="del" data-all="clear-away">Delete put-away</button>` : "") +
      `<button type="button" class="del" data-all="delete">Delete everything</button></div>`,
    );
  }
  const html = rows.join("");
  const list = $("threadList");
  if (list.dataset.html !== html) {
    list.innerHTML = html;
    list.dataset.html = html;
    // Adding a row can make the left-hand Threads instrument taller. Give the
    // next reading panels their normal clearance instead of letting the list grow over them.
    panels.clearLaneOverlaps();
  }
  $("threadsAux").textContent = `${ws.all.filter((t) => !t.kind).length} total`;
}

/** The list answers: a row goes to its thread; its buttons put away, restore, delete; the foot acts on the whole board. */
export function wireThreadsPanel(): void {
  $("threadList").addEventListener("click", (e) => {
    const all = (e.target as HTMLElement).closest<HTMLElement>("button[data-all]");
    if (all) {
      const NAMES = { delete: "delete_all", "clear-away": "clear_archived", tidy: "tidy_board", archive: "archive_all" } as const;
      const name = NAMES[all.dataset.all as keyof typeof NAMES] ?? "archive_all";
      void runAction({ name }).then((n) => {
        if (n) notice(n);
      });
      return;
    }
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>(".tl-row");
    if (!rowEl) return;
    const t = ws.thread(rowEl.dataset.id);
    if (!t) return;
    const act = (e.target as HTMLElement).closest<HTMLElement>("button[data-act]")?.dataset.act;
    if (act === "archive") graph.onArchive?.(t.id);
    else if (act === "restore") notice(bringBack(t));
    else if (act === "delete") deleteThread(t);
    else if (!t.archivedAt) { graph.focus(t.id); paintThread(); }
  });
}

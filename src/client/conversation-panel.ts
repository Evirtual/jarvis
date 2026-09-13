/**
 * The Conversation panel: what was said at the core, outside any thread,
 * oldest first, drawn as replies are drawn in a window — every message kept
 * (core-chat.ts keeps the last 80), so the count in the title, the count on
 * the button and what the panel shows are one number.
 */

import { $ } from "./dom.js";
import { panels } from "./state.js";
import { coreChat } from "./core-chat.js";
import { line } from "./message.js";

export function paintCoreChat(): void {
  if (!panels.isOpen("conversation")) return;
  const box = $("coreChat");
  const rows = coreChat.lines;
  $("convAux").textContent = `${rows.length} message${rows.length === 1 ? "" : "s"}`;
  const key = rows.map((l) => `${l.role}:${l.at}:${l.content.length}`).join("|");
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren();
  if (!rows.length) {
    const e = document.createElement("div");
    e.className = "tl-empty";
    e.textContent = "Nothing said yet. What you and J.A.R.V.I.S. say outside a thread is kept here.";
    box.append(e);
    return;
  }
  const list = document.createElement("div");
  list.className = "tl-chat";
  for (const l of rows) list.append(line(l.role === "assistant" ? "jarvis" : l.role, l.content));
  box.append(list);
  const foot = document.createElement("div");
  foot.className = "tl-foot";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Clear conversation";
  clear.addEventListener("click", () => coreChat.clear());
  foot.append(clear);
  box.append(foot);
  list.scrollTop = list.scrollHeight;
}

/** The count on the Conversation button: every message the panel shows — yours, JARVIS's and the console's notices. */
export function paintConversationCount(): void {
  $("pConversation").textContent = String(coreChat.lines.length);
}

export function wireConversationPanel(): void {
  coreChat.onChange = (): void => { paintCoreChat(); paintConversationCount(); };
  paintConversationCount();
}

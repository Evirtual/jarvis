/**
 * The conversation at the core: what you say to JARVIS and what JARVIS says
 * back when no thread is involved — greetings, questions answered in a
 * breath, console operations, anything looked up and simply told. Kept in
 * this browser so it can be re-read (the Conversation panel) and so
 * follow-ups make sense: the last exchanges go to the model with each
 * question. Threads hold research; this holds the talk.
 */

import type { Turn } from "../shared/types.js";
import { recall, store } from "./dom.js";

export interface CoreLine {
  role: "user" | "assistant" | "sys";
  content: string;
  at: number;
}

const KEY = "jarvis.conversation"; // once "jarvis.core", a letter from the keys' "jarvis.cores"
/** How many lines are kept. Older ones fall off the top. */
const CAP = 80;

function load(): CoreLine[] {
  try {
    const raw = JSON.parse(recall(KEY, "jarvis.core") ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((l): l is CoreLine =>
      !!l && typeof l === "object" && ["user", "assistant", "sys"].includes((l as CoreLine).role) && typeof (l as CoreLine).content === "string",
    ).slice(-CAP);
  } catch {
    return [];
  }
}

let lines: CoreLine[] = load();

export const coreChat = {
  /** Every line kept, oldest first. */
  get lines(): readonly CoreLine[] { return lines; },

  add(role: CoreLine["role"], content: string): void {
    lines.push({ role, content, at: Date.now() });
    if (lines.length > CAP) lines = lines.slice(-CAP);
    store(KEY, JSON.stringify(lines));
    coreChat.onChange?.();
  },

  /** The last exchanges, as the model takes them — notices left out. */
  recent(n = 12): Turn[] {
    return lines.filter((l) => l.role !== "sys").slice(-n).map((l) => ({ role: l.role as Turn["role"], content: l.content }));
  },

  /** Take back the last line, if it is this one — a question that turned out to belong in a thread. */
  forget(role: CoreLine["role"], content: string): void {
    const last = lines[lines.length - 1];
    if (!last || last.role !== role || last.content !== content) return;
    lines.pop();
    store(KEY, JSON.stringify(lines));
    coreChat.onChange?.();
  },

  clear(): void {
    lines = [];
    store(KEY, "[]");
    coreChat.onChange?.();
  },

  onChange: null as (() => void) | null,
};

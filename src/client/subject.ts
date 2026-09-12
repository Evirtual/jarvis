/**
 * Whether a question belongs in the thread in front, or is a new subject
 * that deserves a thread of its own.
 *
 * Decided locally and instantly — no model call — from what each is about:
 * the names and telling words in them, the same kind of evidence the board's
 * links use (links.ts). In order:
 *
 *   • a thread with nothing answered yet is the question's own;
 *   • "and…", "what about…", "why?", "tell me more" carry the conversation on;
 *   • a name or telling word the thread already has keeps it there;
 *   • a name the thread has never mentioned is a new subject;
 *   • "how much does it cost?" points back at what is here;
 *   • otherwise, two or more telling words, none of them from here, are a
 *     new subject — "recommend a laptop for programming" in a thread on Kyoto.
 *
 * When in doubt it stays: a question wrongly moved is more jarring than one
 * that stays where it was asked.
 */

import type { Turn } from "../shared/types.js";
import { STOP } from "./links.js";

/** Openings that continue what was being talked about. */
const FOLLOW_ON = /^(?:and|but|so|also|then|or|plus|what about|how about|what else|why|how come|really|ok(?:ay)?|thanks?|thank you|yes|no|go on|continue|tell me more|more)\b/i;

/** Words that point back at something already said. */
const REFERS = /\b(?:it|its|it's|that|that's|this|these|those|they|them|their|there|he|him|his|she|her|same|else|instead|again|another|ones?)\b/i;

interface Subject {
  /** Proper names and acronyms: "Kyoto", "SpaceX", "JR". */
  names: Set<string>;
  /** Longer ordinary words: "cherry", "programming". */
  words: Set<string>;
}

/** "Temples" and "temple" are the same subject. */
const stem = (w: string): string => {
  const k = w.toLowerCase().replace(/['’]s$/, "");
  return k.length > 4 && k.endsWith("s") && !k.endsWith("ss") ? k.slice(0, -1) : k;
};

/** What a piece of text is about. A capital at the start of a sentence doesn't make a name. */
function subjectOf(text: string): Subject {
  const names = new Set<string>();
  const words = new Set<string>();
  const clean = text.replace(/https?:\/\/\S+/g, " ").replace(/\[\[[^\]]*\]\]/g, " ");
  for (const sentence of clean.split(/(?<=[.!?])\s+|\n+/)) {
    const tokens = sentence.match(/[\p{L}\p{N}'’-]+/gu) ?? [];
    tokens.forEach((tok, i) => {
      const k = stem(tok);
      if (k.length < 3 || STOP.has(k) || STOP.has(tok.toLowerCase())) return;
      if (/^[A-Z]{2,6}$/.test(tok)) names.add(k);
      else if (i > 0 && /^\p{Lu}/u.test(tok)) names.add(k);
      else if (k.length >= 7) words.add(k);
    });
  }
  return { names, words };
}

/** True when the question starts a new subject, rather than carrying on the thread's. */
export function isNewSubject(thread: Turn[], question: string): boolean {
  if (!thread.some((t) => t.role === "assistant")) return false;
  const q = question.trim();
  if (FOLLOW_ON.test(q) || q.split(/\s+/).length < 3) return false;

  const mine = subjectOf(q);
  const here = new Set<string>();
  for (const t of thread) {
    const s = subjectOf(t.content);
    for (const k of [...s.names, ...s.words]) here.add(k);
  }
  if ([...mine.names, ...mine.words].some((k) => here.has(k))) return false;
  if (mine.names.size) return true;
  if (REFERS.test(q)) return false;
  return mine.words.size >= 2;
}

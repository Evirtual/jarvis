/**
 * How JARVIS addresses the person at the console: "sir" (the default) or
 * "ma'am". Chosen in Config → Voice, or by saying "call me ma'am".
 *
 * The reasoning core is told which to use with every question. The console's
 * own lines are written with "sir"; `addressed` turns them round — only where
 * the word is used as a form of address (", sir", "Sir, …"), so a name such
 * as "Sir David" in a thread title is left alone.
 */

import { recall, store } from "./dom.js";

export type Address = "sir" | "madam";

const KEY = "jarvis.address";

export function getAddress(): Address {
  return recall(KEY) === "madam" ? "madam" : "sir";
}

export function setAddress(a: Address): void {
  store(KEY, a);
}

/** A line written with "sir", as it should be said to this user. */
export function addressed(text: string, a: Address = getAddress()): string {
  if (a === "sir") return text;
  return text
    .replace(/(^|[.!?…]\s+|["“(]\s*)Sir\b(?!\s+[A-Z])/g, "$1Ma'am")
    .replace(/,(\s*)sir\b/g, ",$1ma'am")
    .replace(/\bsir(?=[.!?…,;:—)"”]|$)/g, "ma'am")
    .replace(/\bSIR\b/g, "MA'AM");
}

/**
 * The console's colours, as the stylesheet defines them (:root in styles.css),
 * for what is drawn on a canvas or written into an inline style — read from
 * the page once, so a colour changed in one place changes everywhere.
 */

const cache = new Map<string, string>();

export function colour(name: "ice" | "ice-dim" | "gold" | "red" | "green" | "line" | "line-hot" | "text" | "text-hi" | "void"): string {
  let c = cache.get(name);
  if (!c) {
    c = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    if (c) cache.set(name, c);
  }
  return c || "#6ff0ff";
}

/**
 * Reading a reply's Markdown. The parsing is marked's, used as a lexer
 * only: it hands back a token tree, never HTML, and the stage builds each
 * token from text nodes and elements of its own (see message.ts). Nothing
 * here touches the DOM.
 *
 * The console's own media results — [[media:image https://…]] — are lifted
 * out before parsing, since Markdown would otherwise read the address inside
 * them as a link with brackets stuck to it.
 */

import { marked, type Token } from "marked";

export type Media = { type: "image" | "video"; src: string };

const MEDIA = /\[\[media:(image|video)\s+(https:\/\/[^\]\s]+)\]\]/gi;
/** A marker a service left without an address: nothing to show, not brackets to read. */
const EMPTY_MEDIA = /[ \t]*\[\[media:(?:image|video)\s*\]\][ \t]*/gi;

/**
 * A lifted media result's place in the text: its index between two
 * private-use characters, which no Markdown rule or reply will ever contain.
 */
const MARK_OPEN = "";
const MARK_CLOSE = "";
export const MEDIA_MARK = new RegExp(`${MARK_OPEN}(\\d+)${MARK_CLOSE}`, "g");
/** A run of text that is nothing but media marks: cards, with no words of their own. */
export const ONLY_MEDIA = new RegExp(`^(?:\\s*${MARK_OPEN}\\d+${MARK_CLOSE}\\s*)+$`);

/** The text with each media result replaced by a mark, and the results in mark order. */
export function extractMedia(text: string): { text: string; media: Media[] } {
  const media: Media[] = [];
  const out = text
    // a marker that ended up inside another (an older cleaning rule did this) is the inner one
    .replace(/\[\[media:(image|video)\s+\[\[media:(?:image|video)\s+(https:\/\/[^\]\s]+)\]\]\]\]/gi, "[[media:$1 $2]]")
    .replace(EMPTY_MEDIA, "")
    .replace(MEDIA, (_, type: string, src: string) => {
      media.push({ type: type.toLowerCase() as Media["type"], src });
      return `${MARK_OPEN}${media.length - 1}${MARK_CLOSE}`;
    });
  return { text: out, media };
}

/** GitHub-flavoured Markdown as tokens; a single newline is a line break, as a reply means it. */
export function parse(text: string): Token[] {
  return marked.lexer(text, { gfm: true, breaks: true });
}

/**
 * The address a link may open, or null when it is shown as words instead.
 * Only https, as docs/HOW-IT-WORKS.md promises: not http, and never a
 * javascript: or data: address a service might write.
 */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Whether an https address points at a picture the stage can show inline. */
export function isImageHref(href: string): boolean {
  try {
    return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(new URL(href).pathname);
  } catch {
    return false;
  }
}

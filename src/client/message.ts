/**
 * One line in a thread's window, built from its text. A reply's Markdown —
 * lists, headings, emphasis, code, quotes, tables — is read by marked
 * (markdown.ts) and drawn here token by token with createElement and text
 * nodes; https addresses become links (as docs/HOW-IT-WORKS.md promises, a
 * plain http one is shown as text); image and video results become the
 * picture or the player itself. Nothing is ever built from markup, so
 * nothing a service writes can put anything of its own on the page: an HTML
 * tag in a reply appears as the characters it is.
 */

import type { Token, Tokens } from "marked";
import { MEDIA_MARK, ONLY_MEDIA, extractMedia, isImageHref, parse, safeHref, type Media } from "./markdown.js";

function link(href: string, text: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.className = "cw-link";
  return a;
}

/**
 * The picture to show for an image result. A Wikimedia original can be
 * several thousand pixels and megabytes — and Wikimedia rate-limits
 * originals linked from other sites — so its standard 960-pixel preview is
 * shown instead (other widths are refused). The link still opens the original.
 */
function previewOf(src: string): string {
  const original = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/([\w-]+)\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+\.(?:jpe?g|png|webp|gif))$/i.exec(src);
  if (original) {
    const [, wiki, a, ab, file] = original;
    return `https://upload.wikimedia.org/wikipedia/${wiki}/thumb/${a}/${ab}/${file}/960px-${file}`;
  }
  if (/^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//i.test(src) && !/[?&]width=/.test(src)) {
    return `${src}${src.includes("?") ? "&" : "?"}width=960`;
  }
  return src;
}

/** An image or video result as a card, or null when the address isn't one that can be shown. */
function mediaCard(type: string, source: string): HTMLElement | null {
  const card = document.createElement("figure");
  card.className = `cw-media ${type}`;
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return null;
  }
  if (type === "image" && isImageHref(source)) {
    const image = document.createElement("img");
    const preview = previewOf(source);
    // should a preview not exist, the original is the next best thing
    if (preview !== source) image.addEventListener("error", () => { image.src = source; }, { once: true });
    image.src = preview;
    image.alt = "Research image result";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    const open = link(source, "");
    open.title = "Open image source";
    open.append(image);
    card.append(open);
    return card;
  }
  if (type === "video") {
    const youtubeId = parsed.hostname.includes("youtu") ? (parsed.searchParams.get("v") ?? parsed.pathname.split("/").filter(Boolean).pop()) : null;
    const vimeoId = parsed.hostname.includes("vimeo.com") ? parsed.pathname.split("/").filter(Boolean).findLast((part) => /^\d+$/.test(part)) : null;
    const embed = youtubeId && /^[\w-]{6,}$/.test(youtubeId)
      ? { src: `https://www.youtube-nocookie.com/embed/${youtubeId}`, allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" }
      : vimeoId
        ? { src: `https://player.vimeo.com/video/${vimeoId}`, allow: "autoplay; fullscreen; picture-in-picture" }
        : null;
    if (!embed) return null;
    const frame = document.createElement("iframe");
    frame.setAttribute("credentialless", ""); // the player gets no cookies of this page's, or of its own
    frame.src = embed.src;
    frame.title = "Research video result";
    frame.allow = embed.allow;
    frame.allowFullscreen = true;
    card.append(frame);
    return card;
  }
  return null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * Words into a parent as text nodes, with each lifted media result put back
 * as its card. Media is its own source: a result that can't be shown is left
 * out rather than left as a bare link beside the ones that can.
 */
function addWords(parent: HTMLElement, text: string, media: Media[]): void {
  let start = 0;
  for (const m of text.matchAll(MEDIA_MARK)) {
    const index = m.index ?? 0;
    if (index > start) parent.append(document.createTextNode(text.slice(start, index)));
    const item = media[Number(m[1])];
    const card = item ? mediaCard(item.type, item.src) : null;
    if (card) parent.append(card);
    start = index + m[0].length;
  }
  if (start < text.length) parent.append(document.createTextNode(text.slice(start)));
}

/** The words of a token and its children, for a link or image that is shown as text. */
function wordsOf(tokens: Token[] | undefined): string {
  return (tokens ?? []).map((t) => ("tokens" in t && t.tokens ? wordsOf(t.tokens) : "text" in t ? String(t.text ?? "") : t.raw)).join("");
}

/** Inline tokens — the run of one line — into a parent. */
function addInline(parent: HTMLElement, tokens: Token[] | undefined, media: Media[]): void {
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "text": {
        const text = t as Tokens.Text;
        if (text.tokens) addInline(parent, text.tokens, media);
        else addWords(parent, text.text, media);
        break;
      }
      case "escape": addWords(parent, (t as Tokens.Escape).text, media); break;
      case "strong": { const b = el("b"); addInline(b, (t as Tokens.Strong).tokens, media); parent.append(b); break; }
      case "em": { const i = el("i"); addInline(i, (t as Tokens.Em).tokens, media); parent.append(i); break; }
      case "del": { const s = el("s"); addInline(s, (t as Tokens.Del).tokens, media); parent.append(s); break; }
      case "codespan": { const c = el("code"); c.textContent = (t as Tokens.Codespan).text; parent.append(c); break; }
      case "br": {
        // A media result sits on its own line, and the line break around it
        // would draw as an empty line beside the card — the card's own margin
        // is the spacing, so the break is dropped next to one.
        const nextIsMedia = (() => { const n = tokens![tokens!.indexOf(t) + 1]; return n?.type === "text" && ONLY_MEDIA.test((n as Tokens.Text).text); })();
        if (!nextIsMedia && !(parent.lastElementChild?.classList.contains("cw-media") && parent.lastChild === parent.lastElementChild)) parent.append(el("br"));
        break;
      }
      case "link": {
        const l = t as Tokens.Link;
        const href = safeHref(l.href);
        if (href) {
          const a = link(href, "");
          addInline(a, l.tokens, media);
          if (!a.textContent) a.textContent = href;
          parent.append(a);
        } else {
          // shown as words with its address, the way a reply used to be cleaned
          const words = wordsOf(l.tokens);
          addWords(parent, words && words !== l.href ? `${words}: ${l.href}` : l.href, media);
        }
        break;
      }
      case "image": {
        const img = t as Tokens.Image;
        const href = safeHref(img.href);
        const card = href && isImageHref(href) ? mediaCard("image", href) : null;
        if (card) parent.append(card);
        else addWords(parent, img.text || img.href, media);
        break;
      }
      case "html": parent.append(document.createTextNode((t as Tokens.HTML).raw)); break; // the characters, not the tag
      default:
        if ("tokens" in t && t.tokens) addInline(parent, t.tokens, media);
        else parent.append(document.createTextNode(t.raw));
    }
  }
}

/** Block tokens — paragraphs, lists, code, quotes, tables — into a parent. */
function addBlocks(parent: HTMLElement, tokens: Token[] | undefined, media: Media[]): void {
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "space": break;
      case "paragraph": { const p = el("div", "cw-p"); addInline(p, (t as Tokens.Paragraph).tokens, media); parent.append(p); break; }
      case "text": {
        // a tight list item's words come as a text token with the line's runs inside it
        const p = el("div", "cw-p");
        const text = t as Tokens.Text;
        if (text.tokens) addInline(p, text.tokens, media);
        else addWords(p, text.text, media);
        parent.append(p);
        break;
      }
      case "heading": {
        const h = t as Tokens.Heading;
        const node = el("div", "cw-h");
        node.dataset.level = String(h.depth);
        node.setAttribute("role", "heading");
        node.setAttribute("aria-level", String(h.depth));
        addInline(node, h.tokens, media);
        parent.append(node);
        break;
      }
      case "list": {
        const list = t as Tokens.List;
        const node = el(list.ordered ? "ol" : "ul", "cw-list");
        if (list.ordered && typeof list.start === "number" && list.start !== 1) node.setAttribute("start", String(list.start));
        for (const item of list.items) {
          const li = el("li");
          if (item.task) {
            const box = el("span", "cw-task");
            box.textContent = item.checked ? "☑" : "☐";
            box.setAttribute("aria-label", item.checked ? "done" : "to do");
            li.append(box);
          }
          // A tight item's words come as a text token: they sit in the item itself,
          // beside its marker; anything else in the item (a nested list, a
          // paragraph of a loose list, code) stacks as a block below.
          for (const inner of item.tokens) {
            if (inner.type === "text") addInline(li, (inner as Tokens.Text).tokens ?? [inner], media);
            else addBlocks(li, [inner], media);
          }
          node.append(li);
        }
        parent.append(node);
        break;
      }
      case "code": {
        const code = t as Tokens.Code;
        const pre = el("pre", "cw-code");
        if (code.lang) pre.dataset.lang = code.lang.split(/\s+/)[0];
        const inner = el("code");
        inner.textContent = code.text;
        pre.append(inner);
        parent.append(pre);
        break;
      }
      case "blockquote": { const q = el("blockquote", "cw-quote"); addBlocks(q, (t as Tokens.Blockquote).tokens, media); parent.append(q); break; }
      case "table": {
        const table = t as Tokens.Table;
        const wrap = el("div", "cw-table-wrap");
        const node = el("table", "cw-table");
        const head = el("thead");
        const hr = el("tr");
        table.header.forEach((cell, i) => {
          const th = el("th");
          const align = table.align[i];
          if (align) th.style.textAlign = align;
          addInline(th, cell.tokens, media);
          hr.append(th);
        });
        head.append(hr);
        node.append(head);
        const body = el("tbody");
        for (const row of table.rows) {
          const tr = el("tr");
          row.forEach((cell, i) => {
            const td = el("td");
            const align = table.align[i];
            if (align) td.style.textAlign = align;
            addInline(td, cell.tokens, media);
            tr.append(td);
          });
          body.append(tr);
        }
        node.append(body);
        wrap.append(node);
        parent.append(wrap);
        break;
      }
      case "hr": parent.append(el("hr", "cw-hr")); break;
      case "html": { const p = el("div", "cw-p"); p.textContent = (t as Tokens.HTML).raw; parent.append(p); break; }
      case "def": break; // a link reference definition is bookkeeping, not words
      default: {
        const p = el("div", "cw-p");
        if ("tokens" in t && t.tokens) addInline(p, t.tokens, media);
        else p.textContent = t.raw;
        parent.append(p);
      }
    }
  }
}

export function line(kind: "user" | "jarvis" | "sys", text: string): HTMLElement {
  const row = document.createElement("div");
  row.className = `cw-msg ${kind}`;
  // What you typed is shown exactly as typed; only replies carry Markdown.
  if (kind === "user") { row.append(document.createTextNode(text)); return row; }
  const { text: plain, media } = extractMedia(text);
  addBlocks(row, parse(plain), media);
  return row;
}

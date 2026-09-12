/**
 * One line in a thread's window, built from its text: addresses become
 * links, and image and video results become the picture or the player
 * itself. Always built from text, never from markup, so nothing a service
 * writes can put anything of its own on the page.
 */

/** Only https addresses are linked, as docs/HOW-IT-WORKS.md promises; a plain http one is shown as text. */
const ADDRESS = /https:\/\/[^\s<>()\[\]]+/g;
const MEDIA = /\[\[media:(image|video)\s+(https:\/\/[^\]\s]+)\]\]/gi;

/** Text into a row: the words as they are, each https address as a link. */
function addText(row: HTMLElement, value: string): void {
  let start = 0;
  for (const match of value.matchAll(ADDRESS)) {
    const index = match.index ?? 0;
    row.append(document.createTextNode(value.slice(start, index)));
    row.append(link(match[0], match[0]));
    start = index + match[0].length;
  }
  row.append(document.createTextNode(value.slice(start)));
}

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
  if (type === "image" && /\.(?:avif|gif|jpe?g|png|webp)(?:$|\?)/i.test(parsed.pathname)) {
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

export function line(kind: "user" | "jarvis" | "sys", text: string): HTMLElement {
  const row = document.createElement("div");
  row.className = `cw-msg ${kind}`;
  let cursor = 0;
  for (const match of text.matchAll(MEDIA)) {
    const index = match.index ?? 0;
    addText(row, text.slice(cursor, index));
    // Media is its own source: a result that can't be shown is left out
    // rather than left as a bare link beside the ones that can.
    const card = mediaCard(match[1]!.toLowerCase(), match[2]!);
    if (card) row.append(card);
    cursor = index + match[0].length;
  }
  addText(row, text.slice(cursor));
  return row;
}

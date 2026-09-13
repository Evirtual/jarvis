import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tokens } from "marked";

import { MEDIA_MARK, ONLY_MEDIA, extractMedia, isImageHref, parse, safeHref } from "../src/client/markdown.ts";

const types = (tokens: { type: string }[]): string[] => tokens.filter((t) => t.type !== "space").map((t) => t.type);

test("media results are lifted out before parsing and keep their order", () => {
  const { text, media } = extractMedia("Two: [[media:image https://x.org/a.png]] and [[media:video https://youtu.be/abc123]] done");
  assert.deepEqual(media, [{ type: "image", src: "https://x.org/a.png" }, { type: "video", src: "https://youtu.be/abc123" }]);
  assert.deepEqual([...text.matchAll(MEDIA_MARK)].map((m) => m[1]), ["0", "1"]);
  // the mark survives parsing as words, so the address inside is never mistaken for a link
  const [p] = parse(text) as [Tokens.Paragraph];
  assert.ok(p.tokens.every((t) => t.type === "text"), JSON.stringify(p.tokens.map((t) => t.type)));
});

test("lists nest, and a numbered list inside a bulleted one keeps its numbers", () => {
  const [list] = parse("- status — this device\n  1. load\n  2. memory\n- power") as [Tokens.List];
  assert.equal(list.type, "list");
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 2);
  const inner = list.items[0]!.tokens.find((t) => t.type === "list") as Tokens.List;
  assert.equal(inner.ordered, true);
  assert.deepEqual(inner.items.map((i) => (i.tokens[0] as Tokens.Text).text), ["load", "memory"]);
});

test("a task list, a quote, a rule, a heading and fenced code are all recognised", () => {
  const out = parse("# Summary\n\n- [x] done\n- [ ] not yet\n\n> as he said\n\n---\n\n```js\nlet x = 1;\n```").filter((t) => t.type !== "space");
  assert.deepEqual(types(out), ["heading", "list", "blockquote", "hr", "code"]);
  const list = out[1] as Tokens.List;
  assert.deepEqual(list.items.map((i) => [i.task, i.checked]), [[true, true], [true, false]]);
  const code = out[4] as Tokens.Code;
  assert.equal(code.lang, "js");
  assert.equal(code.text, "let x = 1;");
});

test("a table keeps its header, rows and alignment", () => {
  const [table] = parse("| Service | Round trip |\n|---|--:|\n| GeoJS | 48 ms |\n| ipwho.is | 61 ms |") as [Tokens.Table];
  assert.equal(table.type, "table");
  assert.deepEqual(table.header.map((c) => c.text), ["Service", "Round trip"]);
  assert.deepEqual(table.align, [null, "right"]);
  assert.deepEqual(table.rows.map((r) => r.map((c) => c.text)), [["GeoJS", "48 ms"], ["ipwho.is", "61 ms"]]);
});

test("a single newline is a line break and inline marks are read", () => {
  const [p] = parse("**bold** and *soft* and ~~gone~~ and `code`\nnext line") as [Tokens.Paragraph];
  assert.deepEqual(types(p.tokens), ["strong", "text", "em", "text", "del", "text", "codespan", "br", "text"]);
});

test("an HTML tag in a reply is a token of characters, never markup", () => {
  const [p] = parse("hello <img src=x onerror=alert(1)> there") as [Tokens.Paragraph];
  const html = p.tokens.find((t) => t.type === "html") as Tokens.HTML;
  assert.equal(html.raw, "<img src=x onerror=alert(1)>");
});

test("only an https address may be a link", () => {
  assert.equal(safeHref("https://example.org/a?b=1"), "https://example.org/a?b=1");
  assert.equal(safeHref("http://example.org"), null);
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,hi"), null);
  assert.equal(safeHref("not a url"), null);
  assert.equal(safeHref(undefined), null);
});

test("a marker without an address vanishes, and a run of marks is known as media only", () => {
  const { text, media } = extractMedia("Two clips:\n[[media:video ]]\n[[media:video]]\n[[media:video https://youtu.be/abc123]]");
  assert.equal(media.length, 1);
  assert.ok(!text.includes("[[media"), text);
  const lines = text.split("\n").filter(Boolean);
  assert.equal(ONLY_MEDIA.test(lines[lines.length - 1]!), true);
  assert.equal(ONLY_MEDIA.test("Two clips:"), false);
  assert.equal(ONLY_MEDIA.test(""), false);
  // a marker nested in a marker, as an older cleaning rule wrote it, is read as the inner address with the outer kind
  const nested = extractMedia("[[media:video [[media:image https://commons.wikimedia.org/wiki/Special:FilePath/Flight.webm]]]]");
  assert.deepEqual(nested.media, [{ type: "video", src: "https://commons.wikimedia.org/wiki/Special:FilePath/Flight.webm" }]);
  assert.ok(!nested.text.includes("[["), nested.text);
});

test("an inline image is only shown when it is an https picture", () => {
  assert.equal(isImageHref("https://x.org/p.png"), true);
  assert.equal(isImageHref("https://x.org/p.PNG?w=1"), true);
  assert.equal(isImageHref("https://x.org/page"), false);
  assert.equal(isImageHref("nope"), false);
});

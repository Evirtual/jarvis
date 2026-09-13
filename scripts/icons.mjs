// Renders every app icon and the social preview image from the one logo,
// src/client/public/icon.svg (JARVIS's core, simplified). Run after changing
// the logo:  node scripts/icons.mjs
// The PNGs are committed, so a normal build doesn't need an image library.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "src", "client", "public");
const logo = await readFile(path.join(PUBLIC, "icon.svg"), "utf8");

// The core alone, to place on other grounds. The logo itself has no tile: the
// favicon, the install icons and the README show the bare mark.
const core = logo.slice(logo.indexOf('<g transform="translate(256 256)"'), logo.lastIndexOf("</g>") + 4);
const defs = logo.slice(logo.indexOf("<defs>"), logo.indexOf("</defs>") + 7);

/**
 * A full-bleed square with the core on the dark ground (maskable / Apple
 * icons). Scaled so the outer ring meets the edge of what the platform shows —
 * the 80% circle Android's masks are guaranteed to keep, the whole square on
 * an iPhone — rather than sitting in a dark margin.
 */
const square = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}
  <rect width="512" height="512" fill="url(#ground)"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${core}</g></svg>`;

const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">${defs}
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#050b11"/><stop offset="1" stop-color="#0c2230"/>
    </linearGradient>
    <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
      <path d="M56 0H0V56" fill="none" stroke="#1d5468" stroke-opacity=".35" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <g transform="translate(300 315) scale(1.05) translate(-256 -256)">${core}</g>
  <text x="600" y="270" fill="#d6f2fa" font-family="Chakra Petch, Segoe UI, Arial, sans-serif" font-size="78" font-weight="700" letter-spacing="14">J.A.R.V.I.S.</text>
  <text x="604" y="336" fill="#6ff0ff" font-family="Chakra Petch, Segoe UI, Arial, sans-serif" font-size="26" letter-spacing="6">A CONSOLE THAT TALKS BACK</text>
  <text x="604" y="398" fill="#9fc6d2" font-family="IBM Plex Mono, Consolas, monospace" font-size="22">Real machine and network readings,</text>
  <text x="604" y="430" fill="#9fc6d2" font-family="IBM Plex Mono, Consolas, monospace" font-size="22">a voice, and threads of research</text>
  <text x="604" y="462" fill="#9fc6d2" font-family="IBM Plex Mono, Consolas, monospace" font-size="22">you run by talking.</text>
</svg>`;

const out = async (name, svg, w, h = w) => {
  const img = sharp(Buffer.from(svg), { density: 300 }).resize(w, h);
  const buf = await (name.endsWith(".jpg") ? img.jpeg({ quality: 86, mozjpeg: true }) : img.png({ compressionLevel: 9 })).toBuffer();
  await writeFile(path.join(PUBLIC, name), buf);
  console.log(`${name.padEnd(24)} ${(buf.length / 1024).toFixed(1)} KB`);
};

await out("favicon-32.png", logo, 32);
await out("icon-192.png", logo, 192);
await out("icon-512.png", logo, 512);
await out("icon-maskable-512.png", square(1), 512);
await out("apple-touch-icon.png", square(1.24), 180);
// social preview: the size Open Graph and X cards expect, as a light JPEG
await out("og-image.jpg", og, 1200, 630);

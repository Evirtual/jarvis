import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

// The client is a static bundle served by our own Node server in production.
// In dev, Vite proxies every /api call through to that server on 7823.
//
// It can also be published on its own (GitHub Pages), with no server at all:
// VITE_JARVIS_SERVERLESS=1 builds that version (see src/client/server.ts), and
// JARVIS_BASE is the path it is served under ("/jarvis/" on github.io, "/" on
// a domain of its own) — see .github/workflows/pages.yml.
const base = process.env.JARVIS_BASE ?? "/";

/** The manifest is copied as it is, so its root-relative paths get the base by hand. */
function manifestBase(): Plugin {
  let outDir = "";
  return {
    name: "jarvis-manifest-base",
    apply: "build",
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    async closeBundle() {
      if (base === "/") return;
      const file = path.join(outDir, "manifest.webmanifest");
      const m = JSON.parse(await readFile(file, "utf8")) as { id: string; start_url: string; scope: string; icons: { src: string }[] };
      const at = (p: string): string => base.replace(/\/$/, "") + p;
      m.id = at(m.id); m.start_url = at(m.start_url); m.scope = at(m.scope);
      for (const i of m.icons) i.src = at(i.src);
      await writeFile(file, JSON.stringify(m, null, 2));
    },
  };
}

/**
 * The published build keeps the user's API keys in their browser, so the page
 * is locked to the services it actually uses: even a mistake in the page could
 * not send a key anywhere else. (The PC build needs none of this — its keys
 * never reach the browser.)
 */
const SERVERLESS_CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the neural voice run in the browser; no eval of scripts
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // pictures JARVIS finds can come from anywhere on the web, but only over https
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data:",
  "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
  "connect-src 'self' https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com" +
    " https://api.open-meteo.com https://get.geojs.io https://ipwho.is https://1.1.1.1 https://www.google.com" +
    " https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function serverlessCsp(): Plugin {
  return {
    name: "jarvis-serverless-csp",
    apply: "build",
    transformIndexHtml(html) {
      if (process.env.VITE_JARVIS_SERVERLESS !== "1") return html;
      return html.replace("<meta charset=\"utf-8\">", `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${SERVERLESS_CSP}">`);
    },
  };
}

export default defineConfig({
  root: "src/client",
  base,
  // icons, manifest, service worker, robots — copied as they are (src/client/public)
  publicDir: "public",
  plugins: [manifestBase(), serverlessCsp()],
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7823",
        changeOrigin: true,
      },
    },
  },
});

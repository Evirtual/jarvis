import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

// The client is a static bundle served by our own Node server in production.
// In dev, Vite proxies every /api call through to that server on 7823.
//
// It can also be published on its own (GitHub Pages) and pointed at a server
// elsewhere: JARVIS_BASE is the path it is served under ("/jarvis/" on
// github.io, "/" on a domain of its own) and VITE_JARVIS_SERVER the server's
// https address — see .github/workflows/pages.yml and src/client/server.ts.
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

export default defineConfig({
  root: "src/client",
  base,
  // icons, manifest, service worker, robots — copied as they are (src/client/public)
  publicDir: "public",
  plugins: [manifestBase()],
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

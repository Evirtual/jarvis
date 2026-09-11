import { defineConfig } from "vite";

// The client is a static bundle served by our own Node server in production.
// In dev, Vite proxies every /api call through to that server on 7823.
export default defineConfig({
  root: "src/client",
  // icons, manifest, service worker, robots — copied as they are (src/client/public)
  publicDir: "public",
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

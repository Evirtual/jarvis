/* global self */

// What makes the console installable on a phone or desktop. It keeps nothing
// of its own: JARVIS is live readings, live answers and a live voice, so every
// request goes to the network. It does two things to what comes back:
//
// • The page itself is always fetched fresh, never from the browser's cache —
//   a cached page from before an update would ask for script files the update
//   has replaced, and open blank. (Script files are named by their contents,
//   so those can be cached safely.)
//
// • On Chromium browsers (Chrome, Edge, Brave — desktop and Android) the page
//   is made cross-origin isolated, which a static host can't do with headers.
//   Isolation is what lets the neural voice, running in the browser, use more
//   than one core: several times faster. "credentialless" keeps pictures from
//   anywhere working (fetched without cookies); videos are embedded in
//   credentialless frames to match (see stage.ts). Firefox and Safari are left
//   alone: one would block the video embeds, the other ignores it anyway.
const ISOLATE = /Chrome\//.test(self.navigator.userAgent) && !/Firefox\//.test(self.navigator.userAgent);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function isolated(res) {
  if (!ISOLATE || res.status === 0) return res; // an opaque response can't be changed, and needn't be
  const headers = new Headers(res.headers);
  headers.set("Cross-Origin-Embedder-Policy", "credentialless");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req, { cache: "no-store" }).catch(() => fetch(req)).then(isolated));
    return;
  }
  // this site's own scripts and workers carry the same policy as the page
  if (ISOLATE && new URL(req.url).origin === self.location.origin) {
    event.respondWith(fetch(req).then(isolated));
  }
});

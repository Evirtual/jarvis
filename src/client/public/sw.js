/* global self */

// What makes the console installable on a phone or desktop. It keeps nothing
// of its own: JARVIS is live readings, live answers and a live voice, so every
// request goes to the network. The one thing it changes: the page itself is
// always fetched fresh, never from the browser's cache — a cached page from
// before an update would ask for script files the update has replaced, and
// open blank. (Script files are named by their contents, so those can be
// cached safely.)

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req, { cache: "no-store" }).catch(() => fetch(req)));
  }
});

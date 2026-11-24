/* CareSpeak Service Worker v3
 * - Public shell pages: network-first with cache fallback (offline landing).
 * - Authenticated / clinical pages: NEVER cached. Cache Storage survives logout
 *   and is readable by anyone with the device, so persisting a ward board,
 *   patient records or a nurse dashboard would leak PHI to the next user.
 * - MediaPipe WASM/models on CDNs: cache-first (AI works offline after first load).
 * - /api/*: never cached (live data only).
 * - Background Sync "carespeak-flush": pings clients to flush the offline outbox.
 */
const VERSION = "carespeak-v3";
const SHELL = [
  "/", "/about", "/privacy", "/terms", "/license", "/emergency", "/hand-mode", "/eye-mode",
];
const CDN_HOSTS = ["cdn.jsdelivr.net", "storage.googleapis.com"];

/**
 * Clinical/authenticated routes. Matched by path prefix so every nested page is
 * covered. These always go straight to the network; offline they fail rather
 * than render stale patient data.
 */
const PRIVATE_PREFIXES = [
  "/api/",
  "/care",
  "/nurse-view",
  "/ward",
  "/dashboard",
  "/logs",
  "/report",
  "/cctv",
];

function isPrivate(pathname) {
  return PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.allSettled(SHELL.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // v2 cached /nurse-view, /logs and /report. Delete it immediately.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept clinical traffic: no cache read, no cache write.
  if (url.origin === self.location.origin && isPrivate(url.pathname)) return;

  // AI models + WASM: immutable content, cache forever once fetched.
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const clone = res.clone();
            caches.open(VERSION).then((c) => c.put(req, clone));
            return res;
          })
      )
    );
    return;
  }

  // Public shell: network-first, fall back to cache when offline.
  if (url.origin === self.location.origin || url.protocol === "https:") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const clone = res.clone();
            caches.open(VERSION).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || Response.error()))
    );
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "carespeak-flush") {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        for (const client of clients) client.postMessage("carespeak-flush-outbox");
      })
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

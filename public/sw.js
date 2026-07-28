const VERSION = "v1";
const STATIC_CACHE = `ref-static-${VERSION}`;
const PAGE_CACHE = `ref-pages-${VERSION}`;

const PRECACHE = ["/offline", "/manifest.json", "/icon-192.png", "/icon-512.png"];

// Assets safe to serve cache-first: content-hashed chunks and images.
const STATIC_PATTERNS = [
  /^\/_next\/static\//,
  /^\/images\//,
  /\.(?:png|jpg|jpeg|webp|avif|gif|svg|ico|woff2?)$/,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("ref-") && !k.endsWith(VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Pages are cached under origin+pathname so /?day=2 and / share one entry —
// the query only picks the initially shown day, which the client handles.
const pageKey = (url) => url.origin + url.pathname;

async function handleNavigation(req, url) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetch(req);
    // A redirected response can't be replayed for a future navigation
    // (redirect mode "manual"), so only cache clean 200s.
    if (res.ok && !res.redirected) cache.put(pageKey(url), res.clone());
    return res;
  } catch {
    const cached = await cache.match(pageKey(url));
    if (cached) return cached;
    const offline = await caches.match("/offline");
    return offline ?? Response.error();
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(req, res.clone());
  }
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && !res.redirected) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    return cached ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API calls are never cached — the app queues failed writes itself.
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(handleNavigation(req, url));
  } else if (STATIC_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(cacheFirst(req));
  } else {
    // RSC payloads and other same-origin GETs. A cache miss offline surfaces
    // as a network error, which Next turns into a full navigation that the
    // handler above serves from cache.
    event.respondWith(networkFirst(req));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "REF 2026", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "REF 2026";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});

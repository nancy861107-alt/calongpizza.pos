const CACHE_NAME = "pos-system-20260722-gzip";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=20260722-gzip",
  "./keypad-helpers.js?v=20260722-gzip",
  "./app.js?v=20260722-gzip",
  "./manifest.json",
  "./manifest.webmanifest",
  "./app-icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./calong-logo.jpg",
  "./checkout-cash-register.mp3"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isVersionedAsset =
    url.origin === location.origin &&
    !url.pathname.startsWith("/api/") &&
    /\.(css|js|jpg|jpeg|png|svg|mp3|webmanifest)$/.test(url.pathname);

  // Versioned assets never change under the same URL (deploys bump ?v= and
  // CACHE_NAME), so serve them from cache instantly for fast launches.
  if (isVersionedAsset) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // HTML and API stay network-first with cache fallback for offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

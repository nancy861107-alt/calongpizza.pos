const CACHE_NAME = "pos-system-20260713-logo-smaller";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=20260713-logo-smaller",
  "./keypad-helpers.js?v=20260713-logo-smaller",
  "./app.js?v=20260713-logo-smaller",
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

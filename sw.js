// Service worker for 保育指導案・実習記録 作成ツール
//
// Goals
//   1. Work fully offline once the app has been opened online at least once.
//   2. Pick up new versions automatically — the developer only has to re-upload
//      index.html (no build, no reinstall).
//
// Strategy
//   * The app itself (index.html etc.) is "network first": when online, the newest
//     copy is always fetched (and re-cached); when offline or the network is slow,
//     the last cached copy is used.
//   * The Excel library (ExcelJS, from a CDN) is cached at install time and then
//     served "cache first", so Excel export keeps working offline.
//
// You normally never need to edit this file. Change CACHE_NAME only if you add or
// rename files in SHELL below.

const CACHE_NAME = 'hoiku-app-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];
const EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL);
    // The Excel library lives on a CDN; keep a copy so export works offline.
    // (Failure here is not fatal — it is cached on first successful use instead.)
    try {
      const res = await fetch(EXCELJS_URL, { mode: 'cors' });
      if (res.ok) await cache.put(EXCELJS_URL, res);
    } catch (e) { /* offline during install */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  // For page navigations, fetch by URL (a navigate-mode Request can't be re-issued with options).
  const netPromise = fetch(request.mode === 'navigate' ? request.url : request, { cache: 'no-cache' })
    .then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(request.url, res.clone());
      return res;
    });
  // Keep the worker alive so the cache still gets refreshed even if we answered from cache.
  event.waitUntil(netPromise.catch(() => {}));
  try {
    return await Promise.race([
      netPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS))
    ]);
  } catch (e) {
    const cached = await cache.match(request.url, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = (await cache.match('./index.html')) || (await cache.match('./'));
      if (shell) return shell;
    }
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request.url, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(event));
  } else if (request.url === EXCELJS_URL) {
    event.respondWith(cacheFirst(request));
  }
});

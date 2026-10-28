'use strict';

const CACHE_VERSION = 'v2';
const STATIC_CACHE = 'weather-static-' + CACHE_VERSION;
const API_CACHE = 'weather-api-' + CACHE_VERSION;
const API_CACHE_LIMIT = 30;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons'
];

const API_HOSTS = ['api.open-meteo.com', 'air-quality-api.open-meteo.com', 'archive-api.open-meteo.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== STATIC_CACHE && k !== API_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (API_HOSTS.includes(url.hostname)) {
    event.respondWith(networkFirst(req));
  } else if (url.hostname.endsWith('open-meteo.com')) {
    return;
  } else {
    event.respondWith(cacheFirst(event, req));
  }
});

async function cacheFirst(event, req) {
  const cached = await caches.match(req);
  if (cached) {
    if (new URL(req.url).origin === self.location.origin) {
      event.waitUntil(updateStatic(req));
    }
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    if (req.mode === 'navigate') {
      const page = await caches.match('./index.html');
      if (page) return page;
    }
    throw err;
  }
}

async function updateStatic(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(STATIC_CACHE)).put(req, res);
  } catch (err) {}
}

async function networkFirst(req) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      const keys = await cache.keys();
      if (keys.length > API_CACHE_LIMIT) await cache.delete(keys[0]);
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (!cached) throw err;
    const headers = new Headers(cached.headers);
    headers.set('X-From-Cache', '1');
    return new Response(await cached.blob(), { status: cached.status, statusText: cached.statusText, headers });
  }
}

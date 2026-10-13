// FreshDrop POS Pro — relative paths support GitHub Pages project subpaths.
const CACHE_NAME = 'freshdrop-pos-v11';
const BASE = new URL('./', self.registration.scope);
const ASSETS = ['index.html','style.css','app.js','data/stock.js','manifest.json','assets/logo.png'].map(p => new URL(p, BASE).toString());
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('freshdrop-pos-') && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => {
    const network = fetch(event.request).then(response => {
      if (response && response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
      return response;
    });
    return cached || network.catch(() => {
      if (event.request.mode === 'navigate') return caches.match(new URL('index.html', BASE).toString());
      return new Response('Offline — resource unavailable.', {status:503, headers:{'Content-Type':'text/plain'}});
    });
  }));
});

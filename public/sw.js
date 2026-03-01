const CACHE = 'murdoku-v1'

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add('./')))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  // Network-first for HTML navigation: always fetch fresh content when online,
  // update the cache, and only fall back to the cache when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          caches.open(CACHE).then(c => c.put(e.request, response.clone()))
          return response
        })
        .catch(() => caches.match(e.request))
    )
    return
  }
  // Cache-first for everything else (fonts, icons, etc.)
  e.respondWith(
    caches.match(e.request).then(cached => cached ?? fetch(e.request))
  )
})

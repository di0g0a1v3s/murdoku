// Cache key is replaced with the git SHA by the GHA deploy workflow on each deploy,
// forcing a SW reinstall and fresh cache on every new version.
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
  // Ignore cross-origin requests.
  if (!e.request.url.startsWith(self.location.origin)) {
    return
  }

  // Stale-while-revalidate: serve from cache immediately,
  // then fetch in background and update the cache for next time.
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const networkFetch = fetch(e.request).then(response => {
          if (response.ok) {
            cache.put(e.request, response.clone());
          }
          return response
        })
        return cached ?? networkFetch
      })
    )
  )
})

// Offset service worker — network-first, so it never serves stale assets while
// online; the cache is only a fallback when the device is offline. The API and
// all cross-origin requests (Supabase, Gemini, fonts) are left untouched.
const CACHE = 'offset-v1'

// A cap, because the old version cached every same-origin GET that ever
// returned 200 and never removed anything. Each deploy renames the hashed
// bundles, so the entries from the previous one are dead the moment it ships —
// they were simply never deleted, and the store grew with every visit for the
// life of the installation. Browsers evict a whole origin's storage when it
// gets too large, which would take the ledger in demo mode with it.
//
// Sized against a real build rather than picked: one produces about 90 asset
// files, and a cap below that evicts chunks the current version is still using
// — the offline fallback then fails on exactly the pages someone toured most
// recently. This holds a full build plus its routes, and still bounds the store
// to roughly one deploy's worth instead of every deploy ever installed.
const MAX_ENTRIES = 140

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Oldest-first, which for this cache is close enough to least-useful: entries
// go in as they are first requested, so what falls off is what the app stopped
// asking for — most often a bundle from a previous deploy.
async function trim(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_ENTRIES) return
  await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map((k) => cache.delete(k)))
}

// Only what is worth having offline. Caching every 200 also meant caching
// things with no offline value and unbounded variety.
function worthCaching(url, request) {
  if (request.mode === 'navigate') return true
  return /^\/(assets|icon|manifest|favicon)/.test(url.pathname) || url.pathname === '/'
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // leave API / Supabase / fonts alone
  if (url.pathname.startsWith('/api/')) return // never cache the serverless API

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && worthCaching(url, req)) {
          const copy = res.clone()
          caches
            .open(CACHE)
            .then(async (c) => {
              await c.put(req, copy)
              await trim(c)
            })
            .catch(() => {})
        }
        return res
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error())),
      ),
  )
})

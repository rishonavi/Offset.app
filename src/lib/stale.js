// Recovering from a deploy that landed while the app was open.
//
// Every page here is a lazy import — twenty-six of them — and every build
// renames the hashed chunks. A tab that was open across a deploy is still
// holding the previous `index.html`, so the next route it opens asks for a file
// that no longer exists. An installed app on a phone is open for days, which
// makes this the normal case rather than the edge one.
//
// Nothing handled it. Vite's preload helper dispatches a cancelable
// `vite:preloadError` and rethrows when nobody prevents it, so the first nav
// item somebody pressed landed on "Something went wrong", and so did the next,
// and the next. Every page in the app was gone at once, with no message that
// said why and nothing on the screen that would fix it. The way out was a
// reload nobody had been told to do.
//
// A reload *is* the whole fix: the new index.html names the new chunks. What
// needs care is doing it sparingly, because a deploy that is genuinely broken
// would otherwise reload for ever.

export const RELOAD_KEY = 'pl_version_reload'

// Long enough that a broken deploy cannot spin, short enough that the next real
// one recovers while somebody is still looking at the screen. A one-shot mark
// was the first idea and it is wrong for this app: sessionStorage survives the
// reload, so a tab that recovered once could never recover again, and an
// installed app lives through many deploys.
export const RELOAD_COOLDOWN_MS = 120000

// What a chunk that is no longer there looks like. Browsers word it four
// different ways, and a server can make it worse: behind a catch-all SPA
// rewrite a missing `/assets/…` comes back as index.html with a 200, so the
// browser complains about the MIME type or the syntax rather than a 404.
// `vercel.json` now excludes `assets/` from that rewrite for exactly this
// reason, but the patterns stay — other hosts, and older caches, still do it.
const STALE = new RegExp(
  [
    'Failed to fetch dynamically imported module',
    'error loading dynamically imported module',
    'Importing a module script failed',
    'Unable to preload CSS',
    'expected a JavaScript(?:-or-Wasm)? module',
    "MIME type of 'text/html'",
    'is not a valid JavaScript MIME type',
    'ChunkLoadError',
  ].join('|'),
  'i',
)

export function isStaleChunkError(err) {
  if (!err) return false
  const text = typeof err === 'string' ? err : `${err.name || ''} ${err.message || ''}`
  return STALE.test(text)
}

// Whether to reload, and the mark that rate-limits it. Takes the storage and
// the clock so the rule can be tested without a browser and without waiting
// two minutes.
export function shouldReload(storage, now = Date.now()) {
  try {
    const last = Number(storage.getItem(RELOAD_KEY))
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_COOLDOWN_MS) return false
    storage.setItem(RELOAD_KEY, String(now))
    return true
  } catch {
    // A browser that refuses storage cannot be rate-limited, and a page that
    // reloads for ever is worse than one broken route. It gets the message on
    // the boundary instead.
    return false
  }
}

export function armStaleRecovery({
  target = typeof window !== 'undefined' ? window : null,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  reload = () => window.location.reload(),
  now = Date.now,
} = {}) {
  if (!target || !storage) return () => {}
  const onPreloadError = (event) => {
    if (!shouldReload(storage, now())) return
    // Only prevented when the reload is actually happening. Preventing it
    // otherwise swallows the rejection and hands React an undefined module,
    // which crashes somewhere further away with a worse message than the one
    // it started with.
    event.preventDefault()
    reload()
  }
  target.addEventListener('vite:preloadError', onPreloadError)
  return () => target.removeEventListener('vite:preloadError', onPreloadError)
}

// Whether the app can come back from a deploy that happened under it.
//
// Twenty-six routes are lazy imports and every build renames the chunks, so a
// tab open across a deploy asks for files that are gone. Vite's preload helper
// dispatches a cancelable `vite:preloadError` and rethrows when nobody prevents
// it; nobody did, so the first nav item somebody pressed landed on "Something
// went wrong" and so did every other one. Every page in the app, at once, with
// nothing on screen that would fix it.
import { readFileSync } from 'node:fs'
import {
  isStaleChunkError, shouldReload, armStaleRecovery, RELOAD_KEY, RELOAD_COOLDOWN_MS,
} from '../../src/lib/stale.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

// A storage that can be made to refuse, which is Safari in a private window.
function fakeStorage({ broken = false } = {}) {
  const map = new Map()
  return {
    get size() { return map.size },
    getItem: (k) => { if (broken) throw new Error('refused'); return map.has(k) ? map.get(k) : null },
    setItem: (k, v) => { if (broken) throw new Error('refused'); map.set(k, String(v)) },
    removeItem: (k) => { if (broken) throw new Error('refused'); map.delete(k) },
  }
}

console.log('── WHAT A MISSING CHUNK LOOKS LIKE ──')
// Each browser words it differently, and all four reach the same code.
for (const [name, message] of [
  ['Chrome', 'Failed to fetch dynamically imported module: https://x/assets/Dashboard-a1b2.js'],
  ['Firefox', 'error loading dynamically imported module'],
  ['Safari', 'Importing a module script failed.'],
  ['a stylesheet', 'Unable to preload CSS for /assets/index-c3d4.css'],
  ['an SPA rewrite answering with a page', "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of 'text/html'."],
  ['a bundler of another name', 'ChunkLoadError: Loading chunk 42 failed.'],
]) {
  ok(`${name} is recognised`, isStaleChunkError(new Error(message)), message)
}
ok('and the message on its own is enough', isStaleChunkError('Failed to fetch dynamically imported module'))

console.log('\n── AND WHAT IS NOT ──')
// The control. A predicate that said yes to everything would turn every bug in
// the app into "a new version is ready", which is a lie that hides the bug.
for (const [name, err] of [
  ['an ordinary type error', new TypeError('x.map is not a function')],
  ['a failed query', new Error('canceling statement due to statement timeout')],
  ['a refused login', new Error('Invalid login credentials')],
  ['the cloud not answering', new Error('The cloud did not answer.')],
  ['a module that loaded and then threw', new ReferenceError('supabase is not defined')],
  ['nothing at all', null],
  ['an empty error', new Error('')],
]) {
  ok(`${name} is not a stale chunk`, !isStaleChunkError(err), String(err?.message ?? err))
}

console.log('\n── THE RELOAD IS RATE-LIMITED, NOT ONE-SHOT ──')
{
  const s = fakeStorage()
  const t0 = 1_000_000
  ok('the first failure reloads', shouldReload(s, t0))
  eq('and leaves a mark', s.getItem(RELOAD_KEY), String(t0))
  ok('a second one straight after does not', !shouldReload(s, t0 + 1))
  ok('nor one a minute later', !shouldReload(s, t0 + 60_000))
  // Why not one-shot: sessionStorage survives the reload, so a mark that never
  // expired would leave a long-lived installed app unable to recover from the
  // *next* deploy, having recovered from one.
  ok('but one after the cooldown does', shouldReload(s, t0 + RELOAD_COOLDOWN_MS + 1))
  eq('and the mark moves with it', s.getItem(RELOAD_KEY), String(t0 + RELOAD_COOLDOWN_MS + 1))
}
{
  const s = fakeStorage()
  s.setItem(RELOAD_KEY, 'not a number')
  ok('a mark that is not a time is treated as none', shouldReload(s, 5_000))
  const s2 = fakeStorage()
  s2.setItem(RELOAD_KEY, '0')
  ok('and so is a zero', shouldReload(s2, 5_000))
}
{
  // A browser that refuses storage cannot be rate-limited, and a page that
  // reloads for ever is worse than one broken route — so it gets the message on
  // the boundary instead of the reload.
  ok('storage that throws does not get the reload', !shouldReload(fakeStorage({ broken: true }), 1))
}

console.log('\n── ARMED AGAINST THE EVENT VITE ACTUALLY SENDS ──')
{
  const target = new EventTarget()
  const storage = fakeStorage()
  let reloads = 0
  let clock = 2_000_000
  const off = armStaleRecovery({ target, storage, reload: () => { reloads += 1 }, now: () => clock })

  const fire = () => {
    const event = new Event('vite:preloadError', { cancelable: true })
    event.payload = new Error('Failed to fetch dynamically imported module')
    target.dispatchEvent(event)
    return event
  }

  const first = fire()
  eq('the first event reloads', reloads, 1)
  ok('and is prevented, because the page is going anyway', first.defaultPrevented)

  const second = fire()
  eq('the next one inside the cooldown does not reload', reloads, 1)
  // And it must *not* be prevented. Swallowing it hands React an undefined
  // module and the crash resurfaces somewhere further away with a worse
  // message; letting it through is what puts the new-version screen up.
  ok('and is left to throw, so the boundary can speak', !second.defaultPrevented)

  clock += RELOAD_COOLDOWN_MS + 1
  const third = fire()
  eq('after the cooldown it reloads again', reloads, 2)
  ok('and is prevented again', third.defaultPrevented)

  off()
  fire()
  eq('and nothing happens once it is torn down', reloads, 2)
}
{
  // Nothing to attach to is not a crash: this runs at module scope in main.jsx,
  // where a missing window would take the whole app down before it rendered.
  const off = armStaleRecovery({ target: null, storage: null })
  ok('no window is survivable', typeof off === 'function')
  off()
}

console.log('\n── AND THE HOST IS NOT ALLOWED TO HIDE A MISSING CHUNK ──')
{
  // A catch-all rewrite answers a deleted /assets/ file with index.html and a
  // 200, which turns a clean load failure into a MIME error and lets the
  // service worker cache a web page under a script's URL.
  const vercel = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')
  ok('the SPA rewrite excludes assets/', /\(\?!api\/\|assets\/\)/.test(vercel), vercel.trim())
  const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')
  ok('and the worker refuses to cache HTML under one', /text\/html/.test(sw) && /startsWith\('\/assets\/'\)/.test(sw))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

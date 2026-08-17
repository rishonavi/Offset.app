// A short ring of what has already gone wrong in this tab.
//
// The gap between "it broke" and a fixable bug report is usually one line: the
// error the browser printed to a console nobody had open. This keeps the last
// few in memory so a report can carry them. Nothing is transmitted from here —
// the buffer is only read when the user opens a report and chooses to attach it,
// and it dies with the tab.

const MAX = 8
const buffer = []

// Same error firing in a render loop is one entry with a count, not eight
// copies that push everything useful out of the ring.
export function recordError(source, message, stack) {
  const text = String(message ?? '').trim().slice(0, 400)
  if (!text) return
  const last = buffer[buffer.length - 1]
  if (last && last.message === text) {
    last.count += 1
    last.at = new Date().toISOString()
    return
  }
  buffer.push({
    at: new Date().toISOString(),
    source,
    message: text,
    // Enough frames to name the component; not so many that the report becomes
    // a stack dump the user can't read before sending it.
    stack: stack ? String(stack).split('\n').slice(0, 4).join('\n').slice(0, 600) : '',
    count: 1,
  })
  if (buffer.length > MAX) buffer.shift()
}

export const recentErrors = () => buffer.map((e) => ({ ...e }))
export const clearErrorLog = () => buffer.splice(0, buffer.length)

let installed = false
export function installErrorLog() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    // Failed <img>/<script> loads also fire this, without an Error object.
    if (e.error) recordError('error', e.error.message || String(e.error), e.error.stack)
    else if (e.message) recordError('error', e.message)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    recordError('promise', r?.message || String(r), r?.stack)
  })
}

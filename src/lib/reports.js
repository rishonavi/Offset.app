// "Tell the developer what went wrong."
//
// Two things make a report worth reading: what the user was doing, and what the
// app was doing at the time. Only the user can write the first. The second is
// collected here — build, page, browser, backend, and whatever the error log
// already caught — so a fix doesn't wait on a round of "which page? which
// browser?" that never gets answered.
//
// Nothing is gathered behind the user's back: describeDiagnostics() returns the
// exact list shown in the dialog before sending, and a report can be sent
// without it. What is deliberately NOT collected: names, amounts, vendors,
// addresses, tenants, documents — the ledger itself. Only counts of it.

import { recentErrors } from './errorLog'
import { readRows } from './storage/salvage'

export const REPORT_KINDS = [
  { id: 'broken', label: 'Something is broken', hint: 'It crashed, or refused to do what it says it does' },
  { id: 'wrong', label: 'A number looks wrong', hint: 'A total, balance or chart doesn’t match what you expect' },
  { id: 'confusing', label: 'I can’t work out how to do something', hint: 'It’s in here somewhere, but nothing says where' },
  { id: 'missing', label: 'Something is missing', hint: 'A feature you need that Offset doesn’t have yet' },
  { id: 'other', label: 'Something else', hint: '' },
]

export const kindLabel = (id) => REPORT_KINDS.find((k) => k.id === id)?.label || 'Report'

// ── Build stamp ────────────────────────────────────────────────────
// Injected by vite.config.js. Guarded so the module still imports under plain
// node (tests), where neither define exists.
const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
const builtAt = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

// ── Diagnostics ────────────────────────────────────────────────────

// Ids identify rows, and rows are the user's private data. A report about
// /properties/8f3e-… is a report about the asset page, so the id is dropped and
// reports about the same page group together instead of scattering.
const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|id-[a-z0-9]+|[0-9a-f]{12,}|\d+)$/i

export function routePattern(path) {
  const clean = String(path || '/').split(/[?#]/)[0]
  const out = clean
    .split('/')
    .map((seg) => (ID_SEGMENT.test(seg) ? ':id' : seg))
    .join('/')
  return out || '/'
}

// A name a human can act on ("Safari 17 on iPhone"), not the 130-character
// user-agent string that contains every engine ever shipped.
export function browserSummary(ua = '') {
  const s = String(ua)
  const browser =
    /Edg\//.test(s) ? `Edge ${(s.match(/Edg\/(\d+)/) || [])[1] || ''}`
    : /OPR\//.test(s) ? `Opera ${(s.match(/OPR\/(\d+)/) || [])[1] || ''}`
    : /Firefox\//.test(s) ? `Firefox ${(s.match(/Firefox\/(\d+)/) || [])[1] || ''}`
    : /Chrome\//.test(s) ? `Chrome ${(s.match(/Chrome\/(\d+)/) || [])[1] || ''}`
    : /Safari\//.test(s) && /Version\//.test(s) ? `Safari ${(s.match(/Version\/(\d+)/) || [])[1] || ''}`
    : 'Unknown browser'
  const os =
    /iPhone|iPad|iPod/.test(s) ? 'iOS'
    : /Android/.test(s) ? 'Android'
    : /Mac OS X/.test(s) ? 'macOS'
    : /Windows/.test(s) ? 'Windows'
    : /Linux/.test(s) ? 'Linux'
    : 'Unknown OS'
  return `${browser.trim()} on ${os}`
}

// Everything the caller knows is passed in rather than read from globals, so
// this is testable without a browser and there is one obvious list of what a
// report carries.
export function collectDiagnostics({
  route = '/',
  theme = '',
  textSize = '',
  backend = 'demo',
  plan = '',
  counts = {},
  error = null,
} = {}) {
  const w = typeof window !== 'undefined' ? window : null
  return {
    version,
    builtAt,
    at: new Date().toISOString(),
    route: routePattern(route),
    browser: browserSummary(w?.navigator?.userAgent || ''),
    viewport: w ? `${w.innerWidth}×${w.innerHeight}` : '',
    theme,
    textSize,
    backend,
    plan,
    counts: {
      assets: counts.assets ?? 0,
      expenses: counts.expenses ?? 0,
      income: counts.income ?? 0,
    },
    // The crash the user is reporting, when the report was opened from the
    // error screen — plus anything else this tab logged.
    crash: error ? { message: String(error.message || error).slice(0, 400), stack: String(error.stack || '').split('\n').slice(0, 4).join('\n').slice(0, 600) } : null,
    // The ring without its stacks, and that is the whole change.
    //
    // `recentErrors()` carries a `stack` on every entry — up to eight of them
    // at 600 characters each. Nothing showed it: not the row list below, not
    // `formatReportText`, not the admin inbox, which renders
    // `diagnostics.crash.stack` and nothing else. But `submitReportToCloud`
    // sends `report.diagnostics` whole, so those stacks were stored in the
    // browser and transmitted to the inbox, where no human ever saw them.
    // Measured: 3,364 bytes of diagnostics against the 976 the report actually
    // carries.
    //
    // This file's own header says what to do about that — "If it isn't in here,
    // it isn't attached" — and the cheapest way to keep a promise like that is
    // not to collect the thing in the first place.
    errors: recentErrors().map(({ at, source, message, count }) => ({ at, source, message, count })),
  }
}

// The literal list the dialog shows. If it isn't in here, it isn't attached.
export function describeDiagnostics(d) {
  if (!d) return []
  // `counts` is read optionally, like `crash` and `errors` beside it. It was
  // the one field dereferenced outright, and this is called on objects nobody
  // in this session built: `Admin.jsx` passes a `diagnostics` column straight
  // out of Postgres, and `formatReportText` passes one out of localStorage. A
  // row saved by any other version of this shape threw
  // `Cannot read properties of undefined (reading 'assets')` — taking out the
  // admin inbox, which is the one page that must survive a bad report.
  const c = d.counts || {}
  const assets = Number(c.assets) || 0
  const entries = (Number(c.expenses) || 0) + (Number(c.income) || 0)
  const rows = [
    ['Page', d.route],
    ['Offset version', d.builtAt ? `${d.version} (built ${d.builtAt.slice(0, 10)})` : d.version],
    ['Browser', d.browser],
    ['Window size', d.viewport],
    ['Appearance', [d.theme, d.textSize && `${d.textSize} text`].filter(Boolean).join(', ')],
    ['Storage', d.backend === 'cloud' ? 'Cloud sync' : 'This browser only'],
    ['Plan', d.plan],
    ['Portfolio size', `${assets} assets, ${entries} entries`],
  ]
  if (d.crash) rows.push(['Error on screen', d.crash.message])
  // The stack goes out under its own heading in `formatReportText` and the
  // admin inbox renders it, but this list — the one shown before anything is
  // sent — never mentioned it existed. Named rather than printed: four lines of
  // bundled frames in a consent list is a wall nobody reads, and what somebody
  // needs to decide is that it is there and roughly how much of it.
  if (d.crash?.stack) {
    const lines = d.crash.stack.split('\n').filter((l) => l.trim()).length
    rows.push(['Technical detail', `${lines} line${lines === 1 ? '' : 's'} of stack trace`])
  }
  if (d.errors?.length) rows.push([`Recent errors (${d.errors.length})`, d.errors.map((e) => e.message).join(' · ').slice(0, 160)])
  return rows.filter(([, v]) => v !== '' && v != null).map(([label, value]) => ({ label, value: String(value) }))
}

// ── The report itself ──────────────────────────────────────────────

export function validateReport(draft) {
  const errors = {}
  const message = (draft.message || '').trim()
  if (!message) errors.message = 'Tell us what happened — even one line helps.'
  else if (message.length < 10) errors.message = 'A little more detail, please — what were you doing when it happened?'
  const email = (draft.email || '').trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'That doesn’t look like an email address.'
  return errors
}

// Short enough to read down the phone, unique enough to find in a list. No
// vowels, so it can't spell anything unfortunate.
const ALPHABET = '0123456789BCDFGHJKLMNPQRSTVWXYZ'
export function newReference() {
  const bytes = new Uint8Array(6)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return 'OF-' + [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')
}

// What actually gets sent — as text, because a plain-text report can be pasted
// into an email, an issue tracker or a chat and still be readable.
export function formatReportText(report) {
  const lines = [
    `Offset report ${report.reference}`,
    `Type: ${kindLabel(report.kind)}`,
    `Sent: ${new Date(report.created_at).toLocaleString()}`,
    report.email ? `Reply to: ${report.email}` : 'Reply to: (not given)',
    '',
    'WHAT HAPPENED',
    (report.message || '').trim(),
  ]
  if ((report.expected || '').trim()) {
    lines.push('', 'WHAT I EXPECTED', report.expected.trim())
  }
  if (report.diagnostics) {
    lines.push('', 'DIAGNOSTICS')
    for (const { label, value } of describeDiagnostics(report.diagnostics)) lines.push(`${label}: ${value}`)
    if (report.diagnostics.crash?.stack) lines.push('', 'STACK', report.diagnostics.crash.stack)
  } else {
    lines.push('', '(The reporter chose not to attach diagnostics.)')
  }
  return lines.join('\n')
}

export const SUPPORT_EMAIL = String(import.meta.env?.VITE_SUPPORT_EMAIL || '').trim()

// How long a `mailto:` may be before the mail client starts deciding for
// itself. Outlook on Windows cuts around 2,048 characters and several clients do
// it without saying so, which is the failure that matters: somebody presses
// "email it", a window opens, they send what is in it, and the half of the
// report that explained the bug was dropped on the way. A measured report with a
// crash and a full error ring already runs to about 1,460.
export const MAILTO_LIMIT = 1900

export function mailtoLink(report, to = SUPPORT_EMAIL) {
  // Trimmed, because a whitespace-only address is not an address. `SUPPORT_EMAIL`
  // is trimmed where it is read, so the default could not be blank — but this is
  // an exported function with a `to` parameter, and `!to` let "   " through and
  // built `mailto:   ?subject=…`, which opens a compose window addressed to
  // nothing.
  const addr = String(to || '').trim()
  if (!addr) return ''
  const subject = `Offset ${report.reference} — ${kindLabel(report.kind)}`
  const head = `mailto:${addr}?subject=${encodeURIComponent(subject)}&body=`
  const text = formatReportText(report)
  const full = head + encodeURIComponent(text)
  if (full.length <= MAILTO_LIMIT) return full
  // Cut it here, visibly, rather than let the mail client cut it silently. The
  // sections most worth keeping are first — what happened, then what was
  // expected, then diagnostics, then the stack — so this loses the right end,
  // and the marker tells both the reporter and whoever reads it that there is
  // more. The whole thing is still in Settings → Reports, ready to paste.
  const note = '\n\n[Cut short to fit an email. The full report is in Settings → Reports — paste it instead.]'
  const room = MAILTO_LIMIT - head.length - encodeURIComponent(note).length
  let keep = text.length
  while (keep > 0 && encodeURIComponent(text.slice(0, keep)).length > room) {
    keep -= Math.max(1, Math.ceil((encodeURIComponent(text.slice(0, keep)).length - room) / 3))
  }
  return head + encodeURIComponent(text.slice(0, Math.max(0, keep)) + note)
}

// ── Outbox ─────────────────────────────────────────────────────────
// Every report is written down here first. Someone reporting a bug has already
// had one thing fail on them; losing what they just typed because the next step
// also failed is not an acceptable second.

const KEY = 'pl_reports'
const MAX_KEPT = 50

// Read through `storage/salvage.js`, for the reason that file exists: a key that
// will not parse answered `[]` here, which is indistinguishable from an empty
// outbox — and the next `saveReport` wrote `[theOneNewReport]` straight over it.
// Half-written text can be picked over by hand; overwritten text is gone.
//
// This module's own reason for existing is that "someone reporting a bug has
// already had one thing fail on them", so quietly destroying the reports they
// filed earlier is not a defensible second. `readRows` copies the raw value
// aside before anything can write over it and notes the key, which is what puts
// it in the banner that names damaged keys.
export function listReports() {
  return readRows(KEY)
}

function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_KEPT)))
  } catch {
    // The one message that is actually useful here: the report is still on
    // screen, and copying it doesn't need storage at all.
    throw new Error('There’s no room left in this browser’s storage to file the report. Copy it instead — that needs no storage.')
  }
}

export function saveReport(draft, diagnostics) {
  const report = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
    reference: newReference(),
    kind: draft.kind || 'other',
    message: (draft.message || '').trim(),
    expected: (draft.expected || '').trim(),
    email: (draft.email || '').trim(),
    diagnostics: diagnostics || null,
    created_at: new Date().toISOString(),
    status: 'saved',
  }
  persist([...listReports(), report])
  return report
}

export function markReportSent(id, how) {
  const list = listReports().map((r) => (r.id === id ? { ...r, status: 'sent', sent_how: how, sent_at: new Date().toISOString() } : r))
  persist(list)
  return list.find((r) => r.id === id)
}

export function deleteReport(id) {
  persist(listReports().filter((r) => r.id !== id))
}

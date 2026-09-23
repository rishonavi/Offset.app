// Gmail bill import. Connects the user's Gmail (read-only) via Google Identity
// Services, finds recent emails that look like bills/invoices, and reads each
// attachment with the Gemini scanner (/api/scan-receipt). Everything runs in the
// browser with the user's own OAuth token — nothing is stored server-side.
//
// Requires the same VITE_GOOGLE_CLIENT_ID as the Drive backup, with the Gmail
// API enabled and the gmail.readonly scope added to the OAuth consent screen.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const MAX_ATT_B64 = 4_400_000 // skip parsing attachments bigger than Vercel's limit

export const gmailConfigured = Boolean(CLIENT_ID)

let accessToken = null
export const isGmailConnected = () => Boolean(accessToken)

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const existing = document.getElementById('gis-script')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Google script')))
      return
    }
    const s = document.createElement('script')
    s.id = 'gis-script'
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google script'))
    document.head.appendChild(s)
  })
}

export async function connectGmail() {
  if (!CLIENT_ID) throw new Error('Gmail import is not configured (set VITE_GOOGLE_CLIENT_ID).')
  await loadGis()
  return new Promise((resolve, reject) => {
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error) return reject(new Error(resp.error))
          accessToken = resp.access_token
          resolve(true)
        },
      })
      client.requestAccessToken({ prompt: '' })
    } catch (e) {
      reject(e)
    }
  })
}

async function gmail(path) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (r.status === 401) {
    accessToken = null
    throw new Error('Gmail session expired — please connect again.')
  }
  if (!r.ok) throw new Error(`Gmail API error (${r.status}).`)
  return r.json()
}

const b64urlToB64 = (s) => {
  let b = (s || '').replace(/-/g, '+').replace(/_/g, '/')
  while (b.length % 4) b += '=' // Gmail omits base64url padding
  return b
}

function header(payload, name) {
  const h = (payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

// Walk the MIME tree collecting pdf/image attachments.
function findAttachments(payload) {
  const out = []
  const walk = (part) => {
    if (!part) return
    const mt = part.mimeType || ''
    if (part.body?.attachmentId && part.filename && (mt === 'application/pdf' || mt.startsWith('image/'))) {
      out.push({ attachmentId: part.body.attachmentId, filename: part.filename, mimeType: mt })
    }
    ;(part.parts || []).forEach(walk)
  }
  walk(payload)
  return out
}

// Find recent bill-like emails, read the first attachment of each and parse it
// with Gemini. onProgress(done, total) drives the UI. Returns candidates with a
// `parsed` field ({amount,tax,date,vendor,category}) — empty if unreadable.
// `parse` is off for the picker on the expense form. There, somebody is
// attaching one bill they already have in mind, and the form has its own Scan
// button for reading it — running Gemini over fifteen attachments to fill in
// figures nobody asked for would be slow and would spend a scan from their
// monthly allowance for each one.
export async function fetchBillCandidates({ max = 15, parse = true, onProgress } = {}) {
  const q = encodeURIComponent('has:attachment newer_than:120d (invoice OR bill OR receipt OR statement OR "tax invoice" OR payment)')
  const list = await gmail(`messages?q=${q}&maxResults=${max}`)
  const ids = (list.messages || []).map((m) => m.id)
  const out = []
  let done = 0
  for (const id of ids) {
    try {
      const msg = await gmail(`messages/${id}?format=full`)
      const atts = findAttachments(msg.payload)
      if (atts.length) {
        const att = atts[0]
        const a = await gmail(`messages/${id}/attachments/${att.attachmentId}`)
        const data = b64urlToB64(a.data || '')
        let parsed = {}
        if (parse && data && data.length <= MAX_ATT_B64) {
          parsed =
            (await fetch('/api/scan-receipt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ media_type: att.mimeType, data }),
            })
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)) || {}
        }
        out.push({
          id,
          filename: att.filename,
          mimeType: att.mimeType,
          data,
          subject: header(msg.payload, 'Subject'),
          from: header(msg.payload, 'From'),
          parsed,
        })
      }
    } catch {
      /* skip this message */
    }
    done += 1
    onProgress?.(done, ids.length)
  }
  return out
}

// The same listing without the reading: what is attached to recent bill-like
// mail, so somebody can pick one. Named rather than left as an option on the
// call above, because the two uses are different jobs and the difference is
// worth reading at the call site.
export const fetchBillAttachments = (opts = {}) => fetchBillCandidates({ ...opts, parse: false })

// One row for the picker. Gmail's From header is "Name <addr@host>" and the
// name is the useful half; a subject can be a hundred characters of reference
// number, and a filename is often just "invoice.pdf". Between the three there
// is usually one line worth showing.
export function billSummary(candidate) {
  // `= {}` only covers undefined, and null comes back from plenty of places
  // that "have no candidate". Caught by the test, which passed on undefined
  // and threw on null.
  const cand = candidate || {}
  const from = String(cand.from || '')
  const name = (from.match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || from.replace(/[<>]/g, '') || ''
  return {
    file: cand.filename || 'Attachment',
    who: name.trim(),
    subject: String(cand.subject || '').trim(),
    // Bytes, from base64's 4:3 ratio, minus the padding. Shown so nobody picks
    // a 30MB scan on a site connection without knowing.
    bytes: cand.data ? Math.round((cand.data.length * 3) / 4) - (cand.data.endsWith('==') ? 2 : cand.data.endsWith('=') ? 1 : 0) : 0,
  }
}

// Rebuild a File from a candidate's base64 attachment, for uploadReceipt().
export function attachmentToFile(cand) {
  const bin = atob(cand.data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], cand.filename || 'bill', { type: cand.mimeType || 'application/octet-stream' })
}

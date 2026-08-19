// Vercel serverless function: emails a problem report to the operator.
//
// The admin inbox (supabase/reports.sql) is where reports are read; this is how
// the operator finds out one arrived without going to look. Both are optional
// and independent — a deployment can have either, both, or neither, and the
// report dialog says which of them actually took the report.
//
// Env:
//   REPORTS_EMAIL   (required) where reports are sent, e.g. you@example.com
//   RESEND_API_KEY  (required) https://resend.com — free tier is plenty
//   REPORTS_FROM    (optional) verified sender; defaults to Resend's sandbox
//                   address, which only delivers to the account's own email
//
// Unset any of the required ones and this answers 501, which the client treats
// as "email delivery isn't set up here" rather than as a failure.

import { requireUserIfConfigured } from './_auth.js'
import { rateLimited } from './_rate.js'

export const config = { maxDuration: 15 }

const to = () => (process.env.REPORTS_EMAIL || '').trim()
const apiKey = () => (process.env.RESEND_API_KEY || '').trim()
const from = () => (process.env.REPORTS_FROM || 'Offset <onboarding@resend.dev>').trim()
const configured = () => Boolean(to() && apiKey())

async function readBody(req) {
  if (req.body != null && req.body !== '') {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  }
  const chunks = []
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const escape = (s) =>
  String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, configured: configured() })
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  // Once this deployment has accounts, only a signed-in user can send mail
  // through it. With no accounts (demo deployments) there is nothing to check.
  const auth = await requireUserIfConfigured(req)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }
  if (!configured()) {
    res.status(501).json({ error: 'email_not_configured' })
    return
  }

  let body
  try {
    body = await readBody(req)
  } catch {
    res.status(400).json({ error: 'bad_json' })
    return
  }

  const reference = String(body.reference || '').slice(0, 32) || 'OF-------'
  const subject = String(body.subject || `Offset report ${reference}`).slice(0, 200)
  const text = String(body.text || '').slice(0, 20000)
  if (!text.trim()) {
    res.status(400).json({ error: 'empty_report' })
    return
  }

  // A cheap ceiling on how much mail one caller can cause. The real limit lives
  // in submit_report() in Postgres, which counts across every instance; this
  // only stops one script from filling an inbox before Postgres is consulted.
  if (rateLimited(req, res, auth.user, { max: 10 })) return

  // The reporter's address goes in Reply-To, never in From — From must stay a
  // sender the domain actually authorises, or the mail gets filed as spam.
  const replyTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.replyTo || '')) ? String(body.replyTo) : null

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: from(),
        to: [to()],
        subject,
        text,
        // Monospace, because half of a report is a route, a version and a stack.
        html: `<pre style="font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap">${escape(text)}</pre>`,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      res.status(502).json({ error: 'send_failed', status: r.status, detail: detail.slice(0, 300) })
      return
    }
    res.status(200).json({ ok: true, reference })
  } catch (e) {
    res.status(502).json({ error: 'send_failed', detail: String(e?.message || e).slice(0, 300) })
  }
}

// Server-side delivery for problem reports. The local outbox in reports.js is
// written first and always survives; this decides whether a report also
// *reached* anyone.
//
// Two independent destinations, because they answer different questions:
//   • the admin inbox (supabase/reports.sql) — where reports are read and
//     triaged, and the only place their text is shown in the app;
//   • an email to the operator (/api/report) — how they find out one arrived
//     without going to look.
//
// A deployment can have either, both or neither. Delivery reports back exactly
// which of them took the report, so the dialog never claims a send that didn't
// happen.
import { supabase } from './supabaseClient'
import { authHeaders } from './authHeader'
import { formatReportText, kindLabel } from './reports'

export const cloudReportsAvailable = () => Boolean(supabase)

// The reporter's identity is taken from their token inside submit_report(), not
// from anything sent here — the email below is only "where to reply".
export async function submitReportToCloud(report) {
  if (!supabase) throw new Error('Cloud reporting needs Supabase credentials.')
  const { data, error } = await supabase.rpc('submit_report', {
    p_reference: report.reference,
    p_kind: report.kind,
    p_message: report.message,
    p_expected: report.expected || null,
    p_email: report.email || null,
    p_diagnostics: report.diagnostics || null,
  })
  if (error) throw new Error(friendly(error))
  return data
}

// Postgres speaks in error codes; the person who just hit a bug should not have
// to.
function friendly(error) {
  const m = String(error?.message || '')
  if (m.includes('too_many_reports')) return 'That’s a lot of reports today — try again tomorrow, or email this one instead.'
  if (m.includes('not_signed_in')) return 'You need to be signed in to send a report from here.'
  if (m.includes('empty_report')) return 'The report came through empty.'
  if (m.includes('Could not find the function') || m.includes('does not exist')) {
    return 'The report inbox isn’t set up on this deployment yet.'
  }
  return m || 'Could not send the report.'
}

// Posts the same plain text the user can read and copy — no separate wire
// format, so what the operator receives is exactly what the reporter saw.
export async function emailReportToOperator(report) {
  const res = await fetch('/api/report', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      reference: report.reference,
      subject: `Offset ${report.reference} — ${kindLabel(report.kind)}`,
      text: formatReportText(report),
      replyTo: report.email || null,
    }),
  })
  // 501 = the endpoint is there but has no mail credentials; 404 = there is no
  // endpoint at all (a static host). Both mean "email isn't set up here", which
  // is a configuration fact, not a failure to tell the user about.
  if (res.status === 501 || res.status === 404) return { sent: false, why: 'not_configured' }
  if (res.status === 429) throw new Error('That’s a lot of reports in one hour — try again later.')
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error === 'unauthorized' ? 'Sign in to send a report by email.' : 'The report couldn’t be emailed.')
  }
  return { sent: true }
}

// Tries both destinations and says what happened to each:
//   'ok' | 'failed' | 'off'   ('off' = not set up on this deployment)
export async function deliverReport(report) {
  const out = { inbox: 'off', email: 'off', why: '' }

  if (supabase) {
    try {
      await submitReportToCloud(report)
      out.inbox = 'ok'
    } catch (e) {
      out.inbox = 'failed'
      out.why = e?.message || 'Could not reach the report inbox.'
    }
  }

  try {
    const { sent } = await emailReportToOperator(report)
    out.email = sent ? 'ok' : 'off'
  } catch (e) {
    out.email = 'failed'
    if (!out.why) out.why = e?.message || 'Could not email the report.'
  }

  return out
}

export const wasDelivered = (d) => d?.inbox === 'ok' || d?.email === 'ok'

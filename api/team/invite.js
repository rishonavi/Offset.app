// Share your workspace (read-only) with another Offset user by email. The
// caller is verified from their Supabase access token; the invitee must already
// have an account. Writes the membership with the service role (bypasses RLS).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from '@supabase/supabase-js'
import { requireUser } from '../_auth.js'

async function findUserByEmail(admin, email) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) break
    const hit = (data?.users || []).find((u) => (u.email || '').toLowerCase() === email)
    if (hit) return hit
    if (!data || data.users.length < 200) break
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }
  const url = process.env.SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRole) {
    res.status(501).json({ error: 'Sharing is not configured.' })
    return
  }

  const auth = await requireUser(req)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }
  const owner = auth.user

  const admin = createClient(url, serviceRole)
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const email = String(body.email || '').trim().toLowerCase()
    const role = body.role === 'editor' ? 'editor' : 'viewer'
    if (!email) {
      res.status(400).json({ error: 'missing_email' })
      return
    }
    if (email === (owner.email || '').toLowerCase()) {
      res.status(400).json({ error: 'That’s your own email.' })
      return
    }

    const invitee = await findUserByEmail(admin, email)
    if (!invitee) {
      res.status(404).json({ error: 'No Offset account with that email — ask them to sign up first.' })
      return
    }

    const { error } = await admin.from('memberships').upsert(
      {
        owner_id: owner.id,
        member_id: invitee.id,
        owner_email: owner.email,
        member_email: invitee.email,
        role,
      },
      { onConflict: 'owner_id,member_id' },
    )
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.status(200).json({ ok: true, member_email: invitee.email, role })
  } catch (err) {
    res.status(500).json({ error: err?.message || 'invite_failed' })
  }
}

// Client helpers for read-only workspace sharing (cloud mode only).
import { supabase } from './supabaseClient'

export async function listTeam() {
  if (!supabase) return { sharedByMe: [], sharedWithMe: [] }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const me = user?.id
  const { data, error } = await supabase.from('memberships').select('*')
  if (error || !me) return { sharedByMe: [], sharedWithMe: [] }
  return {
    sharedByMe: (data || []).filter((m) => m.owner_id === me),
    sharedWithMe: (data || []).filter((m) => m.member_id === me),
  }
}

export async function inviteMember(email, role = 'viewer') {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Please sign in again.')
  const r = await fetch('/api/team/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, role }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d?.error || 'Could not share.')
  return d
}

export async function removeMembership(id) {
  const { error } = await supabase.from('memberships').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

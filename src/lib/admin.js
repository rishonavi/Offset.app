// Client helpers for the operator/platform admin area. Every call is a
// SECURITY DEFINER RPC guarded by is_admin() in Postgres, so a non-admin
// session simply gets an error — the gate is enforced server-side, not here.
import { supabase } from './supabaseClient'

// Cheap check used to decide whether to show the Admin nav/route. Real access
// control is the is_admin() guard inside every admin_* function.
export async function checkIsAdmin() {
  if (!supabase) return false
  const { data, error } = await supabase.rpc('is_admin')
  if (error) return false
  return data === true
}

export async function adminOverview() {
  const { data, error } = await supabase.rpc('admin_overview')
  if (error) throw error
  return data
}

export async function adminListUsers(search = '', limit = 50, offset = 0) {
  const { data, error } = await supabase.rpc('admin_list_users', {
    p_search: search,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return data || []
}

export async function adminSetPlan(userId, plan) {
  const { data, error } = await supabase.rpc('admin_set_plan', { p_target: userId, p_plan: plan })
  if (error) throw error
  return data
}

export async function adminAuditLog(limit = 50) {
  const { data, error } = await supabase.rpc('admin_audit_log', { p_limit: limit })
  if (error) throw error
  return data || []
}

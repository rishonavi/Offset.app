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

// ── Roles & admin management ──
export async function adminRole() {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('admin_role')
  if (error) return null
  return data || null
}

export async function adminListAdmins() {
  const { data, error } = await supabase.rpc('admin_list_admins')
  if (error) throw error
  return data || []
}

export async function adminAddAdmin(email, role = 'admin') {
  const { data, error } = await supabase.rpc('admin_add_admin', { p_email: email, p_role: role })
  if (error) throw error
  return data
}

export async function adminRemoveAdmin(userId) {
  const { error } = await supabase.rpc('admin_remove_admin', { p_uid: userId })
  if (error) throw error
}

// ── Endpoint health ──
export async function adminHealth() {
  const check = async (url) => {
    try {
      const r = await fetch(url)
      const d = await r.json().catch(() => ({}))
      return { reachable: r.ok, ...d }
    } catch {
      return { reachable: false, configured: false }
    }
  }
  const [scan, parse, ask] = await Promise.all([
    check('/api/scan-receipt'),
    check('/api/parse-entry'),
    check('/api/ask'),
  ])
  return { scan, parse, ask }
}

// ── Problem reports ──
// Needs supabase/reports.sql. Missing on a deployment that hasn't applied it,
// so callers treat a failure as "no inbox yet" rather than an error worth
// shouting about.
export async function adminListReports(status = '', limit = 50) {
  const { data, error } = await supabase.rpc('admin_list_reports', {
    p_status: status,
    p_limit: limit,
    p_offset: 0,
  })
  if (error) throw error
  return data || []
}

export async function adminReportCounts() {
  const { data, error } = await supabase.rpc('admin_report_counts')
  if (error) throw error
  return data || {}
}

export async function adminSetReportStatus(id, status, note = null) {
  const { data, error } = await supabase.rpc('admin_set_report_status', {
    p_id: id,
    p_status: status,
    p_note: note,
  })
  if (error) throw error
  return data
}

// ── App config ──
export async function adminSetConfig(key, value) {
  const { data, error } = await supabase.rpc('admin_set_config', { p_key: key, p_value: value })
  if (error) throw error
  return data
}

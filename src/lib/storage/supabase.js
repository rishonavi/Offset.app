// Supabase backend — Postgres tables + Auth + private Storage bucket.
import { supabase } from '../supabaseClient'

const RECEIPT_BUCKET = 'receipts'

async function requireUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return user.id
}

// When an editor is acting inside another user's (shared) workspace, new rows
// and uploaded files must be stamped with the *owner's* id — not the editor's —
// so the data belongs to the shared workspace. DataContext sets this to the
// active workspace owner, or null for your own workspace / read-only viewing.
let writeOwnerId = null
export function setWriteOwner(id) {
  writeOwnerId = id || null
}
async function ownerForWrite() {
  return writeOwnerId || (await requireUserId())
}

// ── Auth ───────────────────────────────────────────────────────────
export async function getCurrentUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
export function onAuthStateChange(cb) {
  supabase.auth.getSession().then(({ data: { session } }) => cb(session?.user ?? null))
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null))
  return () => subscription.unsubscribe()
}
export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.user
}
export async function signUp({ email, password }) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data // { user, session } — session may be null if email confirmation is on
}
export async function signInWithProvider(provider) {
  // provider: 'google' | 'apple'
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin },
  })
  if (error) throw error
  return data
}
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// ── Plan (commercial tier; set by the Stripe webhook) ──────────────
export async function getPlan() {
  try {
    const user_id = await requireUserId()
    const { data } = await supabase.from('profiles').select('plan').eq('user_id', user_id).maybeSingle()
    return data?.plan || 'free'
  } catch {
    return 'free'
  }
}
// In cloud mode the plan is authoritative (Stripe → webhook → profiles), so a
// client-side setter is intentionally a no-op.
export async function setPlan() {
  /* managed by Stripe webhook */
}

// ── Properties ─────────────────────────────────────────────────────
export async function getProperties() {
  const { data, error } = await supabase.from('properties').select('*').order('name')
  if (error) throw error
  return data
}
export async function addProperty(payload) {
  const user_id = await ownerForWrite()
  const { data, error } = await supabase
    .from('properties')
    .insert({ ...payload, user_id })
    .select()
    .single()
  if (error) throw error
  return data
}
export async function updateProperty(id, payload) {
  const { data, error } = await supabase
    .from('properties')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
export async function deleteProperty(id) {
  const { error } = await supabase.from('properties').delete().eq('id', id)
  if (error) throw error
}

// ── Expenses ───────────────────────────────────────────────────────
export async function getExpenses() {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .order('date', { ascending: false })
  if (error) throw error
  return data
}
export async function addExpense(payload) {
  const user_id = await ownerForWrite()
  const { data, error } = await supabase
    .from('expenses')
    .insert({ ...payload, user_id })
    .select()
    .single()
  if (error) throw error
  return data
}
export async function updateExpense(id, payload) {
  const { data, error } = await supabase
    .from('expenses')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
export async function deleteExpense(id) {
  const { error } = await supabase.from('expenses').delete().eq('id', id)
  if (error) throw error
}

// ── Income ─────────────────────────────────────────────────────────
export async function getIncome() {
  const { data, error } = await supabase.from('income').select('*').order('date', { ascending: false })
  if (error) throw error
  return data
}
export async function addIncome(payload) {
  const user_id = await ownerForWrite()
  const { data, error } = await supabase.from('income').insert({ ...payload, user_id }).select().single()
  if (error) throw error
  return data
}
export async function updateIncome(id, payload) {
  const { data, error } = await supabase.from('income').update(payload).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteIncome(id) {
  const { error } = await supabase.from('income').delete().eq('id', id)
  if (error) throw error
}

// ── Personal expenses & budgets (not tied to an asset) ─────────────
export async function getPersonalExpenses() {
  const { data, error } = await supabase.from('personal_expenses').select('*').order('date', { ascending: false })
  if (error) throw error
  return data
}
export async function addPersonalExpense(payload) {
  const user_id = await requireUserId()
  const { data, error } = await supabase.from('personal_expenses').insert({ ...payload, user_id }).select().single()
  if (error) throw error
  return data
}
export async function updatePersonalExpense(id, payload) {
  const { data, error } = await supabase.from('personal_expenses').update(payload).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deletePersonalExpense(id) {
  const { error } = await supabase.from('personal_expenses').delete().eq('id', id)
  if (error) throw error
}
export async function getPersonalBudgets() {
  const { data, error } = await supabase.from('personal_budgets').select('*')
  if (error) throw error
  return data
}
export async function setPersonalBudget(category, monthly_limit) {
  const user_id = await requireUserId()
  const { data, error } = await supabase
    .from('personal_budgets')
    .upsert({ user_id, category, monthly_limit }, { onConflict: 'user_id,category' })
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Documents (leases, insurance, warranties…) ─────────────────────
export async function getDocuments() {
  const { data, error } = await supabase.from('documents').select('*').order('expiry_date', { ascending: true })
  if (error) throw error
  return data
}
export async function addDocument(payload) {
  const user_id = await ownerForWrite()
  const { data, error } = await supabase.from('documents').insert({ ...payload, user_id }).select().single()
  if (error) throw error
  return data
}
export async function deleteDocument(id) {
  const { error } = await supabase.from('documents').delete().eq('id', id)
  if (error) throw error
}

// ── Receipts (private bucket: store the path, serve via signed URL) ──
export async function uploadReceipt(file) {
  // Store under the workspace owner's folder so shared readers can view it.
  const user_id = await ownerForWrite()
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `${user_id}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  return path // stored in expenses.receipt_url
}
export async function getReceiptUrl(stored) {
  if (!stored) return null
  // Older/imported rows might already hold a full URL.
  if (/^https?:|^data:/.test(stored)) return stored
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(stored, 60 * 60)
  if (error) return null
  return data.signedUrl
}

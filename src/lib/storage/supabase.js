// Supabase backend — Postgres tables + Auth + private Storage bucket.
import { client } from '../supabaseClient'

const RECEIPT_BUCKET = 'receipts'

async function requireUserId() {
  const supabase = await client()
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
  const supabase = await client()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
// How long to wait for the cloud to name the signed-in user before telling
// somebody that it is not answering.
//
// `getSession()` is not one request. With a stored session whose access token
// has expired it refreshes the token first, and gotrue retries that several
// times before giving up. Measured against a host that refuses the connection,
// the promise settled after about 35 seconds; against one that accepts the
// connection and never replies, it does not settle at all. Both are what a
// paused or deleted Supabase project looks like from a browser, and both left
// this app sitting on "Starting up…" with nothing to read and nothing to click.
//
// Eight seconds is longer than a cold token refresh on a slow mobile connection
// and far shorter than either of those. It bounds the wait and not the request:
// the attempt is left running, and if it succeeds afterwards the listener
// reports the user and the app carries on as though nothing had happened.
const SESSION_WAIT_MS = 8000

// The one that cannot simply become async: callers expect an unsubscribe back
// immediately, and a Promise is not one. So the client is fetched in the
// background and the returned function covers both cases — unsubscribing if the
// subscription has arrived, and making sure it never subscribes if the caller
// has already gone. Without that second half, a component that mounts and
// unmounts faster than the library downloads leaks a listener that outlives it.
//
// It answers `cb(user, error)`, and the second argument is not the same fact as
// the first being null: no user means nobody is signed in, an error means we
// could not find out. Told apart because they need opposite things from the
// person reading the screen — sign in again, or wait and try again — and
// because reporting the second as the first logs somebody out of books that are
// still there.
//
// `getClient` is a parameter so the three ways this fails can be tested without
// a browser or a Supabase project.
export function watchAuth(getClient, cb, waitMs = SESSION_WAIT_MS) {
  let subscription = null
  let timer = null
  let stopped = false
  let reported = false
  const report = (user, error = null) => {
    if (stopped) return
    reported = true
    cb(user, error)
  }

  getClient()
    .then((supabase) => {
      if (stopped) return
      // No cloud in this build: nobody is signed in, and that is an answer
      // rather than a failure.
      if (!supabase) return report(null)

      timer = setTimeout(() => {
        // Only if nothing has been said yet. The listener below can answer
        // first, and a timer firing after it would sign out somebody who is
        // sitting there signed in.
        if (!reported) report(null, new Error('The cloud did not answer.'))
      }, waitMs)

      supabase.auth
        .getSession()
        .then(({ data, error }) => {
          if (error) throw error
          report(data?.session?.user ?? null)
        })
        .catch((error) => report(null, error))
        .finally(() => clearTimeout(timer))

      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        report(session?.user ?? null)
      })
      subscription = data.subscription
      if (stopped) subscription.unsubscribe()
    })
    // The library failing to arrive at all: a chunk that 404s because a deploy
    // replaced it, or a browser with no network. This was the worst of the
    // three, because the import rejects in milliseconds and the spinner still
    // ran for the life of the page.
    .catch((error) => report(null, error))

  return () => {
    stopped = true
    clearTimeout(timer)
    subscription?.unsubscribe()
  }
}

export const onAuthStateChange = (cb) => watchAuth(client, cb)

export async function signIn({ email, password }) {
  const supabase = await client()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.user
}
export async function signUp({ email, password }) {
  const supabase = await client()
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data // { user, session } — session may be null if email confirmation is on
}
export async function signInWithProvider(provider) {
  const supabase = await client()
  // provider: 'google' | 'facebook' | 'apple' — whatever is switched on under
  // Authentication → Providers in the Supabase project. Nothing here needs a
  // key: the client ID and secret live in Supabase, not in the bundle.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin },
  })
  if (error) throw error
  return data
}
export async function signOut() {
  const supabase = await client()
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// ── Plan (commercial tier; set by the Stripe webhook) ──────────────
export async function getPlan() {
  const supabase = await client()
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
  const supabase = await client()
  const { data, error } = await supabase.from('properties').select('*').order('name')
  if (error) throw error
  return data
}
export async function addProperty(payload) {
  const supabase = await client()
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
  const supabase = await client()
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
  const supabase = await client()
  const { error } = await supabase.from('properties').delete().eq('id', id)
  if (error) throw error
}

// ── Expenses ───────────────────────────────────────────────────────
export async function getExpenses() {
  const supabase = await client()
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .is('deleted_at', null)
    .order('date', { ascending: false })
  if (error) throw error
  return data
}
export async function addExpense(payload) {
  const supabase = await client()
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
  const supabase = await client()
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
  const supabase = await client()
  // Soft delete → moves to the trash bin (recoverable for 30 days).
  const { error } = await supabase.from('expenses').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

// ── Income ─────────────────────────────────────────────────────────
export async function getIncome() {
  const supabase = await client()
  const { data, error } = await supabase.from('income').select('*').is('deleted_at', null).order('date', { ascending: false })
  if (error) throw error
  return data
}
export async function addIncome(payload) {
  const supabase = await client()
  const user_id = await ownerForWrite()
  const { data, error } = await supabase.from('income').insert({ ...payload, user_id }).select().single()
  if (error) throw error
  return data
}
export async function updateIncome(id, payload) {
  const supabase = await client()
  const { data, error } = await supabase.from('income').update(payload).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteIncome(id) {
  const supabase = await client()
  const { error } = await supabase.from('income').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

// ── Personal expenses & budgets (not tied to an asset) ─────────────
export async function getPersonalExpenses() {
  const supabase = await client()
  const { data, error } = await supabase.from('personal_expenses').select('*').is('deleted_at', null).order('date', { ascending: false })
  if (error) throw error
  return data
}
export async function addPersonalExpense(payload) {
  const supabase = await client()
  const user_id = await requireUserId()
  const { data, error } = await supabase.from('personal_expenses').insert({ ...payload, user_id }).select().single()
  if (error) throw error
  return data
}
export async function updatePersonalExpense(id, payload) {
  const supabase = await client()
  const { data, error } = await supabase.from('personal_expenses').update(payload).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deletePersonalExpense(id) {
  const supabase = await client()
  const { error } = await supabase.from('personal_expenses').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

// ── Trash bin (soft-deleted expenses / income / personal expenses) ─
const TRASH_TABLES = { expense: 'expenses', income: 'income', personal: 'personal_expenses' }
const TRASH_DAYS = 30

export async function getTrash() {
  const supabase = await client()
  // Purge anything older than the retention window, then return what remains.
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString()
  await Promise.all(
    Object.values(TRASH_TABLES).map((t) =>
      supabase.from(t).delete().not('deleted_at', 'is', null).lt('deleted_at', cutoff),
    ),
  )
  const load = async (t) => {
    const { data } = await supabase.from(t).select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
    return data || []
  }
  const [expenses, income, personal] = await Promise.all([
    load('expenses'),
    load('income'),
    load('personal_expenses'),
  ])
  return { expenses, income, personal }
}

export async function restoreTrash(kind, id) {
  const supabase = await client()
  const { error } = await supabase.from(TRASH_TABLES[kind]).update({ deleted_at: null }).eq('id', id)
  if (error) throw error
}

export async function purgeTrash(kind, id) {
  const supabase = await client()
  const { error } = await supabase.from(TRASH_TABLES[kind]).delete().eq('id', id)
  if (error) throw error
}

export async function emptyTrash() {
  const supabase = await client()
  await Promise.all(
    Object.values(TRASH_TABLES).map((t) => supabase.from(t).delete().not('deleted_at', 'is', null)),
  )
}
export async function getPersonalBudgets() {
  const supabase = await client()
  const { data, error } = await supabase.from('personal_budgets').select('*')
  if (error) throw error
  return data
}
export async function setPersonalBudget(category, monthly_limit) {
  const supabase = await client()
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
  const supabase = await client()
  const { data, error } = await supabase.from('documents').select('*').order('expiry_date', { ascending: true })
  if (error) throw error
  return data
}
export async function addDocument(payload) {
  const supabase = await client()
  const user_id = await ownerForWrite()
  const { data, error } = await supabase.from('documents').insert({ ...payload, user_id }).select().single()
  if (error) throw error
  return data
}
export async function deleteDocument(id) {
  const supabase = await client()
  const { error } = await supabase.from('documents').delete().eq('id', id)
  if (error) throw error
}

// ── Comments (notes people leave on a bill / expense / income) ─────
export async function getComments() {
  const supabase = await client()
  const { data, error } = await supabase.from('comments').select('*').order('created_at', { ascending: true })
  if (error) throw error
  return data
}
export async function addComment(payload) {
  const supabase = await client()
  const user_id = await ownerForWrite()
  const { data, error } = await supabase.from('comments').insert({ ...payload, user_id }).select().single()
  if (error) throw error
  return data
}
export async function deleteComment(id) {
  const supabase = await client()
  const { error } = await supabase.from('comments').delete().eq('id', id)
  if (error) throw error
}

// ── Receipts (private bucket: store the path, serve via signed URL) ──
export async function uploadReceipt(file) {
  const supabase = await client()
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
  const supabase = await client()
  if (!stored) return null
  // Older/imported rows might already hold a full URL.
  if (/^https?:|^data:/.test(stored)) return stored
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(stored, 60 * 60)
  if (error) return null
  return data.signedUrl
}

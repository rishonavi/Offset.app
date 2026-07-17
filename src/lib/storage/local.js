// Local "demo mode" backend — persists everything in the browser's
// localStorage. Used automatically when no Supabase credentials are set.

const PROPS_KEY = 'pl_properties'
const EXP_KEY = 'pl_expenses'
const INC_KEY = 'pl_income'
const DOC_KEY = 'pl_documents'
const PEXP_KEY = 'pl_personal_expenses'
const PBUD_KEY = 'pl_personal_budgets'
const COMMENT_KEY = 'pl_comments'

const DEMO_USER = { id: 'local-user', email: 'demo@local' }

// No-op in demo mode — there are no shared workspaces without a cloud backend.
export function setWriteOwner() {}

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || []
  } catch {
    return []
  }
}
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value))

// ── Auth (no-op: demo mode is always "signed in") ──────────────────
export async function getCurrentUser() {
  return DEMO_USER
}
export function onAuthStateChange(cb) {
  cb(DEMO_USER)
  return () => {}
}
export async function signIn() {
  return DEMO_USER
}
export async function signUp() {
  return DEMO_USER
}
export async function signInWithProvider() {
  throw new Error('Social sign-in needs cloud mode — add your Supabase keys.')
}
export async function signOut() {
  /* nothing to do in demo mode */
}

// ── Plan (commercial tier) ─────────────────────────────────────────
export async function getPlan() {
  return localStorage.getItem('pl_plan') || 'free'
}
export async function setPlan(plan) {
  localStorage.setItem('pl_plan', plan)
  return plan
}

// ── Properties ─────────────────────────────────────────────────────
export async function getProperties() {
  return read(PROPS_KEY).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}
export async function addProperty(payload) {
  const row = { id: uid(), created_at: new Date().toISOString(), ...payload }
  write(PROPS_KEY, [...read(PROPS_KEY), row])
  return row
}
export async function updateProperty(id, payload) {
  const list = read(PROPS_KEY).map((p) => (p.id === id ? { ...p, ...payload } : p))
  write(PROPS_KEY, list)
  return list.find((p) => p.id === id)
}
export async function deleteProperty(id) {
  write(PROPS_KEY, read(PROPS_KEY).filter((p) => p.id !== id))
  // cascade: remove this property's expenses, income and documents too
  write(EXP_KEY, read(EXP_KEY).filter((e) => e.property_id !== id))
  write(INC_KEY, read(INC_KEY).filter((e) => e.property_id !== id))
  write(DOC_KEY, read(DOC_KEY).filter((d) => d.property_id !== id))
}

// ── Expenses ───────────────────────────────────────────────────────
export async function getExpenses() {
  return read(EXP_KEY).filter((e) => !e.deleted_at).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}
export async function addExpense(payload) {
  const row = { id: uid(), created_at: new Date().toISOString(), ...payload }
  write(EXP_KEY, [...read(EXP_KEY), row])
  return row
}
export async function updateExpense(id, payload) {
  const list = read(EXP_KEY).map((e) => (e.id === id ? { ...e, ...payload } : e))
  write(EXP_KEY, list)
  return list.find((e) => e.id === id)
}
export async function deleteExpense(id) {
  write(EXP_KEY, read(EXP_KEY).map((e) => (e.id === id ? { ...e, deleted_at: new Date().toISOString() } : e)))
}

// ── Receipts (stored inline as data URLs) ──────────────────────────
export async function uploadReceipt(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result) // data: URL stored in receipt_url
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
export async function getReceiptUrl(stored) {
  return stored || null // already a data URL
}

// ── Income ─────────────────────────────────────────────────────────
export async function getIncome() {
  return read(INC_KEY).filter((e) => !e.deleted_at).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}
export async function addIncome(payload) {
  const row = { id: uid(), created_at: new Date().toISOString(), ...payload }
  write(INC_KEY, [...read(INC_KEY), row])
  return row
}
export async function updateIncome(id, payload) {
  const list = read(INC_KEY).map((e) => (e.id === id ? { ...e, ...payload } : e))
  write(INC_KEY, list)
  return list.find((e) => e.id === id)
}
export async function deleteIncome(id) {
  write(INC_KEY, read(INC_KEY).map((e) => (e.id === id ? { ...e, deleted_at: new Date().toISOString() } : e)))
}

// ── Personal expenses & budgets (not tied to an asset) ─────────────
export async function getPersonalExpenses() {
  return read(PEXP_KEY).filter((e) => !e.deleted_at).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}
export async function addPersonalExpense(payload) {
  const row = { id: uid(), created_at: new Date().toISOString(), ...payload }
  write(PEXP_KEY, [...read(PEXP_KEY), row])
  return row
}
export async function updatePersonalExpense(id, payload) {
  const list = read(PEXP_KEY).map((e) => (e.id === id ? { ...e, ...payload } : e))
  write(PEXP_KEY, list)
  return list.find((e) => e.id === id)
}
export async function deletePersonalExpense(id) {
  write(PEXP_KEY, read(PEXP_KEY).map((e) => (e.id === id ? { ...e, deleted_at: new Date().toISOString() } : e)))
}

// ── Trash bin (soft-deleted expenses / income / personal expenses) ─
const TRASH = { expense: EXP_KEY, income: INC_KEY, personal: PEXP_KEY }
const TRASH_DAYS = 30

export async function getTrash() {
  const cutoff = Date.now() - TRASH_DAYS * 86400000
  const collect = (key, kind) => {
    const all = read(key)
    const kept = all.filter((e) => !e.deleted_at || Date.parse(e.deleted_at) >= cutoff)
    if (kept.length !== all.length) write(key, kept) // purge expired
    return kept.filter((e) => e.deleted_at).map((e) => ({ ...e, kind }))
  }
  return {
    expenses: collect(EXP_KEY, 'expense'),
    income: collect(INC_KEY, 'income'),
    personal: collect(PEXP_KEY, 'personal'),
  }
}
export async function restoreTrash(kind, id) {
  const key = TRASH[kind]
  write(key, read(key).map((e) => (e.id === id ? { ...e, deleted_at: null } : e)))
}
export async function purgeTrash(kind, id) {
  const key = TRASH[kind]
  write(key, read(key).filter((e) => e.id !== id))
}
export async function emptyTrash() {
  for (const key of Object.values(TRASH)) write(key, read(key).filter((e) => !e.deleted_at))
}
export async function getPersonalBudgets() {
  return read(PBUD_KEY)
}
export async function setPersonalBudget(category, monthly_limit) {
  const list = read(PBUD_KEY)
  const existing = list.find((b) => b.category === category)
  let row
  if (existing) {
    row = { ...existing, monthly_limit }
    write(PBUD_KEY, list.map((b) => (b.category === category ? row : b)))
  } else {
    row = { id: uid(), category, monthly_limit }
    write(PBUD_KEY, [...list, row])
  }
  return row
}

// ── Documents (leases, insurance, warranties…) ─────────────────────
export async function getDocuments() {
  return read(DOC_KEY).sort((a, b) => (a.expiry_date || '').localeCompare(b.expiry_date || ''))
}
export async function addDocument(payload) {
  const row = { id: uid(), created_at: new Date().toISOString(), ...payload }
  write(DOC_KEY, [...read(DOC_KEY), row])
  return row
}
export async function deleteDocument(id) {
  write(DOC_KEY, read(DOC_KEY).filter((d) => d.id !== id))
}

// ── Comments (notes people leave on a bill / expense / income) ─────
export async function getComments() {
  return read(COMMENT_KEY).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
}
export async function addComment(payload) {
  const row = { id: uid(), created_at: new Date().toISOString(), ...payload }
  write(COMMENT_KEY, [...read(COMMENT_KEY), row])
  return row
}
export async function deleteComment(id) {
  write(COMMENT_KEY, read(COMMENT_KEY).filter((c) => c.id !== id))
}

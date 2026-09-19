import { lazy, Suspense, useMemo, useState } from 'react'
import { Wallet, Receipt, Scale, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react'
import { usePersonal } from '../context/PersonalContext'
import { useToast } from '../context/ToastContext'
import { PERSONAL_CATEGORIES, colorForPersonal, monthKey, monthLabel, shiftMonth, inMonth, monthPlan } from '../lib/personal'
import { PAYMENT_METHODS } from '../lib/constants'
import { sumAmount } from '../lib/filters'
import { totalsByCategory } from '../lib/stats'
import { formatCurrency, formatDate, todayISO } from '../lib/format'
import { budgetStatus } from '../lib/budget'
import { Card, Button, Field, Input, Select, Textarea, Spinner, Badge, EmptyState, ChartKey } from '../components/ui'
import PageHeader from '../components/PageHeader'
import BudgetBar from '../components/BudgetBar'

// Loaded when there is something to draw. The ring is decoration and the key
// below it is the content, so until this arrives the reader is not missing
// anything — which is why the fallback is the space it will occupy and not a
// spinner over the part that does not matter.
const SpendRing = lazy(() => import('../components/SpendRing'))

const tooltipStyle = { borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(15,23,42,0.08)', fontSize: 13 }
const emptyForm = { date: todayISO(), amount: '', category: PERSONAL_CATEGORIES[0], note: '', payment_method: '' }

function Stat({ icon: Icon, label, value, accent }) {
  return (
    <Card className="min-w-0 p-3 sm:p-4">
      <div className="flex items-center gap-2 sm:gap-3">
        {/* The icon is the first thing to go when there is no room for it —
            three of these have to fit across a phone. */}
        <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-xl sm:grid" style={{ background: `${accent}1a`, color: accent }}>
          <Icon size={20} />
        </span>
        <div className="min-w-0">
          <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-ink-5">{label}</div>
          <div className="truncate font-serif text-lg font-bold text-ink-1 sm:text-xl">{value}</div>
        </div>
      </div>
    </Card>
  )
}

export default function Personal() {
  const { expenses, budgets, loading, addExpense, updateExpense, deleteExpense, restoreExpense, setBudget, budgetFor } = usePersonal()
  const toast = useToast()

  const removeExpense = async (e) => {
    await deleteExpense(e.id)
    toast('Expense moved to bin', { action: { label: 'Undo', onClick: () => restoreExpense(e) } })
  }
  const [month, setMonth] = useState(monthKey())
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [editBudgets, setEditBudgets] = useState(false)
  const [budgetDraft, setBudgetDraft] = useState({})
  const [savingBudgets, setSavingBudgets] = useState(false)

  const monthExpenses = useMemo(() => inMonth(expenses, month), [expenses, month])
  const spent = useMemo(() => sumAmount(monthExpenses), [monthExpenses])
  const byCategory = useMemo(() => totalsByCategory(monthExpenses), [monthExpenses])

  // All of it worked out in `personal.js`, where it can be tested. A budget
  // saying the wrong thing to somebody watching their money is not a rendering
  // detail, and none of this could be reached from a test while it lived here.
  const plan = useMemo(() => monthPlan(monthExpenses, budgets), [monthExpenses, budgets])
  const { planned: totalBudget, budgetedSpent, unbudgetedSpent, left, rows: categoryRows } = plan
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!amount || amount <= 0) return setError('Enter an amount greater than zero.')
    if (!form.date) return setError('Please choose a date.')
    setSaving(true)
    setError(null)
    try {
      const payload = {
        date: form.date,
        amount,
        category: form.category,
        note: form.note.trim(),
        payment_method: form.payment_method,
      }
      if (editingId) await updateExpense(editingId, payload)
      else await addExpense(payload)
      setForm({ ...emptyForm, category: form.category })
      setEditingId(null)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (e) => {
    setEditingId(e.id)
    setForm({ date: e.date, amount: String(e.amount), category: e.category || PERSONAL_CATEGORIES[0], note: e.note || '', payment_method: e.payment_method || '' })
  }
  const cancelEdit = () => {
    setEditingId(null)
    setForm(emptyForm)
  }

  const openBudgets = () => {
    const draft = {}
    PERSONAL_CATEGORIES.forEach((c) => {
      const v = budgetFor(c)
      draft[c] = v ? String(v) : ''
    })
    setBudgetDraft(draft)
    setEditBudgets(true)
  }
  const saveBudgets = async () => {
    setSavingBudgets(true)
    try {
      for (const c of PERSONAL_CATEGORIES) {
        const next = budgetDraft[c] === '' ? 0 : Number(budgetDraft[c])
        if (next !== budgetFor(c)) await setBudget(c, next)
      }
      setEditBudgets(false)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setSavingBudgets(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader title="Personal" subtitle="Everyday budgeting & spending — separate from your assets." />
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface-raised p-1">
          <button onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded-lg text-ink-5 hover:bg-surface-hover">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-36 text-center text-sm font-medium text-ink-3">{monthLabel(month)}</span>
          <button
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            disabled={month >= monthKey()}
            aria-label="Next month"
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-5 hover:bg-surface-hover disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Planned, spent, left — the three figures, over the same categories.
          "Left" leads because it is the question somebody opens this page to
          ask, and it is the only one of the three that needs a colour. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat
          icon={Scale}
          label={totalBudget ? (left >= 0 ? 'Left to spend' : 'Over budget') : 'Spent'}
          value={totalBudget ? formatCurrency(Math.abs(left)) : formatCurrency(spent)}
          accent={totalBudget ? (left >= 0 ? '#2F8F6B' : '#C0492F') : '#C5A059'}
        />
        <Stat icon={Wallet} label="Planned" value={totalBudget ? formatCurrency(totalBudget) : '—'} accent="#3B5A7A" />
        <Stat icon={Receipt} label="Spent of that" value={totalBudget ? formatCurrency(budgetedSpent) : '—'} accent="#C5A059" />
      </div>
      {/* The money the plan says nothing about. For most people this is the
          larger number, and folding it into the shortfall above was what made
          that figure meaningless. */}
      {totalBudget > 0 && unbudgetedSpent > 0 && (
        <p className="-mt-1 text-xs text-ink-5">
          <strong className="tabular font-semibold text-ink-3">{formatCurrency(unbudgetedSpent)}</strong> more went to
          categories with no budget, so the figures above say nothing about it.{' '}
          <button type="button" onClick={openBudgets} className="font-medium text-brand hover:underline">
            Bring it into the plan
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Budgets */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-3">Category budgets</h2>
            <button onClick={editBudgets ? () => setEditBudgets(false) : openBudgets} className="inline-flex min-h-6 items-center gap-1 text-xs font-medium text-brand hover:underline">
              {editBudgets ? (<><X size={13} /> Close</>) : (<><SlidersHorizontal size={13} /> Manage</>)}
            </button>
          </div>

          {editBudgets ? (
            <div className="space-y-2">
              {PERSONAL_CATEGORIES.map((c) => (
                <label key={c} className="flex items-center justify-between gap-2 text-sm text-ink-4">
                  <span className="truncate">{c}</span>
                  <Input
                    type="number"
                    min="0"
                    className="h-9 w-32"
                    placeholder="0"
                    value={budgetDraft[c] ?? ''}
                    onChange={(e) => setBudgetDraft((d) => ({ ...d, [c]: e.target.value }))}
                  />
                </label>
              ))}
              <Button className="mt-2 w-full" loading={savingBudgets} onClick={saveBudgets}>
                Save budgets
              </Button>
            </div>
          ) : categoryRows.length === 0 ? (
            <div className="py-6 text-center text-sm text-ink-6">
              Nothing spent yet this month. Use <strong>Manage</strong> to set a monthly limit per category.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Budgeted categories first, then the ones money went to with no
                  budget behind it. Listing only the budgeted ones hid exactly
                  the spending somebody would want to bring into the plan — and
                  made a page with six categories of spending look like a page
                  with two. */}
              {categoryRows.map((row) => (
                <div key={row.name}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink-3">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorForPersonal(row.name) }} />
                      <span className="truncate">{row.name}</span>
                    </span>
                    {row.budget <= 0 && (
                      <button
                        type="button"
                        onClick={openBudgets}
                        className="shrink-0 text-xs font-medium text-brand hover:underline"
                      >
                        Set a budget
                      </button>
                    )}
                  </div>
                  {row.budget > 0 ? (
                    <BudgetBar spent={row.spent} budget={row.budget} showLabel showStatus />
                  ) : (
                    // No bar, because there is nothing to be a proportion of. A
                    // full-width bar here would read as "spent it all" and an
                    // empty one as "spent nothing", and both are untrue.
                    <p className="flex items-center justify-between gap-2 text-xs text-ink-5">
                      <span>No budget set</span>
                      <span className="tabular font-medium text-ink-3">{formatCurrency(row.spent)} spent</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Spending by category */}
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink-3">Spending by category</h2>
          {byCategory.length === 0 ? (
            <div className="grid h-64 place-items-center text-sm text-ink-6">No spending this month</div>
          ) : (
            <>
            <Suspense fallback={<div style={{ width: '100%', height: 260 }} />}>
              <SpendRing
                data={byCategory.map((d) => ({ ...d, color: colorForPersonal(d.name) }))}
                format={formatCurrency}
                tooltipStyle={tooltipStyle}
              />
            </Suspense>
            <ChartKey
              items={byCategory.map((d) => ({ ...d, color: colorForPersonal(d.name) }))}
              format={formatCurrency}
            />
            </>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Add / edit */}
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink-3">{editingId ? 'Edit expense' : 'Add personal expense'}</h2>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" required>
                <Input type="date" value={form.date} onChange={set('date')} max={todayISO()} />
              </Field>
              <Field label="Amount" required>
                <Input type="number" inputMode="decimal" step="0.01" min="0" value={form.amount} onChange={set('amount')} placeholder="0" />
              </Field>
            </div>
            <Field label="Category" required>
              <Select value={form.category} onChange={set('category')}>
                {PERSONAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment method">
                <Select value={form.payment_method} onChange={set('payment_method')}>
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Note">
                <Input value={form.note} onChange={set('note')} placeholder="e.g. weekly shop" />
              </Field>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              {editingId && (
                <Button type="button" variant="ghost" onClick={cancelEdit}>
                  Cancel
                </Button>
              )}
              <Button type="submit" loading={saving}>
                <Plus size={16} /> {editingId ? 'Save' : 'Add'}
              </Button>
            </div>
          </form>
        </Card>

        {/* This month's list */}
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink-3">{monthLabel(month)} · {monthExpenses.length} entries</h2>
          {monthExpenses.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-6">No personal expenses this month yet.</div>
          ) : (
            <div className="divide-y divide-line-soft">
              {monthExpenses.map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorForPersonal(e.category) }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge color={colorForPersonal(e.category)}>{e.category}</Badge>
                      <span className="text-xs text-ink-6">{formatDate(e.date)}</span>
                    </div>
                    {e.note && <div className="mt-0.5 truncate text-xs text-ink-5">{e.note}</div>}
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-ink-1">{formatCurrency(e.amount)}</span>
                  <button onClick={() => startEdit(e)} className="shrink-0 text-ink-6 hover:text-brand" title="Edit">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => removeExpense(e)} className="shrink-0 text-ink-6 hover:text-red-600" title="Delete">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {expenses.length === 0 && (
        <EmptyState
          icon={Wallet}
          title="Track your everyday spending"
          subtitle="Personal expenses and budgets live here, separate from your property/asset books. Add your first expense above."
        />
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, Crown, TrendingUp, Activity, Boxes, Receipt, Banknote, ScanLine, Search, ShieldAlert } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import { checkIsAdmin, adminOverview, adminListUsers, adminSetPlan, adminAuditLog } from '../lib/admin'
import { formatDate } from '../lib/format'
import { Card, Button, Spinner, EmptyState } from '../components/ui'
import PageHeader from '../components/PageHeader'

function Stat({ icon: Icon, label, value, accent = '#C5A059' }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${accent}1a`, color: accent }}>
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">{label}</div>
          <div className="font-serif text-xl font-bold text-slate-900">{value}</div>
        </div>
      </div>
    </Card>
  )
}

export default function Admin() {
  const toast = useToast()
  const [allowed, setAllowed] = useState(null) // null = checking
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState(null)
  const [users, setUsers] = useState([])
  const [audit, setAudit] = useState([])
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = async (q = '') => {
    setLoading(true)
    try {
      const [ov, us, au] = await Promise.all([adminOverview(), adminListUsers(q), adminAuditLog(30)])
      setOverview(ov)
      setUsers(us)
      setAudit(au)
    } catch (e) {
      toast(e?.message || 'Could not load admin data.', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    checkIsAdmin().then((ok) => {
      if (!active) return
      setAllowed(ok)
      if (ok) load()
      else setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  const setPlan = async (u, plan) => {
    setBusyId(u.user_id)
    try {
      await adminSetPlan(u.user_id, plan)
      setUsers((prev) => prev.map((x) => (x.user_id === u.user_id ? { ...x, plan } : x)))
      toast(`${u.email} set to ${plan === 'pro' ? 'Pro' : 'Free'}.`)
      adminAuditLog(30).then(setAudit).catch(() => {})
    } catch (e) {
      toast(e?.message || 'Could not change plan.', { type: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  const money = useMemo(() => {
    const pro = overview?.pro_users || 0
    const users = overview?.users || 0
    return { conversion: users ? Math.round((pro / users) * 100) : 0 }
  }, [overview])

  if (allowed === null || (allowed && loading && !overview)) return <Spinner />

  if (!allowed) {
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon={ShieldAlert}
          title="Not authorised"
          subtitle="This area is for platform operators. If you should have access, an existing admin needs to add you to the admins table."
          action={
            <Link to="/" className="btn-primary">
              Back to dashboard
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Admin" subtitle="Platform overview, users and audit log." />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Users} label="Total users" value={overview?.users ?? '—'} accent="#3B5A7A" />
        <Stat icon={Crown} label={`Pro (${money.conversion}% conv.)`} value={overview?.pro_users ?? '—'} accent="#C5A059" />
        <Stat icon={TrendingUp} label="Signups · 30d" value={overview?.signups_30d ?? '—'} accent="#2F8F6B" />
        <Stat icon={Activity} label="Active · 30d" value={overview?.active_30d ?? '—'} accent="#6D6A8A" />
        <Stat icon={Boxes} label="Assets" value={overview?.assets ?? '—'} accent="#9C5B33" />
        <Stat icon={Receipt} label="Expenses" value={overview?.expenses ?? '—'} accent="#B5673F" />
        <Stat icon={Banknote} label="Income entries" value={overview?.income ?? '—'} accent="#2F8F6B" />
        <Stat icon={ScanLine} label="AI scans · month" value={overview?.scans_this_month ?? '—'} accent="#46618A" />
      </div>

      {/* Users */}
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-700">Users</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              load(search.trim())
            }}
            className="relative"
          >
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="field-input h-9 w-64 max-w-full pl-9"
              placeholder="Search email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[0.65rem] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Email</th>
                <th className="py-2 pr-3 font-semibold">Joined</th>
                <th className="py-2 pr-3 font-semibold">Assets</th>
                <th className="py-2 pr-3 font-semibold">Txns</th>
                <th className="py-2 pr-3 font-semibold">Plan</th>
                <th className="py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.user_id}>
                  <td className="py-2.5 pr-3">
                    <span className="font-medium text-slate-800">{u.email || u.user_id}</span>
                    {u.is_admin && (
                      <span className="ml-2 rounded-full bg-navy px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-gold">
                        Admin
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-slate-500">{u.created_at ? formatDate(u.created_at) : '—'}</td>
                  <td className="py-2.5 pr-3 text-slate-600">{u.assets}</td>
                  <td className="py-2.5 pr-3 text-slate-600">{Number(u.expenses) + Number(u.income)}</td>
                  <td className="py-2.5 pr-3">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={u.plan === 'pro' ? { background: '#f5efe2', color: '#a87b2e' } : { background: '#f1f5f9', color: '#64748b' }}
                    >
                      {u.plan === 'pro' ? 'Pro' : 'Free'}
                    </span>
                  </td>
                  <td className="py-2.5">
                    {u.plan === 'pro' ? (
                      <button
                        onClick={() => setPlan(u, 'free')}
                        disabled={busyId === u.user_id}
                        className="text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
                      >
                        Downgrade
                      </button>
                    ) : (
                      <button
                        onClick={() => setPlan(u, 'pro')}
                        disabled={busyId === u.user_id}
                        className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
                      >
                        Grant Pro
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-slate-400">
                    No users match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Audit log */}
      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Admin audit log</h3>
        {audit.length === 0 ? (
          <p className="text-sm text-slate-400">No admin actions recorded yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {audit.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-slate-700">
                  <span className="font-medium">{a.admin_email || 'admin'}</span> · {a.action}
                  {a.target_email ? ` → ${a.target_email}` : ''}
                  {a.detail?.plan ? ` (${a.detail.plan})` : ''}
                </span>
                <span className="shrink-0 text-xs text-slate-400">{formatDate(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

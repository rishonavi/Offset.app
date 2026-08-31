import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, Crown, TrendingUp, Activity, Boxes, Receipt, Banknote, ScanLine, Search, ShieldAlert, UserPlus, Trash2, Bug } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import { useConfig } from '../context/ConfigContext'
import {
  checkIsAdmin,
  adminRole,
  adminOverview,
  adminListUsers,
  adminSetPlan,
  adminAuditLog,
  adminListAdmins,
  adminAddAdmin,
  adminRemoveAdmin,
  adminSetConfig,
  adminHealth,
  adminListReports,
  adminReportCounts,
  adminSetReportStatus,
} from '../lib/admin'
import { kindLabel, describeDiagnostics } from '../lib/reports'
import { formatCurrency, formatDate } from '../lib/format'
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
          <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-ink-5">{label}</div>
          <div className="font-serif text-xl font-bold text-ink-1">{value}</div>
        </div>
      </div>
    </Card>
  )
}

export default function Admin() {
  const toast = useToast()
  const cfg = useConfig()
  const [allowed, setAllowed] = useState(null) // null = checking
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState(null)
  const [users, setUsers] = useState([])
  const [audit, setAudit] = useState([])
  const [health, setHealth] = useState(null)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [role, setRole] = useState(null)
  const [admins, setAdmins] = useState([])
  const [newAdmin, setNewAdmin] = useState({ email: '', role: 'admin' })
  const [addingAdmin, setAddingAdmin] = useState(false)
  // null until the first load; stays null on a deployment without reports.sql,
  // which is what hides the card rather than showing a permanently empty inbox.
  const [reports, setReports] = useState(null)
  const [reportCounts, setReportCounts] = useState({})
  const [reportFilter, setReportFilter] = useState('new')
  const [openReportId, setOpenReportId] = useState(null)

  const canWrite = role === 'superadmin' || role === 'admin' || role === 'support'
  const canConfig = role === 'superadmin' || role === 'admin'
  const isSuper = role === 'superadmin'

  // Editable copies of app_config, seeded from the live config.
  const [announcement, setAnnouncement] = useState({ active: false, text: '' })
  const [maintenance, setMaintenance] = useState({ active: false, message: '' })
  const [plans, setPlans] = useState({ pro_price: 499, free_assets: 2, free_scans: 10 })
  const [savingCfg, setSavingCfg] = useState(null)
  useEffect(() => {
    if (cfg.announcement) setAnnouncement({ active: !!cfg.announcement.active, text: cfg.announcement.text || '' })
    if (cfg.maintenance) setMaintenance({ active: !!cfg.maintenance.active, message: cfg.maintenance.message || '' })
    if (cfg.plans) setPlans({ pro_price: cfg.plans.pro_price ?? 499, free_assets: cfg.plans.free_assets ?? 2, free_scans: cfg.plans.free_scans ?? 10 })
  }, [cfg])

  const saveConfig = async (key, value) => {
    setSavingCfg(key)
    try {
      await adminSetConfig(key, value)
      toast('Saved. Users see the change on their next load.')
    } catch (e) {
      toast(e?.message || 'Could not save config.', { type: 'error' })
    } finally {
      setSavingCfg(null)
    }
  }

  const load = async (q = '') => {
    setLoading(true)
    try {
      const [ov, us, au, rl] = await Promise.all([adminOverview(), adminListUsers(q), adminAuditLog(30), adminRole()])
      setOverview(ov)
      setUsers(us)
      setAudit(au)
      setRole(rl)
      if (rl === 'superadmin') setAdmins(await adminListAdmins().catch(() => []))
      adminHealth().then(setHealth).catch(() => {})
      loadReports(reportFilter)
    } catch (e) {
      toast(e?.message || 'Could not load admin data.', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Reports are optional: an operator who hasn't run reports.sql shouldn't see
  // an error, just no inbox.
  const loadReports = async (status) => {
    try {
      const [list, counts] = await Promise.all([adminListReports(status), adminReportCounts()])
      setReports(list)
      setReportCounts(counts)
    } catch {
      setReports(null)
    }
  }

  const setReportStatus = async (r, status) => {
    try {
      await adminSetReportStatus(r.id, status)
      await loadReports(reportFilter)
      toast(`${r.reference} marked ${status}.`)
    } catch (e) {
      toast(e?.message || 'Could not update the report.', { type: 'error' })
    }
  }

  const addAdmin = async (e) => {
    e.preventDefault()
    if (!newAdmin.email.trim()) return
    setAddingAdmin(true)
    try {
      await adminAddAdmin(newAdmin.email.trim(), newAdmin.role)
      setNewAdmin({ email: '', role: 'admin' })
      setAdmins(await adminListAdmins())
      toast('Admin added.')
    } catch (err) {
      toast(err?.message || 'Could not add admin.', { type: 'error' })
    } finally {
      setAddingAdmin(false)
    }
  }

  const removeAdmin = async (uid) => {
    try {
      await adminRemoveAdmin(uid)
      setAdmins((prev) => prev.filter((a) => a.user_id !== uid))
      toast('Admin removed.')
    } catch (err) {
      toast(err?.message || 'Could not remove admin.', { type: 'error' })
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
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Admin" subtitle="Platform operations." />
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="Admin" subtitle="Platform overview, users and audit log." />
        {role && (
          <span className="rounded-full bg-navy px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gold">
            {role}
          </span>
        )}
      </div>

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

      {/* Billing & health */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-3">Billing</h2>
            <a
              href="https://dashboard.stripe.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-6 items-center text-xs font-medium text-brand hover:underline"
            >
              Open Stripe ↗
            </a>
          </div>
          <div className="mb-3">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-ink-5">Est. MRR</div>
            <div className="font-serif text-2xl font-bold text-ink-1">
              {formatCurrency((overview?.pro_users || 0) * (Number(plans.pro_price) || 0))}
            </div>
            <div className="text-[0.65rem] text-ink-6">{overview?.pro_users ?? 0} Pro × {formatCurrency(Number(plans.pro_price) || 0)}</div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Active', v: overview?.sub_active, c: '#15803d' },
              { label: 'Past due', v: overview?.sub_past_due, c: '#b45309' },
              { label: 'Canceled', v: overview?.sub_canceled, c: '#b91c1c' },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-surface-sunk py-2">
                <div className="font-serif text-lg font-bold" style={{ color: s.c }}>{s.v ?? 0}</div>
                <div className="text-[0.6rem] uppercase tracking-wide text-ink-5">{s.label}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink-3">Endpoint health</h2>
          <div className="divide-y divide-line-soft">
            {[
              { key: 'scan', label: 'Receipt scanning (/api/scan-receipt)' },
              { key: 'parse', label: 'AI quick-add (/api/parse-entry)' },
              { key: 'ask', label: 'AI answers (/api/ask)' },
            ].map((e) => {
              const h = health?.[e.key]
              const state = !h || !h.reachable ? 'down' : h.configured ? 'live' : 'unconfigured'
              const meta = {
                live: { c: '#15803d', t: 'Live' },
                unconfigured: { c: '#b45309', t: 'Not configured' },
                down: { c: '#94a3b8', t: health ? 'Unreachable' : 'Checking…' },
              }[state]
              return (
                <div key={e.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-ink-4">{e.label}</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium" style={{ color: meta.c }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: meta.c }} />
                    {meta.t}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* App config */}
      {canConfig && (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink-3">App configuration</h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Announcement */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-5">Announcement banner</span>
                <label className="flex items-center gap-1.5 text-xs text-ink-4">
                  <input type="checkbox" checked={announcement.active} onChange={(e) => setAnnouncement((s) => ({ ...s, active: e.target.checked }))} />
                  On
                </label>
              </div>
              <textarea
                className="field-input h-20 resize-none"
                placeholder="Shown to everyone at the top of the app"
                value={announcement.text}
                onChange={(e) => setAnnouncement((s) => ({ ...s, text: e.target.value }))}
              />
              <Button className="mt-2 w-full" loading={savingCfg === 'announcement'} onClick={() => saveConfig('announcement', announcement)}>
                Save banner
              </Button>
            </div>

            {/* Maintenance */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-5">Maintenance mode</span>
                <label className="flex items-center gap-1.5 text-xs text-ink-4">
                  <input type="checkbox" checked={maintenance.active} onChange={(e) => setMaintenance((s) => ({ ...s, active: e.target.checked }))} />
                  On
                </label>
              </div>
              <textarea
                className="field-input h-20 resize-none"
                placeholder="Message shown while in maintenance"
                value={maintenance.message}
                onChange={(e) => setMaintenance((s) => ({ ...s, message: e.target.value }))}
              />
              <Button className="mt-2 w-full" loading={savingCfg === 'maintenance'} onClick={() => saveConfig('maintenance', maintenance)}>
                Save maintenance
              </Button>
            </div>

            {/* Plan limits */}
            <div>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink-5">Plan limits</span>
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-2 text-sm text-ink-4">
                  Pro price
                  <input type="number" min="0" className="field-input h-9 w-28" value={plans.pro_price} onChange={(e) => setPlans((s) => ({ ...s, pro_price: e.target.value }))} />
                </label>
                <label className="flex items-center justify-between gap-2 text-sm text-ink-4">
                  Free assets
                  <input type="number" min="0" className="field-input h-9 w-28" value={plans.free_assets} onChange={(e) => setPlans((s) => ({ ...s, free_assets: e.target.value }))} />
                </label>
                <label className="flex items-center justify-between gap-2 text-sm text-ink-4">
                  Free scans/mo
                  <input type="number" min="0" className="field-input h-9 w-28" value={plans.free_scans} onChange={(e) => setPlans((s) => ({ ...s, free_scans: e.target.value }))} />
                </label>
              </div>
              <Button
                className="mt-2 w-full"
                loading={savingCfg === 'plans'}
                onClick={() =>
                  saveConfig('plans', {
                    pro_price: Number(plans.pro_price) || 0,
                    free_assets: Number(plans.free_assets) || 0,
                    free_scans: Number(plans.free_scans) || 0,
                  })
                }
              >
                Save limits
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Problem reports */}
      {reports !== null && (
        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <CardTitle
              title="Problem reports"
              icon={Bug}
              description="What users have told you is broken. Newest unread first."
            />
            <div className="flex flex-wrap gap-1">
              {[
                ['new', 'New'],
                ['triaged', 'Triaged'],
                ['fixed', 'Fixed'],
                ['wontfix', 'Won’t fix'],
                ['', 'All'],
              ].map(([id, label]) => (
                <button
                  key={id || 'all'}
                  onClick={() => { setReportFilter(id); loadReports(id) }}
                  className={`px-2.5 py-1 text-xs font-medium transition ${
                    reportFilter === id ? 'bg-navy text-gold' : 'bg-surface-chip text-ink-4 hover:bg-surface-grab'
                  }`}
                >
                  {label}
                  {id && reportCounts[id] ? ` (${reportCounts[id]})` : ''}
                </button>
              ))}
            </div>
          </div>

          {reports.length === 0 ? (
            <p className="text-sm text-ink-6">
              {reportFilter === 'new' ? 'Nothing new — the inbox is clear.' : 'No reports with this status.'}
            </p>
          ) : (
            <div className="divide-y divide-border-subtle">
              {reports.map((r) => {
                const expanded = openReportId === r.id
                return (
                  <div key={r.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <button
                        onClick={() => setOpenReportId(expanded ? null : r.id)}
                        className="min-w-0 flex-1 text-start"
                        aria-expanded={expanded}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-ink-3">{r.reference}</span>
                          <span className="text-xs text-ink-5">{kindLabel(r.kind)}</span>
                          <span
                            className="px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide"
                            style={
                              {
                                new: { background: '#fef3c7', color: '#92400e' },
                                triaged: { background: '#e0e7ff', color: '#3730a3' },
                                fixed: { background: '#dcfce7', color: '#166534' },
                                wontfix: { background: '#f1f5f9', color: '#64748b' },
                              }[r.status] || {}
                            }
                          >
                            {r.status}
                          </span>
                          <span className="text-[0.65rem] text-ink-6">{formatDate(r.created_at)}</span>
                        </span>
                        <span className={`mt-0.5 block text-sm text-ink-3 ${expanded ? '' : 'truncate'}`}>{r.message}</span>
                      </button>
                      {canWrite && (
                        <div className="flex shrink-0 flex-wrap gap-1">
                          {[
                            ['triaged', 'Triage'],
                            ['fixed', 'Fixed'],
                            ['wontfix', 'Won’t fix'],
                          ]
                            .filter(([id]) => id !== r.status)
                            .map(([id, label]) => (
                              <button
                                key={id}
                                onClick={() => setReportStatus(r, id)}
                                className="border border-border-light px-2 py-0.5 text-[0.65rem] font-medium text-ink-5 transition hover:border-gold hover:text-ink-2"
                              >
                                {label}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>

                    {expanded && (
                      <div className="mt-3 space-y-3 border-s-2 border-gold/40 pl-3">
                        {r.expected && (
                          <div>
                            <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-ink-6">Expected</div>
                            <p className="text-sm text-ink-4">{r.expected}</p>
                          </div>
                        )}
                        <div>
                          <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-ink-6">Reply to</div>
                          {r.email ? (
                            <a href={`mailto:${r.email}?subject=Offset ${r.reference}`} className="text-sm text-brand hover:underline">
                              {r.email}
                            </a>
                          ) : (
                            <p className="text-sm text-ink-6">Not given</p>
                          )}
                        </div>
                        {r.diagnostics ? (
                          <dl className="space-y-0.5">
                            {describeDiagnostics(r.diagnostics).map((d) => (
                              <div key={d.label} className="flex gap-3 text-xs">
                                <dt className="w-32 shrink-0 text-ink-6">{d.label}</dt>
                                <dd className="min-w-0 break-words font-medium text-ink-4">{d.value}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <p className="text-xs text-ink-6">No diagnostics — the reporter chose not to attach them.</p>
                        )}
                        {r.diagnostics?.crash?.stack && (
                          <pre className="overflow-x-auto bg-surface-sunk p-2 text-[0.65rem] leading-relaxed text-ink-4">
                            {r.diagnostics.crash.stack}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* Users */}
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-3">Users</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              load(search.trim())
            }}
            className="relative"
          >
            <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-6" />
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
              <tr className="border-b border-line text-start text-[0.65rem] uppercase tracking-wide text-ink-6">
                <th className="py-2 pr-3 font-semibold">Email</th>
                <th className="py-2 pr-3 font-semibold">Joined</th>
                <th className="py-2 pr-3 font-semibold">Assets</th>
                <th className="py-2 pr-3 font-semibold">Txns</th>
                <th className="py-2 pr-3 font-semibold">Plan</th>
                <th className="py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {users.map((u) => (
                <tr key={u.user_id}>
                  <td className="py-2.5 pr-3">
                    <span className="font-medium text-ink-2">{u.email || u.user_id}</span>
                    {u.is_admin && (
                      <span className="ml-2 rounded-full bg-navy px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-gold">
                        Admin
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-ink-5">{u.created_at ? formatDate(u.created_at) : '—'}</td>
                  <td className="py-2.5 pr-3 text-ink-4">{u.assets}</td>
                  <td className="py-2.5 pr-3 text-ink-4">{Number(u.expenses) + Number(u.income)}</td>
                  <td className="py-2.5 pr-3">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={u.plan === 'pro' ? { background: '#f5efe2', color: '#a87b2e' } : { background: '#f1f5f9', color: '#64748b' }}
                    >
                      {u.plan === 'pro' ? 'Pro' : 'Free'}
                    </span>
                  </td>
                  <td className="py-2.5">
                    {!canWrite ? (
                      <span className="text-xs text-ink-7">—</span>
                    ) : u.plan === 'pro' ? (
                      <button
                        onClick={() => setPlan(u, 'free')}
                        disabled={busyId === u.user_id}
                        className="inline-flex min-h-6 items-center text-xs font-medium text-ink-5 hover:text-ink-2 disabled:opacity-50"
                      >
                        Downgrade
                      </button>
                    ) : (
                      <button
                        onClick={() => setPlan(u, 'pro')}
                        disabled={busyId === u.user_id}
                        className="inline-flex min-h-6 items-center text-xs font-medium text-brand hover:underline disabled:opacity-50"
                      >
                        Grant Pro
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-ink-6">
                    No users match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Admins (superadmin only) */}
      {isSuper && (
        <Card className="p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink-3">Admins</h2>
          <p className="mb-3 text-xs text-ink-5">Manage who can access this area. The user must already have an Offset account.</p>
          <form onSubmit={addAdmin} className="flex flex-wrap gap-2">
            <input
              type="email"
              className="field-input min-w-0 flex-1"
              placeholder="their@email.com"
              value={newAdmin.email}
              onChange={(e) => setNewAdmin((s) => ({ ...s, email: e.target.value }))}
            />
            <select
              className="field-input w-auto"
              value={newAdmin.role}
              onChange={(e) => setNewAdmin((s) => ({ ...s, role: e.target.value }))}
            >
              <option value="admin">Admin</option>
              <option value="support">Support</option>
              <option value="readonly">Read-only</option>
              <option value="superadmin">Superadmin</option>
            </select>
            <Button type="submit" loading={addingAdmin}>
              <UserPlus size={16} /> Add
            </Button>
          </form>
          <div className="mt-3 divide-y divide-line-soft">
            {admins.map((a) => (
              <div key={a.user_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-ink-3">
                  {a.email}
                  <span className="ml-2 rounded-full bg-surface-chip px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-ink-5">
                    {a.role}
                  </span>
                </span>
                <button onClick={() => removeAdmin(a.user_id)} className="shrink-0 text-ink-6 hover:text-red-600" title="Remove admin">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Audit log */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-3">Admin audit log</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-ink-6">No admin actions recorded yet.</p>
        ) : (
          <div className="divide-y divide-line-soft">
            {audit.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-ink-3">
                  <span className="font-medium">{a.admin_email || 'admin'}</span> · {a.action}
                  {a.target_email ? ` → ${a.target_email}` : ''}
                  {a.detail?.plan ? ` (${a.detail.plan})` : ''}
                </span>
                <span className="shrink-0 text-xs text-ink-6">{formatDate(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

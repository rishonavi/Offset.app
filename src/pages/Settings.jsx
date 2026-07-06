import { useEffect, useState } from 'react'
import { Crown, LogOut, Download, Trash2, Check, CreditCard, ShieldCheck, UserPlus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { usePlan } from '../context/PlanContext'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { startCheckout, openBillingPortal } from '../lib/billing'
import { listTeam, inviteMember, removeMembership } from '../lib/team'
import { formatCurrency } from '../lib/format'
import { Card, Button, Spinner } from '../components/ui'
import PageHeader from '../components/PageHeader'

export default function Settings() {
  const { user, isCloud, signOut } = useAuth()
  const { info, isPro, billingEnabled, scanCount, scanLimit } = usePlan()
  const { properties, expenses, income, loading, deleteProperty } = useData()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [team, setTeam] = useState({ sharedByMe: [], sharedWithMe: [] })
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviting, setInviting] = useState(false)

  const loadTeam = async () => {
    try {
      setTeam(await listTeam())
    } catch {
      /* sharing not set up yet */
    }
  }
  useEffect(() => {
    if (isCloud) loadTeam()
  }, [isCloud])

  const invite = async (e) => {
    e.preventDefault()
    const email = inviteEmail.trim()
    if (!email) return
    setInviting(true)
    try {
      await inviteMember(email, inviteRole)
      setInviteEmail('')
      await loadTeam()
      toast(inviteRole === 'editor' ? 'Shared — they can now view and edit.' : 'Shared — they can now view your workspace.')
    } catch (err) {
      toast(err?.message || 'Could not share.', { type: 'error' })
    } finally {
      setInviting(false)
    }
  }
  const unshare = async (id) => {
    try {
      await removeMembership(id)
      await loadTeam()
      toast('Access removed.')
    } catch (err) {
      toast(err?.message || 'Could not remove access.', { type: 'error' })
    }
  }

  if (loading) return <Spinner />

  const upgrade = async () => {
    setBusy(true)
    try {
      await startCheckout(user)
    } catch (e) {
      toast(e?.message || 'Could not start checkout.', { type: 'error' })
      setBusy(false)
    }
  }
  const manage = async () => {
    setBusy(true)
    try {
      await openBillingPortal(user)
    } catch (e) {
      toast(e?.message || 'Could not open billing.', { type: 'error' })
      setBusy(false)
    }
  }

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), properties, expenses, income }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `offset-data-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('Your data was exported.')
  }

  const deleteAll = async () => {
    if (!window.confirm(`Delete ALL your data — ${properties.length} assets and every expense & income record? This cannot be undone.`)) return
    setBusy(true)
    try {
      for (const p of [...properties]) await deleteProperty(p.id)
      toast('All data deleted.')
    } catch (e) {
      toast(e?.message || 'Could not delete data.', { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Settings" subtitle="Your account, plan and data." />

      {/* Plan */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`grid h-11 w-11 place-items-center rounded-xl ${isPro ? 'bg-gold/15 text-gold' : 'bg-slate-100 text-slate-500'}`}>
              <Crown size={20} />
            </span>
            <div>
              <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">Current plan</div>
              <div className="font-serif text-xl font-bold text-slate-900">
                {info.name}
                {info.price > 0 && <span className="ml-2 text-sm font-normal text-slate-400">{formatCurrency(info.price)}/mo</span>}
              </div>
            </div>
          </div>
          {billingEnabled ? (
            isPro ? (
              <Button variant="ghost" onClick={manage} loading={busy}>
                <CreditCard size={16} /> Manage billing
              </Button>
            ) : (
              <Button onClick={upgrade} loading={busy}>
                <Crown size={16} /> Upgrade to Pro
              </Button>
            )
          ) : (
            <span className="text-xs text-slate-400">Billing not enabled</span>
          )}
        </div>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {info.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
              <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" /> {f}
            </li>
          ))}
        </ul>

        {scanLimit !== Infinity && (
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            AI scans this month: <strong>{scanCount}</strong> / {scanLimit}
          </p>
        )}
      </Card>

      {/* Account */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700">Account</h3>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-light text-sm font-semibold text-brand">
              {(user?.email || 'U')[0].toUpperCase()}
            </span>
            <div>
              <div className="text-sm font-medium text-slate-800">{user?.email || 'Local user'}</div>
              <div className="inline-flex items-center gap-1 text-xs text-slate-400">
                <ShieldCheck size={12} /> {isCloud ? 'Cloud account' : 'Demo mode (this browser)'}
              </div>
            </div>
          </div>
          {isCloud && (
            <Button variant="ghost" onClick={signOut}>
              <LogOut size={15} /> Sign out
            </Button>
          )}
        </div>
      </Card>

      {/* Team / sharing (cloud only) */}
      {isCloud && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700">Team &amp; sharing</h3>
          <p className="mt-1 text-xs text-slate-500">
            Invite someone (e.g. your accountant or partner) to your workspace. A <strong>viewer</strong> is read-only;
            an <strong>editor</strong> can add and change records. They’ll need an Offset account.
          </p>
          <form onSubmit={invite} className="mt-3 flex flex-wrap gap-2">
            <input
              type="email"
              className="field-input min-w-0 flex-1"
              placeholder="their@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select className="field-input w-auto" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <Button type="submit" loading={inviting}>
              <UserPlus size={16} /> Share
            </Button>
          </form>

          {team.sharedByMe.length > 0 && (
            <div className="mt-4">
              <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">People with access</div>
              <div className="mt-1 divide-y divide-slate-100">
                {team.sharedByMe.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-slate-700">
                      {m.member_email || m.member_id}
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
                        {m.role === 'editor' ? 'Editor' : 'Viewer'}
                      </span>
                    </span>
                    <button onClick={() => unshare(m.id)} className="shrink-0 text-xs font-medium text-red-600 hover:underline">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {team.sharedWithMe.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">
              <span className="font-medium">Shared with you:</span>{' '}
              {team.sharedWithMe.map((m) => m.owner_email || m.owner_id).join(', ')} — switch from the workspace selector in the sidebar.
            </div>
          )}
        </Card>
      )}

      {/* Data */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700">Your data</h3>
        <p className="mt-1 text-xs text-slate-500">Download everything as JSON, or permanently delete it.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={exportData}>
            <Download size={16} /> Export my data
          </Button>
          <Button variant="ghost" onClick={deleteAll} loading={busy} className="text-red-600 hover:bg-red-50">
            <Trash2 size={16} /> Delete all my data
          </Button>
        </div>
      </Card>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Crown, LogOut, Download, Trash2, Check, CreditCard, ShieldCheck, UserPlus, Sun, Moon, Languages, Bug, Copy, Mail, Sparkles } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAppearance } from '../context/ThemeContext'
import { usePlan } from '../context/PlanContext'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import { useReport } from '../context/ReportContext'
import { hasSampleData, removeSampleData } from '../lib/sampleData'
import { listReports, deleteReport, formatReportText, mailtoLink, kindLabel, SUPPORT_EMAIL } from '../lib/reports'
import { startCheckout, openBillingPortal } from '../lib/billing'
import { listTeam, inviteMember, removeMembership } from '../lib/team'
import { formatCurrency } from '../lib/format'
import { clearSearches } from '../lib/searchHistory'
import { Card, Button, Spinner, Avatar } from '../components/ui'
import AppearanceCard from '../components/AppearanceCard'
import PageHeader from '../components/PageHeader'

export default function Settings() {
  const { user, isCloud, signOut } = useAuth()
  const { avatar } = useAppearance()
  const { t, lang, chosen, setLanguage, languages, coverage } = useLanguage()
  const changeLanguage = (code) => {
    setLanguage(code)
    const picked = languages.find((l) => l.code === code)
    toast(picked ? `${picked.name} · ${picked.english}` : t('language.systemDefault'))
  }
  const { info, isPro, billingEnabled, scanCount, scanLimit } = usePlan()
  const { properties, expenses, income, loading, deleteProperty, deleteExpense, deleteIncome, refresh } = useData()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [team, setTeam] = useState({ sharedByMe: [], sharedWithMe: [] })
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviting, setInviting] = useState(false)
  const { openReport, filedCount } = useReport()
  // Newest first, and refreshed whenever a report is filed from the dialog.
  const [reports, setReports] = useState([])
  useEffect(() => setReports(listReports().slice().reverse()), [filedCount])

  const copyReport = async (r) => {
    try {
      await navigator.clipboard.writeText(formatReportText(r))
      toast('Report copied.')
    } catch {
      toast('Couldn’t reach the clipboard.')
    }
  }
  const removeReport = (r) => {
    // Only clears your local copy — anything already sent is gone from here.
    if (!window.confirm(`Delete report ${r.reference}? Anything you already sent has been sent.`)) return
    deleteReport(r.id)
    setReports((prev) => prev.filter((x) => x.id !== r.id))
  }

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
      // "All your data" has to mean all of it. What someone searched for is a
      // record of what they were looking at, and leaving it behind would make
      // the button's promise false.
      clearSearches()
      toast('All data deleted.')
    } catch (e) {
      toast(e?.message || 'Could not delete data.', { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const clearSample = async () => {
    if (!window.confirm('Remove the sample portfolio? Only the demo rows go — anything you have added yourself stays.')) return
    setBusy(true)
    try {
      const n = await removeSampleData({ properties, expenses, income, deleteProperty, deleteExpense, deleteIncome })
      await refresh()
      toast(`Removed ${n} sample ${n === 1 ? 'row' : 'rows'}.`)
    } catch (e) {
      toast(e?.message || 'Could not remove the sample data.')
    } finally {
      setBusy(false)
    }
  }

  const sampleLoaded = hasSampleData({ properties, expenses, income })

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      {/* Language */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-light text-gold">
              <Languages size={20} />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-700">{t('language.title')}</h2>
              <p className="mt-1 text-xs text-slate-500">{t('language.description')}</p>
            </div>
          </div>
          <label className="min-w-[13rem]">
            <span className="sr-only">{t('language.label')}</span>
            <select
              className="field-input"
              value={chosen}
              onChange={(e) => changeLanguage(e.target.value)}
              aria-label={t('language.label')}
            >
              {/* '' keeps following the browser if that changes later, which is
                  a different thing from picking English once. */}
              <option value="">{t('language.systemDefault')}</option>
              {languages.map((l) => (
                <option key={l.code} value={l.code} lang={l.code}>
                  {l.name}
                  {l.english === l.name ? '' : ` · ${l.english}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          {t('language.amounts')}
          {/* Always true for a non-English language, not only when the dictionary
              has holes: the dictionary covers the menus, buttons and messages,
              while the entry forms, tables and reports are still English. Gating
              this on coverage meant a fully-translated dictionary reported 100%
              and said nothing, which read as "the whole app is in your
              language". The percentage is still shown when it adds something. */}
          {lang !== 'en' && (
            <>
              {' '}
              {t('language.partial')}
              {coverage.percent < 100 && <> ({t('language.coverage', { percent: coverage.percent })})</>}
            </>
          )}
        </p>
      </Card>

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
        <h2 className="text-sm font-semibold text-slate-700">Account</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar avatar={avatar} email={user?.email} size={40} />
            <div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {avatar.name?.trim() || user?.email || 'Local user'}
              </div>
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

      {/* Appearance */}
      <AppearanceCard />

      {/* Team / sharing (cloud only) */}
      {isCloud && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-700">Team &amp; sharing</h2>
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

      {/* Problem reports */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Report a problem</h2>
          <Button variant="ghost" onClick={() => openReport({})}>
            <Bug size={16} /> New report
          </Button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Found a bug, a number that looks wrong, or something you can’t work out? Tell the developer.
          {SUPPORT_EMAIL ? ' Reports go to ' : ' Reports are kept here so you can copy or send them on.'}
          {SUPPORT_EMAIL && <span className="font-medium">{SUPPORT_EMAIL}</span>}
          {SUPPORT_EMAIL && '.'}
        </p>

        {reports.length > 0 && (
          <div className="mt-4">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">
              Reports you’ve filed
            </div>
            <div className="mt-1 divide-y divide-border-subtle">
              {reports.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-700">{r.reference}</span>
                      <span className="text-xs text-slate-500">{kindLabel(r.kind)}</span>
                      {r.status === 'sent' && (
                        <span className="bg-emerald-50 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-emerald-700">
                          {{ email: 'Emailed', copied: 'Copied' }[r.sent_how] || 'Sent'}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-600">{r.message}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {SUPPORT_EMAIL && (
                      <a
                        href={mailtoLink(r)}
                        className="grid h-8 w-8 place-items-center text-slate-400 hover:text-brand"
                        title={`Email report ${r.reference}`}
                        aria-label={`Email report ${r.reference}`}
                      >
                        <Mail size={15} />
                      </a>
                    )}
                    <button
                      onClick={() => copyReport(r)}
                      className="grid h-8 w-8 place-items-center text-slate-400 hover:text-brand"
                      title={`Copy report ${r.reference}`}
                      aria-label={`Copy report ${r.reference}`}
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      onClick={() => removeReport(r)}
                      className="grid h-8 w-8 place-items-center text-slate-400 hover:text-red-600"
                      title={`Delete report ${r.reference}`}
                      aria-label={`Delete report ${r.reference}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Data */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-700">Your data</h2>
        <p className="mt-1 text-xs text-slate-500">Download everything as JSON, or permanently delete it.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={exportData}>
            <Download size={16} /> Export my data
          </Button>
          {/* Only offered when there is sample data to remove, so it isn't a
              button that does nothing on a real set of books. */}
          {sampleLoaded && (
            <Button variant="ghost" onClick={clearSample} loading={busy}>
              <Sparkles size={16} /> Remove sample data
            </Button>
          )}
          <Button variant="ghost" onClick={deleteAll} loading={busy} className="text-red-600 hover:bg-red-50">
            <Trash2 size={16} /> Delete all my data
          </Button>
        </div>
      </Card>
    </div>
  )
}

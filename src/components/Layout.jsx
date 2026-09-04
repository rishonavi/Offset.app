import { Suspense, useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Boxes,
  Receipt,
  Banknote,
  FileText,
  MailPlus,
  FileUp,
  PieChart,
  Settings as SettingsIcon,
  LogOut,
  Menu,
  X,
  Wallet,
  Info,
  Plus,
  Sun,
  Moon,
  Eye,
  ShieldCheck,
  PiggyBank,
  Trash2,
  Search,
  Building2,
  Briefcase,
  Bug,
  FileSpreadsheet,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme, useAppearance } from '../context/ThemeContext'
import { useData } from '../context/DataContext'
import { isSettled } from '../lib/payments'
import { useWorkspace } from '../context/WorkspaceContext'
import { useConfig } from '../context/ConfigContext'
import { useReport } from '../context/ReportContext'
import { useT } from '../context/LanguageContext'
import { useEntity } from '../context/EntityContext'
import { CONSOLIDATED, PERSONAL } from '../lib/corporate'
import ErrorBoundary from './ErrorBoundary'
import QuickAddExpense from './QuickAddExpense'
import CommandPalette from './CommandPalette'
import ShortcutsHelp from './ShortcutsHelp'
import { checkIsAdmin } from '../lib/admin'
import { Spinner, Avatar } from './ui'

// Eleven destinations in one flat column is eleven things to read before
// choosing one, and it gave equal weight to the dashboard and to the bin. The
// groups are the same four questions the app is actually about — where do I
// stand, what moved, what do I own, what do I do with it — and the last group
// is the one nobody visits on purpose.
const NAV = [
  { group: null, items: [
    { to: '/', key: 'nav.dashboard', icon: LayoutDashboard, end: true },
  ] },
  { group: 'nav.groupLedger', items: [
    { to: '/income', key: 'nav.income', icon: Banknote, count: 'income' },
    { to: '/expenses', key: 'nav.expenses', icon: Receipt, count: 'expenses' },
    { to: '/bills', key: 'nav.bills', icon: FileText },
    { to: '/invoices', key: 'nav.invoices', icon: FileSpreadsheet },
  ] },
  { group: 'nav.groupHoldings', items: [
    { to: '/properties', key: 'nav.assets', icon: Boxes },
    { to: '/personal', key: 'nav.personal', icon: PiggyBank },
  ] },
  { group: 'nav.groupTools', items: [
    { to: '/reports', key: 'nav.reports', icon: PieChart, keepsFilter: true },
    // Three errands that were spread across two pages, one of which was called
    // Export and contained an import. Data in, data out, and what it all came
    // to — each now behind the word for it.
    { to: '/import', key: 'nav.import', icon: MailPlus },
    { to: '/exports', key: 'nav.exports', icon: FileUp, keepsFilter: true },
  ] },
  { group: 'nav.groupManage', items: [
    { to: '/bin', key: 'nav.bin', icon: Trash2 },
    { to: '/settings', key: 'nav.settings', icon: SettingsIcon },
  ] },
]

// Only shown once a company exists — a personal install never sees it.
// Stock, advances and payroll share one destination because they are one job —
// running the company behind the property — and eleven places to go was already
// too many.
const CORPORATE_NAV = [
  { to: '/companies', key: 'nav.companies', icon: Building2 },
  { to: '/operations', key: 'nav.operations', icon: Briefcase },
]
const ADMIN_NAV = { to: '/admin', key: 'nav.admin', icon: ShieldCheck }

// What is waiting for you, per destination. A sidebar that only links is a list
// of places; one that counts is a place to look first. Only unsettled entries
// count — a paid expense is finished business and putting it in the badge would
// make the number mean "how much have you done", which nobody needs.
function useNavCounts() {
  const { expenses, income } = useData()
  return useMemo(() => ({
    expenses: expenses.filter((e) => !isSettled(e, 'expense')).length,
    income: income.filter((e) => !isSettled(e, 'income')).length,
  }), [expenses, income])
}

const FILTER_PAIR = ['/reports', '/exports']

function NavItems({ onNavigate, isAdmin }) {
  const t = useT()
  const { enabled: corporate } = useEntity()
  const counts = useNavCounts()
  const { pathname, search } = useLocation()
  const keepsFilterHere = FILTER_PAIR.includes(pathname)
  const groups = NAV.map((g) => {
    if (corporate && g.group === 'nav.groupHoldings') return { ...g, items: [...g.items, ...CORPORATE_NAV] }
    if (isAdmin && g.group === 'nav.groupManage') return { ...g, items: [ADMIN_NAV, ...g.items] }
    return g
  })
  return (
    <nav className="flex flex-col gap-5">
      {groups.map((g, i) => (
        <div key={g.group || 'top'} className="flex flex-col gap-0.5">
          {g.group && (
            <p className="mb-1 px-3 text-[0.6rem] font-semibold uppercase tracking-[2px] text-white/35">
              {t(g.group)}
            </p>
          )}
          {g.items.map(({ to, key, icon: Icon, end, count, keepsFilter }) => {
            const waiting = count ? counts[count] : 0
            // Reports and Export ask the same question of the same rows, so
            // moving between them keeps the filter you already built. Every
            // other destination starts clean — carrying ?propertyId= into
            // Settings would be noise, not continuity.
            const target = keepsFilter && keepsFilterHere ? { pathname: to, search } : to
            return (
              <NavLink
                key={to}
                to={target}
                end={end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `group flex min-h-11 items-center gap-3 rounded-lg border-s-2 px-3 text-[0.83rem] transition ${
                    isActive
                      ? 'border-gold bg-gold/15 font-semibold text-gold'
                      : 'border-transparent font-medium text-white/70 hover:bg-white/5 hover:text-gold'
                  }`
                }
              >
                <Icon size={17} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t(key)}</span>
                {waiting > 0 && (
                  <span
                    className="shrink-0 rounded-full bg-gold/20 px-1.5 py-0.5 text-[0.65rem] font-semibold tabular text-gold"
                    title={t('nav.waiting', { count: waiting })}
                  >
                    {waiting > 99 ? '99+' : waiting}
                    <span className="sr-only"> {t('nav.waiting', { count: waiting })}</span>
                  </span>
                )}
              </NavLink>
            )
          })}
          {/* A hairline between groups rather than a heavier divider: it should
              separate without being another thing on screen. */}
          {i < groups.length - 1 && <span aria-hidden="true" className="mt-4 h-px bg-gradient-to-r from-gold/25 to-transparent" />}
        </div>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gold text-navy shadow-[0_2px_10px_-2px_var(--color-gold)]">
        <Wallet size={18} />
      </div>
      <div className="leading-tight">
        <div className="font-serif text-[1.05rem] font-bold tracking-wide text-white">Offset</div>
        {/* The same gold rule that sits under every page heading. It is a small
            thing, but it is what ties the mark to the pages rather than leaving
            it a logo parked above them. */}
        <span aria-hidden="true" className="mt-1 block h-px w-8 bg-gradient-to-r from-gold to-transparent" />
      </div>
    </div>
  )
}

function ThemeToggle({ className = '' }) {
  const { theme, toggle } = useTheme()
  const t = useT()
  const dark = theme === 'dark'
  return (
    <button
      onClick={toggle}
      className={`grid h-11 w-11 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-gold ${className}`}
      title={dark ? t('chrome.switchToLight') : t('chrome.switchToDark')}
      aria-label={t('chrome.toggleTheme')}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}

function QuickAdd({ onClick }) {
  const t = useT()
  return (
    <button onClick={onClick} className="btn-primary mt-6 w-full">
      <Plus size={15} /> {t('chrome.addExpense')}
    </button>
  )
}

// Which set of books you are looking at. Absent until a company exists.
//
// Two levels, because they are two different questions. The tabs answer "whose
// books" — your own, or a company's — which is the one that changes what the
// app is for, and it was previously buried as one option inside a dropdown you
// had to open to read. The select underneath answers "which company", and only
// appears when there is more than one to choose between.
function CompanySwitcher() {
  const { enabled, entities, activeId, switchTo, consolidated, personal } = useEntity()
  const t = useT()
  if (!enabled) return null

  // Coming back to a company lands on the one you were last in, so the tab is a
  // toggle rather than a thing that loses your place.
  const lastCompany = entities.some((e) => e.id === activeId) ? activeId : entities[0].id

  return (
    <div className="mt-3">
      <div
        role="tablist"
        aria-label={t('company.books')}
        className="flex gap-1 border border-white/15 bg-white/5 p-1"
      >
        <BooksTab selected={personal} onSelect={() => switchTo(PERSONAL)} label={t('company.personal')} icon={PiggyBank} />
        <BooksTab
          selected={!personal}
          onSelect={() => switchTo(consolidated ? CONSOLIDATED : lastCompany)}
          label={t('company.company')}
          icon={Building2}
        />
      </div>

      {!personal && entities.length > 1 && (
        <select
          value={consolidated ? CONSOLIDATED : activeId}
          onChange={(e) => switchTo(e.target.value)}
          className="mt-1.5 w-full border border-white/15 bg-white/5 px-2 py-2 text-xs text-white/90"
          aria-label={t('company.switch')}
          title={t('company.switch')}
        >
          {entities.map((e) => (
            <option key={e.id} value={e.id} className="text-ink-1">{e.name}</option>
          ))}
          <option value={CONSOLIDATED} className="text-ink-1">{t('company.all')}</option>
        </select>
      )}
      {!personal && entities.length === 1 && (
        <p className="mt-1.5 truncate px-1 text-[0.68rem] text-white/45" title={entities[0].name}>
          {entities[0].name}
        </p>
      )}
    </div>
  )
}

function BooksTab({ selected, onSelect, label, icon: Icon }) {
  return (
    <button
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={
        selected
          ? 'flex flex-1 items-center justify-center gap-1.5 bg-gold px-2 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[1px] text-navy'
          : 'flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[1px] text-white/55 transition hover:text-white/90'
      }
    >
      <Icon size={13} /> {label}
    </button>
  )
}

// Sits under the nav in both the sidebar and the drawer. Quiet enough not to
// compete with the destinations above it, present enough that nobody has to go
// hunting through Settings at the exact moment the app has annoyed them.
function ReportLink({ onClick }) {
  const t = useT()
  return (
    <button
      onClick={onClick}
      className="mt-2 flex w-full items-center gap-3 px-3 py-2 text-[0.7rem] font-medium uppercase tracking-[1px] text-white/45 transition hover:text-gold"
    >
      <Bug size={15} />
      {t('chrome.reportProblem')}
    </button>
  )
}

function WorkspaceSwitcher() {
  const { workspaces, activeOwner, setActiveOwner, hasShared } = useWorkspace()
  const t = useT()
  if (!hasShared) return null
  return (
    <select
      value={activeOwner}
      onChange={(e) => setActiveOwner(e.target.value)}
      className="mt-4 w-full border border-white/15 bg-white/5 px-2 py-2 text-xs text-white/90"
      title={t('chrome.switchWorkspace')}
    >
      {workspaces.map((w) => (
        <option key={w.ownerId} value={w.ownerId} className="text-ink-1">
          {w.own ? t('chrome.myWorkspace') : t('chrome.sharedWorkspace', { name: w.label })}
        </option>
      ))}
    </select>
  )
}

// Hides the mobile floating quick-add on the very form it would link to
// (/properties/new, /expenses/:id/edit, etc.) — otherwise it's a redundant
// shortcut to the current page, floating over the form's own fields.
const ON_ADD_EDIT_FORM = /^\/(properties|expenses|income)\/(new|[^/]+\/edit)$/

export default function Layout() {
  const { user, signOut, isCloud } = useAuth()
  const { canWrite } = useData()
  const { announcement, maintenance } = useConfig()
  const { openReport } = useReport()
  const t = useT()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [quickAdd, setQuickAdd] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const location = useLocation()
  const showFab = canWrite && !ON_ADD_EDIT_FORM.test(location.pathname)

  useEffect(() => {
    let active = true
    checkIsAdmin().then((ok) => active && setIsAdmin(ok))
    return () => {
      active = false
    }
  }, [user])

  // Keyboard: ⌘K / Ctrl-K opens the command palette anywhere; "n" quick-adds an
  // expense (but not while typing in a field).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setCmdOpen((v) => !v)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      const typing = t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT' || t?.isContentEditable
      if (typing) return
      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(true)
        return
      }
      if (e.key !== 'n' && e.key !== 'N') return
      if (!canWrite) return
      e.preventDefault()
      setQuickAdd(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canWrite])

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded focus:bg-gold focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-navy"
      >
        {t('chrome.skipToContent')}
      </a>
      <div className="noise-overlay" />

      {/* Desktop sidebar */}
      <aside className="inset-safe ps-safe [--safe-pad-x:1rem] [--safe-pad:1.25rem] sticky top-0 hidden h-screen flex-col border-e border-navy-dark bg-navy px-4 lg:flex">
        <Brand />
        <WorkspaceSwitcher />
        {canWrite && <QuickAdd onClick={() => setQuickAdd(true)} />}
        <button
          onClick={() => setCmdOpen(true)}
          className="mt-3 flex w-full items-center gap-2 border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/50 transition hover:border-gold/40 hover:text-white/80"
        >
          <Search size={14} />
          <span className="flex-1 text-start">{t('chrome.search')}</span>
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[0.6rem]">⌘K</kbd>
        </button>
        {/* min-h-0 as well as flex-1: without it a flex child refuses to shrink
            below its content, so the column grew past the screen and took the
            user footer with it instead of scrolling. Grouping the nav made it
            tall enough to matter, but the bug was always there waiting for a
            short screen or one more destination. */}
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto pe-1">
          <NavItems isAdmin={isAdmin} />
          <ReportLink onClick={() => openReport({})} />
        </div>
        <UserFooter user={user} isCloud={isCloud} onSignOut={signOut} />
      </aside>

      {/* Mobile top bar */}
      <header className="pt-safe ps-safe [--safe-pad-x:1rem] [--safe-pad:0.75rem] sticky top-0 z-30 flex items-center justify-between border-b border-navy-dark bg-navy px-4 pb-3 lg:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCmdOpen(true)}
            className="grid h-11 w-11 place-items-center rounded-lg text-white/70 hover:text-gold"
            aria-label={t('chrome.searchLabel')}
          >
            <Search size={20} />
          </button>
          <ThemeToggle />
          <button
            onClick={() => setMobileOpen(true)}
            className="grid h-11 w-11 place-items-center rounded-lg text-white/70 hover:text-gold"
            aria-label={t('chrome.openMenu')}
          >
            <Menu size={22} />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="inset-safe [--safe-pad:1.25rem] absolute start-0 top-0 flex h-full w-72 flex-col border-e-2 border-gold bg-navy px-4 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                onClick={() => setMobileOpen(false)}
                className="grid h-11 w-11 place-items-center rounded-lg text-white/60 hover:text-gold"
                aria-label={t('chrome.closeMenu')}
              >
                <X size={20} />
              </button>
            </div>
            <WorkspaceSwitcher />
            {canWrite && <QuickAdd onClick={() => { setMobileOpen(false); setQuickAdd(true) }} />}
            <div className="mt-6 min-h-0 flex-1 overflow-y-auto pe-1">
              <NavItems onNavigate={() => setMobileOpen(false)} isAdmin={isAdmin} />
              <ReportLink onClick={() => { setMobileOpen(false); openReport({}) }} />
            </div>
            <UserFooter user={user} isCloud={isCloud} onSignOut={signOut} />
          </div>
        </div>
      )}

      {/* Main content */}
      <main id="main-content" className="min-w-0">
        {maintenance?.active && (
          <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-700 lg:px-8">
            <Info size={14} className="shrink-0" />
            <span>{maintenance.message || t('banner.maintenance')}</span>
          </div>
        )}
        {announcement?.active && announcement.text && (
          <div className="flex items-center gap-2 border-b border-gold/30 bg-brand-light px-4 py-2 text-xs font-medium text-ink-3 lg:px-8">
            <Info size={14} className="shrink-0 text-gold" />
            <span>{announcement.text}</span>
          </div>
        )}
        {!canWrite && (
          <div className="flex items-center gap-2 border-b border-line bg-surface-chip px-4 py-2 text-xs text-ink-4 lg:px-8">
            <Eye size={14} className="shrink-0" />
            <span>
              {t('banner.readOnlyLead')} <strong>{t('banner.readOnlyStrong')}</strong> {t('banner.readOnlyTail')}
            </span>
          </div>
        )}
        {!isCloud && (
          <div className="flex items-center gap-2 border-b border-gold/20 bg-amber-50 px-4 py-2 text-xs text-amber-800 lg:px-8">
            <Info size={14} className="shrink-0" />
            <span>
              <strong>{t('banner.demoStrong')}</strong> {t('banner.demoBody')}
            </span>
          </div>
        )}
        <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-10">
          <ErrorBoundary resetKey={location.pathname} onReport={(error) => openReport({ error })}>
            <Suspense fallback={<Spinner />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      {/* Mobile floating quick-add */}
      {showFab && (
        <button
          onClick={() => setQuickAdd(true)}
          className="fixed bottom-5 right-5 z-30 grid h-14 w-14 place-items-center bg-gold text-navy shadow-lg shadow-navy/40 transition active:scale-95 lg:hidden"
          aria-label={t('chrome.addExpense')}
        >
          <Plus size={26} />
        </button>
      )}

      <QuickAddExpense open={quickAdd} onClose={() => setQuickAdd(false)} />
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onQuickAdd={() => setQuickAdd(true)}
        onHelp={() => setHelpOpen(true)}
        onReport={() => openReport({})}
      />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}

function UserFooter({ user, isCloud, onSignOut }) {
  const t = useT()
  const { avatar } = useAppearance()
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="flex items-center gap-3 px-1">
        <Avatar avatar={avatar} email={user?.email} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">
            {avatar?.name?.trim() || user?.email || t('chrome.localUser')}
          </div>
          <div className="text-[10px] uppercase tracking-[1.5px] text-gold/60">{isCloud ? t('chrome.signedIn') : t('chrome.demoMode')}</div>
        </div>
        <ThemeToggle />
        {isCloud && (
          <button
            onClick={onSignOut}
            className="grid h-11 w-11 place-items-center rounded-lg text-white/50 transition hover:bg-red-500/15 hover:text-red-400"
            title={t('chrome.signOut')}
          >
            <LogOut size={17} />
          </button>
        )}
      </div>
      {/* Which books you are in is the same kind of question as who you are
          signed in as, so it sits with it rather than competing with the brand
          at the top of the column. Absent entirely until a company exists. */}
      <CompanySwitcher />
    </div>
  )
}

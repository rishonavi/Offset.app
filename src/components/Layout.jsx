import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Boxes,
  Receipt,
  Banknote,
  FileText,
  MailPlus,
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
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useData } from '../context/DataContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useConfig } from '../context/ConfigContext'
import { useT } from '../context/LanguageContext'
import ErrorBoundary from './ErrorBoundary'
import QuickAddExpense from './QuickAddExpense'
import CommandPalette from './CommandPalette'
import ShortcutsHelp from './ShortcutsHelp'
import { checkIsAdmin } from '../lib/admin'
import { Spinner } from './ui'

const NAV = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/personal', key: 'nav.personal', icon: PiggyBank },
  { to: '/properties', key: 'nav.assets', icon: Boxes },
  { to: '/income', key: 'nav.income', icon: Banknote },
  { to: '/expenses', key: 'nav.expenses', icon: Receipt },
  { to: '/bills', key: 'nav.bills', icon: FileText },
  { to: '/import', key: 'nav.import', icon: MailPlus },
  { to: '/reports', key: 'nav.reports', icon: PieChart },
  { to: '/bin', key: 'nav.bin', icon: Trash2 },
  { to: '/settings', key: 'nav.settings', icon: SettingsIcon },
]

function NavItems({ onNavigate, isAdmin }) {
  const t = useT()
  const items = isAdmin ? [...NAV, { to: '/admin', key: 'nav.admin', icon: ShieldCheck }] : NAV
  return (
    <nav className="flex flex-col gap-1">
      {items.map(({ to, key, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 border-l-2 px-3 py-2.5 text-[0.78rem] font-medium uppercase tracking-[1px] transition ${
              isActive
                ? 'border-gold bg-gold/15 text-gold'
                : 'border-transparent text-white/65 hover:bg-white/5 hover:text-gold'
            }`
          }
        >
          <Icon size={17} />
          {t(key)}
        </NavLink>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <div className="grid h-9 w-9 place-items-center bg-gold text-navy">
        <Wallet size={18} />
      </div>
      <div className="leading-tight">
        <div className="font-serif text-base font-bold tracking-wide text-white">Offset</div>
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
      className={`grid h-9 w-9 place-items-center text-white/60 transition hover:bg-white/10 hover:text-gold ${className}`}
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
        <option key={w.ownerId} value={w.ownerId} className="text-slate-900">
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
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-navy-dark bg-navy px-4 py-5 lg:flex">
        <Brand />
        <WorkspaceSwitcher />
        {canWrite && <QuickAdd onClick={() => setQuickAdd(true)} />}
        <button
          onClick={() => setCmdOpen(true)}
          className="mt-3 flex w-full items-center gap-2 border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/50 transition hover:border-gold/40 hover:text-white/80"
        >
          <Search size={14} />
          <span className="flex-1 text-left">{t('chrome.search')}</span>
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[0.6rem]">⌘K</kbd>
        </button>
        <div className="mt-6 flex-1">
          <NavItems isAdmin={isAdmin} />
        </div>
        <UserFooter user={user} isCloud={isCloud} onSignOut={signOut} />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-navy-dark bg-navy px-4 py-3 lg:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCmdOpen(true)}
            className="grid h-10 w-10 place-items-center text-white/70 hover:text-gold"
            aria-label={t('chrome.searchLabel')}
          >
            <Search size={20} />
          </button>
          <ThemeToggle />
          <button
            onClick={() => setMobileOpen(true)}
            className="grid h-10 w-10 place-items-center text-white/70 hover:text-gold"
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
          <div className="absolute left-0 top-0 flex h-full w-72 flex-col border-r-2 border-gold bg-navy px-4 py-5 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                onClick={() => setMobileOpen(false)}
                className="grid h-9 w-9 place-items-center text-white/60 hover:text-gold"
                aria-label={t('chrome.closeMenu')}
              >
                <X size={20} />
              </button>
            </div>
            <WorkspaceSwitcher />
            {canWrite && <QuickAdd onClick={() => { setMobileOpen(false); setQuickAdd(true) }} />}
            <div className="mt-6 flex-1">
              <NavItems onNavigate={() => setMobileOpen(false)} isAdmin={isAdmin} />
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
          <div className="flex items-center gap-2 border-b border-gold/30 bg-brand-light px-4 py-2 text-xs font-medium text-slate-700 lg:px-8">
            <Info size={14} className="shrink-0 text-gold" />
            <span>{announcement.text}</span>
          </div>
        )}
        {!canWrite && (
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2 text-xs text-slate-600 lg:px-8">
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
          <ErrorBoundary resetKey={location.pathname}>
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
      />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}

function UserFooter({ user, isCloud, onSignOut }) {
  const t = useT()
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="flex items-center gap-3 px-1">
        <div className="grid h-9 w-9 shrink-0 place-items-center bg-gold/20 text-sm font-semibold text-gold">
          {(user?.email || 'U')[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{user?.email || t('chrome.localUser')}</div>
          <div className="text-[10px] uppercase tracking-[1.5px] text-gold/60">{isCloud ? t('chrome.signedIn') : t('chrome.demoMode')}</div>
        </div>
        <ThemeToggle />
        {isCloud && (
          <button
            onClick={onSignOut}
            className="grid h-9 w-9 place-items-center text-white/50 transition hover:bg-red-500/15 hover:text-red-400"
            title={t('chrome.signOut')}
          >
            <LogOut size={17} />
          </button>
        )}
      </div>
    </div>
  )
}

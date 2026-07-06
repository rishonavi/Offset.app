import { Suspense, useState } from 'react'
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
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useData } from '../context/DataContext'
import { useWorkspace } from '../context/WorkspaceContext'
import ErrorBoundary from './ErrorBoundary'
import { Spinner } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/properties', label: 'Assets', icon: Boxes },
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/income', label: 'Income', icon: Banknote },
  { to: '/bills', label: 'Bills', icon: FileText },
  { to: '/import', label: 'Import from Gmail', icon: MailPlus },
  { to: '/reports', label: 'Reports & Export', icon: PieChart },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

function NavItems({ onNavigate }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon, end }) => (
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
          {label}
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
  const dark = theme === 'dark'
  return (
    <button
      onClick={toggle}
      className={`grid h-9 w-9 place-items-center text-white/60 transition hover:bg-white/10 hover:text-gold ${className}`}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle theme"
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}

function QuickAdd({ onNavigate }) {
  return (
    <Link to="/expenses/new" onClick={onNavigate} className="btn-primary mt-6 w-full">
      <Plus size={15} /> Add expense
    </Link>
  )
}

function WorkspaceSwitcher() {
  const { workspaces, activeOwner, setActiveOwner, hasShared } = useWorkspace()
  if (!hasShared) return null
  return (
    <select
      value={activeOwner}
      onChange={(e) => setActiveOwner(e.target.value)}
      className="mt-4 w-full border border-white/15 bg-white/5 px-2 py-2 text-xs text-white/90"
      title="Switch workspace"
    >
      {workspaces.map((w) => (
        <option key={w.ownerId} value={w.ownerId} className="text-slate-900">
          {w.own ? 'My workspace' : `Shared · ${w.label}`}
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
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const showFab = canWrite && !ON_ADD_EDIT_FORM.test(location.pathname)

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      <div className="noise-overlay" />

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-navy-dark bg-navy px-4 py-5 lg:flex">
        <Brand />
        <WorkspaceSwitcher />
        {canWrite && <QuickAdd />}
        <div className="mt-6 flex-1">
          <NavItems />
        </div>
        <UserFooter user={user} isCloud={isCloud} onSignOut={signOut} />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-navy-dark bg-navy px-4 py-3 lg:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            onClick={() => setMobileOpen(true)}
            className="grid h-10 w-10 place-items-center text-white/70 hover:text-gold"
            aria-label="Open menu"
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
                aria-label="Close menu"
              >
                <X size={20} />
              </button>
            </div>
            <WorkspaceSwitcher />
            {canWrite && <QuickAdd onNavigate={() => setMobileOpen(false)} />}
            <div className="mt-6 flex-1">
              <NavItems onNavigate={() => setMobileOpen(false)} />
            </div>
            <UserFooter user={user} isCloud={isCloud} onSignOut={signOut} />
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="min-w-0">
        {!canWrite && (
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2 text-xs text-slate-600 lg:px-8">
            <Eye size={14} className="shrink-0" />
            <span>
              You’re viewing a <strong>shared workspace</strong> — read-only.
            </span>
          </div>
        )}
        {!isCloud && (
          <div className="flex items-center gap-2 border-b border-gold/20 bg-amber-50 px-4 py-2 text-xs text-amber-800 lg:px-8">
            <Info size={14} className="shrink-0" />
            <span>
              <strong>Demo mode</strong> — data is saved only in this browser. Add your Supabase keys
              in <code className="bg-amber-100 px-1">.env</code> for cloud sync, login &amp; receipt storage.
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
        <Link
          to="/expenses/new"
          className="fixed bottom-5 right-5 z-30 grid h-14 w-14 place-items-center bg-gold text-navy shadow-lg shadow-navy/40 transition active:scale-95 lg:hidden"
          aria-label="Add expense"
        >
          <Plus size={26} />
        </Link>
      )}
    </div>
  )
}

function UserFooter({ user, isCloud, onSignOut }) {
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="flex items-center gap-3 px-1">
        <div className="grid h-9 w-9 shrink-0 place-items-center bg-gold/20 text-sm font-semibold text-gold">
          {(user?.email || 'U')[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{user?.email || 'Local user'}</div>
          <div className="text-[10px] uppercase tracking-[1.5px] text-gold/60">{isCloud ? 'Signed in' : 'Demo mode'}</div>
        </div>
        <ThemeToggle />
        {isCloud && (
          <button
            onClick={onSignOut}
            className="grid h-9 w-9 place-items-center text-white/50 transition hover:bg-red-500/15 hover:text-red-400"
            title="Sign out"
          >
            <LogOut size={17} />
          </button>
        )}
      </div>
    </div>
  )
}

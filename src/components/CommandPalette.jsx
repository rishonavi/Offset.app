import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  LayoutDashboard,
  Boxes,
  Banknote,
  Receipt,
  FileText,
  MailPlus,
  PieChart,
  Settings as SettingsIcon,
  Trash2,
  PiggyBank,
  Plus,
  Moon,
  Sun,
  Building2,
  CornerDownLeft,
  Keyboard,
  Bug,
} from 'lucide-react'
import { useData } from '../context/DataContext'
import { useTheme } from '../context/ThemeContext'
import { formatCurrency, formatDate } from '../lib/format'

const NAV_COMMANDS = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Personal', to: '/personal', icon: PiggyBank },
  { label: 'Assets', to: '/properties', icon: Boxes },
  { label: 'Income', to: '/income', icon: Banknote },
  { label: 'Expenses', to: '/expenses', icon: Receipt },
  { label: 'Bills', to: '/bills', icon: FileText },
  { label: 'Import', to: '/import', icon: MailPlus },
  { label: 'Reports & Export', to: '/reports', icon: PieChart },
  { label: 'Bin', to: '/bin', icon: Trash2 },
  { label: 'Settings', to: '/settings', icon: SettingsIcon },
]

// A ⌘K / Ctrl-K palette: jump to any page, run a quick action, or search across
// assets, income, expenses and documents. Everything is local — no navigation
// round-trips until you pick a result.
export default function CommandPalette({ open, onClose, onQuickAdd, onHelp, onReport }) {
  const navigate = useNavigate()
  const { properties, expenses, income, documents, propertyNameById, canWrite } = useData()
  const { theme, toggle } = useTheme()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 10)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => setActive(0), [q])

  const items = useMemo(() => {
    const query = q.trim().toLowerCase()
    const match = (s) => !query || (s || '').toLowerCase().includes(query)
    const go = (to) => () => {
      onClose()
      navigate(to)
    }
    const out = []
    const push = (group, label, sublabel, icon, action) => out.push({ group, label, sublabel, icon, action })

    if (canWrite) {
      if (match('add expense')) push('Actions', 'Add expense', 'Quick add', Plus, () => { onClose(); onQuickAdd?.() })
      if (match('add income')) push('Actions', 'Add income', '', Plus, go('/income/new'))
      if (match('add asset') || match('add property')) push('Actions', 'Add asset', '', Plus, go('/properties/new'))
    }
    const dark = theme === 'dark'
    if (match(dark ? 'light mode' : 'dark mode') || match('theme') || match('appearance'))
      push('Actions', dark ? 'Switch to light mode' : 'Switch to dark mode', '', dark ? Sun : Moon, () => { toggle(); onClose() })
    if (match('keyboard shortcuts') || match('help'))
      push('Actions', 'Keyboard shortcuts', '', Keyboard, () => { onClose(); onHelp?.() })
    // "bug" and "feedback" are what people actually type when something is wrong.
    if (match('report a problem') || match('bug') || match('feedback') || match('support'))
      push('Actions', 'Report a problem', 'Tell the developer about a bug', Bug, () => { onClose(); onReport?.() })

    for (const n of NAV_COMMANDS) if (match(n.label)) push('Go to', n.label, '', n.icon, go(n.to))

    if (query) {
      let n = 0
      for (const p of properties) {
        if (n >= 6) break
        if (match(p.name) || match(p.address) || match(p.type)) {
          push('Assets', p.name, p.type || p.address || '', Building2, go(`/properties/${p.id}`))
          n++
        }
      }
      n = 0
      for (const e of expenses) {
        if (n >= 6) break
        if (match(e.vendor) || match(e.category) || match(e.description)) {
          push('Expenses', `${e.vendor || e.category || 'Expense'} · ${formatCurrency(e.amount)}`, `${propertyNameById(e.property_id) || ''} · ${formatDate(e.date)}`, Receipt, go(`/properties/${e.property_id}`))
          n++
        }
      }
      n = 0
      for (const e of income) {
        if (n >= 6) break
        if (match(e.source) || match(e.payer) || match(e.description)) {
          push('Income', `${e.source || 'Income'} · ${formatCurrency(e.amount)}`, `${propertyNameById(e.property_id) || ''} · ${formatDate(e.date)}`, Banknote, go(`/properties/${e.property_id}`))
          n++
        }
      }
      n = 0
      for (const d of documents) {
        if (n >= 5) break
        if (match(d.title) || match(d.doc_type)) {
          push('Documents', d.title, `${d.doc_type || ''} · ${propertyNameById(d.property_id) || ''}`, FileText, go(`/properties/${d.property_id}`))
          n++
        }
      }
    }
    return out
  }, [q, properties, expenses, income, documents, canWrite, theme]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[active]?.action()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-navy/50 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="card w-full max-w-xl animate-fade-in overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border-light px-4">
          <Search size={18} className="shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search or jump to…"
            className="w-full bg-transparent py-3.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            aria-label="Command palette search"
          />
          <kbd className="hidden shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[0.65rem] font-sans text-slate-400 sm:block">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">No matches for “{q}”.</div>
          ) : (
            <ul>
              {items.map((it, i) => {
                const showHeader = i === 0 || items[i - 1].group !== it.group
                const Icon = it.icon
                return (
                  <Fragment key={i}>
                    {showHeader && (
                      <li className="px-4 pb-1 pt-3 text-[0.6rem] font-semibold uppercase tracking-[1.5px] text-slate-400">
                        {it.group}
                      </li>
                    )}
                    <li>
                      <button
                        data-idx={i}
                        onMouseMove={() => setActive(i)}
                        onClick={it.action}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                          active === i ? 'bg-brand-light text-slate-900' : 'text-slate-600'
                        }`}
                      >
                        <Icon size={16} className={active === i ? 'text-gold' : 'text-slate-400'} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{it.label}</span>
                          {it.sublabel && <span className="block truncate text-xs text-slate-400">{it.sublabel}</span>}
                        </span>
                        {active === i && <CornerDownLeft size={14} className="shrink-0 text-slate-400" />}
                      </button>
                    </li>
                  </Fragment>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border-light px-4 py-2 text-[0.65rem] text-slate-400">
          <span>↑↓ to navigate · ↵ to open</span>
          <span>Search assets, income, expenses &amp; docs</span>
        </div>
      </div>
    </div>
  )
}

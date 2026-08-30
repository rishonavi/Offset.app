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
  Clock,
  Eraser,
  Keyboard,
  Bug,
} from 'lucide-react'
import { useData } from '../context/DataContext'
import { useTheme } from '../context/ThemeContext'
import { formatCurrency, formatDate } from '../lib/format'
import { recentSearches, recordSearch, clearSearches, RETENTION_DAYS } from '../lib/searchHistory'
import { terms, matchesAll, score } from '../lib/searchMatch'

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
  // Read when the palette opens rather than held across the session, so a week
  // ticking over — or another tab clearing the list — is reflected next time it
  // is used instead of at the next reload.
  const [recents, setRecents] = useState([])
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    setRecents(recentSearches())
    const t = setTimeout(() => inputRef.current?.focus(), 10)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => setActive(0), [q])

  const items = useMemo(() => {
    const query = q.trim()
    const words = terms(query)
    // Commands are matched on their own label; records get every field they
    // have, so "villa plumber" can find the plumber's bill for the villa even
    // though no single field holds both words.
    const match = (s) => matchesAll([s], words)
    const go = (to) => () => {
      onClose()
      navigate(to)
    }
    const out = []
    const push = (group, label, sublabel, icon, action, rank) => out.push({ group, label, sublabel, icon, action, rank })

    // With nothing typed, the most useful thing to offer is what they were
    // looking for last time. Only here: once someone starts typing, the results
    // are more use than the history of getting to them.
    if (!words.length) {
      for (const r of recents) {
        push('Recent searches', r, '', Clock, () => { setQ(r); inputRef.current?.focus() })
      }
      if (recents.length) {
        push('Recent searches', 'Clear recent searches', `Kept on this device for ${RETENTION_DAYS} days`, Eraser,
          () => setRecents(clearSearches()))
      }
    }

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

    if (words.length) {
      let n = 0
      for (const p of properties) {
        if (n >= 6) break
        if (matchesAll([p.name, p.address, p.type, p.notes], words)) {
          push('Assets', p.name, p.type || p.address || '', Building2, go(`/properties/${p.id}`), score([p.name, p.type, p.address], words))
          n++
        }
      }
      n = 0
      for (const e of expenses) {
        if (n >= 6) break
        if (matchesAll([e.vendor, e.category, e.description, propertyNameById(e.property_id)], words)) {
          push('Expenses', `${e.vendor || e.category || 'Expense'} · ${formatCurrency(e.amount)}`, `${propertyNameById(e.property_id) || ''} · ${formatDate(e.date)}`, Receipt, go(`/properties/${e.property_id}`), score([e.vendor, e.category, e.description], words))
          n++
        }
      }
      n = 0
      for (const e of income) {
        if (n >= 6) break
        if (matchesAll([e.source, e.payer, e.description, propertyNameById(e.property_id)], words)) {
          push('Income', `${e.source || 'Income'} · ${formatCurrency(e.amount)}`, `${propertyNameById(e.property_id) || ''} · ${formatDate(e.date)}`, Banknote, go(`/properties/${e.property_id}`), score([e.source, e.payer, e.description], words))
          n++
        }
      }
      n = 0
      for (const d of documents) {
        if (n >= 5) break
        if (matchesAll([d.title, d.doc_type, propertyNameById(d.property_id)], words)) {
          push('Documents', d.title, `${d.doc_type || ''} · ${propertyNameById(d.property_id) || ''}`, FileText, go(`/properties/${d.property_id}`), score([d.title, d.doc_type], words))
          n++
        }
      }
    }
    // Actions and navigation keep the order they are written in — that order is
    // a decision. The records are sorted by how well they matched, so a source
    // called "Rent" comes before a note that happens to mention rent.
    const fixed = out.filter((x) => !x.rank)
    const ranked = out.filter((x) => x.rank).sort((a, b) => b.rank - a.rank)
    return [...fixed, ...ranked]
  }, [q, properties, expenses, income, documents, canWrite, theme, recents]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  // A search is a thing someone did once they acted on a result. Recorded here
  // rather than on every keystroke, which would fill the list with "s", "se",
  // "sea" — the prefixes of one search, none of which anyone meant. Picking a
  // past search back out of the list is moving around inside the palette, not a
  // new search, so it does not re-record itself.
  const run = (item) => {
    if (!item) return
    if (item.group !== 'Recent searches') recordSearch(q)
    item.action()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(items[active])
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
                        onClick={() => run(it)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-start transition ${
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

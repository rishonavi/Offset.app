import { useEffect } from 'react'
import { X } from 'lucide-react'

const SHORTCUTS = [
  { keys: ['⌘', 'K'], desc: 'Command palette — search & jump anywhere' },
  { keys: ['N'], desc: 'Quick-add an expense' },
  { keys: ['?'], desc: 'Show this shortcuts help' },
  { keys: ['Esc'], desc: 'Close any dialog' },
]

// A small cheat sheet so the keyboard shortcuts are discoverable (opened with
// "?" or from the command palette).
export default function ShortcutsHelp({ open, onClose }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-navy/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="card w-full max-w-md animate-fade-in p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-lg font-bold text-slate-900">Keyboard shortcuts</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <ul className="space-y-2.5">
          {SHORTCUTS.map((s) => (
            <li key={s.desc} className="flex items-center justify-between gap-4">
              <span className="text-sm text-slate-600">{s.desc}</span>
              <span className="flex shrink-0 items-center gap-1">
                {s.keys.map((k, j) => (
                  <kbd
                    key={j}
                    className="min-w-[1.6rem] rounded border border-border-light bg-slate-50 px-1.5 py-0.5 text-center text-xs font-semibold text-slate-600"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
          Tip: click any table column header to sort by it.
        </p>
      </div>
    </div>
  )
}

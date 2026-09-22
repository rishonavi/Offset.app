import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

const ToastContext = createContext(() => {})
export const useToast = () => useContext(ToastContext)

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info }
const ACCENT = { success: '#2F8F6B', error: '#C0492F', info: '#C5A059' }

let counter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    if (timers.current[id]) {
      clearTimeout(timers.current[id])
      delete timers.current[id]
    }
  }, [])

  // toast(message, { type, action: { label, onClick }, duration })
  const toast = useCallback(
    (message, { type = 'success', action, duration = 5000 } = {}) => {
      const id = ++counter
      setToasts((list) => [...list, { id, message, type, action }])
      timers.current[id] = setTimeout(() => dismiss(id), duration)
      return id
    },
    [dismiss],
  )

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => {
          const Icon = ICONS[t.type] || Info
          return (
            <div
              key={t.id}
              className="animate-fade-in pointer-events-auto flex w-full max-w-md items-center gap-3 border border-white/10 bg-navy px-4 py-3 text-white shadow-xl shadow-navy/30"
              role="status"
            >
              <Icon size={18} style={{ color: ACCENT[t.type] || ACCENT.info }} className="shrink-0" />
              <span className="flex-1 text-sm">{t.message}</span>
              {t.action && (
                <button
                  onClick={() => {
                    t.action.onClick()
                    dismiss(t.id)
                  }}
                  className="shrink-0 text-xs font-semibold uppercase tracking-wide text-brand-ink hover:underline"
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-white/50 transition hover:text-white"
                aria-label="Dismiss"
              >
                <X size={15} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

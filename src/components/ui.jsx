import { Loader2 } from 'lucide-react'

export const cx = (...c) => c.filter(Boolean).join(' ')

export function Button({ variant = 'primary', className, children, loading, ...props }) {
  const variants = {
    primary: 'btn-primary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
  }
  return (
    <button className={cx(variants[variant] || 'btn-primary', className)} disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  )
}

export function Card({ className, children, ...props }) {
  return (
    <div className={cx('card', className)} {...props}>
      {children}
    </div>
  )
}

export function Field({ label, children, hint, required }) {
  return (
    <label className="block">
      {label && (
        <span className="field-label">
          {label} {required && <span className="text-red-500">*</span>}
        </span>
      )}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function Input({ className, ...props }) {
  return <input className={cx('field-input', className)} {...props} />
}

export function Textarea({ className, ...props }) {
  return <textarea className={cx('field-input', className)} {...props} />
}

export function Select({ className, children, ...props }) {
  return (
    <select className={cx('field-input', className)} {...props}>
      {children}
    </select>
  )
}

export function Badge({ color = '#64748b', children }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.5px]"
      style={{ backgroundColor: `${color}1a`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  )
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
      <Loader2 className="animate-spin" size={20} />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center">
      {Icon && (
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-light text-brand">
          <Icon size={26} />
        </div>
      )}
      <h2 className="text-base font-semibold text-slate-800">{title}</h2>
      {subtitle && <p className="mt-1 max-w-sm text-sm text-slate-500">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }) {
  return <div className={cx('skeleton', className)} />
}

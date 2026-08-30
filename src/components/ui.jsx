import { Loader2 } from 'lucide-react'
import { initialsFrom } from '../lib/appearance'

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

// A card's heading, with room for a control on the right. An <h2> because
// cards sit under the page's single <h1> — the level is part of the component
// so a new card can't quietly break the document outline.
export function CardTitle({ title, description, icon: Icon, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          {Icon && <Icon size={16} className="shrink-0 text-slate-400" />}
          {title}
        </h2>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function Field({ label, children, hint, required, className }) {
  return (
    <label className={cx('block', className)}>
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

// A labelled break in a field grid. Rendered as a full-width grid item so a
// form can be grouped without the fields having to be re-nested.
export function FormSection({ title, className }) {
  return (
    <div className={cx('form-section sm:col-span-2', className)}>
      <p className="form-section-title">{title}</p>
    </div>
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

// Someone's mark in the sidebar. Initials unless they picked a symbol, and the
// accent colour unless they picked a different one — so the default costs no
// decision and still looks chosen once they change the accent.
export function Avatar({ avatar, email, size = 36, className }) {
  const { symbol, name, hue } = avatar || {}
  const tint = typeof hue === 'number' ? `oklch(0.7245 0.0998 ${hue})` : 'var(--color-gold)'
  const label = symbol || initialsFrom(name, email)
  return (
    <span
      aria-hidden="true"
      className={cx('grid shrink-0 place-items-center rounded-xl font-semibold', className)}
      style={{
        width: size,
        height: size,
        // A tenth of the accent behind it, the accent itself in front: legible
        // on the navy sidebar and on a white card without needing two colours.
        backgroundColor: `color-mix(in oklab, ${tint} 22%, transparent)`,
        color: tint,
        fontSize: symbol ? size * 0.5 : size * 0.4,
        lineHeight: 1,
      }}
    >
      {label}
    </span>
  )
}

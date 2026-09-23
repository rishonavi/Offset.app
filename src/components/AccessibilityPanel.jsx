import { useEffect, useRef } from 'react'
import {
  X, Droplet, Circle, Palette, Link2, Type, Rows3, ALargeSmall,
  AlignLeft, Contrast, MousePointer2, Waves, RotateCcw,
} from 'lucide-react'
import { useA11y } from '../context/A11yContext'
import { SCALES, STEPS } from '../lib/a11y'
import { useT } from '../context/LanguageContext'
import { cx } from './ui'

// A percentage reads the same in every language this app ships, so the stepped
// controls say what they are set to without costing twelve translations each.
const pct = (n) => `${Math.round(n * 100)}%`

const TILES = [
  { key: 'invert', icon: Droplet, label: 'a11y.invert' },
  { key: 'grayscale', icon: Circle, label: 'a11y.grayscale' },
  { key: 'saturation', icon: Palette, label: 'a11y.saturation' },
  { key: 'links', icon: Link2, label: 'a11y.links' },
  { key: 'fontSize', icon: Type, label: 'a11y.fontSize', value: (v) => pct(SCALES.fontSize[v]) },
  { key: 'lineHeight', icon: Rows3, label: 'a11y.lineHeight', value: (v) => String(SCALES.lineHeight[v]) },
  { key: 'letterSpacing', icon: ALargeSmall, label: 'a11y.letterSpacing', value: (v) => SCALES.letterSpacing[v] },
  { key: 'align', icon: AlignLeft, label: 'a11y.textAlign', value: null },
  { key: 'contrast', icon: Contrast, label: 'a11y.contrast', value: (v) => pct(SCALES.contrast[v]) },
  { key: 'dyslexia', icon: null, label: 'a11y.dyslexia', glyph: 'Df' },
  { key: 'cursor', icon: MousePointer2, label: 'a11y.cursor' },
  { key: 'motion', icon: Waves, label: 'a11y.motion' },
]

const ALIGN_LABEL = ['a11y.stepOff', 'a11y.alignStart', 'a11y.alignCenter', 'a11y.alignEnd']

export default function AccessibilityPanel({ open, onClose }) {
  const { settings, step, reset, isDefault, count } = useA11y()
  const t = useT()
  const first = useRef(null)
  const closer = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    // Focus lands inside the dialog rather than staying behind it — somebody
    // opening this from the keyboard is the person most likely to need it.
    closer.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const stepsOn = (key) => STEPS[key] > 2

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="a11y-title"
      className="a11y-panel fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-navy/50 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="card my-auto w-full max-w-lg animate-fade-in p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="min-w-0">
            <h2 id="a11y-title" className="font-serif text-xl font-bold text-ink-1">{t('a11y.title')}</h2>
            <p className="mt-1 text-xs text-ink-5">{t('a11y.subtitle')}</p>
          </div>
          <button ref={closer} onClick={onClose} aria-label={t('common.close')} className="icon-btn shrink-0 text-ink-6 hover:bg-surface-hover">
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
          {TILES.map((tile, i) => {
            const raw = settings[tile.key]
            const on = raw !== false && raw !== 0
            const Icon = tile.icon
            // The stepped controls say where they are; the toggles do not need
            // to, because the tile itself is the state and `aria-pressed`
            // carries it to a screen reader.
            const reading = tile.key === 'align'
              ? (on ? t(ALIGN_LABEL[raw]) : null)
              : (on && tile.value ? tile.value(raw) : null)
            return (
              <button
                key={tile.key}
                ref={i === 0 ? first : null}
                onClick={() => step(tile.key)}
                aria-pressed={on}
                className={cx(
                  'flex min-h-[7rem] flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition',
                  // `border-strong`, not `border-line`. The panel's card is
                  // opaque white on purpose, and slate-200 against white is a
                  // border you cannot see — twelve tiles with no edges, which
                  // is the layout reading as a mistake rather than as a grid.
                  on
                    ? 'border-brand bg-brand/15 text-ink-1'
                    : 'border-border-strong text-ink-4 hover:border-brand/60 hover:text-ink-2',
                )}
              >
                {Icon
                  ? <Icon size={26} className={cx('shrink-0', on ? 'text-brand-ink' : 'text-ink-5')} aria-hidden="true" />
                  : <span aria-hidden="true" className={cx('text-2xl font-bold leading-none', on ? 'text-brand-ink' : 'text-ink-5')}>{tile.glyph}</span>}
                <span className="text-xs font-semibold leading-tight">{t(tile.label)}</span>
                {/* Kept in the layout whether or not there is a reading, so a
                    tile does not change height when it is switched on and
                    shove the rest of the grid down a line. */}
                <span className="min-h-4 text-[0.625rem] font-medium uppercase tracking-[1px] text-ink-5">
                  {reading || (stepsOn(tile.key) && !on ? t('a11y.stepOff') : '')}
                </span>
              </button>
            )
          })}
        </div>

        <div className="border-t border-line p-5">
          <button
            onClick={reset}
            disabled={isDefault}
            className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={16} /> {t('a11y.reset')}
          </button>
          {/* Said out loud, because the whole point of a count is somebody who
              cannot see that anything is on. */}
          <p aria-live="polite" className="mt-3 text-center text-xs text-ink-5">
            {isDefault ? t('a11y.noneOn') : t('a11y.someOn', { count })}
          </p>
        </div>
      </div>
    </div>
  )
}

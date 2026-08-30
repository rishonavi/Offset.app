import { Sun, Moon, Check, RotateCcw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAppearance } from '../context/ThemeContext'
import { ACCENTS, AVATAR_SYMBOLS, accentById } from '../lib/appearance'
import { Card, Avatar, cx } from './ui'

const swatch = (hue) => `oklch(0.7245 0.0998 ${hue})`

export default function AppearanceCard() {
  const { user } = useAuth()
  const { theme, toggle, accent, setAccent, avatar, setAvatar, resetAvatar } = useAppearance()
  const chosenHue = typeof avatar.hue === 'number' ? avatar.hue : null

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Appearance</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        How Offset looks and who it says you are — saved to this browser.
      </p>

      <div className="mt-5 grid gap-6 sm:grid-cols-[auto_1fr] sm:gap-8">
        {/* The preview is the point of the whole card: it is much easier to
            choose a colour you can see on the thing it will colour. */}
        <div className="flex items-center gap-3 sm:flex-col sm:items-start">
          <div className="flex items-center gap-3 rounded-2xl bg-navy p-4">
            <Avatar avatar={avatar} email={user?.email} size={44} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">
                {avatar.name?.trim() || user?.email || 'Local user'}
              </div>
              <div className="text-[10px] uppercase tracking-[1.5px] text-gold/70">
                {accentById(accent).name}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <fieldset>
            <legend className="field-label">Theme</legend>
            <div className="inline-flex rounded-xl border border-border-light bg-white p-0.5 dark:border-[#2a4878] dark:bg-[#0a1a33]">
              {[
                { v: 'light', label: 'Light', icon: Sun },
                { v: 'dark', label: 'Dark', icon: Moon },
              ].map((o) => {
                const on = theme === o.v
                return (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => !on && toggle()}
                    aria-pressed={on}
                    className={cx(
                      'inline-flex min-h-[2.75rem] items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-wide transition',
                      on ? 'bg-brand text-navy' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100',
                    )}
                  >
                    <o.icon size={15} /> {o.label}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="field-label">Colour</legend>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              Tints buttons, links and highlights across the app.
            </p>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((a) => {
                const on = accent === a.id
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAccent(a.id)}
                    aria-pressed={on}
                    title={a.name}
                    className={cx(
                      'grid h-11 w-11 place-items-center rounded-xl border-2 transition',
                      on ? 'border-slate-900 dark:border-white' : 'border-transparent hover:border-slate-300 dark:hover:border-slate-600',
                    )}
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ backgroundColor: swatch(a.hue) }}>
                      {on && <Check size={15} className="text-navy" />}
                    </span>
                    <span className="sr-only">{a.name}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="field-label">Your avatar</legend>
            <label className="block">
              <span className="sr-only">Display name</span>
              <input
                className="field-input max-w-xs"
                value={avatar.name || ''}
                onChange={(e) => setAvatar({ name: e.target.value })}
                placeholder={user?.email?.split('@')[0] || 'Your name'}
                aria-label="Display name"
              />
            </label>
            <p className="mt-2 mb-2 text-xs text-slate-500 dark:text-slate-400">
              Your initials, or pick a symbol.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAvatar({ symbol: null })}
                aria-pressed={!avatar.symbol}
                className={cx(
                  'grid h-11 w-11 place-items-center rounded-xl border-2 text-sm font-semibold transition',
                  !avatar.symbol
                    ? 'border-slate-900 text-slate-900 dark:border-white dark:text-white'
                    : 'border-border-light text-slate-500 hover:border-slate-300 dark:border-[#2a4878] dark:text-slate-400',
                )}
              >
                Aa<span className="sr-only">Use my initials</span>
              </button>
              {AVATAR_SYMBOLS.map((sym) => {
                const on = avatar.symbol === sym
                return (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => setAvatar({ symbol: sym })}
                    aria-pressed={on}
                    className={cx(
                      'grid h-11 w-11 place-items-center rounded-xl border-2 text-lg transition',
                      on ? 'border-slate-900 dark:border-white' : 'border-border-light hover:border-slate-300 dark:border-[#2a4878]',
                    )}
                  >
                    {sym}
                    <span className="sr-only">Symbol {sym}</span>
                  </button>
                )
              })}
            </div>

            {/* Following the accent is the default, so the common case is no
                decision at all — the override is here for someone who wants
                their mark to stand apart from the interface around it. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">Colour:</span>
              <button
                type="button"
                onClick={() => setAvatar({ hue: null })}
                aria-pressed={chosenHue === null}
                className={cx(
                  'min-h-[2.25rem] rounded-lg border px-3 py-1.5 text-xs font-medium transition',
                  chosenHue === null
                    ? 'border-slate-900 text-slate-900 dark:border-white dark:text-white'
                    : 'border-border-light text-slate-500 hover:border-slate-300 dark:border-[#2a4878] dark:text-slate-400',
                )}
              >
                Match the app
              </button>
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAvatar({ hue: a.hue })}
                  aria-pressed={chosenHue === a.hue}
                  title={a.name}
                  className={cx(
                    'grid h-9 w-9 place-items-center rounded-lg border-2 transition',
                    chosenHue === a.hue ? 'border-slate-900 dark:border-white' : 'border-transparent hover:border-slate-300',
                  )}
                >
                  <span className="h-5 w-5 rounded-md" style={{ backgroundColor: swatch(a.hue) }} />
                  <span className="sr-only">{a.name}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={resetAvatar}
              className="mt-3 inline-flex min-h-[2.25rem] items-center gap-1.5 text-xs font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
            >
              <RotateCcw size={13} /> Reset avatar
            </button>
          </fieldset>
        </div>
      </div>
    </Card>
  )
}

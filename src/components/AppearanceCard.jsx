import { useState } from 'react'
import { Sun, Moon, Check, RotateCcw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAppearance } from '../context/ThemeContext'
import { ACCENTS, AVATAR_SYMBOLS, TONES, DEFAULT_ACCENT, accentById, accentHueOf, hueOfHex } from '../lib/appearance'
import { Card, Avatar, cx } from './ui'

const swatch = (hue) => `oklch(0.7245 0.0998 ${hue})`
// The page ground each tone produces, light and dark — the same numbers the
// stylesheet will use, so the chip cannot drift from the thing it previews.
const toneSwatch = (t, dark) =>
  dark ? `oklch(0.1686 ${(0.0322 * t.chroma).toFixed(4)} ${t.hue})`
       : `oklch(0.9288 ${(0.0126 * t.chroma).toFixed(4)} ${t.hue})`

export default function AppearanceCard() {
  const { user } = useAuth()
  const { theme, toggle, accent, setAccent, tone, setTone, avatar, setAvatar, resetAvatar } = useAppearance()
  // A custom accent is stored as its hue, so "is this one of the six" is the
  // same question as "does the stored value name a preset".
  const customHue = ACCENTS.some((a) => a.id === accent) ? null : accentHueOf(accent)
  const [picked, setPicked] = useState('#0d9488')
  const [hex, setHex] = useState('')
  const chosenHue = typeof avatar.hue === 'number' ? avatar.hue : null

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-ink-3">Appearance</h2>
      <p className="mt-1 text-xs text-ink-5">
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
            <div className="inline-flex rounded-xl border border-border-light bg-surface-raised p-0.5">
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
                      on ? 'bg-brand text-navy' : 'text-ink-5 hover:text-ink-2',
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
            <p className="mb-2 text-xs text-ink-5">
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
                      on ? 'border-ink-1' : 'border-transparent hover:border-border-strong',
                    )}
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ backgroundColor: swatch(a.hue) }}>
                      {on && <Check size={15} className="text-navy" />}
                    </span>
                    <span className="sr-only">{a.name}</span>
                  </button>
                )
              })}
              {/* Any colour, not only these six. What is taken from it is the
                  hue — the lightness and the amount of colour stay on the ramp
                  everything else is built from, which is what keeps the result
                  readable wherever it lands. The swatch beside it shows what
                  you actually get, so that is visible rather than a surprise. */}
              <label
                className={cx(
                  'grid h-11 w-11 cursor-pointer place-items-center rounded-xl border-2 transition',
                  customHue !== null ? 'border-ink-1' : 'border-transparent hover:border-border-strong',
                )}
                title="Any colour"
              >
                <span
                  className="grid h-7 w-7 place-items-center rounded-lg"
                  style={{
                    background: customHue !== null ? swatch(customHue)
                      : 'conic-gradient(#c56a59,#c5a059,#8fb559,#59b58f,#5992c5,#8f59c5,#c559a0,#c56a59)',
                  }}
                >
                  {customHue !== null && <Check size={15} className="text-navy" />}
                </span>
                <input
                  type="color"
                  className="sr-only"
                  value={picked}
                  onChange={(e) => {
                    setPicked(e.target.value)
                    const h = hueOfHex(e.target.value)
                    // A grey has no hue to take; keeping the last one beats
                    // snapping to red because atan2(0, 0) says so.
                    if (h !== null) setAccent(String(h))
                  }}
                />
                <span className="sr-only">Choose any colour</span>
              </label>
            </div>
            {/* A hex box beside the picker, because most people arriving with a
                colour in mind arrived with its hex — off a brand sheet or a
                logo — and hunting for it inside a gradient square is the long
                way round. Applied only once six digits are there, so it does
                not re-tint the whole app on every keystroke. */}
            <label className="mt-3 flex max-w-[11rem] items-center gap-2">
              <span className="sr-only">Accent colour hex</span>
              <span aria-hidden="true" className="text-xs text-ink-5">#</span>
              <input
                className="field-input py-1.5 text-xs uppercase"
                value={hex}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
                  setHex(next)
                  const h = hueOfHex(`#${next}`)
                  if (h !== null) setAccent(String(h))
                }}
                placeholder="0D9488"
                aria-label="Accent colour hex"
                spellCheck="false"
              />
            </label>
            {customHue !== null && (
              <p className="mt-2 text-xs text-ink-5">
                Using the hue of your colour, at the app's own lightness.{' '}
                <button type="button" className="font-medium underline underline-offset-2" onClick={() => setAccent(DEFAULT_ACCENT)}>
                  Back to Gold
                </button>
              </p>
            )}
          </fieldset>

          <fieldset>
            <legend className="field-label">Base tone</legend>
            <p className="mb-2 text-xs text-ink-5">
              The ground, the cards and the text — everything the accent is not.
            </p>
            <div className="flex flex-wrap gap-2">
              {TONES.map((t) => {
                const on = tone === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTone(t.id)}
                    aria-pressed={on}
                    title={t.name}
                    className={cx(
                      'flex min-h-[2.75rem] items-center gap-2 rounded-xl border-2 px-3 transition',
                      on ? 'border-ink-1' : 'border-transparent hover:border-border-strong',
                    )}
                  >
                    {/* Both ends of the ramp, so the choice is legible on a
                        light screen and a dark one without switching theme. */}
                    {/* data-preview marks a colour sample rather than a
                        surface. Half of this is deliberately the light ground
                        while you are looking at the dark theme, which is the
                        point of it and exactly what the audit's stray-fill
                        check is otherwise right to flag. */}
                    <span data-preview className="flex h-6 w-6 overflow-hidden rounded-md ring-1 ring-black/10">
                      <span className="h-full w-1/2" style={{ background: toneSwatch(t, false) }} />
                      <span className="h-full w-1/2" style={{ background: toneSwatch(t, true) }} />
                    </span>
                    <span className="text-xs font-medium text-ink-3">{t.name}</span>
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
            <p className="mt-2 mb-2 text-xs text-ink-5">
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
                    ? 'border-ink-1 text-ink-1 dark:text-white'
                    : 'border-border-light text-ink-5 hover:border-border-strong',
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
                      on ? 'border-ink-1' : 'border-border-light hover:border-border-strong',
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
              <span className="text-xs text-ink-5">Colour:</span>
              <button
                type="button"
                onClick={() => setAvatar({ hue: null })}
                aria-pressed={chosenHue === null}
                className={cx(
                  'min-h-[2.25rem] rounded-lg border px-3 py-1.5 text-xs font-medium transition',
                  chosenHue === null
                    ? 'border-ink-1 text-ink-1 dark:text-white'
                    : 'border-border-light text-ink-5 hover:border-border-strong',
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
                    chosenHue === a.hue ? 'border-ink-1' : 'border-transparent hover:border-border-strong',
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
              className="mt-3 inline-flex min-h-[2.25rem] items-center gap-1.5 text-xs font-medium text-ink-5 underline-offset-2 hover:underline"
            >
              <RotateCcw size={13} /> Reset avatar
            </button>
          </fieldset>
        </div>
      </div>
    </Card>
  )
}

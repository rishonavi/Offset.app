import { PiggyBank, Building2 } from 'lucide-react'
import { useEntity } from '../context/EntityContext'
import { useT } from '../context/LanguageContext'
import { CONSOLIDATED, PERSONAL } from '../lib/corporate'
import { cx } from './ui'

// Which set of books you are in: your own, or a company's.
//
// It lives in two places that look nothing alike — the navy sidebar and a card
// on Settings — and the behaviour is the part that must not differ between
// them. Two copies of "coming back to a company lands on the one you were last
// in" is two chances for one of them to be wrong, so the copies differ only in
// their palette.
//
// Absent entirely until a company exists: with none there is nothing to switch
// between, and Settings offers to create one instead.
// Rounded like everything else, because nothing else in this app has a square
// corner — the group and the select had no radius at all, which is most of why
// they read as a raw form dropped into the sidebar rather than part of it. The
// chosen side is a raised pill on a sunk track: one lit thing against a quiet
// one, which is what makes a small control look considered rather than loud.
//
// Every colour here is a token, never a hex. The accent follows whatever was
// picked in Settings — gold out of the box, but the person who sets it to teal
// gets a teal switcher, and hardcoding the default would quietly break that.
const TONE = {
  sidebar: {
    group: 'rounded-xl border border-white/10 bg-black/20 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
    on: 'rounded-lg bg-gold text-navy shadow-[0_1px_2px_rgba(0,0,0,0.35)]',
    off: 'rounded-lg text-white/50 hover:bg-white/5 hover:text-white/90',
    select: 'field-dark rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/85 transition hover:border-white/25 hover:bg-white/[0.07] focus:border-gold focus:outline-none',
    caption: 'text-white/60',
  },
  card: {
    group: 'rounded-xl border border-line bg-surface-sunk p-1',
    on: 'rounded-lg bg-brand text-navy shadow-sm',
    off: 'rounded-lg text-ink-5 hover:bg-black/[0.04] hover:text-ink-2',
    select: 'field-input',
    caption: 'text-ink-6',
  },
}

// `onSwitch` is how the mobile drawer learns to close. Without it the switch
// happened — storage changed, the tab moved — behind a drawer still covering
// the page, so from the user's side nothing had happened at all. Every nav
// link in that drawer already closes it; this was the one control that did not.
export default function BooksSwitcher({ variant = 'sidebar', className, onSwitch }) {
  const { enabled, entities, activeId, switchTo, consolidated, personal } = useEntity()
  const t = useT()
  if (!enabled) return null
  const tone = TONE[variant] || TONE.sidebar

  // Coming back to a company lands on the one you were last in, so the tab is a
  // toggle rather than a thing that loses your place.
  const lastCompany = entities.some((e) => e.id === activeId) ? activeId : entities[0].id
  const go = (id) => { switchTo(id); onSwitch?.() }

  return (
    <div className={className}>
      <div role="tablist" aria-label={t('company.books')} className={cx('flex gap-1', tone.group)}>
        <Tab tone={tone} selected={personal} onSelect={() => go(PERSONAL)} label={t('company.personal')} icon={PiggyBank} />
        <Tab
          tone={tone}
          selected={!personal}
          onSelect={() => go(consolidated ? CONSOLIDATED : lastCompany)}
          label={t('company.company')}
          icon={Building2}
        />
      </div>

      {!personal && entities.length > 1 && (
        <select
          value={consolidated ? CONSOLIDATED : activeId}
          onChange={(e) => go(e.target.value)}
          className={cx('mt-2 w-full', tone.select)}
          aria-label={t('company.switch')}
          title={t('company.switch')}
        >
          {entities.map((e) => (
            <option key={e.id} value={e.id} className="text-ink-1">{e.name}</option>
          ))}
          <option value={CONSOLIDATED} className="text-ink-1">{t('company.all')}</option>
        </select>
      )}
      {/* One company needs no dropdown to choose between, but the tab saying
          COMPANY does not say which one. */}
      {!personal && entities.length === 1 && (
        <p className={cx('mt-1.5 truncate px-1 text-[0.6875rem]', tone.caption)} title={entities[0].name}>
          {entities[0].name}
        </p>
      )}
    </div>
  )
}

function Tab({ tone, selected, onSelect, label, icon: Icon }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cx(
        'flex min-h-11 flex-1 items-center justify-center gap-1.5 px-2 py-1.5',
        'text-[0.6875rem] font-semibold uppercase tracking-[1px]',
        // The same press the rest of the app's buttons have. `transition-all`
        // rather than `transition`, so the scale is animated too.
        'transition-all duration-200 active:scale-[0.97]',
        // A segmented control is a row of buttons in a div, and without this it
        // had no focus style at all — reachable by keyboard and invisible once
        // you got there.
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70',
        selected ? tone.on : tone.off,
      )}
    >
      <Icon size={13} /> {label}
    </button>
  )
}

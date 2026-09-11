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
const TONE = {
  sidebar: {
    group: 'border border-white/15 bg-white/5',
    on: 'bg-gold text-navy',
    off: 'text-white/55 hover:text-white/90',
    select: 'border border-white/15 bg-white/5 px-2 py-2 text-xs text-white/90',
    caption: 'text-white/45',
  },
  card: {
    group: 'border border-line bg-surface-sunk',
    on: 'bg-brand text-navy',
    off: 'text-ink-5 hover:text-ink-2',
    select: 'field-input',
    caption: 'text-ink-6',
  },
}

export default function BooksSwitcher({ variant = 'sidebar', className }) {
  const { enabled, entities, activeId, switchTo, consolidated, personal } = useEntity()
  const t = useT()
  if (!enabled) return null
  const tone = TONE[variant] || TONE.sidebar

  // Coming back to a company lands on the one you were last in, so the tab is a
  // toggle rather than a thing that loses your place.
  const lastCompany = entities.some((e) => e.id === activeId) ? activeId : entities[0].id

  return (
    <div className={className}>
      <div role="tablist" aria-label={t('company.books')} className={cx('flex gap-1 p-1', tone.group)}>
        <Tab tone={tone} selected={personal} onSelect={() => switchTo(PERSONAL)} label={t('company.personal')} icon={PiggyBank} />
        <Tab
          tone={tone}
          selected={!personal}
          onSelect={() => switchTo(consolidated ? CONSOLIDATED : lastCompany)}
          label={t('company.company')}
          icon={Building2}
        />
      </div>

      {!personal && entities.length > 1 && (
        <select
          value={consolidated ? CONSOLIDATED : activeId}
          onChange={(e) => switchTo(e.target.value)}
          className={cx('mt-1.5 w-full', tone.select)}
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
        <p className={cx('mt-1.5 truncate px-1 text-[0.68rem]', tone.caption)} title={entities[0].name}>
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
        'flex min-h-9 flex-1 items-center justify-center gap-1.5 px-2 py-1.5',
        'text-[0.68rem] font-semibold uppercase tracking-[1px] transition',
        selected ? tone.on : tone.off,
      )}
    >
      <Icon size={13} /> {label}
    </button>
  )
}

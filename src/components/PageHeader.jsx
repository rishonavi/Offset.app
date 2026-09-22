// The page's action belongs beside its title, not floating at the bottom of a
// block whose height depends on how long the subtitle happens to be — which is
// what `items-end` gave, and why the button sat at a different height on every
// page.
//
// `icon` exists because the asset page had its own header markup for the sake
// of one tile, and paid for it by drifting: no gold rule, and a title stuck at
// text-2xl while every page that used this component grew to text-3xl. The
// dashboard had opted out for no reason at all. Two pages out of twenty-one
// looking not-quite-like the other nineteen reads as carelessness rather than
// as a choice, so the one thing they needed is now part of the component.
export default function PageHeader({ title, subtitle, actions, eyebrow, icon: Icon }) {
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-light text-brand-ink">
              <Icon size={22} />
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
            <h1 className="font-serif text-2xl font-bold tracking-tight text-ink-1 sm:text-3xl">{title}</h1>
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
      </div>
      <span className="mt-3 block h-[2px] w-12 bg-gold" />
      {/* Capped, because a line of explanatory text running the full width of a
          wide monitor is measurably harder to read than one that doesn't. */}
      {subtitle && <div className="mt-3 max-w-2xl text-sm text-ink-5">{subtitle}</div>}
    </div>
  )
}

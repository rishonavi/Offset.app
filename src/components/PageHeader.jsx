// The page's action belongs beside its title, not floating at the bottom of a
// block whose height depends on how long the subtitle happens to be — which is
// what `items-end` gave, and why the button sat at a different height on every
// page.
export default function PageHeader({ title, subtitle, actions, eyebrow }) {
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <h1 className="font-serif text-2xl font-bold tracking-tight text-ink-1 sm:text-3xl">{title}</h1>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
      </div>
      <span className="mt-3 block h-[2px] w-12 bg-gold" />
      {/* Capped, because a line of explanatory text running the full width of a
          wide monitor is measurably harder to read than one that doesn't. */}
      {subtitle && <p className="mt-3 max-w-2xl text-sm text-ink-5">{subtitle}</p>}
    </div>
  )
}

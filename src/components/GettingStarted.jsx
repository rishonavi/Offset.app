import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, X, Sparkles, ArrowRight } from 'lucide-react'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { steps as onboardingSteps, progress, dismiss, shouldShow } from '../lib/onboarding'
import { installSampleData, hasRealData } from '../lib/sampleData'
import { Card, Button } from './ui'

// The short list of things still worth doing, on the dashboard, until they are
// done. Each line is ticked by the books themselves, so it cannot claim you
// have added an asset when you haven't.
export default function GettingStarted() {
  const data = useData()
  const { properties, expenses, income, addProperty, addExpense, addIncome, refresh, canWrite } = data
  const toast = useToast()
  const [hidden, setHidden] = useState(false)
  const [loading, setLoading] = useState(false)

  if (hidden || !shouldShow({ properties, expenses, income })) return null

  const list = onboardingSteps({ properties, expenses, income })
  const { done, total } = progress({ properties, expenses, income })
  const empty = !hasRealData({ properties, expenses, income })

  const hide = () => {
    dismiss()
    setHidden(true)
  }

  const loadSample = async () => {
    setLoading(true)
    try {
      const added = await installSampleData({ addProperty, addExpense, addIncome, properties, expenses, income })
      await refresh()
      toast(`Loaded a sample portfolio — ${added.assets} assets and a year of entries. Remove it from Settings.`)
    } catch (err) {
      toast(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-700">Getting started</h2>
          <p className="mt-1 text-xs text-slate-500">
            {done} of {total} done. This disappears on its own once it's finished.
          </p>
        </div>
        <button
          onClick={hide}
          aria-label="Hide getting started"
          className="grid h-8 w-8 shrink-0 place-items-center text-slate-400 hover:text-slate-700"
        >
          <X size={16} />
        </button>
      </div>

      <ol className="mt-4 space-y-2">
        {list.map((s) => (
          <li key={s.id} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-white ${
                s.done ? 'border-emerald-600 bg-emerald-600' : 'border-border-light bg-transparent'
              }`}
            >
              {s.done && <Check size={12} />}
            </span>
            <div className="min-w-0 flex-1">
              {/* A finished step is struck through and dimmed, but only to
                  slate-500 — slate-400 comes out at 3.97:1 on the dark card,
                  and "done" is still text someone may want to read. */}
              <p className={`text-sm ${s.done ? 'text-slate-500 line-through' : 'font-medium text-slate-700'}`}>
                {s.title}
                <span className="sr-only">{s.done ? ' — done' : ' — still to do'}</span>
              </p>
              {!s.done && (
                <p className="mt-0.5 text-xs text-slate-500">
                  {s.why}{' '}
                  {/* Underlined rather than gold-on-white: the brand gold is
                      2.5:1 against a white card, which is below the 4.5:1 a
                      body-sized link needs, and colour alone should not be
                      what marks a link anyway. */}
                  <Link
                    to={s.to}
                    className="inline-flex items-center gap-1 font-medium text-slate-700 underline underline-offset-2 hover:text-brand"
                  >
                    {s.cta} <ArrowRight size={12} />
                  </Link>
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {/* Only offered on genuinely empty books — merging demo rows into real
          ones is the one thing this must never do. */}
      {empty && canWrite && (
        <div className="mt-4 border-t border-border-light pt-4">
          <p className="text-xs text-slate-500">
            Or have a look around first with a sample portfolio — two properties, a car and a year of entries. You
            can remove it in one click from Settings.
          </p>
          <Button variant="ghost" className="mt-2" onClick={loadSample} loading={loading}>
            <Sparkles size={15} /> Load sample data
          </Button>
        </div>
      )}
    </Card>
  )
}

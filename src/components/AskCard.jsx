import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useData } from '../context/DataContext'
import { askData, buildDataSummary } from '../lib/ai'
import { Card, Input, Button } from './ui'

const SUGGESTIONS = [
  'How much did I spend on maintenance this year?',
  'Which asset earns the most per rupee invested?',
  'What were my top 3 expense categories?',
]

export default function AskCard() {
  const { properties, expenses, income } = useData()
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  const ask = async (question) => {
    const text = (question ?? q).trim()
    if (!text) return
    setQ(text)
    setLoading(true)
    setErr(null)
    setAnswer(null)
    try {
      const summary = buildDataSummary({ properties, expenses, income })
      const { answer } = await askData(text, summary)
      setAnswer(answer)
    } catch (e) {
      setErr(e?.code === 'not_configured' ? 'AI answers aren’t set up on this deployment yet.' : e?.message || 'Could not answer that.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={16} className="text-gold" />
        <h3 className="text-sm font-semibold text-slate-700">Ask about your finances</h3>
      </div>
      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ask()
            }
          }}
          placeholder="e.g. how much on maintenance last year?"
        />
        <Button type="button" onClick={() => ask()} loading={loading} className="shrink-0">
          Ask
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => ask(s)}
            className="rounded-full border border-border-light px-2.5 py-1 text-xs text-slate-500 transition hover:border-gold hover:text-gold"
          >
            {s}
          </button>
        ))}
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {answer && (
        <div className="mt-3 whitespace-pre-wrap border-l-2 border-gold bg-brand-light/40 p-3 text-sm text-slate-700">
          {answer}
        </div>
      )}
      <p className="mt-3 text-[0.7rem] text-slate-400">
        Answers are generated from your data by AI — double-check anything important.
      </p>
    </Card>
  )
}

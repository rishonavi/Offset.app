import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { emptyFilters } from './filters'

// Filters that live in the address bar rather than in a component.
//
// Reports and Exports are two pages asking the same question of the same rows —
// which entries, over which period, for which asset — and the answer used to be
// state inside one component, so splitting them would have meant building a
// filter twice and losing it on the way between. Putting it in the URL means it
// survives the hop, survives a reload, and can be sent to an accountant as a
// link that opens on exactly what you were looking at.
//
// Only keys that differ from the empty filter are written, so a plain visit
// leaves a plain URL and there is nothing to read in the bar until there is
// something to say.
export function useFilterParams() {
  const [params, setParams] = useSearchParams()

  const filters = useMemo(() => {
    const out = { ...emptyFilters }
    for (const key of Object.keys(emptyFilters)) {
      const v = params.get(key)
      if (v !== null) out[key] = v
    }
    return out
  }, [params])

  const setFilters = useCallback(
    (next) => {
      // FilterBar hands over either the object or an updater, the same as
      // useState — it should not have to know where the value is kept.
      const value = typeof next === 'function' ? next(filters) : next
      const q = new URLSearchParams(params)
      for (const key of Object.keys(emptyFilters)) {
        const v = String(value?.[key] ?? '')
        if (v && v !== emptyFilters[key]) q.set(key, v)
        else q.delete(key)
      }
      // Replace rather than push: a filter is a refinement of where you are,
      // not somewhere new, and pushing would make Back walk backwards through
      // every keystroke of a search box.
      setParams(q, { replace: true })
    },
    [filters, params, setParams],
  )

  return [filters, setFilters]
}

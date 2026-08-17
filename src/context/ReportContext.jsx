import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import ReportProblem from '../components/ReportProblem'

const ReportContext = createContext({ openReport: () => {}, filedCount: 0 })
export const useReport = () => useContext(ReportContext)

// One report dialog for the whole app, opened from wherever the user happens to
// hit trouble — the sidebar, the command palette, Settings, or the crash screen.
// It lives here rather than in Layout because the thing most worth reporting is
// a page that has just failed to render, and that page is inside Layout.
export function ReportProvider({ children }) {
  const [state, setState] = useState(null) // null = closed; { error? } = open
  // Bumped on each filing, so a list of past reports elsewhere on screen
  // (Settings) picks up one filed from the dialog without a reload.
  const [filedCount, setFiledCount] = useState(0)
  const location = useLocation()

  const openReport = useCallback((prefill = {}) => setState(prefill), [])
  const value = useMemo(() => ({ openReport, filedCount }), [openReport, filedCount])

  return (
    <ReportContext.Provider value={value}>
      {children}
      <ReportProblem
        open={state !== null}
        prefill={state}
        route={location.pathname}
        onClose={() => setState(null)}
        onFiled={() => setFiledCount((n) => n + 1)}
      />
    </ReportContext.Provider>
  )
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { db } from '../lib/storage'
import { useAuth } from './AuthContext'

// Personal budgeting & everyday expenses — always the signed-in user's own
// (not workspace-shared), so this is intentionally separate from DataContext.
const PersonalContext = createContext(null)
export const usePersonal = () => useContext(PersonalContext)

const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '')

export function PersonalProvider({ children }) {
  const { user } = useAuth()
  const [expenses, setExpenses] = useState([])
  const [budgets, setBudgets] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [e, b] = await Promise.all([db.getPersonalExpenses(), db.getPersonalBudgets()])
      setExpenses([...e].sort(byDateDesc))
      setBudgets(b)
    } catch {
      /* personal tables may not exist yet in cloud — treated as empty */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user) refresh()
  }, [user, refresh])

  const addExpense = async (data) => {
    const row = await db.addPersonalExpense(data)
    setExpenses((p) => [row, ...p].sort(byDateDesc))
    return row
  }
  const updateExpense = async (id, data) => {
    const row = await db.updatePersonalExpense(id, data)
    setExpenses((p) => p.map((e) => (e.id === id ? row : e)).sort(byDateDesc))
    return row
  }
  const deleteExpense = async (id) => {
    await db.deletePersonalExpense(id)
    setExpenses((p) => p.filter((e) => e.id !== id))
  }
  const setBudget = async (category, monthly_limit) => {
    const row = await db.setPersonalBudget(category, monthly_limit)
    setBudgets((p) => {
      const exists = p.some((b) => b.category === category)
      return exists ? p.map((b) => (b.category === category ? row : b)) : [...p, row]
    })
    return row
  }
  const budgetFor = useCallback(
    (category) => Number(budgets.find((b) => b.category === category)?.monthly_limit) || 0,
    [budgets],
  )

  const value = useMemo(
    () => ({ expenses, budgets, loading, refresh, addExpense, updateExpense, deleteExpense, setBudget, budgetFor }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, budgets, loading, budgetFor],
  )
  return <PersonalContext.Provider value={value}>{children}</PersonalContext.Provider>
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { db, isCloud } from '../lib/storage'
import { useAuth } from './AuthContext'
import { useWorkspace } from './WorkspaceContext'

const DataContext = createContext(null)

export const useData = () => useContext(DataContext)

const byNameAsc = (a, b) => (a.name || '').localeCompare(b.name || '')
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '')

export function DataProvider({ children }) {
  const { user } = useAuth()
  const { activeOwner, isOwnWorkspace } = useWorkspace()
  const [properties, setProperties] = useState([])
  const [expenses, setExpenses] = useState([])
  const [income, setIncome] = useState([])
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Shared workspaces are read-only; your own (and demo mode) are read/write.
  const canWrite = !isCloud || isOwnWorkspace
  const guard = () => {
    if (!canWrite) throw new Error('This shared workspace is read-only.')
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [p, e, inc, docs] = await Promise.all([
        db.getProperties(),
        db.getExpenses(),
        db.getIncome(),
        db.getDocuments(),
      ])
      setProperties([...p].sort(byNameAsc))
      setExpenses([...e].sort(byDateDesc))
      setIncome([...inc].sort(byDateDesc))
      setDocuments(docs)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user) refresh()
  }, [user, refresh])

  // In cloud mode the queries return your own rows + any shared with you; scope
  // the view to the active workspace owner. (Demo mode rows have no user_id.)
  const inScope = useCallback(
    (rows) => (isCloud ? rows.filter((r) => r.user_id === activeOwner) : rows),
    [activeOwner],
  )
  const scopedProperties = useMemo(() => inScope(properties), [properties, inScope])
  const scopedExpenses = useMemo(() => inScope(expenses), [expenses, inScope])
  const scopedIncome = useMemo(() => inScope(income), [income, inScope])
  const scopedDocuments = useMemo(() => inScope(documents), [documents, inScope])

  const propertyNameById = useCallback(
    (id) => scopedProperties.find((p) => p.id === id)?.name,
    [scopedProperties],
  )

  // ── Properties ──
  const addProperty = async (data) => {
    guard()
    const row = await db.addProperty(data)
    setProperties((prev) => [...prev, row].sort(byNameAsc))
    return row
  }
  const updateProperty = async (id, data) => {
    guard()
    const row = await db.updateProperty(id, data)
    setProperties((prev) => prev.map((p) => (p.id === id ? row : p)).sort(byNameAsc))
    return row
  }
  const deleteProperty = async (id) => {
    guard()
    await db.deleteProperty(id)
    setProperties((prev) => prev.filter((p) => p.id !== id))
    setExpenses((prev) => prev.filter((e) => e.property_id !== id))
    setIncome((prev) => prev.filter((e) => e.property_id !== id))
    setDocuments((prev) => prev.filter((d) => d.property_id !== id))
  }

  // ── Expenses ──
  const addExpense = async (data) => {
    guard()
    const row = await db.addExpense(data)
    setExpenses((prev) => [row, ...prev].sort(byDateDesc))
    return row
  }
  const updateExpense = async (id, data) => {
    guard()
    const row = await db.updateExpense(id, data)
    setExpenses((prev) => prev.map((e) => (e.id === id ? row : e)).sort(byDateDesc))
    return row
  }
  const deleteExpense = async (id) => {
    guard()
    await db.deleteExpense(id)
    setExpenses((prev) => prev.filter((e) => e.id !== id))
  }

  // ── Income ──
  const addIncome = async (data) => {
    guard()
    const row = await db.addIncome(data)
    setIncome((prev) => [row, ...prev].sort(byDateDesc))
    return row
  }
  const updateIncome = async (id, data) => {
    guard()
    const row = await db.updateIncome(id, data)
    setIncome((prev) => prev.map((e) => (e.id === id ? row : e)).sort(byDateDesc))
    return row
  }
  const deleteIncome = async (id) => {
    guard()
    await db.deleteIncome(id)
    setIncome((prev) => prev.filter((e) => e.id !== id))
  }

  // ── Documents ──
  const addDocument = async (data) => {
    guard()
    const row = await db.addDocument(data)
    setDocuments((prev) => [...prev, row])
    return row
  }
  const deleteDocument = async (id) => {
    guard()
    await db.deleteDocument(id)
    setDocuments((prev) => prev.filter((d) => d.id !== id))
  }

  const value = useMemo(
    () => ({
      properties: scopedProperties,
      expenses: scopedExpenses,
      income: scopedIncome,
      documents: scopedDocuments,
      loading,
      error,
      canWrite,
      refresh,
      propertyNameById,
      addProperty,
      updateProperty,
      deleteProperty,
      addExpense,
      updateExpense,
      deleteExpense,
      addIncome,
      updateIncome,
      deleteIncome,
      addDocument,
      deleteDocument,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedProperties, scopedExpenses, scopedIncome, scopedDocuments, loading, error, canWrite, refresh, propertyNameById],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

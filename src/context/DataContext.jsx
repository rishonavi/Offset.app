import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { db, isCloud } from '../lib/storage'
import { useAuth } from './AuthContext'
import { useWorkspace } from './WorkspaceContext'
import { useEntity } from './EntityContext'
import { cleanMoney } from '../lib/money'

const DataContext = createContext(null)

export const useData = () => useContext(DataContext)

const byNameAsc = (a, b) => (a.name || '').localeCompare(b.name || '')
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '')

export function DataProvider({ children }) {
  const { user } = useAuth()
  const { activeOwner, isOwnWorkspace, canWriteActive } = useWorkspace()
  const { inEntity, stamp, gate } = useEntity()
  const [properties, setProperties] = useState([])
  const [expenses, setExpenses] = useState([])
  const [income, setIncome] = useState([])
  const [documents, setDocuments] = useState([])
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Your own workspace and demo mode are always read/write; a shared workspace
  // is writable only when you were invited as an editor.
  const canWrite = !isCloud || canWriteActive
  const guard = () => {
    if (!canWrite) throw new Error('This shared workspace is read-only.')
  }

  // Stamp new rows/files with the active workspace owner when acting as an
  // editor in someone else's workspace (null = your own workspace).
  useEffect(() => {
    if (isCloud) db.setWriteOwner(isOwnWorkspace ? null : activeOwner)
  }, [isOwnWorkspace, activeOwner])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [p, e, inc, docs, cmts] = await Promise.all([
        db.getProperties(),
        db.getExpenses(),
        db.getIncome(),
        db.getDocuments(),
        db.getComments(),
      ])
      setProperties([...p].sort(byNameAsc))
      setExpenses([...e].sort(byDateDesc))
      setIncome([...inc].sort(byDateDesc))
      setDocuments(docs)
      setComments(cmts)
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

  // And then by which set of books you are in — `inEntity` from EntityContext,
  // which is the one place that rule is written. The bin filters with the same
  // function, so the two cannot drift apart about what "personal" means.
  //
  // A personal install never narrows anything: with no company every row is
  // unstamped, so this is a no-op on the app most people are running.
  const visible = useCallback((rows) => inEntity(inScope(rows)), [inEntity, inScope])
  const scopedProperties = useMemo(() => visible(properties), [properties, visible])
  const scopedExpenses = useMemo(() => visible(expenses), [expenses, visible])
  const scopedIncome = useMemo(() => visible(income), [income, visible])
  // Attachments and notes hang off an asset rather than carrying their own
  // company: if you cannot see the asset, there is nothing for them to be on.
  const visibleIds = useMemo(() => new Set(scopedProperties.map((p) => p.id)), [scopedProperties])
  const scopedDocuments = useMemo(
    () => inScope(documents).filter((d) => !d.property_id || visibleIds.has(d.property_id)),
    [documents, inScope, visibleIds],
  )
  const scopedComments = useMemo(
    () => inScope(comments).filter((c) => !c.property_id || visibleIds.has(c.property_id)),
    [comments, inScope, visibleIds],
  )

  // Every expense and income row asks for its asset's name while rendering, so
  // a linear scan here is a scan per row — 400 entries over 30 assets is 12,000
  // comparisons on each render of a table that also sorts and filters. Build
  // the index once instead.
  const propertyNames = useMemo(
    () => new Map(scopedProperties.map((p) => [p.id, p.name])),
    [scopedProperties],
  )
  const propertyNameById = useCallback((id) => propertyNames.get(id), [propertyNames])

  // Money is cleaned here rather than in each caller. Rows arrive from forms,
  // from a backup file, from a bank statement, from Tally, from a spreadsheet
  // and from an inbox; the forms refuse a number the app cannot add up, but a
  // restored backup went straight past them and put 1e308 in the ledger. This
  // is the one place all six already meet.
  // A new row belongs to the books it was created in. `stamp()` is the company
  // when you are in one and nothing at all when you are in your own — so a
  // personal install writes exactly the rows it always did.
  // ── Properties ──
  const addProperty = async (data) => {
    guard()
    const row = await db.addProperty(cleanMoney({ ...data, ...stamp() }, 'property'))
    setProperties((prev) => [...prev, row].sort(byNameAsc))
    return row
  }
  const updateProperty = async (id, data) => {
    guard()
    const row = await db.updateProperty(id, cleanMoney(data, 'property'))
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
    // Gated on the way in, so a bill over the company's limit is pending from
    // the moment it exists rather than from whenever somebody remembers.
    const row = await db.addExpense(cleanMoney({ ...data, ...stamp(), ...gate(data, 'expense') }, 'expense'))
    setExpenses((prev) => [row, ...prev].sort(byDateDesc))
    return row
  }
  const updateExpense = async (id, data) => {
    guard()
    const row = await db.updateExpense(id, cleanMoney(data, 'expense'))
    setExpenses((prev) => prev.map((e) => (e.id === id ? row : e)).sort(byDateDesc))
    return row
  }
  const deleteExpense = async (id) => {
    guard()
    await db.deleteExpense(id)
    setExpenses((prev) => prev.filter((e) => e.id !== id))
  }
  const restoreExpense = async (row) => {
    guard()
    await db.restoreTrash('expense', row.id)
    setExpenses((prev) => [row, ...prev.filter((e) => e.id !== row.id)].sort(byDateDesc))
  }

  // ── Income ──
  const addIncome = async (data) => {
    guard()
    const row = await db.addIncome(cleanMoney({ ...data, ...stamp() }, 'income'))
    setIncome((prev) => [row, ...prev].sort(byDateDesc))
    return row
  }
  const updateIncome = async (id, data) => {
    guard()
    const row = await db.updateIncome(id, cleanMoney(data, 'income'))
    setIncome((prev) => prev.map((e) => (e.id === id ? row : e)).sort(byDateDesc))
    return row
  }
  const deleteIncome = async (id) => {
    guard()
    await db.deleteIncome(id)
    setIncome((prev) => prev.filter((e) => e.id !== id))
  }
  const restoreIncome = async (row) => {
    guard()
    await db.restoreTrash('income', row.id)
    setIncome((prev) => [row, ...prev.filter((e) => e.id !== row.id)].sort(byDateDesc))
  }

  // ── Documents ──
  const addDocument = async (data) => {
    guard()
    const row = await db.addDocument({ ...data, ...stamp() })
    setDocuments((prev) => [...prev, row])
    return row
  }
  const deleteDocument = async (id) => {
    guard()
    await db.deleteDocument(id)
    setDocuments((prev) => prev.filter((d) => d.id !== id))
  }

  // ── Comments ──
  const addComment = async (data) => {
    guard()
    const row = await db.addComment(data)
    setComments((prev) => [...prev, row])
    return row
  }
  const deleteComment = async (id) => {
    guard()
    await db.deleteComment(id)
    setComments((prev) => prev.filter((c) => c.id !== id))
  }

  const value = useMemo(
    () => ({
      properties: scopedProperties,
      expenses: scopedExpenses,
      income: scopedIncome,
      documents: scopedDocuments,
      comments: scopedComments,
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
      restoreExpense,
      addIncome,
      updateIncome,
      deleteIncome,
      restoreIncome,
      addDocument,
      deleteDocument,
      addComment,
      deleteComment,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedProperties, scopedExpenses, scopedIncome, scopedDocuments, scopedComments, loading, error, canWrite, refresh, propertyNameById],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

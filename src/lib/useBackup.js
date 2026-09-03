import { useRef, useState } from 'react'
import { useData } from '../context/DataContext'
import { useEntity } from '../context/EntityContext'
import { isBlobToken, blobToDataUrl } from './storage/blobs'
import { cloudProviders } from './cloud'
import { exportCorporate, importCorporate, hasCorporateData } from './storage/corporate'

// Backup and restore, in one place because they are one round trip.
//
// The two halves now live on different pages — a backup is a way of getting
// your data out, restoring it is a way of getting data in — but they share the
// payload format, the attachment inlining, the provider list and the busy
// state. Duplicating ninety lines of that across two pages would mean a fix to
// one being a bug in the other, which is exactly how a backup quietly stops
// round-tripping.
export function useBackup(baseName) {
  const { expenses, income, properties, propertyNameById, addProperty, addExpense, addIncome } = useData()
  // Companies, departments, stock, advances and payroll live in their own
  // store. exportCorporate had been written and never called, so a backup
  // quietly held only the personal books — and restoring one onto a new browser
  // lost every company in it.
  const { reload: reloadEntities } = useEntity()
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudMsg, setCloudMsg] = useState(null)
  const [providerId, setProviderId] = useState(cloudProviders[0]?.id || '')
  const backupFileRef = useRef(null)

  const withAttachments = async (rows) =>
    Promise.all(
      rows.map(async (row) => {
        if (!isBlobToken(row.receipt_url)) return row
        const inlined = await blobToDataUrl(row.receipt_url).catch(() => null)
        return { ...row, receipt_url: inlined || null }
      }),
    )

  const buildPayload = async () => ({
    version: 2,
    exportedAt: new Date().toISOString(),
    properties,
    expenses: await withAttachments(expenses),
    income: await withAttachments(income),
    // Absent on a personal install rather than an empty husk, so a version 1
    // file and a personal version 2 file restore identically.
    ...(hasCorporateData() ? { corporate: exportCorporate() } : {}),
  })

  // Recreate assets/expenses/income from a backup object (matches assets by
  // name; additive). Shared by every cloud provider and the file restore.
  const importBackup = async (data) => {
    const oldIdToName = new Map((data.properties || []).map((p) => [p.id, p.name]))
    const nameToId = new Map(properties.map((p) => [p.name.trim().toLowerCase(), p.id]))
    let createdProps = 0
    let addedExp = 0
    let addedInc = 0
    for (const p of data.properties || []) {
      const key = (p.name || '').trim().toLowerCase()
      if (!key) continue
      if (!nameToId.has(key)) {
        const np = await addProperty({
          name: p.name,
          type: p.type || 'Other',
          address: p.address || '',
          notes: p.notes || '',
          monthly_budget: p.monthly_budget ?? null,
          value: p.value ?? null,
        })
        nameToId.set(key, np.id)
        createdProps += 1
      }
    }
    for (const e of data.expenses || []) {
      const pid = nameToId.get((oldIdToName.get(e.property_id) || '').trim().toLowerCase())
      if (!pid) continue
      await addExpense({
        property_id: pid,
        date: e.date,
        amount: Number(e.amount) || 0,
        category: e.category || 'Other',
        vendor: e.vendor || '',
        payment_method: e.payment_method || '',
        status: e.status || 'paid',
        due_date: e.due_date || null,
        tax: e.tax ?? null,
        description: e.description || '',
        receipt_url: null,
      })
      addedExp += 1
    }
    for (const e of data.income || []) {
      const pid = nameToId.get((oldIdToName.get(e.property_id) || '').trim().toLowerCase())
      if (!pid) continue
      await addIncome({
        property_id: pid,
        date: e.date,
        amount: Number(e.amount) || 0,
        source: e.source || 'Other',
        payer: e.payer || '',
        payment_method: e.payment_method || '',
        status: e.status || 'received',
        due_date: e.due_date || null,
        tax: e.tax ?? null,
        description: e.description || '',
        receipt_url: null,
      })
      addedInc += 1
    }
    // Merged by id, so the ids inside a movement or an adjustment still point
    // at the item or advance they were written against.
    const { added: addedCorp } = data.corporate ? importCorporate(data.corporate) : { added: 0 }
    if (addedCorp) reloadEntities?.()
    return { createdProps, addedExp, addedInc, addedCorp }
  }

  const provider = cloudProviders.find((p) => p.id === providerId)

  const cloudBackup = async () => {
    if (!provider) return
    setCloudBusy(true)
    setCloudMsg(null)
    try {
      await provider.backup(await buildPayload())
      setCloudMsg({ ok: true, text: `Backed up your data to ${provider.label}.` })
    } catch (err) {
      setCloudMsg({ ok: false, text: err?.message || String(err) })
    } finally {
      setCloudBusy(false)
    }
  }

  const cloudRestore = async () => {
    if (!provider) return
    if (!window.confirm(`Restore adds the records from your ${provider.label} backup to this account. Continue?`)) return
    setCloudBusy(true)
    setCloudMsg(null)
    try {
      const data = await provider.restore()
      if (!data) {
        setCloudMsg({ ok: false, text: `No backup found in your ${provider.label}.` })
        return
      }
      const { createdProps, addedExp, addedInc, addedCorp } = await importBackup(data)
      setCloudMsg({
        ok: true,
        text: `Restored ${addedExp} expenses, ${addedInc} income${createdProps ? `, created ${createdProps} assets` : ''}${addedCorp ? `, ${addedCorp} company records` : ''} from ${provider.label}.`,
      })
    } catch (err) {
      setCloudMsg({ ok: false, text: err?.message || String(err) })
    } finally {
      setCloudBusy(false)
    }
  }

  const downloadBackup = async () => {
    const blob = new Blob([JSON.stringify(await buildPayload(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${baseName}-backup.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const restoreFromFile = async (file) => {
    if (!file) return
    setCloudBusy(true)
    setCloudMsg(null)
    try {
      const data = JSON.parse(await file.text())
      const { createdProps, addedExp, addedInc, addedCorp } = await importBackup(data)
      setCloudMsg({
        ok: true,
        text: `Restored ${addedExp} expenses, ${addedInc} income${createdProps ? `, created ${createdProps} assets` : ''}${addedCorp ? `, ${addedCorp} company records` : ''} from file.`,
      })
    } catch (err) {
      setCloudMsg({ ok: false, text: `Could not read backup file: ${err?.message || err}` })
    } finally {
      setCloudBusy(false)
      if (backupFileRef.current) backupFileRef.current.value = ''
    }
  }

  return {
    busy: cloudBusy,
    msg: cloudMsg,
    providerId,
    setProviderId,
    provider,
    providers: cloudProviders,
    backupFileRef,
    // Out.
    downloadBackup,
    cloudBackup,
    // In.
    restoreFromFile,
    cloudRestore,
  }
}

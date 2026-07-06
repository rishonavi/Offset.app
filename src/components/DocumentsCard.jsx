import { useRef, useState } from 'react'
import { FileText, Trash2, Upload, ExternalLink } from 'lucide-react'
import { db } from '../lib/storage'
import { DOC_TYPES, docExpiry } from '../lib/documents'
import { formatDate } from '../lib/format'
import { Card, Field, Input, Select, Button } from './ui'
import ReceiptViewer from './ReceiptViewer'

const badgeStyle = (state) =>
  state === 'expired'
    ? { background: '#fee2e2', color: '#b91c1c' }
    : state === 'expiring'
    ? { background: '#fef3c7', color: '#b45309' }
    : { background: '#dcfce7', color: '#15803d' }

export default function DocumentsCard({ propertyId, documents, canWrite, onAdd, onDelete }) {
  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState(DOC_TYPES[0])
  const [expiry, setExpiry] = useState('')
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [viewing, setViewing] = useState(null)
  const fileRef = useRef(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Give the document a title.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let file_url = null
      if (file) file_url = await db.uploadReceipt(file)
      await onAdd({
        property_id: propertyId,
        title: title.trim(),
        doc_type: docType,
        expiry_date: expiry || null,
        file_url,
      })
      setTitle('')
      setDocType(DOC_TYPES[0])
      setExpiry('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  const sorted = [...documents].sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'))

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <FileText size={16} className="text-gold" />
        <h3 className="text-sm font-semibold text-slate-700">Documents</h3>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-slate-400">No documents yet — add a lease, insurance policy or warranty below.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {sorted.map((d) => {
            const exp = docExpiry(d)
            return (
              <div key={d.id} className="flex items-center gap-3 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                  <FileText size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">{d.title}</div>
                  <div className="text-xs text-slate-400">
                    {d.doc_type}
                    {d.expiry_date ? ` · expires ${formatDate(d.expiry_date)}` : ''}
                  </div>
                </div>
                {exp && (
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" style={badgeStyle(exp.state)}>
                    {exp.state === 'expired' ? `Expired ${Math.abs(exp.daysLeft)}d` : `${exp.daysLeft}d left`}
                  </span>
                )}
                {d.file_url && (
                  <button
                    type="button"
                    onClick={() => setViewing(d.file_url)}
                    className="shrink-0 text-slate-400 hover:text-brand"
                    title="View file"
                  >
                    <ExternalLink size={15} />
                  </button>
                )}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => onDelete(d.id)}
                    className="shrink-0 text-slate-400 hover:text-red-600"
                    title="Delete document"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {canWrite && (
        <form onSubmit={submit} className="mt-4 border-t border-slate-100 pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Home insurance 2026" />
            </Field>
            <Field label="Type">
              <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expiry date" hint="Optional — drives the dashboard reminder">
              <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </Field>
            <Field label="File" hint="Optional — image or PDF">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="btn-ghost w-full justify-start bg-transparent"
              >
                <Upload size={15} /> {file ? file.name : 'Choose file'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </Field>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-3 flex justify-end">
            <Button type="submit" loading={saving}>
              Add document
            </Button>
          </div>
        </form>
      )}

      {viewing && <ReceiptViewer stored={viewing} onClose={() => setViewing(null)} />}
    </Card>
  )
}

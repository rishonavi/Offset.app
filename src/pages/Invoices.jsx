import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Upload, Download, Printer, Trash2, Star, Plus, X, Check, AlertTriangle, Code } from 'lucide-react'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { formatCurrency, todayISO } from '../lib/format'
import {
  buildInvoice, invoiceTokens, nextNumber, linesFromIncome, round2, isValidGSTIN, taxKind,
} from '../lib/invoice'
import {
  listTemplates, saveTemplate, deleteTemplate, defaultTemplateId, setDefaultTemplate,
  parseTemplateFile, templateToFile, analyseTemplate, renderDocument,
  DEFAULT_TEMPLATE_HTML, DEFAULT_TEMPLATE_CSS, TEMPLATE_EXTENSIONS, TOKENS, LINE_TOKENS, CONDITIONS,
} from '../lib/invoiceTemplate'
import { invoiceToPDF, printInvoice, downloadHtml } from '../lib/invoicePdf'
import { Card, Button, CardTitle, Field, Input, Select, Textarea, EmptyState } from '../components/ui'
import PageHeader from '../components/PageHeader'

const ISSUER_KEY = 'pl_invoice_issuer'
const SEQ_KEY = 'pl_invoice_seq'

const readJSON = (key, fallback) => {
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(key)) || {}) }
  } catch {
    return fallback
  }
}

const BUILT_IN = { id: '', name: 'Offset default', html: DEFAULT_TEMPLATE_HTML, paper: 'a4', builtIn: true }

export default function Invoices() {
  const { properties, income, propertyNameById } = useData()
  const toast = useToast()
  const fileRef = useRef(null)

  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState('')
  const [showTokens, setShowTokens] = useState(false)
  const [busy, setBusy] = useState('')

  const [issuer, setIssuer] = useState(() =>
    readJSON(ISSUER_KEY, { name: '', address: '', gstin: '', pan: '', email: '', phone: '', bank: '' }),
  )
  const [client, setClient] = useState({ name: '', address: '', gstin: '', email: '' })
  const [meta, setMeta] = useState({
    numberPattern: 'INV-{FY}-{0001}',
    seq: Number(localStorage.getItem(SEQ_KEY) || 1),
    date: todayISO(),
    dueDate: '',
    period: '',
    notes: '',
    taxRate: 18,
    propertyId: '',
  })
  const [lines, setLines] = useState([{ description: '', hsn: '', qty: 1, rate: '' }])

  useEffect(() => {
    setTemplates(listTemplates())
    setTemplateId(defaultTemplateId())
  }, [])

  // The issuer's own details are the same on every invoice they ever send, so
  // they are remembered rather than retyped.
  useEffect(() => {
    try {
      localStorage.setItem(ISSUER_KEY, JSON.stringify(issuer))
    } catch {
      /* a convenience, not worth an error */
    }
  }, [issuer])

  const allTemplates = [BUILT_IN, ...templates]
  const template = allTemplates.find((t) => t.id === templateId) || BUILT_IN
  const analysis = useMemo(() => analyseTemplate(template.html), [template.html])

  const asset = properties.find((p) => p.id === meta.propertyId) || null

  const invoice = useMemo(
    () =>
      buildInvoice({
        number: nextNumber(meta.numberPattern, meta.seq, meta.date),
        date: meta.date,
        dueDate: meta.dueDate,
        period: meta.period,
        notes: meta.notes,
        issuer,
        client,
        asset,
        taxRate: Number(meta.taxRate),
        lines: lines.filter((l) => (l.description || '').trim() || Number(l.rate)),
      }),
    [meta, issuer, client, asset, lines],
  )

  const documentHtml = useMemo(
    () =>
      renderDocument(template.html, invoiceTokens(invoice), {
        css: template.builtIn ? DEFAULT_TEMPLATE_CSS : DEFAULT_TEMPLATE_CSS,
        title: invoice.number || 'Invoice',
      }),
    [template, invoice],
  )

  // ── Templates ──
  const importTemplate = async (file) => {
    if (!file) return
    try {
      const text = await file.text()
      const parsed = parseTemplateFile(file.name, text)
      const found = analyseTemplate(parsed.html)
      const row = saveTemplate(parsed)
      setTemplates(listTemplates())
      setTemplateId(row.id)
      if (found.unknown.length) {
        toast(`Imported, but ${found.unknown.length} token${found.unknown.length === 1 ? '' : 's'} aren’t recognised — check the list below.`, { type: 'error', duration: 8000 })
      } else {
        toast(`“${row.name}” imported.`)
      }
    } catch (e) {
      toast(e?.message || 'That file couldn’t be read as a format.', { type: 'error' })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removeTemplate = (t) => {
    // Only the stored format goes; anything already downloaded is a file on
    // their disk and is untouched.
    const ok = window.confirm(
      `Delete “${t.name}”? The format is removed from this browser. Invoices you have already downloaded are unaffected.`,
    )
    if (!ok) return
    deleteTemplate(t.id)
    setTemplates(listTemplates())
    if (templateId === t.id) setTemplateId(defaultTemplateId())
  }

  const makeDefault = (t) => {
    setDefaultTemplate(t.id)
    setTemplates(listTemplates())
    toast(t.id ? `“${t.name}” is now the default format.` : 'Back to the built-in format.')
  }

  // ── Lines ──
  const setLine = (i, patch) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const addLine = () => setLines((prev) => [...prev, { description: '', hsn: '', qty: 1, rate: '' }])
  const dropLine = (i) => setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, j) => j !== i)))

  // Pull this asset's income for the chosen period straight in as line items —
  // the reason to invoice from inside the ledger rather than a separate app.
  const pullFromLedger = () => {
    const rows = income
      .filter((r) => !meta.propertyId || r.property_id === meta.propertyId)
      .filter((r) => !meta.period || (r.date || '').startsWith(meta.period))
      .slice(0, 40)
    if (!rows.length) {
      toast('No income entries match that asset and period.', { type: 'error' })
      return
    }
    setLines(linesFromIncome(rows, { propertyNameById }))
    toast(`${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} added as lines.`)
  }

  // ── Output ──
  const bumpSeq = () => {
    const next = Number(meta.seq) + 1
    setMeta((m) => ({ ...m, seq: next }))
    try {
      localStorage.setItem(SEQ_KEY, String(next))
    } catch {
      /* numbering still advances for this session */
    }
  }

  const downloadPDF = async () => {
    setBusy('pdf')
    try {
      await invoiceToPDF(documentHtml, { filename: `${invoice.number || 'invoice'}.pdf`, paper: template.paper })
      bumpSeq()
      toast('PDF saved.')
    } catch (e) {
      toast(e?.message || 'Could not build the PDF.', { type: 'error' })
    } finally {
      setBusy('')
    }
  }

  const gstinProblem =
    (issuer.gstin && !isValidGSTIN(issuer.gstin) && 'yours') ||
    (client.gstin && !isValidGSTIN(client.gstin) && 'theirs') ||
    ''
  const kind = taxKind(issuer.gstin, client.gstin)

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Invoices"
        subtitle="Build an invoice from your ledger and print it in your own format."
        actions={
          <>
            <Button variant="ghost" onClick={() => printInvoice(documentHtml)}>
              <Printer size={16} /> Print
            </Button>
            <Button onClick={downloadPDF} loading={busy === 'pdf'}>
              <Download size={16} /> Download PDF
            </Button>
          </>
        }
      />

      {/* Formats */}
      <Card className="p-5">
        <CardTitle
          title="Your format"
          icon={FileText}
          description="Import your own invoice layout as an HTML file. Offset fills in the numbers."
          action={
            <>
              <input
                ref={fileRef}
                type="file"
                accept={TEMPLATE_EXTENSIONS.join(',')}
                className="hidden"
                aria-label="Import an invoice format"
                onChange={(e) => importTemplate(e.target.files?.[0])}
              />
              <Button variant="ghost" onClick={() => fileRef.current?.click()}>
                <Upload size={16} /> Import a format
              </Button>
            </>
          }
        />

        <div className="mt-4 divide-y divide-border-subtle">
          {allTemplates.map((t) => {
            const isDefault = t.id === defaultTemplateId()
            return (
              <div key={t.id || 'built-in'} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                  <input
                    type="radio"
                    name="invoice-format"
                    checked={templateId === t.id}
                    onChange={() => setTemplateId(t.id)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">
                      {t.name}
                      {t.builtIn && <span className="ml-2 text-xs font-normal text-slate-400">built in</span>}
                      {isDefault && (
                        <span className="ml-2 bg-brand-light px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-gold">
                          Default
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-slate-400">{t.paper === 'letter' ? 'Letter' : 'A4'}</span>
                  </span>
                </label>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => makeDefault(t)}
                    className="grid h-8 w-8 place-items-center text-slate-400 hover:text-gold"
                    title={`Make “${t.name}” the default`}
                    aria-label={`Make ${t.name} the default format`}
                  >
                    <Star size={15} />
                  </button>
                  {!t.builtIn && (
                    <>
                      <button
                        onClick={() => downloadHtml(templateToFile(t), `${t.name}.json`)}
                        className="grid h-8 w-8 place-items-center text-slate-400 hover:text-brand"
                        title={`Export “${t.name}”`}
                        aria-label={`Export ${t.name}`}
                      >
                        <Download size={15} />
                      </button>
                      <button
                        onClick={() => removeTemplate(t)}
                        className="grid h-8 w-8 place-items-center text-slate-400 hover:text-red-600"
                        title={`Delete “${t.name}”`}
                        aria-label={`Delete ${t.name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {analysis.unknown.length > 0 && (
          <div className="mt-3 flex items-start gap-2 border-s-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              This format uses {analysis.unknown.length} token{analysis.unknown.length === 1 ? '' : 's'} Offset
              doesn’t know: <code className="font-mono">{analysis.unknown.join(', ')}</code>. They’ll come out
              blank — check the spelling against the list below.
            </span>
          </div>
        )}
        {analysis.warnings.map((w) => (
          <p key={w} className="mt-2 text-xs text-slate-500">
            {w}
          </p>
        ))}

        <button
          onClick={() => setShowTokens((v) => !v)}
          className="mt-3 flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
          aria-expanded={showTokens}
        >
          <Code size={13} /> {showTokens ? 'Hide' : 'Show'} what you can put in a format
        </button>
        {showTokens && <TokenReference />}
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Details */}
        <div className="space-y-5">
          <Card className="p-5">
            <CardTitle title="From" description="Remembered on this device for next time." />
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name / business"><Input value={issuer.name} onChange={(e) => setIssuer({ ...issuer, name: e.target.value })} /></Field>
              <Field label="GSTIN"><Input value={issuer.gstin} onChange={(e) => setIssuer({ ...issuer, gstin: e.target.value.toUpperCase() })} placeholder="27AAAPA1234A1Z5" /></Field>
              <div className="sm:col-span-2">
                <Field label="Address"><Textarea className="h-16 resize-y" value={issuer.address} onChange={(e) => setIssuer({ ...issuer, address: e.target.value })} /></Field>
              </div>
              <Field label="Email"><Input type="email" value={issuer.email} onChange={(e) => setIssuer({ ...issuer, email: e.target.value })} /></Field>
              <Field label="Phone"><Input value={issuer.phone} onChange={(e) => setIssuer({ ...issuer, phone: e.target.value })} /></Field>
              <div className="sm:col-span-2">
                <Field label="Payment details" hint="Bank account, UPI — whatever you want printed."><Input value={issuer.bank} onChange={(e) => setIssuer({ ...issuer, bank: e.target.value })} /></Field>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <CardTitle title="Bill to" />
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name"><Input value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} /></Field>
              <Field label="GSTIN"><Input value={client.gstin} onChange={(e) => setClient({ ...client, gstin: e.target.value.toUpperCase() })} /></Field>
              <div className="sm:col-span-2">
                <Field label="Address"><Textarea className="h-16 resize-y" value={client.address} onChange={(e) => setClient({ ...client, address: e.target.value })} /></Field>
              </div>
            </div>
            {gstinProblem && (
              <p className="mt-2 text-xs text-amber-700">
                {gstinProblem === 'yours' ? 'Your' : 'Their'} GSTIN doesn’t look like a GSTIN (15 characters,
                starting with a state code). Tax will still be worked out from the state code.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              {kind === 'intra'
                ? 'Same state — tax splits into CGST and SGST.'
                : kind === 'inter'
                  ? 'Different states — tax is charged as IGST.'
                  : 'No GSTIN on both sides, so no tax lines will be printed.'}
            </p>
          </Card>

          <Card className="p-5">
            <CardTitle title="Invoice" />
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Number pattern" hint="{FY} = financial year, {0001} = counter">
                <Input value={meta.numberPattern} onChange={(e) => setMeta({ ...meta, numberPattern: e.target.value })} />
              </Field>
              <Field label="Next number" hint={`Will print as ${nextNumber(meta.numberPattern, meta.seq, meta.date)}`}>
                <Input type="number" min="1" value={meta.seq} onChange={(e) => setMeta({ ...meta, seq: e.target.value })} />
              </Field>
              <Field label="Date"><Input type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} /></Field>
              <Field label="Due date"><Input type="date" value={meta.dueDate} onChange={(e) => setMeta({ ...meta, dueDate: e.target.value })} /></Field>
              <Field label="Asset">
                <Select value={meta.propertyId} onChange={(e) => setMeta({ ...meta, propertyId: e.target.value })}>
                  <option value="">None</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Period" hint="YYYY-MM, used to pull entries"><Input placeholder="2026-05" value={meta.period} onChange={(e) => setMeta({ ...meta, period: e.target.value })} /></Field>
              <Field label="Tax rate %"><Input type="number" min="0" step="0.5" value={meta.taxRate} onChange={(e) => setMeta({ ...meta, taxRate: e.target.value })} /></Field>
              <div className="sm:col-span-2">
                <Field label="Notes"><Textarea className="h-14 resize-y" value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} /></Field>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <CardTitle
              title="Lines"
              action={
                <Button variant="ghost" onClick={pullFromLedger}>
                  <Plus size={15} /> From ledger
                </Button>
              }
            />
            <div className="mt-3 space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <input
                    className="field-input col-span-6"
                    placeholder="Description"
                    aria-label={`Line ${i + 1} description`}
                    value={l.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                  />
                  <input
                    className="field-input col-span-2"
                    placeholder="HSN"
                    aria-label={`Line ${i + 1} HSN code`}
                    value={l.hsn}
                    onChange={(e) => setLine(i, { hsn: e.target.value })}
                  />
                  <input
                    className="field-input col-span-1"
                    type="number"
                    min="0"
                    placeholder="Qty"
                    aria-label={`Line ${i + 1} quantity`}
                    value={l.qty}
                    onChange={(e) => setLine(i, { qty: e.target.value })}
                  />
                  <input
                    className="field-input col-span-2"
                    type="number"
                    min="0"
                    placeholder="Rate"
                    aria-label={`Line ${i + 1} rate`}
                    value={l.rate}
                    onChange={(e) => setLine(i, { rate: e.target.value })}
                  />
                  <button
                    onClick={() => dropLine(i)}
                    className="col-span-1 grid place-items-center text-slate-400 hover:text-red-600"
                    aria-label={`Remove line ${i + 1}`}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
            <Button variant="ghost" className="mt-3" onClick={addLine}>
              <Plus size={15} /> Add line
            </Button>

            <dl className="mt-4 space-y-1 border-t border-border-subtle pt-3 text-sm">
              <Row label="Subtotal" value={formatCurrency(invoice.subtotal)} />
              {invoice.taxKind === 'intra' && (
                <>
                  <Row label="CGST" value={formatCurrency(invoice.cgst)} />
                  <Row label="SGST" value={formatCurrency(invoice.sgst)} />
                </>
              )}
              {invoice.taxKind === 'inter' && <Row label="IGST" value={formatCurrency(invoice.igst)} />}
              <Row label="Total" value={formatCurrency(invoice.total)} strong />
            </dl>
          </Card>
        </div>

        {/* Preview */}
        <Card className="overflow-hidden p-0 lg:sticky lg:top-6 lg:self-start">
          <div className="flex items-center justify-between border-b border-border-light px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-700">Preview</span>
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <Check size={13} className="text-emerald-600" /> {template.name}
            </span>
          </div>
          {/* Sandboxed: a format may have come from someone else, and a preview
              is for looking at, not for running. */}
          <iframe
            title="Invoice preview"
            sandbox=""
            srcDoc={documentHtml}
            className="h-[70vh] w-full bg-white"
          />
        </Card>
      </div>
    </div>
  )
}

function Row({ label, value, strong }) {
  return (
    <div className={`flex justify-between ${strong ? 'border-t border-border-subtle pt-1.5 font-semibold text-slate-900' : 'text-slate-600'}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function TokenReference() {
  const group = (title, map, prefix = '') => (
    <div>
      <div className="text-[0.6rem] font-semibold uppercase tracking-[1px] text-slate-400">{title}</div>
      <dl className="mt-1 space-y-0.5">
        {Object.entries(map).map(([k, v]) => (
          <div key={k} className="flex gap-3 text-xs">
            <dt className="w-44 shrink-0 font-mono text-slate-600">{`{{${prefix}${k}}}`}</dt>
            <dd className="min-w-0 text-slate-500">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
  return (
    <div className="mt-3 space-y-4 border-t border-border-subtle pt-3">
      <p className="text-xs text-slate-500">
        Put these anywhere in your HTML. Wrap the row of a table in{' '}
        <code className="font-mono">{'{{#each lines}}…{{/each}}'}</code> to repeat it per line item, and{' '}
        <code className="font-mono">{'{{#if is_intra_state}}…{{/if}}'}</code> to show something only when it applies.
      </p>
      {group('Values', TOKENS)}
      {group('Inside {{#each lines}}', LINE_TOKENS)}
      {group('Conditions', CONDITIONS)}
    </div>
  )
}

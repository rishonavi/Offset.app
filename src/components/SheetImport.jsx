import { useMemo, useState } from 'react'
import { FileSpreadsheet, Check, AlertTriangle, ArrowRight } from 'lucide-react'
import * as store from '../lib/storage/corporate'
import { parseSpreadsheet } from '../lib/exports'
import {
  TARGETS,
  TARGET_IDS,
  mapRows,
  describeMatch,
  isNumbersPackage,
  NUMBERS_NOTE,
} from '../lib/intake'
import { extractText } from '../lib/ocr'
import { readPaper, paperRows, describePaper, PAPERS } from '../lib/papers'
import { Card, Button, Field, Select, Badge, attempt } from './ui'

// Somebody else's spreadsheet, into the books.
//
// Everything here can be typed in and on a real site nothing is: the sales list
// is what the broker sent, the salary register is what the last accountant left
// behind. Re-keying four hundred flats is the reason an app never gets used.
//
// The screen is built around one idea — **the match is a guess, so it is shown
// before anything is written.** Which of your columns became which field, which
// ones were ignored, which rows will be skipped and why. An importer that
// guesses silently and writes four hundred rows is worse than one that refuses.
export default function SheetImport({ data, eid, actor, canWrite, bump, toast }) {
  const [target, setTarget] = useState('units')
  const [projectId, setProjectId] = useState('')
  const [rows, setRows] = useState(null)
  // A PDF is one document rather than four hundred rows, so it is held apart
  // and previewed differently — and then confirmed through the same button, so
  // there is one way to say yes rather than two.
  const [paper, setPaper] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [done, setDone] = useState(null)

  const plan = useMemo(
    () => (rows ? mapRows(rows, target, { entityId: eid, projectId: projectId || null }) : null),
    [rows, target, eid, projectId],
  )
  const fromPaper = useMemo(
    () => (paper ? paperRows(paper, { entityId: eid, projectId: projectId || null }) : []),
    [paper, eid, projectId],
  )
  const spec = TARGETS[target]
  // Whichever came in, this is what will be written.
  const ready = paper ? fromPaper : (plan?.ready || [])

  const load = async (file) => {
    setDone(null)
    setRows(null)
    setPaper(null)
    if (!file) return
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
    if (isPdf || /^image\//.test(file.type)) {
      setBusy(true)
      setNote('Reading the document…')
      try {
        // `extractText` reads a generated PDF as text and falls back to OCR on a
        // scanned one. Nothing here needs to know which it was.
        const read = readPaper(await extractText(file))
        setPaper(read)
        // The kind decides where it goes, rather than whatever the picker
        // happened to be left on.
        if (read.target) setTarget(read.target)
        setNote(`${file.name} — ${describePaper(read)}`)
      } catch (e) {
        setNote(e?.message || 'That document could not be read.')
      }
      setBusy(false)
      return
    // A .numbers document is a package rather than a spreadsheet. Saying so
    // beats "could not read file" about a file that is perfectly fine.
    }
    if (isNumbersPackage(file.name)) { setNote(NUMBERS_NOTE); return }
    try {
      // Blank rows kept, so a skipped row's line number is the line number in
      // the file rather than in whatever survived the reader.
      const parsed = await parseSpreadsheet(file, { keepBlanks: true })
      setRows(parsed)
      setNote(parsed.length ? `${parsed.length} rows read from ${file.name}.` : `${file.name} has no rows under its headers.`)
    } catch (e) {
      setRows(null)
      setNote(e?.message || 'That file could not be read.')
    }
  }

  const write = () => {
    if (!ready.length) return
    let written = 0
    let repeats = 0
    for (const row of ready) {
      const saved = attempt(() => {
        const out = store[target].add(row, actor, eid)
        if (out?._repeat) repeats += 1; else written += 1
      }, toast)
      // A refusal — a closed month, say — stops the run rather than writing
      // half a sheet and leaving somebody to work out which half.
      if (!saved) break
    }
    setRows(null)
    setPaper(null)
    setDone({ written, repeats, of: ready.length })
    bump()
    toast(`${written} ${written === 1 ? spec.noun : `${spec.noun}s`} added`)
  }

  if (!canWrite) return null

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <FileSpreadsheet size={16} className="text-gold" />
        <h3 className="text-sm font-semibold text-ink-3">From a spreadsheet</h3>
      </div>
      <p className="mt-1 text-xs text-ink-5">
        Nothing is written until you have seen what it will do. The columns are matched loosely — a loose match is a
        guess — so the guess is shown first: which of your columns became which field, which were ignored, and which
        rows will be skipped.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Bringing in">
          <Select aria-label="What to import" value={target} onChange={(e) => { setTarget(e.target.value); setDone(null) }}>
            {TARGET_IDS.map((id) => <option key={id} value={id}>{TARGETS[id].label}</option>)}
          </Select>
        </Field>
        {target !== 'employees' && data.projects.length > 0 && (
          <Field label="Site">
            <Select aria-label="Import site" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Not booked to a site</option>
              {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        )}
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-line px-4 text-[0.78rem] font-semibold text-ink-3 hover:border-line-strong">
          <FileSpreadsheet size={15} /> {busy ? 'Reading…' : 'Choose a file'}
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.numbers,.pdf,image/*"
            aria-label="Spreadsheet to import"
            className="hidden"
            onChange={(e) => load(e.target.files?.[0])}
          />
        </label>
      </div>

      <p className="mt-2 text-[0.7rem] text-ink-6">
        A spreadsheet with columns like: {spec.example}. Or one document — a salary slip, a quotation, an allotment
        letter — as a PDF or a photograph.
      </p>
      {note && <p className="mt-2 text-xs text-ink-4">{note}</p>}

      {done && (
        <p className="mt-3 flex items-center gap-2 text-sm text-good">
          <Check size={15} /> {done.written} of {done.of} added
          {done.repeats > 0 && <span className="text-ink-5">· {done.repeats} were already there</span>}
        </p>
      )}

      {paper && (
        <div className="mt-3 rounded-xl border border-line-soft p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-ink-3">
              {paper.kind ? PAPERS[paper.kind].label : 'Not recognised'}
            </p>
            {paper.guessed && paper.kind && (
              <Badge color={paper.confident ? '#64748b' : '#d97706'}>
                {paper.confident ? 'recognised' : 'unsure — check it'}
              </Badge>
            )}
          </div>

          {!paper.read ? (
            <p className="mt-2 text-xs text-ink-5">{describePaper(paper)}</p>
          ) : (
            <>
              <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {Object.entries(readFields(paper)).map(([label, value]) => (
                  <li key={label} className="flex items-center justify-between gap-2 text-[0.7rem]">
                    <span className="text-ink-5">{label}</span>
                    <span className="truncate font-medium text-ink-2">{value}</span>
                  </li>
                ))}
              </ul>

              {/* Not found is not nought. A slip with no medical line says
                  nothing about medical, and a zero would make the reader's
                  silence into the document's statement. */}
              {paper.missing?.length > 0 && (
                <p className="mt-2 text-[0.7rem] text-ink-6">
                  Nothing in it about: {paper.missing.join(', ')}. Those are left at nothing rather than guessed.
                </p>
              )}

              {/* The document's own totals are checked, not trusted. */}
              {paper.problems?.length > 0 && (
                <p className="mt-2 text-[0.7rem] text-warn">
                  {paper.problems.join('; ')}.
                </p>
              )}
            </>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
            <span className="text-xs text-ink-5">
              {ready.length ? `1 ${spec.noun} ready` : 'Nothing to add from this'}
            </span>
            <Button type="button" onClick={write} disabled={!ready.length}>
              <Check size={15} /> Add {spec.noun}
            </Button>
          </div>
        </div>
      )}

      {!paper && plan && plan.refused && (
        <p className="mt-3 flex items-start gap-2 text-sm text-bad">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {plan.refused} Nothing has been written.
        </p>
      )}

      {!paper && plan && !plan.refused && (
        <div className="mt-3 rounded-xl border border-line-soft p-3">
          <p className="text-xs font-semibold text-ink-3">{describeMatch(plan.match, target)}</p>

          <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {Object.entries(plan.match.columns).map(([field, header]) => (
              <li key={field} className="flex items-center gap-2 text-[0.7rem] text-ink-5">
                <span className="truncate text-ink-3">{header}</span>
                <ArrowRight size={11} className="shrink-0 text-ink-6" />
                <span className="truncate">{field}</span>
              </li>
            ))}
          </ul>

          {/* Your columns that nothing was done with. A "Parking" column that
              vanished is a question worth asking before four hundred rows. */}
          {plan.match.ignored.length > 0 && (
            <p className="mt-2 text-[0.7rem] text-warn">
              Ignored: {plan.match.ignored.join(', ')}
            </p>
          )}
          {plan.match.ambiguous.length > 0 && (
            <p className="mt-2 text-[0.7rem] text-warn">
              {plan.match.ambiguous.map((a) => `${a.headers.join(' and ')} both look like ${a.field}`).join('; ')}.
            </p>
          )}

          {/* Named, not dropped. "12 skipped" with no reason is how somebody
              finds out in March that the penthouse is missing. */}
          {plan.skipped.length > 0 && (
            <div className="mt-2">
              <p className="text-[0.7rem] font-semibold text-ink-4">
                {plan.skipped.length} {plan.skipped.length === 1 ? 'row' : 'rows'} will be skipped
              </p>
              <ul className="mt-1 space-y-0.5">
                {plan.skipped.slice(0, 5).map((s) => (
                  <li key={s.line} className="text-[0.68rem] text-ink-6">Line {s.line} — {s.why}</li>
                ))}
                {plan.skipped.length > 5 && (
                  <li className="text-[0.68rem] text-ink-6">and {plan.skipped.length - 5} more</li>
                )}
              </ul>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
            <span className="text-xs text-ink-5">
              {plan.ready.length} {plan.ready.length === 1 ? spec.noun : `${spec.noun}s`} ready
              {target === 'quotes' && plan.inputs && plan.inputs.length !== plan.ready.length && (
                <span className="text-ink-6"> from {plan.inputs.length} rows</span>
              )}
            </span>
            <Button type="button" onClick={write} disabled={!plan.ready.length}>
              <Check size={15} /> Add {plan.ready.length} {plan.ready.length === 1 ? spec.noun : `${spec.noun}s`}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

// The handful of fields worth showing back, per kind. A dump of everything the
// parser produced is not a check anybody performs.
function readFields(paper) {
  const money = (n) => (n || n === 0 ? `₹${Number(n).toLocaleString('en-IN')}` : '—')
  if (paper.kind === 'salarySlip') {
    return {
      Name: paper.name || '—',
      Code: paper.code || '—',
      Month: paper.period || '—',
      Basic: money(paper.components?.basic),
      'House rent': money(paper.components?.hra),
      Gross: money(paper.gross),
      Deductions: money(paper.totalDeductions),
      'Take-home': money(paper.net),
    }
  }
  if (paper.kind === 'quotation') {
    return {
      Vendor: paper.vendor || '—',
      Reference: paper.ref || '—',
      Date: paper.date || '—',
      Materials: String(paper.lines?.length || 0),
      First: paper.lines?.[0] ? `${paper.lines[0].name} @ ${money(paper.lines[0].rate)}` : '—',
    }
  }
  return {
    Unit: paper.name || '—',
    Tower: paper.tower || '—',
    Floor: paper.floor || '—',
    Configuration: paper.configuration || '—',
    'Carpet area': paper.carpetArea || '—',
    Price: money(paper.agreedPrice),
    Buyer: paper.buyer || '—',
  }
}

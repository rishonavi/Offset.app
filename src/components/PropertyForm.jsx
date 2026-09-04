import { useRef, useState } from 'react'
import { Sparkles, Loader2, ChevronDown } from 'lucide-react'
import {
  ASSET_TYPES, ASSET_GROUPS, shortTypeLabel, exampleNameFor,
  hasAddress, canBeFinanced, canBeLeased, ATTACHMENT_ACCEPT,
} from '../lib/constants'
import { iconForAssetType } from '../lib/assetIcon'
import { monthlyPayment } from '../lib/loan'
import { usual } from '../lib/defaults'
import { currencySymbol, formatCurrency } from '../lib/format'
import {
  METALS, METAL_KEYS, PURITIES, UNITS, UNIT_KEYS,
  holdsMetal, defaultMetalFor, quoteLabel, valueMetalHolding, describeHolding,
} from '../lib/metals'
import { Field, Input, Select, Textarea, Button, cx } from './ui'


// What a read actually found, and what it left out. The making charges are the
// point: they are on the bill and they are not part of what the metal is
// worth, so showing the two side by side is the difference between an honest
// valuation and a flattering one.
const NOTE_TEXT = {
  bill_rate_basis_unknown:
    'The bill did not say what the rate is per, so it was left blank — a per-gram rate entered as per-10-grams is wrong by ten.',
  weight_is_gross:
    'Only a gross weight was on the bill. If the piece has stones, reduce it to the metal weight.',
  weight_from_gross_less_stones: 'Weight taken as gross less the stones listed.',
  making_charges_excluded_from_metal:
    'Making charges are part of what you paid but not of what the metal is worth — they are not recovered on resale.',
  no_weight: 'No weight could be read; enter it by hand.',
  no_purity: 'No purity could be read; check the picker above.',
}

function BillSummary({ read }) {
  const { breakdown } = read
  return (
    <div className="mt-3 rounded-lg border border-gold/40 bg-gold/10 p-3 text-xs text-ink-3">
      <p className="font-semibold">Read from the bill</p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1">
        {breakdown.metalValue != null && (
          <><dt className="text-ink-5">Metal</dt><dd className="text-end">{formatCurrency(breakdown.metalValue)}</dd></>
        )}
        {breakdown.making != null && (
          <><dt className="text-ink-5">Making</dt><dd className="text-end">{formatCurrency(breakdown.making)}</dd></>
        )}
        {breakdown.tax != null && (
          <><dt className="text-ink-5">Tax</dt><dd className="text-end">{formatCurrency(breakdown.tax)}</dd></>
        )}
        {breakdown.total != null && (
          <><dt className="font-medium text-ink-4">Paid</dt><dd className="text-end font-medium">{formatCurrency(breakdown.total)}</dd></>
        )}
      </dl>
      {read.notes.map((n) => NOTE_TEXT[n] && <p key={n} className="mt-1.5 text-ink-5">{NOTE_TEXT[n]}</p>)}
      <p className="mt-1.5 text-ink-5">Check every figure against the bill before saving.</p>
    </div>
  )
}

// Pointing at the thing you own, rather than reading a dropdown to the end.
//
// Real radios in a real fieldset: keyboard arrows, screen-reader grouping and
// form semantics all come for free, and the visible focus ring is put back on
// the label because the input itself is hidden.
function TypePicker({ value, onChange }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink-3">Type</legend>
      <div className="mt-2 space-y-2.5">
        {ASSET_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-1 text-[0.6rem] font-semibold uppercase tracking-[1.5px] text-ink-6">{group.label}</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {group.types.map((type) => {
                const Icon = iconForAssetType(type)
                const on = value === type
                return (
                  <label
                    key={type}
                    className={cx(
                      // min-h-11 keeps the tap target honest on a phone even
                      // though the tile itself is only as tall as its label.
                      'relative flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs leading-tight transition',
                      'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/60',
                      on
                        ? 'border-brand bg-brand/10 font-semibold text-ink-1'
                        : 'border-border-light text-ink-4 hover:border-brand/40 hover:text-ink-2',
                    )}
                  >
                    <input
                      type="radio"
                      name="asset-type"
                      value={type}
                      checked={on}
                      onChange={() => onChange(type)}
                      // Stretched over the whole tile rather than hidden in a
                      // corner of it: sr-only leaves the input a one-pixel
                      // sliver that the icon sits on top of, so the thing being
                      // clicked is the label and the control itself is
                      // unreachable by anything that aims at the input.
                      className="absolute inset-0 m-0 cursor-pointer appearance-none opacity-0"
                    />
                    <Icon size={15} className={on ? 'shrink-0 text-brand' : 'shrink-0 text-ink-6'} />
                    <span className="min-w-0">{shortTypeLabel(type)}</span>
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  )
}

// Everything below the name is optional, and a block of four inputs sitting
// open is a block of four inputs you feel you owe an answer to. Named for what
// it says about the asset — "there is a loan on it" — rather than for the table
// it writes to, and opened already when the asset being edited has the data.
function Disclosure({ title, summary, open, onToggle, children }) {
  return (
    <div className="rounded-lg border border-border-light">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-surface-hover"
      >
        <span className="flex-1">
          <span className="block text-sm font-medium text-ink-2">{title}</span>
          <span className="block text-xs text-ink-5">{summary}</span>
        </span>
        <ChevronDown size={16} className={cx('shrink-0 text-ink-5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-border-light p-4">{children}</div>}
    </div>
  )
}

// A money input is the same six lines everywhere it appears.
function Money({ value, onChange, ...rest }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-ink-5">
        {currencySymbol}
      </span>
      <Input type="number" inputMode="decimal" step="0.01" min="0" className="ps-8"
        value={value} onChange={onChange} placeholder="0" {...rest} />
    </div>
  )
}

export default function PropertyForm({ initial, history = [], onSubmit, onCancel }) {
  // Someone with eleven flats is adding a twelfth, not a warehouse. The first
  // entry in a list of forty types is a worse guess than the type they have
  // picked every time so far — and when they have no habit yet, `usual` says so
  // and the list falls back to its own first entry.
  const learnedType = usual(history, 'type', { among: ASSET_TYPES })
  const [form, setForm] = useState({
    name: initial?.name || '',
    type: initial?.type || learnedType || ASSET_TYPES[0],
    address: initial?.address || '',
    value: initial?.value ?? '',
    monthly_budget: initial?.monthly_budget ?? '',
    loan_principal: initial?.loan_principal ?? '',
    loan_rate: initial?.loan_rate ?? '',
    loan_tenure_months: initial?.loan_tenure_months ?? '',
    loan_start: initial?.loan_start || '',
    tenant_name: initial?.tenant_name || '',
    lease_start: initial?.lease_start || '',
    lease_end: initial?.lease_end || '',
    deposit: initial?.deposit ?? '',
    metal: initial?.metal || defaultMetalFor(initial?.type || learnedType || ASSET_TYPES[0]) || 'gold',
    metal_quantity: initial?.metal_quantity ?? '',
    metal_unit: initial?.metal_unit || 'g',
    metal_fineness: initial?.metal_fineness ?? '',
    metal_rate: initial?.metal_rate ?? '',
    notes: initial?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Open where there is already something to see. Editing a mortgaged flat and
  // being shown a collapsed row saying "Loan / mortgage" would hide the very
  // numbers you came to change.
  const [open, setOpen] = useState({
    loan: initial?.loan_principal != null && initial?.loan_principal !== '',
    lease: Boolean(initial?.tenant_name || initial?.lease_end),
    notes: Boolean(initial?.notes),
  })
  const toggle = (k) => () => setOpen((o) => ({ ...o, [k]: !o[k] }))

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  // Switching to Jewellery should land on a sensible metal rather than an
  // empty picker; switching away leaves the numbers alone so they survive a
  // mis-click.
  const setType = (type) =>
    setForm((f) => ({ ...f, type, metal: f.metal || defaultMetalFor(type) || 'gold' }))

  // Computed on every keystroke rather than on save: three numbers in, the form
  // can already answer the question the loan block exists to answer.
  // Whole rupees: an EMI quoted to the paisa is two characters of noise in the
  // middle of the sentence you actually wanted to read.
  const emi = Math.round(monthlyPayment(form.loan_principal, form.loan_rate, form.loan_tenure_months))
  const months = Number(form.loan_tenure_months) || 0
  const totalPaid = emi * months
  const interest = Math.max(0, totalPaid - Number(form.loan_principal))
  const loanYears =
    months >= 12
      ? `${Math.round((months / 12) * 10) / 10} years`.replace('.0 ', ' ')
      : `${months} month${months === 1 ? '' : 's'}`
  const ltv =
    Number(form.value) > 0 && Number(form.loan_principal) > 0
      ? Math.round((Number(form.loan_principal) / Number(form.value)) * 100)
      : null

  const billRef = useRef(null)
  const [reading, setReading] = useState(false)
  const [billNote, setBillNote] = useState(null)

  // Read a purchase bill and fill the metal fields from it. Only fields the
  // bill actually stated are written — anything it did not say is left alone
  // rather than blanked, so a partial read adds to what is there instead of
  // wiping it.
  const readBill = async (file) => {
    if (!file) return
    setReading(true)
    setBillNote(null)
    try {
      const { scanMetalBill, metalScanNote } = await import('../lib/ocr')
      const { data, error } = await scanMetalBill(file)
      if (!data) {
        setBillNote({ ok: false, text: metalScanNote(error) })
        return
      }
      const { fromBill } = await import('../lib/metalBill')
      const read = fromBill(data)
      setForm((f) => ({
        ...f,
        metal: read.metal || f.metal,
        metal_quantity: read.metal_quantity ?? f.metal_quantity,
        metal_unit: read.metal_quantity != null ? 'g' : f.metal_unit,
        metal_fineness: read.metal_fineness ?? f.metal_fineness,
        metal_rate: read.metal_rate ?? f.metal_rate,
        value: read.value ?? f.value,
        name: f.name || [read.vendor, METALS[read.metal || 'gold']?.label].filter(Boolean).join(' — '),
      }))
      setBillNote({ ok: true, read })
    } catch (err) {
      setBillNote({ ok: false, text: err?.message || String(err) })
    } finally {
      setReading(false)
      if (billRef.current) billRef.current.value = ''
    }
  }

  const isMetal = holdsMetal(form.type)
  const addressable = hasAddress(form.type)
  const financeable = canBeFinanced(form.type)
  const leasable = canBeLeased(form.type)
  const metalDef = METALS[form.metal] || METALS.gold
  const fineness = form.metal_fineness === '' ? metalDef.defaultFineness : Number(form.metal_fineness)
  const holding =
    isMetal && form.metal_quantity !== ''
      ? valueMetalHolding({
          metal: form.metal,
          quantity: form.metal_quantity,
          unit: form.metal_unit,
          fineness,
          rate: form.metal_rate === '' ? null : form.metal_rate,
        })
      : null

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Property name is required.')
      return
    }
    if (holding?.error) {
      setError(holding.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const num = (v) => (v === '' || v == null ? null : Number(v))
      await onSubmit({
        ...form,
        // Metal details belong only to assets that are a quantity of metal.
        // Clearing them on other types stops a stale gram count trailing an
        // asset that was briefly mis-typed as jewellery.
        // An address on a car or a holding of gold is a field nobody meant to
        // fill; clearing it stops one trailing an asset that was briefly typed
        // as a flat.
        address: addressable ? form.address : null,
        metal: isMetal ? form.metal : null,
        metal_quantity: isMetal ? num(form.metal_quantity) : null,
        metal_unit: isMetal ? form.metal_unit : null,
        metal_fineness: isMetal ? num(fineness) : null,
        metal_rate: isMetal ? num(form.metal_rate) : null,
        name: form.name.trim(),
        value: num(form.value),
        monthly_budget: num(form.monthly_budget),
        // Same split as the address and the metal fields: kept while editing so
        // a mis-click survives, dropped on save so a mortgage does not trail a
        // holding of stock that was briefly typed as a flat.
        loan_principal: financeable ? num(form.loan_principal) : null,
        loan_rate: financeable ? num(form.loan_rate) : null,
        loan_tenure_months: financeable ? num(form.loan_tenure_months) : null,
        loan_start: (financeable && form.loan_start) || null,
        tenant_name: (leasable && form.tenant_name.trim()) || null,
        lease_start: (leasable && form.lease_start) || null,
        lease_end: (leasable && form.lease_end) || null,
        deposit: leasable ? num(form.deposit) : null,
      })
    } catch (err) {
      setError(err?.message || String(err))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Asset name" required>
        <Input value={form.name} onChange={set('name')} placeholder={`e.g. ${exampleNameFor(form.type)}`} autoFocus />
      </Field>

      <TypePicker value={form.type} onChange={setType} />

      <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">

        {/* Only for assets that are fixed to a place — see hasAddress. The
            value is kept in form state rather than dropped the moment the type
            changes, so a mis-click and a correction does not lose what was
            typed; it is nulled on submit instead, the same way the metal
            fields are. */}
        {addressable && (
          <Field className="sm:col-span-2" label="Address">
            <Input value={form.address} onChange={set('address')} placeholder="Street, area, city" />
          </Field>
        )}

        <Field label="Asset value" hint="Optional — purchase price or current value, used for ROI & yield">
          <Money value={form.value} onChange={set('value')} />
        </Field>

        <Field label="Monthly budget" hint="Optional — used for budget alerts on this property">
          <Money value={form.monthly_budget} onChange={set('monthly_budget')} />
        </Field>
      </div>

      {/* How much metal, and how pure — only for assets that are a quantity
          of metal rather than a single thing with a price. */}
      {isMetal && (
        <div className="border-t border-border-light pt-5">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[1.5px] text-ink-5">The metal itself</p>
          <p className="mt-1 text-xs text-ink-6">
            Weight and purity, so the value follows the market instead of being retyped. A rate buys fine metal, so a
            22K piece is worth 91.6% of it.
          </p>

          {/* The weight, purity and rate are all printed on the bill you were
              given, so typing them again is work the bill has already done. */}
          <div className="mt-3">
            <button type="button" onClick={() => billRef.current?.click()} disabled={reading} className="btn-ghost">
              {reading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {reading ? ' Reading the bill…' : ' Fill from a purchase bill'}
            </button>
            <input
              ref={billRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              aria-label="Purchase bill to read"
              onChange={(e) => readBill(e.target.files?.[0])}
            />
            {billNote?.ok === false && <p role="alert" className="mt-2 text-xs text-red-600">{billNote.text}</p>}
            {billNote?.ok && <BillSummary read={billNote.read} />}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Metal">
              <Select value={form.metal} onChange={set('metal')}>
                {METAL_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {METALS[k].label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Purity" hint="As stamped on the piece">
              <Select value={String(form.metal_fineness || metalDef.defaultFineness)} onChange={set('metal_fineness')}>
                {(PURITIES[form.metal] || PURITIES.gold).map((p) => (
                  <option key={p.fineness} value={p.fineness}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="How much you hold">
              <Input
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                value={form.metal_quantity}
                onChange={set('metal_quantity')}
                placeholder="e.g. 22.5"
              />
            </Field>

            <Field label="Measured in">
              <Select value={form.metal_unit} onChange={set('metal_unit')}>
                {UNIT_KEYS.map((u) => (
                  <option key={u} value={u}>
                    {UNITS[u].label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Market rate" hint={`${metalDef.label} ${quoteLabel(form.metal)} — optional`}>
              <div className="relative">
                <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-ink-5">
                  {currencySymbol}
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  className="ps-8"
                  value={form.metal_rate}
                  onChange={set('metal_rate')}
                  placeholder="0"
                />
              </div>
            </Field>
          </div>

          {/* What the numbers above actually come to, before it is saved. */}
          {holding && !holding.error && (
            <div className="mt-3 rounded-lg bg-surface-sunk px-3 py-2.5 text-xs">
              <p className="text-ink-4">
                {describeHolding({
                  metal: form.metal,
                  quantity: form.metal_quantity,
                  unit: form.metal_unit,
                  fineness,
                })}
              </p>
              {holding.value == null ? (
                <p className="mt-1 text-ink-6">Add a rate to see what that is worth today.</p>
              ) : (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-ink-4">
                  <span>
                    Metal value <strong className="text-ink-2">{formatCurrency(holding.value)}</strong>
                  </span>
                  <button
                    type="button"
                    className="min-h-6 rounded border border-border-light px-2 py-0.5 font-medium text-brand hover:bg-surface-raised"
                    onClick={() => setForm((f) => ({ ...f, value: String(holding.value) }))}
                  >
                    Use as asset value
                  </button>
                </p>
              )}
              <p className="mt-1 text-ink-6">
                Metal only — making charges and GST on jewellery are not recovered on resale.
              </p>
            </div>
          )}
          {holding?.error && <p className="mt-2 text-sm text-red-600">{holding.error}</p>}
        </div>
      )}

      {/* A loan against a holding of stock is a facility against the portfolio, not
          an EMI on one line of it — see canBeFinanced. */}
      {financeable && (
        <Disclosure
          title="Loan / mortgage"
          summary={emi ? `${formatCurrency(emi)} a month` : 'There is money owed against it'}
          open={open.loan}
          onToggle={toggle('loan')}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Loan amount">
              <Money value={form.loan_principal} onChange={set('loan_principal')} />
            </Field>
            <Field label="Interest rate" hint="Annual %">
              <Input type="number" inputMode="decimal" step="0.001" min="0"
                value={form.loan_rate} onChange={set('loan_rate')} placeholder="e.g. 8.5" />
            </Field>
            <Field label="Tenure" hint="Total months">
              <Input type="number" inputMode="numeric" step="1" min="0"
                value={form.loan_tenure_months} onChange={set('loan_tenure_months')} placeholder="e.g. 240" />
            </Field>
            <Field label="Start date">
              <Input type="date" value={form.loan_start} onChange={set('loan_start')} />
            </Field>
          </div>

          {/* The answer while you are still typing the question. Three numbers
              in and the form tells you what the loan costs a month, which is
              the thing you wanted to know and the reason to fill it in at all —
              rather than saving, navigating to the asset and finding out there. */}
          {emi > 0 ? (
            <p className="mt-3 rounded-lg bg-surface-sunk px-3 py-2.5 text-xs text-ink-4">
              <strong className="text-ink-2">{formatCurrency(emi)}</strong> a month for {loanYears}.{' '}
              {formatCurrency(totalPaid)} in all, {formatCurrency(interest)} of it interest.
              {ltv != null && <> The loan is {ltv}% of what the asset is worth.</>}
            </p>
          ) : (
            <p className="mt-3 text-xs text-ink-6">
              Amount, rate and tenure give you the monthly payment; the start date adds the balance and payoff
              date on the asset page.
            </p>
          )}
        </Disclosure>
      )}

      {/* Letting something out for someone else's use — see canBeLeased. Gold and
          a painting are owned, not tenanted. */}
      {leasable && (
        <Disclosure
          title="Tenancy / lease"
          summary={form.tenant_name.trim() ? `Let to ${form.tenant_name.trim()}` : 'Somebody else is using it'}
          open={open.lease}
          onToggle={toggle('lease')}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Tenant name">
              <Input value={form.tenant_name} onChange={set('tenant_name')} placeholder="e.g. Rahul Mehta" />
            </Field>
            <Field label="Deposit held">
              <Money value={form.deposit} onChange={set('deposit')} />
            </Field>
            <Field label="Lease start">
              <Input type="date" value={form.lease_start} onChange={set('lease_start')} />
            </Field>
            <Field label="Lease end">
              <Input type="date" value={form.lease_end} onChange={set('lease_end')} />
            </Field>
          </div>
          <p className="mt-3 text-xs text-ink-6">
            The dashboard nudges you as the lease end nears, so a renewal is not something you remember late.
          </p>
        </Disclosure>
      )}

      <Disclosure
        title="Notes"
        summary={form.notes.trim() ? form.notes.trim().slice(0, 60) : 'Anything worth remembering'}
        open={open.notes}
        onToggle={toggle('notes')}
      >
        <Textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Anything worth remembering" aria-label="Notes" />
      </Disclosure>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-light pt-5">
        {/* The sentence that decides whether this reads as a form or as a
            question. Everything except the name is optional, and saying so
            where the save button is means nobody sits filling boxes they were
            never obliged to fill. */}
        <p className="me-auto text-xs text-ink-6">
          {form.name.trim()
            ? 'That is enough to save. The rest can be added any time.'
            : 'Only the name is needed — everything else can wait.'}
        </p>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {initial ? 'Save changes' : 'Add asset'}
        </Button>
      </div>
    </form>
  )
}

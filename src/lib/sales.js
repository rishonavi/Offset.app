// What the company is building to sell, and what the buyers owe for it.
//
// The rest of this app is a cost ledger. This is the other side: a tower has
// flats and shops in it, they are sold one at a time over two years, and the
// money arrives in instalments tied to how far the building has got.
//
// Four things kept apart on purpose, because merging any pair is how a
// developer's books go wrong:
//
//   **Agreed is not demanded.** A flat sold for ₹1.2 crore does not mean ₹1.2
//   crore is owed today. The payment plan says what is due when.
//
//   **Demanded is not received.** A demand letter went out; the money may not
//   have come. That gap is the receivable, and it is the number a developer is
//   asked for and cannot usually produce.
//
//   **Due is not overdue.** A milestone reached last week is due; one reached
//   in March and still unpaid is a different conversation.
//
//   **Inventory is not unsold.** A flat held back for a director, one blocked
//   for a broker and one genuinely available are three different things, and
//   counting them together is how a developer thinks he has stock he cannot
//   sell.
//
// The interesting join is to `progress.js`. Construction-linked instalments
// become due when the work they name is done — "on completion of 4th slab" is
// a fact about the building, not a date — so what is due for work done is
// derived from measured progress rather than typed in by hand.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

const today = () => new Date().toISOString().slice(0, 10)

// What is being sold. A shop and a flat in the same tower are priced
// differently, sell to different buyers and are counted separately by everyone
// who asks how the project is going.
export const UNIT_KINDS = {
  flat: { id: 'flat', label: 'Flat / apartment', residential: true },
  shop: { id: 'shop', label: 'Shop', residential: false },
  office: { id: 'office', label: 'Office / commercial', residential: false },
  villa: { id: 'villa', label: 'Villa / row house', residential: true },
  plot: { id: 'plot', label: 'Plot', residential: false },
  parking: { id: 'parking', label: 'Parking', residential: false },
  other: { id: 'other', label: 'Other', residential: false },
}
export const UNIT_KIND_IDS = Object.keys(UNIT_KINDS)
export const unitKindOf = (id) => UNIT_KINDS[id] || UNIT_KINDS.other

// Where a unit stands. `available` and `held` are both unsold and are not the
// same thing: one can be sold tomorrow and the other cannot, and a developer
// who counts them together believes he has stock he does not have.
export const UNIT_STATUS = {
  available: { id: 'available', label: 'Available', sellable: true, sold: false },
  blocked: { id: 'blocked', label: 'Blocked', sellable: false, sold: false },
  held: { id: 'held', label: 'Held back', sellable: false, sold: false },
  booked: { id: 'booked', label: 'Booked', sellable: false, sold: true },
  agreement: { id: 'agreement', label: 'Agreement done', sellable: false, sold: true },
  registered: { id: 'registered', label: 'Registered', sellable: false, sold: true },
  possession: { id: 'possession', label: 'Possession given', sellable: false, sold: true },
  cancelled: { id: 'cancelled', label: 'Cancelled', sellable: true, sold: false },
}
export const UNIT_STATUS_IDS = Object.keys(UNIT_STATUS)
export const isSold = (status) => UNIT_STATUS[status]?.sold ?? false
export const isSellable = (status) => UNIT_STATUS[status]?.sellable ?? false

// Which area a price is quoted on. In India three numbers describe the same
// flat and they are not close: carpet is what you can walk on, built-up adds
// the walls, super built-up adds a share of the lobby and can be 30% more. A
// rate per square foot means nothing without saying which.
export const AREA_BASIS = {
  carpet: { id: 'carpet', label: 'Carpet area' },
  builtUp: { id: 'builtUp', label: 'Built-up area' },
  superBuiltUp: { id: 'superBuiltUp', label: 'Super built-up area' },
}
export const AREA_BASIS_IDS = Object.keys(AREA_BASIS)

export function makeUnit({
  id, entityId, projectId = null, name = '', kind = 'flat', tower = '', floor = null,
  configuration = '', carpetArea = 0, builtUpArea = 0, superBuiltUpArea = 0,
  areaBasis = 'carpet', ratePerArea = 0, agreedPrice = 0, otherCharges = 0,
  status = 'available', note = '', createdBy = null,
} = {}) {
  const carpet = Math.max(0, round2(carpetArea))
  const superArea = Math.max(0, round2(superBuiltUpArea))
  const built = Math.max(0, round2(builtUpArea))
  const basis = AREA_BASIS[areaBasis] ? areaBasis : 'carpet'
  const area = basis === 'carpet' ? carpet : basis === 'builtUp' ? built : superArea
  const rate = Math.max(0, round2(ratePerArea))
  return {
    id: id || newId(),
    entity_id: entityId,
    project_id: projectId || null,
    name: (name || 'Unnamed unit').trim().slice(0, 80),
    kind: UNIT_KINDS[kind] ? kind : 'flat',
    tower: String(tower).trim().slice(0, 40),
    floor: floor === null || floor === '' ? null : Math.round(Number(floor) || 0),
    // "2BHK", "3BHK + study", "Corner shop". What a buyer asks for.
    configuration: String(configuration).trim().slice(0, 60),
    carpet_area: carpet,
    built_up_area: built,
    super_built_up_area: superArea,
    area_basis: basis,
    rate_per_area: rate,
    // Priced from the rate when nobody typed a price, because that is how a
    // rate card works — but a negotiated price always wins, since that is what
    // the agreement says and the agreement is what is enforceable.
    agreed_price: Math.max(0, round2(agreedPrice)) || round2(area * rate),
    // Floor rise, parking, club, maintenance deposit, stamp duty. Real money
    // and not part of the unit's price, so a rate per square foot stays a rate
    // per square foot.
    other_charges: Math.max(0, round2(otherCharges)),
    status: UNIT_STATUS[status] ? status : 'available',
    note: String(note).trim().slice(0, 200),
    created_by: createdBy,
    created_at: new Date().toISOString(),
  }
}

// One instalment of a payment plan. Either tied to a stage of work or to a
// date, and the first is how Indian construction-linked plans are actually
// written: "10% on completion of 4th slab" is a fact about the building.
export function makePlanStage({
  id, unitId, entityId, label = '', percent = 0, amount = 0,
  workStage = '', triggerAt = 0, dueOn = '', sequence = 0,
} = {}) {
  return {
    id: id || newId(),
    unit_id: unitId,
    entity_id: entityId,
    label: (label || 'Instalment').trim().slice(0, 120),
    percent: Math.min(100, Math.max(0, round2(percent))),
    // A flat amount instead of a percentage, for the instalments that are one
    // — a booking amount is usually a round number, not a share.
    amount: Math.max(0, round2(amount)),
    // The stage of work this waits on, from `progress.js`. Blank means it does
    // not wait on the building at all.
    work_stage: String(workStage).trim().slice(0, 40),
    // How far that stage must have got. 100 means finished; 50 means half.
    trigger_at: Math.min(100, Math.max(0, round2(triggerAt))),
    due_on: dueOn || null,
    sequence: Math.round(Number(sequence) || 0),
  }
}

export function makeReceipt({
  id, unitId, entityId, projectId = null, date, amount = 0,
  mode = 'bank', reference = '', towards = '', note = '', createdBy = null,
} = {}) {
  return {
    id: id || newId(),
    unit_id: unitId,
    entity_id: entityId,
    project_id: projectId || null,
    date: date || today(),
    amount: Math.max(0, round2(amount)),
    mode: ['bank', 'cheque', 'cash', 'loan', 'upi'].includes(mode) ? mode : 'bank',
    reference: String(reference).trim().slice(0, 80),
    // Which instalment it was against, when anyone bothered to say. Money
    // arrives against the oldest unpaid instalment when nobody did, which is
    // how a builder's clerk actually applies it.
    towards: String(towards).trim().slice(0, 80),
    note: String(note).trim().slice(0, 200),
    created_by: createdBy,
    created_at: new Date().toISOString(),
  }
}

const stageAmount = (stage, unit) => {
  const flat = Number(stage.amount) || 0
  if (flat > 0) return round2(flat)
  return round2(((Number(unit.agreed_price) || 0) * (Number(stage.percent) || 0)) / 100)
}

// Has the work this instalment names actually been done?
//
// `stages` is what `siteProgress` returns — a percentage per stage of work —
// so this is a fact about the building rather than a date somebody typed.
const stageReached = (stage, progressStages, asOf) => {
  if (!stage.work_stage) {
    // A date and nothing else: due when the date arrives.
    //
    // With neither a stage nor a date there is nothing to wait for, and the
    // tempting default — due at once — is wrong in the direction that costs
    // something. Every plan ends with "on possession", which names no stage and
    // carries no date, and treating it as payable today would demand the last
    // instalment of every flat in the tower on day one. A developer chasing
    // money nobody owes is worse than one who has to finish the plan, so an
    // instalment with no trigger waits, and the ledger counts it so somebody
    // fixes it.
    return Boolean(stage.due_on) && stage.due_on <= (asOf || today())
  }
  const built = progressStages.find((s) => s.stage.id === stage.work_stage)
  if (!built || built.percent === null) return false
  return built.percent >= (Number(stage.trigger_at) || 100) - 0.001
}

// One unit: what was agreed, what has fallen due, what came in, what is owed.
export function unitLedger(unit, stages = [], receipts = [], { progressStages = [], asOf = null } = {}) {
  const mine = stages
    .filter((s) => s.unit_id === unit.id && !s.deleted_at)
    .slice()
    .sort((a, b) => a.sequence - b.sequence || (a.due_on || '').localeCompare(b.due_on || ''))

  const paid = receipts.filter((r) => r.unit_id === unit.id && !r.deleted_at)
  const received = round2(paid.reduce((t, r) => t + (Number(r.amount) || 0), 0))

  const agreed = round2((Number(unit.agreed_price) || 0) + (Number(unit.other_charges) || 0))

  const lines = mine.map((stage) => {
    const due = stageReached(stage, progressStages, asOf)
    return { stage, amount: stageAmount(stage, unit), due }
  })

  const demanded = round2(lines.filter((l) => l.due).reduce((t, l) => t + l.amount, 0))
  const planned = round2(lines.reduce((t, l) => t + l.amount, 0))

  // Money is applied to the oldest instalment first, which is how a builder's
  // clerk actually does it and the only rule that needs no extra data entry.
  let left = received
  const applied = lines.map((l) => {
    const against = l.due ? Math.min(left, l.amount) : 0
    left = round2(left - against)
    return { ...l, received: round2(against), outstanding: round2(l.amount - against) }
  })

  // What has fallen due and has not been paid. The number a developer is asked
  // for and usually cannot produce.
  const dueNow = round2(Math.max(0, demanded - Math.min(received, demanded)))
  const day = asOf || today()
  const overdue = round2(applied
    .filter((l) => l.due && l.outstanding > 0 && l.stage.due_on && l.stage.due_on < day)
    .reduce((t, l) => t + l.outstanding, 0))

  return {
    unit,
    lines: applied,
    agreed,
    price: round2(Number(unit.agreed_price) || 0),
    otherCharges: round2(Number(unit.other_charges) || 0),
    planned,
    // A plan that does not add up to the price is a plan that will run out or
    // over. Worth saying, because nobody checks and the last instalment is
    // where it shows.
    planGap: round2(agreed - planned),
    // Instalments waiting on nothing at all: no stage of work and no date.
    // They will never fall due on their own, so they are counted rather than
    // quietly treated as payable now or silently ignored for ever.
    untriggered: lines.filter((l) => !l.stage.work_stage && !l.stage.due_on).length,
    demanded,
    received,
    dueNow,
    overdue,
    // Not yet demanded: agreed, but the building has not reached the stage that
    // asks for it. Real money and not a receivable — confusing the two is how a
    // developer's collections look terrible or wonderful for no reason.
    notYetDue: round2(Math.max(0, agreed - demanded)),
    balance: round2(Math.max(0, agreed - received)),
    percentReceived: agreed > 0 ? Math.round((received / agreed) * 1000) / 10 : null,
    // More money in than was ever asked for. Advance payment happens; so do
    // double entries, and only one of those is good news.
    overpaid: round2(Math.max(0, received - agreed)),
    receipts: paid.length,
    sold: isSold(unit.status),
  }
}

// Every unit in the book.
export function salesReport(units = [], stages = [], receipts = [], { entityId = null, projectId = undefined, progressStages = [], asOf = null } = {}) {
  const mine = units
    .filter((u) => !u.deleted_at)
    .filter((u) => !entityId || u.entity_id === entityId)
    .filter((u) => projectId === undefined || u.project_id === projectId)

  const lines = mine.map((u) => unitLedger(u, stages, receipts, { progressStages, asOf }))
  const sum = (rows, pick) => round2(rows.reduce((t, l) => t + (pick(l) || 0), 0))
  const sold = lines.filter((l) => l.sold)
  const available = lines.filter((l) => isSellable(l.unit.status))
  const heldBack = lines.filter((l) => !l.sold && !isSellable(l.unit.status))

  return {
    lines: lines.sort((a, b) =>
      b.overdue - a.overdue || b.dueNow - a.dueNow || (a.unit.name || '').localeCompare(b.unit.name || '')),
    count: lines.length,

    // Inventory. `available` and `heldBack` are both unsold and are not the
    // same thing: one can be sold tomorrow and the other cannot.
    sold: sold.length,
    available: available.length,
    heldBack: heldBack.length,
    soldValue: sum(sold, (l) => l.agreed),
    availableValue: sum(available, (l) => l.agreed),
    // Area, because a developer counts stock in square feet as often as in
    // flats, and eight one-bedrooms are not eight penthouses.
    soldArea: round2(sold.reduce((t, l) => t + (Number(l.unit.carpet_area) || 0), 0)),
    availableArea: round2(available.reduce((t, l) => t + (Number(l.unit.carpet_area) || 0), 0)),

    // Money, on the sold units only: an unsold flat owes nothing.
    agreed: sum(sold, (l) => l.agreed),
    demanded: sum(sold, (l) => l.demanded),
    received: sum(sold, (l) => l.received),
    dueNow: sum(sold, (l) => l.dueNow),
    overdue: sum(sold, (l) => l.overdue),
    notYetDue: sum(sold, (l) => l.notYetDue),
    balance: sum(sold, (l) => l.balance),
    overpaid: sum(sold, (l) => l.overpaid),
    percentReceived: sum(sold, (l) => l.agreed) > 0
      ? Math.round((sum(sold, (l) => l.received) / sum(sold, (l) => l.agreed)) * 1000) / 10
      : null,
    unitsOverdue: sold.filter((l) => l.overdue > 0).length,
    unitsWithGap: lines.filter((l) => Math.abs(l.planGap) > 1).length,
    untriggered: lines.reduce((t, l) => t + l.untriggered, 0),
  }
}

// Sales against construction, as one sentence.
//
// A tower 70% sold and 30% built is a company holding other people's money; one
// 30% sold and 70% built is a company funding a building nobody has bought. The
// two are opposite problems and both look like progress on their own.
export function salesAgainstBuild(report, built) {
  const sold = report.count > 0 ? Math.round((report.sold / report.count) * 1000) / 10 : null
  if (sold === null || built === null || built === undefined) {
    return { sold, built: built ?? null, known: false, why: 'Both a sales book and a measured schedule are needed.' }
  }
  const gap = Math.round((sold - built) * 10) / 10
  return {
    sold,
    built,
    gap,
    known: true,
    aheadOfBuild: gap > 10,
    behindBuild: gap < -10,
    why: gap > 10
      ? `${gap}% more is sold than built — the money is other people's until it is delivered.`
      : gap < -10
        ? `${Math.abs(gap)}% more is built than sold — the company is funding it.`
        : 'Selling and building are keeping pace.',
  }
}

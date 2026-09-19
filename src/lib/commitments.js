// What is already promised, and what is already owed.
//
// A ledger answers "what has this cost". A builder's question is the one
// before it: *what have I already agreed to spend that has not reached the
// books yet*. A work order signed for ₹1.8 crore with ₹60 lakh certified is
// ₹1.2 crore of cost that has not happened and cannot be stopped; an accepted
// quotation is a lorry-load the company has committed to buy. Neither is an
// expense, so neither appears anywhere in the accounts, and both are spent.
//
// Three horizons, and the mistake is folding them into one number:
//
//   **Committed** — agreed, not yet incurred. It will become cost. It is not
//   cash due today and putting it in a cash figure makes a solvent company look
//   bankrupt.
//   **Due** — incurred, not yet settled. Cash, this month.
//   **Coming** — contracted to arrive. Instalments that have fallen due, bills
//   certified to a client and not paid, retention past its release date.
//
// The one arithmetic caution worth stating: the operational ledgers here (work
// orders, stock, plant, muster) are parallel to the money ledger, not inside
// it. Nothing in this app turns an RA bill into an expense, and `projectReport`
// already adds the two together on that understanding. A company that also keys
// its contractors' bills into Expenses by hand will see the same money twice —
// there, here, and in every job cost — and the answer is to stop keying it
// twice rather than to guess at which copy to drop.
import { subcontractReport, retentionBook, round2 } from './subcontract'
import { quoteTotals, quoteState } from './quotes'
import { salesReport } from './sales'
import { siteProgress } from './progress'
import { ageing } from './payables'
import { madeOf } from './certainty'
import { todayISO } from './today'

// A bill that has been certified is owed. A draft has not been agreed yet and
// a paid one is finished, so neither is money waiting to move.
const OWED = (bill) => bill.status === 'certified'

// What one side of the contract book is carrying.
function contractSide(orders, bills, { entityId, asOf, side, projectId }) {
  const report = subcontractReport(orders, bills, { entityId, projectId, side })
  const open = report.lines.filter((l) => l.order.status !== 'closed')
  const sum = (rows, pick) => round2(rows.reduce((t, l) => t + (pick(l) || 0), 0))

  return {
    count: report.count,
    certified: report.certified,
    // Agreed and not yet done. Only on open orders: a closed order's unspent
    // value is a saving, not a commitment, and counting it would report a
    // company as owing money on work nobody is going to do.
    remaining: sum(open, (l) => (l.orderValue > 0 ? Math.max(0, l.orderValue - l.certifiedToDate) : 0)),
    // An order priced per unit with no value on it commits a real amount that
    // nobody has written down. Counted as a number of contracts rather than
    // folded into the total as a zero, because a zero reads as "nothing left".
    unvalued: open.filter((l) => !(l.orderValue > 0)).length,
    // Certified, not paid. The net figure, because retention and TDS do not
    // leave the bank.
    unpaid: sum(report.lines, (l) =>
      l.lines.filter((r) => OWED(r.bill)).reduce((t, r) => t + r.net, 0)),
    retentionDue: retentionBook(orders, bills, { entityId, side, asOf }).due,
  }
}

export function commitments(books = {}, { entityId = null, asOf = null, projectId = undefined } = {}) {
  const {
    workOrders = [], raBills = [], quotes = [], units = [], planStages = [], receipts = [],
    expenses = [], income = [],
  } = books
  const day = asOf || todayISO()

  const sub = contractSide(workOrders, raBills, { entityId, asOf: day, side: 'sub', projectId })
  const client = contractSide(workOrders, raBills, { entityId, asOf: day, side: 'client', projectId })

  // An accepted quotation the company has not taken delivery against. The
  // stamp is what tells them apart, and it is the same stamp that stops the
  // same lorry being added to stock twice.
  const openOrders = quotes
    .filter((q) => !q.deleted_at)
    .filter((q) => !entityId || q.entity_id === entityId)
    .filter((q) => projectId === undefined || (projectId === null ? !q.project_id : q.project_id === projectId))
    .filter((q) => quoteState(q, day) === 'accepted' && !q.received_at)
    .map((q) => ({ quote: q, ...quoteTotals(q) }))
  const materials = {
    count: openOrders.length,
    // Inclusive of tax, because that is what leaves the bank. The input credit
    // comes back later and from somebody else.
    ordered: round2(openOrders.reduce((t, o) => t + o.total, 0)),
    net: round2(openOrders.reduce((t, o) => t + o.subtotal, 0)),
    tax: round2(openOrders.reduce((t, o) => t + o.tax, 0)),
    lines: openOrders.sort((a, b) => b.total - a.total),
  }

  const payable = ageing(expenses, { kind: 'payable', asOf: day, entityId })
  const receivable = ageing(income, { kind: 'receivable', asOf: day, entityId })

  // Sales, a site at a time, because an instalment falls due when a stage of
  // *that* building is finished. Asking for every unit at once with one list of
  // completed stages would trigger a demand on the villas because the tower
  // reached its eighth slab — and `salesReport` cannot notice, since it is
  // handed the stages rather than working them out.
  const sold = units
    .filter((u) => !u.deleted_at)
    .filter((u) => !entityId || u.entity_id === entityId)
    .filter((u) => projectId === undefined || (projectId === null ? !u.project_id : u.project_id === projectId))
  const sites = [...new Set(sold.map((u) => u.project_id ?? null))]
  const book = { dueNow: 0, overdue: 0, notYetDue: 0, balance: 0, untriggered: 0 }
  for (const site of sites) {
    const items = (books.workItems || [])
      .filter((i) => (!entityId || i.entity_id === entityId) && (i.project_id ?? null) === site)
    const stages = siteProgress(items, books.measurements || []).stages
    const r = salesReport(units, planStages, receipts, { entityId, projectId: site, progressStages: stages, asOf: day })
    book.dueNow = round2(book.dueNow + r.dueNow)
    book.overdue = round2(book.overdue + r.overdue)
    book.notYetDue = round2(book.notYetDue + r.notYetDue)
    book.balance = round2(book.balance + r.balance)
    book.untriggered += r.untriggered
  }

  // Cash, this month.
  const dueOut = round2(payable.total + sub.unpaid + sub.retentionDue)
  const dueIn = round2(receivable.total + book.dueNow + client.unpaid + client.retentionDue)
  // Agreed, not yet incurred. Deliberately kept out of the cash figures above.
  const committed = round2(sub.remaining + materials.ordered)

  return {
    asOf: day,
    subcontract: sub,
    client,
    materials,
    payable,
    receivable,
    sales: { ...book, sites: sites.length },

    committed,
    dueOut,
    dueIn,
    // The question a director asks: if everything due came in and everything
    // due went out, where would we be.
    gap: round2(dueIn - dueOut),
    // And the same thing as a ratio, because a ₹4 lakh gap means one thing on
    // ₹5 lakh of outgoings and another on ₹5 crore.
    cover: dueOut > 0 ? Math.round((dueIn / dueOut) * 100) / 100 : null,
    // Everything agreed, whenever it lands. The number that says whether the
    // gap above is the whole story or the first month of it.
    committedAndDue: round2(committed + dueOut),
    // True when a commitment exists that nobody has put a figure to, so a
    // reader knows the total is a floor rather than the answer.
    incomplete: sub.unvalued > 0 || client.unvalued > 0,

    // How each of the three was arrived at. Declared here rather than decided
    // by whichever screen happens to print it, because the answer is a property
    // of the arithmetic and not of the layout — and because a total is only as
    // certain as its least certain part.
    certainty: {
      committed: madeOf({
        'work orders outstanding': 'agreed',
        'deliveries accepted': 'agreed',
      }),
      dueOut: madeOf({
        'bills unpaid': 'recorded',
        'bills certified and not paid': 'recorded',
        'retention past its release date': 'recorded',
      }),
      dueIn: madeOf({
        'invoices awaited': 'recorded',
        'instalments that have fallen due': 'recorded',
        'retention the client owes back': 'recorded',
      }),
      // Agreed money and recorded money added together is agreed money, which
      // is the whole reason the three are never shown as one figure.
      committedAndDue: madeOf({ committed: 'agreed', 'owed now': 'recorded' }),
    },
  }
}

// One sentence for a card, because a number with no sentence gets read as
// whatever the reader already believed.
export function describeGap(c) {
  if (!c) return ''
  if (c.dueOut <= 0 && c.dueIn <= 0) return 'Nothing due in either direction.'
  if (c.gap >= 0) {
    return `Everything due covers everything owed${c.committed > 0 ? ', before the work already agreed' : ''}.`
  }
  return c.committed > 0
    ? 'More is owed than is due in, and that is before the work already agreed.'
    : 'More is owed than is due in.'
}

// Export income & expenses as Tally-importable XML vouchers.
//
// The output is the standard Tally "Import Data → Vouchers" envelope. In
// TallyPrime: Gateway of Tally → Import → Vouchers → pick this file. Expenses
// become Payment vouchers (expense ledger debited, Cash/Bank credited) and
// income becomes Receipt vouchers (income ledger credited, Cash/Bank debited).
// Tally's amount convention: debits are negative, credits positive.

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const tallyDate = (iso) => (iso || '').replace(/-/g, '') // YYYY-MM-DD → YYYYMMDD
const money = (n) => (Number(n) || 0).toFixed(2)

// Map a payment method to the balancing cash/bank ledger.
const counterLedgerFor = (pm) => (!pm || pm === 'Cash' || pm === 'Other' ? 'Cash' : 'Bank')

function voucher({ type, date, number, narration, ledger, counter, amount, debitLedger }) {
  const amt = money(amount)
  // debitLedger=true → primary ledger is debited (Payment/expense); else credited (Receipt/income).
  const primary = debitLedger ? { dp: 'Yes', amt: '-' + amt } : { dp: 'No', amt }
  const balancing = debitLedger ? { dp: 'No', amt } : { dp: 'Yes', amt: '-' + amt }
  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="${esc(type)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
      <DATE>${tallyDate(date)}</DATE>
      <VOUCHERTYPENAME>${esc(type)}</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${number}</VOUCHERNUMBER>
      <NARRATION>${esc(narration)}</NARRATION>
      <PARTYLEDGERNAME>${esc(counter)}</PARTYLEDGERNAME>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${esc(ledger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>${primary.dp}</ISDEEMEDPOSITIVE>
       <AMOUNT>${primary.amt}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${esc(counter)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>${balancing.dp}</ISDEEMEDPOSITIVE>
       <AMOUNT>${balancing.amt}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
     </VOUCHER>
    </TALLYMESSAGE>`
}

export function toTallyXML({ expenses = [], income = [], propertyNameById = () => '', company = 'Offset' } = {}) {
  const messages = []
  let n = 0
  for (const e of expenses) {
    n++
    messages.push(
      voucher({
        type: 'Payment',
        date: e.date,
        number: n,
        narration: [e.category, e.vendor, propertyNameById(e.property_id)].filter(Boolean).join(' · '),
        ledger: e.category || 'Expenses',
        counter: counterLedgerFor(e.payment_method),
        amount: e.amount,
        debitLedger: true,
      }),
    )
  }
  for (const e of income) {
    n++
    messages.push(
      voucher({
        type: 'Receipt',
        date: e.date,
        number: n,
        narration: [e.source, e.payer, propertyNameById(e.property_id)].filter(Boolean).join(' · '),
        ledger: e.source || 'Income',
        counter: counterLedgerFor(e.payment_method),
        amount: e.amount,
        debitLedger: false,
      }),
    )
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
${messages.join('\n')}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>`
}

// Putting a document on paper.
//
// Deliberately thin. Everything worth getting right — what a certificate says,
// what a demand letter demands, the amount in words — is worked out in
// `siteDocs.js` and tested there. This lays out whatever that produced, which
// is why one function covers all six.
//
// jspdf and its table plugin are a few hundred kilobytes, so nothing here loads
// until somebody asks for a file.

import { formatCurrency } from './format'

// CommonJS reached through a dynamic import comes back wrapped, and how many
// times depends on the package and the bundler: `ns.default` is sometimes the
// function and sometimes the module object with the function inside it. The
// pages that load these statically get one layer unwrapped for free, which is
// why the same `.default || module` line works there and not here. So unwrap
// until there is something callable, and say so plainly if there never is.
const callable = (module_, name) => {
  let found = module_
  for (let i = 0; i < 4 && found && typeof found !== 'function'; i += 1) found = found.default
  if (typeof found !== 'function') throw new Error(`${name} did not load, so there is nothing to make a PDF with.`)
  return found
}

let libs
const load = () =>
  (libs ||= Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([pdf, table]) => ({
    jsPDF: callable(pdf, 'The PDF library'),
    autoTable: callable(table, 'The PDF table plugin'),
  })))

const INK = [10, 24, 40]
const isMoney = (v) => typeof v === 'number'
const cell = (v) => (isMoney(v) ? formatCurrency(v) : v === null || v === undefined ? '' : String(v))

export async function documentToPDF(document_, { filename = null } = {}) {
  if (!document_) throw new Error('There is nothing to print.')
  const { jsPDF, autoTable } = await load()
  const doc = new jsPDF()
  const W = doc.internal.pageSize.getWidth()
  let y = 18

  doc.setFontSize(14)
  doc.setTextColor(...INK)
  doc.text(document_.company.name, 14, y)
  doc.setFontSize(9)
  doc.setTextColor(120)
  const sub = [document_.company.gstin && `GSTIN ${document_.company.gstin}`, document_.company.address]
    .filter(Boolean).join(' · ')
  if (sub) { y += 5; doc.text(sub, 14, y) }

  // The title on the right, so a stack of these can be riffled through.
  doc.setFontSize(12)
  doc.setTextColor(...INK)
  doc.text(document_.title, W - 14, 18, { align: 'right' })
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(document_.date, W - 14, 23, { align: 'right' })
  if (document_.reference) doc.text(document_.reference, W - 14, 28, { align: 'right' })

  y += 10
  if (document_.to) {
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text('To', 14, y)
    doc.setTextColor(...INK)
    doc.setFontSize(11)
    y += 5
    doc.text(document_.to.name || '', 14, y)
    if (document_.to.address) { y += 5; doc.setFontSize(9); doc.setTextColor(120); doc.text(String(document_.to.address).slice(0, 90), 14, y) }
    y += 6
  }

  if (document_.meta.length) {
    autoTable(doc, {
      startY: y,
      body: document_.meta.map((m) => [m.label, cell(m.value)]),
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 1.2 },
      columnStyles: { 0: { textColor: 120 }, 1: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: 14, right: W / 2 },
    })
    y = doc.lastAutoTable.finalY + 6
  }

  for (const section of document_.sections) {
    if (!section.rows?.length) continue
    autoTable(doc, {
      startY: y,
      head: section.title ? [[{ content: section.title, colSpan: section.columns.length, styles: { halign: 'left' } }], section.columns] : [section.columns],
      body: section.rows.map((r) => r.map(cell)),
      foot: section.totals?.map((t) => t.map(cell)),
      styles: { fontSize: 9 },
      headStyles: { fillColor: INK },
      footStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: 'bold' },
      // Money right, words left. A column of figures that does not line up is a
      // column nobody can add in their head.
      columnStyles: Object.fromEntries(
        section.columns.map((_, i) => [i, { halign: section.rows.some((r) => isMoney(r[i])) ? 'right' : 'left' }]),
      ),
      margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 6
  }

  if (document_.notes.length) {
    doc.setFontSize(9)
    doc.setTextColor(60)
    for (const note of document_.notes) {
      if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 20 }
      const lines = doc.splitTextToSize(note, W - 28)
      doc.text(lines, 14, y)
      y += lines.length * 4.5 + 2
    }
    y += 4
  }

  // Signatures last, and on the page they finish on rather than a fresh one:
  // a signature block alone on page three is a page people lose.
  if (document_.signatures.length) {
    if (y > doc.internal.pageSize.getHeight() - 35) { doc.addPage(); y = 20 }
    y += 14
    const span = (W - 28) / document_.signatures.length
    doc.setDrawColor(180)
    doc.setFontSize(8)
    doc.setTextColor(120)
    document_.signatures.forEach((s, i) => {
      const x = 14 + i * span
      doc.line(x, y, x + span - 10, y)
      doc.text(s.label, x, y + 4)
    })
  }

  const name = filename || `${document_.kind}-${document_.date}.pdf`
  doc.save(name)
  return name
}

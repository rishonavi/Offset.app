// Turning a rendered invoice into a PDF and into a print job.
//
// The template is the user's own HTML, so the PDF has to look like *their*
// document rather than like something re-laid-out by a PDF library. The page is
// rendered in an offscreen iframe — which keeps the template's CSS from
// colliding with the app's — photographed with html2canvas, and paginated onto
// A4 or Letter.
//
// jspdf and html2canvas are ~700KB between them, so nothing here is imported
// until someone actually asks for a file.

let libs
const loadLibs = () =>
  (libs ||= Promise.all([import('jspdf'), import('html2canvas')]).then(([pdf, h2c]) => ({
    jsPDF: pdf.default,
    html2canvas: h2c.default || h2c,
  })))

// mm, portrait.
const PAPER = { a4: [210, 297], letter: [215.9, 279.4] }

// The iframe is the isolation boundary: the template's styles apply to it and
// nothing else, and it is removed whether or not rendering worked.
async function withRenderedFrame(documentHtml, width, fn) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('title', 'Invoice render')
  // Offscreen rather than display:none — a hidden element has no layout, and
  // no layout means nothing to photograph.
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:1200px;border:0;visibility:hidden;`
  document.body.appendChild(frame)
  try {
    const doc = frame.contentDocument
    doc.open()
    doc.write(documentHtml)
    doc.close()
    // Let fonts and layout settle before measuring.
    await new Promise((r) => setTimeout(r, 60))
    if (doc.fonts?.ready) await doc.fonts.ready.catch(() => {})
    return await fn(doc, frame)
  } finally {
    frame.remove()
  }
}

export async function invoiceToPDF(documentHtml, { filename = 'invoice.pdf', paper = 'a4', scale = 2 } = {}) {
  const { jsPDF, html2canvas } = await loadLibs()
  const [pw, ph] = PAPER[paper] || PAPER.a4
  // 96 CSS px per inch, 25.4mm per inch — render at the paper's own width so
  // the template's mm/percentage widths land where the author meant them to.
  const pxWidth = Math.round(((pw - 24) / 25.4) * 96)

  const canvas = await withRenderedFrame(documentHtml, pxWidth, async (doc) =>
    html2canvas(doc.body, { scale, backgroundColor: '#ffffff', logging: false, windowWidth: pxWidth }),
  )

  const pdf = new jsPDF({ unit: 'mm', format: paper === 'letter' ? 'letter' : 'a4' })
  const margin = 12
  const usableW = pw - margin * 2
  const usableH = ph - margin * 2
  // How tall a full page is in canvas pixels, at the scale the image will be
  // placed. Slicing here rather than letting jsPDF overflow is what keeps a
  // two-page invoice from losing the join.
  const pageHeightPx = Math.floor((usableH * canvas.width) / usableW)

  let offset = 0
  let first = true
  while (offset < canvas.height) {
    const sliceHeight = Math.min(pageHeightPx, canvas.height - offset)
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = sliceHeight
    const ctx = slice.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, slice.width, slice.height)
    ctx.drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight)

    if (!first) pdf.addPage()
    pdf.addImage(
      slice.toDataURL('image/jpeg', 0.92),
      'JPEG',
      margin,
      margin,
      usableW,
      (sliceHeight * usableW) / canvas.width,
    )
    first = false
    offset += sliceHeight
  }

  pdf.save(filename)
  return { pages: pdf.getNumberOfPages() }
}

// The other route to a PDF, and the better one where it's available: the
// browser's own print pipeline keeps the text as text — selectable, searchable
// and a fraction of the size — and honours the template's @page rules.
export function printInvoice(documentHtml) {
  const frame = document.createElement('iframe')
  frame.setAttribute('title', 'Invoice print')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  doc.open()
  doc.write(documentHtml)
  doc.close()
  const done = () => setTimeout(() => frame.remove(), 1000)
  setTimeout(() => {
    try {
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } finally {
      done()
    }
  }, 120)
}

export function downloadHtml(documentHtml, filename = 'invoice.html') {
  const blob = new Blob([documentHtml], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

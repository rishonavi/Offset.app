// On-device receipt reading (OCR) for images + PDFs. The heavy libraries are
// imported dynamically so they only download when the user actually scans.
//
// authHeader is a static import rather than a dynamic one because it is a few
// lines and defers Supabase itself; this whole module is already behind a
// dynamic import from the forms, so nothing here loads before a scan anyway.

import { authHeaders } from './authHeader'

function pad(n) {
  return String(n).padStart(2, '0')
}

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

async function ocrImage(image, onProgress) {
  const Tesseract = (await import('tesseract.js')).default
  const { data } = await Tesseract.recognize(image, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(m.progress || 0)
    },
  })
  return data?.text || ''
}

async function loadPdfjs() {
  const pdfjsLib = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjsLib
}

async function extractPdfText(file) {
  try {
    const pdfjsLib = await loadPdfjs()
    const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
    let text = ''
    const pages = Math.min(doc.numPages, 5)
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      text += content.items.map((it) => it.str).join(' ') + '\n'
    }
    return text
  } catch {
    return ''
  }
}

async function renderPdfFirstPage(file) {
  try {
    const pdfjsLib = await loadPdfjs()
    const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
    const page = await doc.getPage(1)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    return canvas
  } catch {
    return null
  }
}

// Returns the raw text read from a receipt file (image or PDF).
export async function extractText(file, onProgress) {
  const type = file.type || ''
  const name = (file.name || '').toLowerCase()
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    const text = await extractPdfText(file)
    if (text.replace(/\s/g, '').length > 20) return text // text-based PDF
    const canvas = await renderPdfFirstPage(file) // scanned PDF → OCR
    if (canvas) return ocrImage(canvas, onProgress)
    return text
  }
  return ocrImage(file, onProgress)
}

function guessDate(text) {
  let m = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/)
  if (m) {
    let [, d, mo, y] = m
    if (+mo > 12 && +d <= 12) [d, mo] = [mo, d] // tolerate m/d/y order
    if (+mo > 12) return null
    if (y.length === 2) y = '20' + y
    return `${y}-${pad(mo)}-${pad(d)}`
  }
  m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{2,4})\b/)
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (mo) {
      let y = m[3]
      if (y.length === 2) y = '20' + y
      return `${y}-${mo}-${pad(m[1])}`
    }
  }
  return null
}

function guessAmount(lines) {
  const moneyRe = /(?:₹|rs\.?|inr|\$|usd)?\s*([0-9][0-9,]*\.[0-9]{2}|[0-9][0-9,]{2,})/gi
  const candidates = []
  for (const line of lines) {
    const lower = line.toLowerCase()
    const weight = /grand\s*total|amount\s*due|balance\s*due|amount payable|net amount/.test(lower)
      ? 3
      : /total|amount|subtotal/.test(lower)
        ? 2
        : 1
    let m
    while ((m = moneyRe.exec(line))) {
      const val = parseFloat(m[1].replace(/,/g, ''))
      if (!isNaN(val) && val > 0 && val < 1e9) candidates.push({ val, weight })
    }
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => b.weight - a.weight || b.val - a.val)
  return candidates[0].val
}

function guessVendor(lines) {
  const skip = /total|invoice|receipt|gst|tax|date|amount|bill|tel|phone|www\.|http|@|order|cash|change|qty|subtotal/i
  const v = lines.find((l) => /[a-z]/i.test(l) && !skip.test(l) && l.replace(/[^a-z]/gi, '').length >= 3)
  return v ? v.replace(/\s+/g, ' ').trim().slice(0, 60) : null
}

// Last money-looking number on a line, ignoring percentages (e.g. "18%").
function amountOnLine(line) {
  const cleaned = line.replace(/\d+(?:\.\d+)?\s*%/g, ' ')
  const nums = [...cleaned.matchAll(/([0-9][0-9,]*\.[0-9]{2}|[0-9][0-9,]{1,})/g)]
    .map((m) => parseFloat(m[1].replace(/,/g, '')))
    .filter((n) => !isNaN(n) && n > 0)
  return nums.length ? nums[nums.length - 1] : null
}

// Pull out the tax/GST amount. Sums CGST+SGST when itemised; else IGST/GST/VAT/Tax.
function guessTax(lines) {
  let cgst = null
  let sgst = null
  let igst = null
  let generic = null
  for (const line of lines) {
    const l = line.toLowerCase()
    if (/cgst/.test(l)) cgst = amountOnLine(line) ?? cgst
    else if (/sgst|utgst/.test(l)) sgst = amountOnLine(line) ?? sgst
    else if (/igst/.test(l)) igst = amountOnLine(line) ?? igst
    else if (/\b(gst|vat|tax)\b/.test(l) && !/total|without|excl/.test(l)) generic = amountOnLine(line) ?? generic
  }
  if (igst) return igst
  if (cgst || sgst) return (cgst || 0) + (sgst || 0)
  return generic
}

// Best-effort structured fields from receipt text. The user verifies/edits.
export function parseReceipt(text) {
  const out = { amount: null, date: null, vendor: null, tax: null, category: null }
  if (!text) return out
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  out.amount = guessAmount(lines)
  out.date = guessDate(text)
  out.vendor = guessVendor(lines)
  out.tax = guessTax(lines)
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// AI-assisted scanning — sends the receipt to a Gemini vision model server-side
// (api/scan-receipt) for far more accurate reading, with on-device OCR as a
// graceful fallback when the API isn't configured / reachable / the file is too
// large.
// ───────────────────────────────────────────────────────────────────────────

const AI_ENDPOINT = '/api/scan-receipt'
const MAX_B64_BYTES = 4_400_000 // stay under Vercel's ~4.5 MB request-body limit

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}

// Downscale a photo and re-encode as JPEG so the upload is small and quick.
async function imageToBase64(file, maxDim = 1600) {
  try {
    const img = await loadImage(file)
    let { width, height } = img
    const scale = Math.min(1, maxDim / Math.max(width, height || 1))
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(img, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    return { media_type: 'image/jpeg', data: dataUrl.split(',')[1] }
  } catch {
    // Couldn't decode (e.g. HEIC) — send the original bytes as-is.
    const data = arrayBufferToBase64(await file.arrayBuffer())
    return { media_type: file.type || 'image/jpeg', data }
  }
}

async function prepareForUpload(file) {
  const type = file.type || ''
  const name = (file.name || '').toLowerCase()
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    const data = arrayBufferToBase64(await file.arrayBuffer())
    if (data.length > MAX_B64_BYTES) return null
    return { kind: 'document', media_type: 'application/pdf', data }
  }
  const img = await imageToBase64(file)
  if (!img?.data || img.data.length > MAX_B64_BYTES) return null
  return { kind: 'image', media_type: img.media_type, data: img.data }
}

// Returns { data, error }: data is the parsed fields (or null), error is a
// short reason code when the AI reader couldn't be used (so the UI can explain
// why it fell back to OCR).
async function scanWithAI(file, kind) {
  const payload = await prepareForUpload(file)
  if (!payload) return { data: null, error: 'too_big' } // file too large → OCR
  if (kind) payload.kind = kind
  // The token lets the server attribute the scan to the user where plan limits
  // are enforced, and is harmless otherwise. This was a hand-rolled copy of
  // authHeaders() — two versions of "how do we authenticate" is one too many.
  const headers = await authHeaders()
  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  if (res.status === 501) return { data: null, error: 'not_configured' }
  if (res.status === 429) return { data: null, error: 'scan_limit_reached' }
  if (!res.ok) return { data: null, error: `http_${res.status}` }
  const d = await res.json().catch(() => null)
  if (!d) return { data: null, error: 'bad_response' }
  const hit = kind === 'metal'
    ? d.metal || d.net_weight_g != null || d.gross_weight_g != null || d.rate_amount != null || d.total != null
    : d.amount != null || d.tax != null || d.date || d.vendor || d.category
  if (!hit) return { data: null, error: 'no_fields' }
  // A metal bill's fields are a different set entirely, and narrowing them to
  // the expense shape here would drop every one of them — leaving a reading
  // that looks successful and contains no metal.
  if (kind === 'metal') return { data: d, error: null }
  return {
    data: {
      amount: d.amount ?? null,
      tax: d.tax ?? null,
      date: d.date || null,
      vendor: d.vendor || null,
      category: d.category || null,
    },
    error: null,
  }
}

// Public entry point used by the forms. Tries the accurate AI vision reader
// first, then falls back to on-device OCR + heuristics. Always resolves with
// { amount, tax, date, vendor, category, source, aiError }.
export async function scanReceipt(file, onProgress) {
  let aiError = null
  try {
    const { data, error } = await scanWithAI(file)
    if (data) return { ...data, source: 'ai', aiError: null }
    aiError = error
  } catch {
    aiError = 'network' // /api unreachable, blocked, or returned non-JSON
  }
  const text = await extractText(file, onProgress)
  return { ...parseReceipt(text), source: 'ocr', aiError }
}

// Human-readable note about which reader was used, shown under the scan button.
export function scanSourceNote(parsed) {
  if (parsed.source === 'ai') return 'Read by Google Gemini.'
  switch (parsed.aiError) {
    case 'not_configured':
      return 'Used basic OCR — add the Gemini key in Vercel (then redeploy) for accurate AI scans.'
    case 'too_big':
      return 'File too large for AI — used basic OCR. Try a smaller photo.'
    case 'network':
      return 'AI reader unreachable — used basic OCR. Check the deployment / API route.'
    case 'no_fields':
      return 'AI couldn’t read this one — used basic OCR.'
    default:
      return 'AI reader unavailable — used basic OCR.'
  }
}

// Reading a jeweller's or bullion bill, for the metal fields on an asset.
//
// Unlike scanReceipt there is no on-device fallback. The OCR path parses an
// expense receipt — a total, a date, a vendor — and has no notion of a net
// weight or a rate basis. Handing back a confident-looking half answer from it
// would be worse than saying the reader is not available, because the numbers
// it does produce would look like metal facts.
export async function scanMetalBill(file) {
  try {
    const { data, error } = await scanWithAI(file, 'metal')
    if (data) return { data, error: null }
    return { data: null, error: error || 'no_fields' }
  } catch {
    return { data: null, error: 'network' }
  }
}

// Why a metal bill could not be read, in words someone can act on.
export function metalScanNote(error) {
  switch (error) {
    case 'not_configured':
      return 'Reading bills needs the Gemini key set on the deployment. Fill the metal fields in by hand for now.'
    case 'too_big':
      return 'That file is too large to read. Try a smaller photo.'
    case 'scan_limit_reached':
      return 'You have used this month’s AI scans — upgrade to Pro for unlimited (Settings).'
    case 'network':
      return 'The reader could not be reached. Fill the metal fields in by hand.'
    case 'no_fields':
      return 'Nothing on that looked like a metal purchase. Fill the fields in by hand.'
    default:
      return 'That bill could not be read. Fill the metal fields in by hand.'
  }
}

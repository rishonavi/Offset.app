// Measuring what the interface actually looks like, rather than trusting it.
//
// Two things make this harder than it first appears.
//
// **Canvas fillStyle is not a colour converter.** Chromium accepts `oklch()`
// and hands the same `oklch()` string straight back, so a checker that pulls
// the digits out of it is reading L, C and H as though they were R, G and B.
// That scores slate-600 on white at 2.47:1 when it is really 8.5:1 — and every
// palette colour Tailwind v4 emits is `oklch()`, with `oklab()` for anything
// carrying an alpha modifier. Painting the colour onto a canvas and reading the
// pixel back is the normalisation that actually holds.
//
// **The colour behind a piece of text is often not a declared colour at all.**
// The page ground is a gradient, cards are translucent, and one of them sits
// behind a backdrop-blur. Walking up the DOM for the first painted ancestor
// invents an answer in all three cases. So the backdrop is read from a
// screenshot taken with every glyph made invisible: whatever is genuinely
// painted where the text sits, gradients, translucency and blur included.

// Installed into the page. `srgb` paints a stack of colours bottom-most first,
// the way the browser layers them, and returns unpremultiplied [r, g, b, a].
export function installColour () {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const g = cv.getContext('2d', { willReadFrequently: true })
  const srgb = (stack) => {
    g.clearRect(0, 0, 1, 1)
    for (const c of [].concat(stack)) { g.fillStyle = c; g.fillRect(0, 0, 1, 1) }
    return [...g.getImageData(0, 0, 1, 1).data]
  }
  const lum = ([r, gr, b]) => [r, gr, b]
    .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
    .reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * v, 0)
  const ratio = (fg, bg) => {
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a)
    return (hi + 0.05) / (lo + 0.05)
  }
  window.__colour = { srgb, lum, ratio }
  // The older names, kept so a suite can ask for one colour without a backdrop.
  window.__rgb = (c) => srgb(c).slice(0, 3)
  window.__lum = (c) => lum(srgb(c))
  window.__alpha = (c) => srgb(c)[3] / 255
}

// Every glyph made invisible — including placeholders, which are painted by a
// pseudo-element and ignore a plain `color` override, and text shadows, which
// would otherwise tint the pixel we are about to sample.
const HIDE = `*,*::before,*::after,*::first-line,*::first-letter{
  color:transparent!important;-webkit-text-fill-color:transparent!important;
  text-shadow:none!important;text-decoration-color:transparent!important}
*::placeholder{color:transparent!important;-webkit-text-fill-color:transparent!important}
::selection{background:transparent!important}`

// The colours actually painted at each point, given in document coordinates.
// One screenshot covers the whole batch, so asking about forty elements costs
// the same as asking about one.
export async function backdrops (page, points) {
  if (!points.length) return []
  await page.evaluate((css) => {
    const s = document.createElement('style')
    s.id = '__hidefg'
    s.textContent = css
    document.head.append(s)
  }, HIDE)
  let shot
  try {
    shot = (await page.screenshot({ fullPage: true })).toString('base64')
  } finally {
    await page.evaluate(() => document.getElementById('__hidefg')?.remove())
  }
  return page.evaluate(async ({ b64, pts }) => {
    const img = new Image()
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64 })
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, 0, 0)
    // Pixels are square, so the width alone fixes the scale between CSS
    // coordinates and the shot's device pixels.
    const d = document.documentElement
    const scale = img.width / Math.max(d.scrollWidth, d.clientWidth)
    return pts.map(([x, y]) => {
      const px = Math.min(img.width - 1, Math.max(0, Math.round(x * scale)))
      const py = Math.min(img.height - 1, Math.max(0, Math.round(y * scale)))
      return [...g.getImageData(px, py, 1, 1).data].slice(0, 3)
    })
  }, { b64: shot, pts: points })
}

// What someone can make their own: the accent colour the whole interface is
// tinted with, and the avatar that stands for them in the sidebar.

// Every accent is the *same colour as the original gold, rotated*. Gold sits at
// oklch(0.7245 0.0998 82.35), and the three shades around it were measured off
// the palette it shipped with, so an accent varies hue and nothing else. That
// is what keeps this safe: 142 places in the app use these tokens as fills, as
// borders, and as text on both the navy sidebar and a white card, and every one
// of those relationships is a question about lightness. Hold the lightness and
// they all keep the answer gold already gave them.
const RAMP = {
  base:  { l: 0.7245, c: 0.0998 },
  hover: { l: 0.7665, c: 0.1387 },
  deep:  { l: 0.6620, c: 0.1071 },
  wash:  { l: 0.9533, c: 0.0184 },
}

export const ACCENTS = [
  { id: 'gold', name: 'Gold', hue: 82.35 },
  { id: 'copper', name: 'Copper', hue: 42 },
  { id: 'rose', name: 'Rose', hue: 15 },
  { id: 'violet', name: 'Violet', hue: 310 },
  { id: 'indigo', name: 'Indigo', hue: 262 },
  { id: 'emerald', name: 'Emerald', hue: 155 },
]
export const DEFAULT_ACCENT = 'gold'

export const accentById = (id) => ACCENTS.find((a) => a.id === id) || ACCENTS[0]


// ── The base tone ───────────────────────────────────────────────────────────
//
// The accent above is one colour. This is everything else: the ground, the
// cards, the borders, the text. Measuring the theme showed it was already
// built out of exactly two hue families and nothing else — every surface and
// border sits near 260° in the dark theme and 257° in the light one, and the
// warm tokens (the field fill, the two brand borders, the cream text on navy)
// sit near 80°, which is the gold. Nothing was scattered.
//
// That is what makes this safe to offer. Each token keeps its own lightness and
// its own chroma; only the hue moves, and a chroma multiplier can take the
// whole ramp toward grey. Contrast is a question about lightness, so every
// relationship the navy satisfied is preserved by construction — and the suite
// checks it across every base tone rather than taking the argument on trust.

// [lightness, chroma] per token. Split by which family it belongs to: `base`
// follows the tone chosen here, `warm` follows the accent, because those tokens
// are the brand showing through rather than structure.
const DARK_BASE = {
  'surface-page': [0.1686, 0.0322], 'surface-card': [0.2274, 0.0490],
  'surface-raised': [0.2477, 0.0658], 'surface-sunk': [0.2166, 0.0492],
  'surface-chip': [0.2166, 0.0492], 'surface-hover': [0.2843, 0.0720],
  'surface-grab': [0.3548, 0.0979], 'field-bg': [0.2195, 0.0538],
  'field-bg-focus': [0.2561, 0.0695], 'border-subtle': [0.2812, 0.0672],
  'border-card': [0.2966, 0.0644], 'border-light': [0.3343, 0.0814],
  'line': [0.3343, 0.0814], 'line-soft': [0.2812, 0.0672],
  'border-strong': [0.4158, 0.1083], 'field-line': [0.4032, 0.0889],
  'field-line-hi': [0.4757, 0.0979], 'hint': [0.6611, 0.0420],
}
const DARK_WARM = {
  'ink-1': [0.9402, 0.0235], 'ink-2': [0.9047, 0.0322], 'ink-3': [0.8464, 0.0368],
  'ink-4': [0.7895, 0.0411], 'ink-5': [0.7040, 0.0383], 'ink-6': [0.5923, 0.0357],
  'ink-7': [0.5049, 0.0319],
}
const LIGHT_BASE = {
  'surface-page': [0.9767, 0.0026], 'surface-sunk': [0.9842, 0.0034],
  'surface-chip': [0.9683, 0.0069], 'surface-hover': [0.9683, 0.0069],
  'surface-grab': [0.9288, 0.0126], 'line': [0.9288, 0.0126],
  'line-soft': [0.9683, 0.0069], 'border-strong': [0.8686, 0.0216],
  'ink-1': [0.2084, 0.0417], 'ink-2': [0.2799, 0.0408], 'ink-3': [0.3717, 0.0449],
  'ink-4': [0.4454, 0.0430], 'ink-5': [0.5542, 0.0460], 'ink-6': [0.7038, 0.0402],
  'ink-7': [0.8686, 0.0216], 'hint': [0.5248, 0.0402],
  // Was missing, so in the light theme the border a field grows on hover was
  // the only structural line that ignored the chosen tone.
  'field-line-hi': [0.8686, 0.0216],
}
const LIGHT_WARM = {
  'border-light': [0.8889, 0.0202], 'border-subtle': [0.9360, 0.0149],
  'field-bg': [0.9711, 0.0074], 'field-line': [0.8889, 0.0202],
}

// Light-theme tokens that are deliberately white or near-white and take no hue
// at all: a card is a white sheet resting on the tinted ground, and tinting it
// would flatten the two into one surface. Named here so "the light half is
// missing these" is a decision the test can check rather than an omission it
// cannot tell apart from a bug.
export const LIGHT_UNTINTED = ['surface-card', 'surface-raised', 'field-bg-focus', 'border-card']

// A tone is a hue and how much colour to keep. Graphite is the same ramp with
// the colour taken out rather than a separate set of greys, which is why it
// cannot drift from the others.
export const TONES = [
  { id: 'navy', name: 'Navy', hue: 260, chroma: 1 },
  { id: 'slate', name: 'Slate', hue: 250, chroma: 0.55 },
  { id: 'graphite', name: 'Graphite', hue: 260, chroma: 0.12 },
  { id: 'forest', name: 'Forest', hue: 158, chroma: 0.95 },
  { id: 'plum', name: 'Plum', hue: 320, chroma: 0.85 },
  { id: 'clay', name: 'Clay', hue: 40, chroma: 0.9 },
]
export const DEFAULT_TONE = 'navy'
export const toneById = (id) => TONES.find((t) => t.id === id) || TONES[0]

const tok = ([l, c], hue, scale = 1) => `oklch(${l.toFixed(4)} ${(c * scale).toFixed(4)} ${hue})`

// Every variable a scheme sets, for one theme. The caller writes the light set
// on :root and the dark set on .dark, which is the same shape the stylesheet
// already uses — so a token that is not listed here keeps whatever the
// stylesheet says and nothing silently loses its value.
// The chrome — sidebar, hero, and the ink on a primary button. Not a surface
// token, and the same colour in both themes, so it lives on its own; without it
// a Forest scheme re-tinted the whole app except the sidebar, and the two sat
// next to each other disagreeing.
const CHROME = { navy: [0.2056, 0.0376], 'navy-dark': [0.1614, 0.0297] }

export function chromeVars(tone = DEFAULT_TONE) {
  const t = toneById(tone)
  const out = {}
  for (const [name, lc] of Object.entries(CHROME)) out[`--color-${name}`] = tok(lc, t.hue, t.chroma)
  return out
}

export function schemeVars({ tone = DEFAULT_TONE, accentHue, dark = false } = {}) {
  const t = toneById(tone)
  const warmHue = typeof accentHue === 'number' ? accentHue : accentById(DEFAULT_ACCENT).hue
  const base = dark ? DARK_BASE : LIGHT_BASE
  const warm = dark ? DARK_WARM : LIGHT_WARM
  const out = {}
  for (const [name, lc] of Object.entries(base)) out[`--color-${name}`] = tok(lc, t.hue, t.chroma)
  for (const [name, lc] of Object.entries(warm)) out[`--color-${name}`] = tok(lc, warmHue)
  return out
}

// `gold` and `brand` are two names for one colour — the app grew the second as
// an alias — so both are set rather than leaving half the interface behind.
const at = (shade, hue) => `oklch(${RAMP[shade].l} ${RAMP[shade].c} ${hue})`

export const accentVars = (hue) => ({
  '--color-gold': at('base', hue),
  '--color-gold-dark': at('hover', hue),
  '--color-brand': at('base', hue),
  '--color-brand-dark': at('deep', hue),
  '--color-brand-light': at('wash', hue),
})

// A colour someone picked, reduced to the one thing that can be taken safely.
// Their hue is used; the lightness and chroma stay on the ramp everything else
// is built from. A finance app that let you set text to #FFFF00 on white would
// be honouring the choice and failing the person, and there is no way to know
// which of the forty places a colour lands is the one that stops being
// readable. The picker shows the result, so this is visible rather than quiet.
export const hueOfHex = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return null
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(m[1].slice(i, i + 2), 16)))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const ss = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.4285922050 * mm + 0.4505937099 * ss
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.8086757660 * ss
  // A grey has no hue to take. Saying so lets the caller keep the last one
  // rather than snapping to red, which is what atan2(0, 0) would give.
  if (Math.hypot(A, B) < 0.002) return null
  return Math.round(((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 * 10) / 10
}

// An accent is either one of the named ones or a hue someone chose. Stored as
// the hue in that case, so a preset being renamed or dropped later cannot
// silently change a colour somebody picked.
export const accentHueOf = (value) => {
  const n = Number(value)
  if (Number.isFinite(n) && String(value).trim() !== '') return ((n % 360) + 360) % 360
  return accentById(value).hue
}

const block = (selector, vars) =>
  `${selector}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`

// One stylesheet rather than inline styles on <html>: the light and dark ramps
// hold different values for the same token names, and an inline style has
// nowhere to put the second set.
export function schemeStyle({ accent = DEFAULT_ACCENT, tone = DEFAULT_TONE } = {}) {
  const hue = accentHueOf(accent)
  return [
    block(':root', {
      ...accentVars(hue),
      ...chromeVars(tone),
      ...schemeVars({ tone, accentHue: hue, dark: false }),
    }),
    block('.dark', schemeVars({ tone, accentHue: hue, dark: true })),
  ].join('')
}

// OKLCH back to a hex. Needed because <meta name="theme-color"> is read by the
// operating system rather than by the page's style engine, and an oklch() there
// is at best unevenly understood — a status bar that silently falls back to
// white is worse than one that never moved. Out-of-gamut components are
// clamped, which for these ramps only ever shaves a little chroma.
export function hexFromOklch(L, C, H) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
  return '#' + lin.map((v) => {
    const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055
    const byte = Math.round(Math.min(1, Math.max(0, srgb)) * 255)
    return byte.toString(16).padStart(2, '0')
  }).join('')
}

// What the browser paints around the page: the status bar on a phone, the title
// bar of an installed window. The app's own chrome is navy — the sidebar on a
// desktop, the header on a phone — so this follows the tone with it. Left
// hardcoded it announced navy while the app was green, which is the kind of
// seam that makes a web app feel like a web page.
export const chromeColour = (tone = DEFAULT_TONE) => {
  const t = toneById(tone)
  return hexFromOklch(CHROME.navy[0], CHROME.navy[1] * t.chroma, t.hue)
}

export const STYLE_ID = 'offset-scheme'

export function applyAppearance({ accent = DEFAULT_ACCENT, tone = DEFAULT_TONE } = {}) {
  if (typeof document === 'undefined') return
  let el = document.getElementById(STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.append(el)
  }
  el.textContent = schemeStyle({ accent, tone })

  // Two of these ship in index.html so the colour is right before any script
  // runs; this keeps them in step once someone changes the tone.
  const colour = chromeColour(tone)
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', colour)
  }
}

// A short row rather than a grid. Someone wanting a picture of themselves is not
// served by a hundred faces to scroll, and the initials are the default because
// they need no decision at all.
export const AVATAR_SYMBOLS = ['🏠', '🔑', '📈', '🧾', '🌿', '⭐', '🐘', '🦉']

export const initialsFrom = (name, email) => {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  const local = String(email || '').split('@')[0]
  return (local.slice(0, 2) || 'U').toUpperCase()
}

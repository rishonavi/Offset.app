// The adjustments somebody makes to read the app at all.
//
// Distinct from lib/appearance.js, which is taste — an accent colour, a tone,
// an avatar. Nothing in here is decoration. Each one exists because without it
// a particular person cannot use the screen: inverted colours for glare and
// light sensitivity, larger text and looser lines for low vision, a bigger
// cursor for a tremor or a small pointer, a link that is marked as a link by
// something other than its colour, motion stilled for vestibular disorder.
//
// Kept as pure data and pure functions so the whole model can be tested
// without a browser, and so the one place that decides what "contrast 2" means
// is this file rather than a stylesheet and a component disagreeing quietly.

// Off is always 0 or false, which is what makes `isDefault` a comparison
// against this object rather than a list of special cases to keep in step.
export const DEFAULTS = {
  invert: false,
  grayscale: false,
  saturation: false,
  contrast: 0,
  links: false,
  dyslexia: false,
  cursor: false,
  motion: false,
  fontSize: 0,
  lineHeight: 0,
  letterSpacing: 0,
  align: 0,
}

// How many positions each control has. A toggle has two; a stepped control
// cycles and comes back round to off, so there is always a way out without
// hunting for a reset.
export const STEPS = {
  invert: 2, grayscale: 2, saturation: 2, links: 2, dyslexia: 2, cursor: 2, motion: 2,
  contrast: 3,
  fontSize: 4,
  lineHeight: 4,
  letterSpacing: 4,
  align: 4,
}

// The values behind the steps. Index 0 is always "leave it alone", and is
// never written into the stylesheet — a default that is applied is a default
// that can be wrong.
export const SCALES = {
  // Root font size. Everything in this app is sized in rem, so this one lever
  // moves type, padding and control heights together, which is what somebody
  // asking for bigger text actually wants — not 24px text in a 32px button.
  fontSize: [1, 1.15, 1.3, 1.5],
  lineHeight: [null, 1.6, 1.9, 2.2],
  letterSpacing: [null, '0.02em', '0.06em', '0.12em'],
  contrast: [null, 1.25, 1.6],
}

// `start` and `end` rather than left and right: this app ships Arabic and Urdu,
// and a reader who has asked for ragged-right text in an RTL language means the
// ragged edge, not the west side of the screen.
export const ALIGNMENTS = [null, 'start', 'center', 'end']

export const STORAGE_KEY = 'pl_a11y'

const clampStep = (value, steps) => {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n > 0 && n < steps ? n : 0
}

// Anything at all can come out of localStorage — a half-written value, a blob
// from an older version, a string somebody typed into devtools. Every key is
// forced back into range and unknown keys are dropped, so the rest of the
// module can treat the settings object as trustworthy.
export function sanitise(raw) {
  const out = { ...DEFAULTS }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in raw)) continue
    out[key] = STEPS[key] === 2 ? Boolean(raw[key]) : clampStep(raw[key], STEPS[key])
  }
  return out
}

export const isDefault = (s) => Object.keys(DEFAULTS).every((k) => sanitise(s)[k] === DEFAULTS[k])

// How many adjustments are on, for the count on the launcher. Somebody who
// inverted the colours on a phone last week and cannot work out why the app
// looks wrong today needs to be told that something is on, from the outside.
export const activeCount = (s) => {
  const v = sanitise(s)
  return Object.keys(DEFAULTS).filter((k) => v[k] !== DEFAULTS[k]).length
}

// One step on, wrapping back to off at the end.
export function cycle(settings, key) {
  const s = sanitise(settings)
  if (!(key in DEFAULTS)) return s
  const steps = STEPS[key]
  return { ...s, [key]: steps === 2 ? !s[key] : (s[key] + 1) % steps }
}

// The four colour controls compose into one `filter`, because they are one CSS
// property and the last declaration would otherwise win. Order matters:
// inverting after a contrast boost is not the same picture as boosting the
// contrast of an inverted one.
//
// The hue rotation is what separates "inverted" from "a photographic negative".
// A straight invert turns the navy chrome orange; rotating the hue back 180°
// leaves the lightness flipped and the colours roughly where they were, which
// is what somebody who turned this on to cut glare is asking for.
export function filterFor(settings) {
  const s = sanitise(settings)
  const parts = []
  if (s.invert) parts.push('invert(1) hue-rotate(180deg)')
  if (s.grayscale) parts.push('grayscale(1)')
  if (s.saturation && !s.grayscale) parts.push('saturate(0.45)')
  if (s.contrast) parts.push(`contrast(${SCALES.contrast[s.contrast]})`)
  return parts.join(' ')
}

// The typographic controls, as custom properties. Only the ones that are on:
// an absent property lets the stylesheet's own value stand, so "off" costs
// nothing and cannot subtly restyle the app.
export function varsFor(settings) {
  const s = sanitise(settings)
  const vars = {}
  if (s.fontSize) vars['--a11y-font-scale'] = String(SCALES.fontSize[s.fontSize])
  if (s.lineHeight) vars['--a11y-line-height'] = String(SCALES.lineHeight[s.lineHeight])
  if (s.letterSpacing) vars['--a11y-letter-spacing'] = SCALES.letterSpacing[s.letterSpacing]
  if (s.align) vars['--a11y-align'] = ALIGNMENTS[s.align]
  return vars
}

// What the stylesheet hooks onto. Each is its own attribute rather than one
// class list, so a rule can ask about exactly one setting.
export function flagsFor(settings) {
  const s = sanitise(settings)
  return {
    'data-a11y-invert': s.invert ? '' : null,
    'data-a11y-links': s.links ? '' : null,
    'data-a11y-dyslexia': s.dyslexia ? '' : null,
    'data-a11y-cursor': s.cursor ? '' : null,
    'data-a11y-motion': s.motion ? '' : null,
    // One flag per rule, not one for all three typography controls. A single
    // `data-a11y-type` meant the line-height rule was live whenever letter
    // spacing alone was on, and its `!important` fallback of `inherit` then
    // overrode Tailwind's line-heights across the whole app for a setting
    // nobody had touched.
    'data-a11y-lh': s.lineHeight ? '' : null,
    'data-a11y-ls': s.letterSpacing ? '' : null,
    'data-a11y-align': s.align ? '' : null,
  }
}

// Everything the document needs, in one object, so applying it is a loop
// rather than a sequence somebody can get out of order.
export function styleFor(settings) {
  return { filter: filterFor(settings), vars: varsFor(settings), flags: flagsFor(settings) }
}

// Write it to the document. Separate from the React tree because the same
// thing has to happen before React exists — see the inline script in
// index.html, which is this function's shape in twenty lines of ES5.
export function applyA11y(settings, root = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!root) return
  const { filter, vars, flags } = styleFor(settings)
  // A `filter` on the root element, deliberately, and not on <body>. A filter
  // makes an element the containing block for its fixed descendants, so the
  // same declaration on <body> tears every fixed thing in the app off the
  // viewport — measured on a phone, where the floating quick-add dropped from
  // y=768 to y=-132 as soon as the page scrolled. The root element is the
  // exception: the filter applies to the canvas and fixed children stay put.
  root.style.filter = filter
  for (const key of ['--a11y-font-scale', '--a11y-line-height', '--a11y-letter-spacing', '--a11y-align']) {
    if (key in vars) root.style.setProperty(key, vars[key])
    else root.style.removeProperty(key)
  }
  for (const [attr, value] of Object.entries(flags)) {
    if (value === null) root.removeAttribute(attr)
    else root.setAttribute(attr, value)
  }
}

export function readStored(storage) {
  try {
    const raw = (storage || localStorage).getItem(STORAGE_KEY)
    return sanitise(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULTS }
  }
}

// Defaults are not stored. An empty key means "no choice made", which is the
// same thing the accent and tone do, and it keeps a fresh browser from
// carrying a blob that says nothing.
export function writeStored(settings, storage) {
  try {
    const store = storage || localStorage
    if (isDefault(settings)) store.removeItem(STORAGE_KEY)
    else store.setItem(STORAGE_KEY, JSON.stringify(sanitise(settings)))
  } catch {
    /* a browser refusing to store a preference is not worth an error */
  }
}

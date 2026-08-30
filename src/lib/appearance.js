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

const at = (shade, hue) => `oklch(${RAMP[shade].l} ${RAMP[shade].c} ${hue})`

// `gold` and `brand` are two names for one colour — the app grew the second as
// an alias — so both are set rather than leaving half the interface behind.
export const accentVars = (hue) => ({
  '--color-gold': at('base', hue),
  '--color-gold-dark': at('hover', hue),
  '--color-brand': at('base', hue),
  '--color-brand-dark': at('deep', hue),
  '--color-brand-light': at('wash', hue),
})

export const applyAccent = (id, root) => {
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null)
  if (!el) return
  const vars = accentVars(accentById(id).hue)
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
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

export const CURRENCY = import.meta.env.VITE_CURRENCY || 'INR'
export const LOCALE = import.meta.env.VITE_LOCALE || 'en-IN'

export const ASSET_TYPES = [
  'Real Estate — Apartment / Flat',
  'Real Estate — Villa / House',
  'Real Estate — Commercial',
  'Land / Plot',
  'Vehicle / Car',
  'Yacht / Boat',
  'Aircraft',
  'Machinery / Equipment',
  'Jewellery',
  'Precious Metals — Gold / Silver',
  'Stocks / Equity',
  'Mutual Funds / Bonds',
  'Cryptocurrency',
  'Art / Collectibles',
  'Other',
]

// An address identifies the asset for anything fixed to a place, and is noise
// for anything that isn't: a car, a gold chain, a holding of stock and a
// cryptocurrency wallet do not have one, and asking for it invites someone to
// type where the thing happens to be kept — which is not the same fact and is
// not what any of the reports mean by "address".
//
// "Other" is on the list because it is the unknown case. Someone filing a
// warehouse or a leased plot under Other should still be able to record where
// it is; showing a field nobody fills is a smaller cost than hiding one
// somebody needs.
export const ADDRESSABLE_ASSET_TYPES = [
  'Real Estate — Apartment / Flat',
  'Real Estate — Villa / House',
  'Real Estate — Commercial',
  'Land / Plot',
  'Other',
]

export const hasAddress = (type) => ADDRESSABLE_ASSET_TYPES.includes(type)

// A loan block asks for a principal, a rate, a tenure and a start date, and
// puts an EMI and a payoff date on the asset page. That shape fits anything
// bought on finance or pledged as security — which in India very much includes
// jewellery and bullion, gold loans being among the most common secured
// borrowing there is. Leaving them out would be a Western default applied to an
// India-first app.
//
// What it does not fit is a financial holding. Borrowing against a portfolio is
// a facility against the portfolio, drawn and repaid at will; it has no EMI and
// no payoff date, and recording it against one line of stock would misstate
// both. So the list is everything physical, plus Other for the unknown case.
export const FINANCEABLE_ASSET_TYPES = [
  'Real Estate — Apartment / Flat',
  'Real Estate — Villa / House',
  'Real Estate — Commercial',
  'Land / Plot',
  'Vehicle / Car',
  'Yacht / Boat',
  'Aircraft',
  'Machinery / Equipment',
  'Jewellery',
  'Precious Metals — Gold / Silver',
  'Art / Collectibles',
  'Other',
]

export const canBeFinanced = (type) => FINANCEABLE_ASSET_TYPES.includes(type)

// Tenancy is narrower than finance. The fields are a tenant, a deposit held and
// a lease running between two dates — the shape of letting something out for
// someone else's use. That covers property, land, and the large movable things
// that are chartered or leased rather than sold: vehicles, boats, aircraft,
// plant.
//
// It does not cover gold, bullion or a painting. You can lend a painting to a
// gallery, but "tenant name" and "deposit held" are not how that is recorded,
// and a field that nearly fits is worse than one that is absent.
export const LEASABLE_ASSET_TYPES = [
  'Real Estate — Apartment / Flat',
  'Real Estate — Villa / House',
  'Real Estate — Commercial',
  'Land / Plot',
  'Vehicle / Car',
  'Yacht / Boat',
  'Aircraft',
  'Machinery / Equipment',
  'Other',
]

export const canBeLeased = (type) => LEASABLE_ASSET_TYPES.includes(type)

export const CATEGORIES = [
  'Materials',
  'Labor / Contractors',
  'Permits & Legal',
  'Utilities',
  'Property Tax',
  'Maintenance & Repairs',
  'Insurance',
  'Loan / EMI',
  'Brokerage / Marketing',
  'Furnishing',
  'Other',
]

export const PAYMENT_METHODS = [
  'Cash',
  'Bank Transfer',
  'UPI',
  'Cheque',
  'Credit Card',
  'Debit Card',
  'Other',
]

// Stable colour per category for charts/legends.
export const CATEGORY_COLORS = {
  'Materials': '#C5A059',
  'Labor / Contractors': '#3B5A7A',
  'Permits & Legal': '#6D6A8A',
  'Utilities': '#2F6F6B',
  'Property Tax': '#9C5B33',
  'Maintenance & Repairs': '#B5673F',
  'Insurance': '#7C8A5A',
  'Loan / EMI': '#46618A',
  'Brokerage / Marketing': '#A87B2E',
  'Furnishing': '#8A6E4B',
  'Other': '#7A7165',
}

// Muted, luxury palette for charts keyed by index (e.g. per-property bars).
export const CHART_PALETTE = [
  '#C5A059', '#0A1828', '#2F6F6B', '#9C5B33', '#3B5A7A',
  '#A87B2E', '#6D6A8A', '#7C8A5A', '#B5673F', '#46618A',
  '#8A6E4B', '#5A7D7C',
]

export const colorForCategory = (cat, i = 0) =>
  CATEGORY_COLORS[cat] || CHART_PALETTE[i % CHART_PALETTE.length]

export const INCOME_SOURCES = [
  'Rent',
  'Security Deposit',
  'Maintenance Charges',
  'Parking',
  'Sale Proceeds',
  'Other',
]

export const INCOME_COLORS = {
  'Rent': '#2F6F6B',
  'Security Deposit': '#46618A',
  'Maintenance Charges': '#7C8A5A',
  'Parking': '#A87B2E',
  'Sale Proceeds': '#9C5B33',
  'Other': '#7A7165',
}

export const colorForSource = (s, i = 0) =>
  INCOME_COLORS[s] || CHART_PALETTE[i % CHART_PALETTE.length]

// What the attachment pickers accept — receipts on an entry, and the files on
// the Documents card. Office formats are here because a bill often arrives as
// a Word or Excel file rather than a scan, and rejecting it forces someone to
// print-to-PDF before they can file it. Nothing parses these; they are stored
// and handed back on download, so the list can grow without touching any
// reading code.
export const ATTACHMENT_ACCEPT = [
  'image/*',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
].join(',')

// Only images and PDFs can be read by the scanner (AI vision or on-device OCR).
// A Word or Excel attachment is stored and handed back, but offering "Scan to
// auto-fill" on one is a button that can only fail, so the callers hide it.
export const isScannable = (file) =>
  Boolean(file) && (/^image\//.test(file.type) || file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''))

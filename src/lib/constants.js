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

// Semantic colours for income vs expense vs net.
export const FLOW_COLORS = { income: '#2F8F6B', expense: '#C5A059', net: '#0A1828' }

// Where a cost was booked.
//
// Personal books have one answer and the form insists on it: every expense
// belongs to an asset, because in personal books an asset is the only thing
// there is. A construction company has two answers and most of the time it is
// the second one — the cement belongs to the tower being built, which the
// builder does not own, will never own, and is selling by the flat.
//
// A few costs have neither. Office rent, the auditor's fee, diesel for the
// director's car. Those are overheads, and a form that will not take them
// without an asset does not stop them being logged; it makes somebody pick the
// nearest asset to get past the field, and after a hundred of those the asset's
// own numbers are fiction. Better to accept the row unbooked and say so out
// loud: `unattributed()` in lib/projects.js already totals what nobody is
// paying for, and the attention surface puts it on the dashboard.

// Which of the two answers a row gives, and the name that goes with it.
//
// The asset comes first because it is the narrower claim: a row naming both is
// a cost on something the company owns, incurred for a job, and the thing it
// was spent on is what a person scanning the column is looking for.
//
// An asset the lookup cannot name — deleted, or in books you are not looking at
// — falls through to the site rather than showing nothing. A stale id is not a
// reason to withhold the answer the row still has.
export function placeOf(row, { assetName, siteName } = {}) {
  if (!row) return { kind: 'none', id: null, name: '' }
  const asset = row.property_id ? assetName?.(row.property_id) : ''
  if (asset) return { kind: 'asset', id: row.property_id, name: asset }
  const site = row.project_id ? siteName?.(row.project_id) : ''
  if (site) return { kind: 'site', id: row.project_id, name: site }
  return { kind: 'none', id: null, name: '' }
}

// The same thing when all you want is the string for a cell.
export function placeName(row, names) {
  return placeOf(row, names).name
}

// What to call the column above it. "Property" is exactly right for a landlord
// and a category error for a builder, whose costs mostly sit against jobs.
export function placeHeading(corporate) {
  return corporate ? 'Booked to' : 'Property'
}

// Whether the form may take a row with no asset on it. Personal books may not:
// nothing else in them can carry a cost, so an unbooked expense there is a
// mistake rather than an overhead.
export function assetOptional(ent) {
  return Boolean(ent?.corporate)
}

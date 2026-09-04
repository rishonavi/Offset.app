import {
  Building2, Car, Ship, Plane, Factory, Landmark, Box,
  Gem, Coins, Palette, TrendingUp, PieChart, Bitcoin,
} from 'lucide-react'

// Pick a sensible icon for an asset based on its type label.
//
// Seven of the fifteen types used to land on the fallback box, which put three
// identical icons in a row under Valuables and three more under Investments.
// An icon that is the same for everything is not a picture, it is noise with a
// gap where a picture should be — so every type the app ships now has its own.
export function iconForAssetType(type = '') {
  const t = (type || '').toLowerCase()
  // Places first, and "art" matched as a whole word. Substring matching put a
  // painter's palette on "Apartment / Flat", because apArTment contains art.
  if (
    t.includes('real estate') ||
    t.includes('apartment') ||
    t.includes('villa') ||
    t.includes('house') ||
    t.includes('commercial') ||
    t.includes('property') ||
    t.includes('office') ||
    t.includes('shop')
  )
    return Building2
  if (t.includes('land') || t.includes('plot')) return Landmark
  if (t.includes('car') || t.includes('vehicle')) return Car
  if (t.includes('yacht') || t.includes('boat') || t.includes('ship')) return Ship
  if (t.includes('air') || t.includes('plane') || t.includes('jet') || t.includes('craft')) return Plane
  if (t.includes('machin') || t.includes('equip')) return Factory
  if (t.includes('jewel')) return Gem
  if (t.includes('gold') || t.includes('silver') || t.includes('metal') || t.includes('bullion')) return Coins
  if (/\bart\b/.test(t) || t.includes('collect') || t.includes('paint')) return Palette
  if (t.includes('crypto') || t.includes('bitcoin')) return Bitcoin
  if (t.includes('mutual') || t.includes('fund') || t.includes('bond')) return PieChart
  if (t.includes('stock') || t.includes('equity') || t.includes('share')) return TrendingUp
  return Box
}

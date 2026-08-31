// The two sweeps that run at startup, and the much more important question of
// what they leave alone.
//
// pruneBlobs deletes everything it is not handed. Called against a store that
// had not loaded yet it would delete every receipt the user owns, so the tests
// that matter here are the ones about what survives.
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4188'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

const open = async () => {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(30000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  return { ctx, p }
}
// Write blobs straight into the store the app uses, so the sweep sees real rows.
const seedBlobs = (p, ids) => p.evaluate((list) => new Promise((res, rej) => {
  const req = indexedDB.open('offset-attachments', 1)
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('blobs')) req.result.createObjectStore('blobs') }
  req.onerror = () => rej(req.error)
  req.onsuccess = () => {
    const tx = req.result.transaction('blobs', 'readwrite')
    for (const id of list) tx.objectStore('blobs').put(new Blob(['x'], { type: 'image/png' }), id)
    tx.oncomplete = () => res(true)
    tx.onerror = () => rej(tx.error)
  }
}), ids)
const blobIds = (p) => p.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('offset-attachments', 1)
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('blobs')) req.result.createObjectStore('blobs') }
  req.onerror = () => res([])
  req.onsuccess = () => {
    const tx = req.result.transaction('blobs', 'readonly')
    const all = tx.objectStore('blobs').getAllKeys()
    all.onsuccess = () => res([...all.result])
    all.onerror = () => res([])
  }
}))

console.log('── A RECEIPT WHOSE ENTRY IS GONE IS SWEPT UP ──')
{
  const { ctx, p } = await open()
  await p.goto(B, { waitUntil: 'networkidle' })
  await seedBlobs(p, ['kept', 'binned', 'orphan'])
  await p.evaluate(() => {
    const now = new Date().toISOString()
    localStorage.setItem('pl_properties', JSON.stringify([{ id: 'a1', name: 'Villa', type: 'Real Estate — Apartment / Flat', created_at: now }]))
    localStorage.setItem('pl_expenses', JSON.stringify([
      { id: 'e1', property_id: 'a1', date: '2026-01-01', amount: 100, receipt_url: 'idb:kept#a.png', created_at: now },
      // Soft-deleted: still in the bin, so its receipt has to survive or a
      // restore brings back an entry whose photograph has been thrown away.
      { id: 'e2', property_id: 'a1', date: '2026-01-02', amount: 200, receipt_url: 'idb:binned#b.png', deleted_at: now, created_at: now },
    ]))
  })
  await p.goto(B + '/expenses', { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  const after = await blobIds(p)
  ok('the unreachable one is gone', !after.includes('orphan'), after.join(','))
  ok('the one still referenced stays', after.includes('kept'), after.join(','))
  ok('and so does the one in the bin', after.includes('binned'), after.join(','))
  await ctx.close()
}

console.log('\n── AN EMPTY LEDGER DOES NOT MEAN AN EMPTY STORE ──')
{
  // The dangerous case. If the sweep ran before storage was read, every row
  // would look absent and every attachment would be deleted.
  const { ctx, p } = await open()
  await p.goto(B, { waitUntil: 'networkidle' })
  await seedBlobs(p, ['mine'])
  await p.evaluate(() => {
    const now = new Date().toISOString()
    localStorage.setItem('pl_expenses', JSON.stringify([
      { id: 'e1', property_id: 'a1', date: '2026-01-01', amount: 100, receipt_url: 'idb:mine#a.png', created_at: now }]))
  })
  for (const r of ['/', '/expenses', '/reports', '/settings']) {
    await p.goto(B + r, { waitUntil: 'networkidle' })
    await p.waitForTimeout(300)
  }
  ok('a referenced receipt survives every page load', (await blobIds(p)).includes('mine'))
  await ctx.close()
}

console.log('\n── EXPIRED DRAFTS ARE SWEPT, LIVE ONES ARE NOT ──')
{
  const { ctx, p } = await open()
  await p.goto(B, { waitUntil: 'networkidle' })
  await p.evaluate(() => {
    const old = Date.now() - 48 * 60 * 60 * 1000
    localStorage.setItem('pl_draft_expense_stale', JSON.stringify({ at: old, fields: { amount: '1' } }))
    localStorage.setItem('pl_draft_expense_fresh', JSON.stringify({ at: Date.now(), fields: { amount: '2' } }))
  })
  await p.goto(B + '/expenses', { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  const keys = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pl_draft_')))
  ok('the day-old draft is gone', !keys.includes('pl_draft_expense_stale'), keys.join(','))
  ok('the recent one is untouched', keys.includes('pl_draft_expense_fresh'), keys.join(','))
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)

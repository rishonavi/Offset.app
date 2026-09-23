// Attaching a bill out of an inbox, end to end.
//
// Runs against a build with VITE_GOOGLE_CLIENT_ID set — without it the button
// does not exist, on purpose, because a dialog whose one action cannot work is
// worse than no button. Google's token client is stubbed and the Gmail API is
// intercepted: what is under test is what the app does with the answer, not
// whether Google will hand one over.
//
//   VITE_GOOGLE_CLIENT_ID=test-client npm run build
//   npx vite preview --port 4189 --strictPort
//   OFFSET_TEST_URL=http://localhost:4189 npx vite-node tests/browser/cloudbillui.mjs
import { chromium } from './_playwright.mjs'
const B = process.env.OFFSET_TEST_URL || 'http://localhost:4189'
const b = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

// A one-pixel PNG, so the File that comes out the other end is a real image.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const MESSAGES = [
  { id: 'm1', from: 'Kadam Hardware <billing@kadam.example>', subject: 'Tax invoice TI-8841', filename: 'TI-8841.pdf', mime: 'application/pdf' },
  { id: 'm2', from: '"Shinde Contractors" <accounts@shinde.example>', subject: 'September running bill', filename: 'sept-ra-bill.png', mime: 'image/png' },
]

const boot = async (route = '/expenses/new') => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' })
  const p = await ctx.newPage(); p.setDefaultTimeout(20000)
  await p.route('**/fonts.g**/**', (r) => r.abort())
  // The token client, without Google. `loadGis` resolves at once when
  // window.google is already there, so nothing is fetched from accounts.google.
  await p.addInitScript(() => {
    window.google = { accounts: { oauth2: {
      initTokenClient: ({ callback }) => ({
        requestAccessToken: () => setTimeout(() => callback({ access_token: 'stub-token' }), 10),
      }),
    } } }
  })
  await p.route('**gmail.googleapis.com/**', (r) => {
    const url = r.request().url()
    const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) })
    if (url.includes('/messages?q=')) return json({ messages: MESSAGES.map((m) => ({ id: m.id })) })
    const att = url.match(/messages\/(\w+)\/attachments\//)
    if (att) return json({ data: PNG.replace(/\+/g, '-').replace(/\//g, '_') })
    const full = url.match(/messages\/(\w+)\?/)
    if (full) {
      const m = MESSAGES.find((x) => x.id === full[1])
      return json({
        payload: {
          headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject }],
          parts: [{ mimeType: m.mime, filename: m.filename, body: { attachmentId: 'a-' + m.id } }],
        },
      })
    }
    return json({})
  })
  await p.goto(B, { waitUntil: 'domcontentloaded' })
  await p.evaluate(() => {
    localStorage.clear()
    const now = new Date().toISOString()
    const put = (k, v) => localStorage.setItem(k, JSON.stringify(v))
    put('pl_properties', [{ id: 'p1', name: 'Sea View Villa', type: 'Real Estate — Villa / House', value: 1, created_at: now }])
    put('pl_expenses', []); put('pl_income', []); put('pl_documents', [])
  })
  await p.goto(B + route, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  return { ctx, p }
}

const dialog = (p) => p.locator('[role=dialog][aria-labelledby=cloud-bill-title]')
const button = (p) => p.locator('button:has-text("From email")')

// ── It only exists where it can work ────────────────────────────────────
{
  const { ctx, p } = await boot()
  ok('the From email button is there when a client id is configured', (await button(p).count()) === 1)
  ok('and the dialog is not open until asked', (await dialog(p).count()) === 0)

  await button(p).click()
  await p.waitForTimeout(250)
  ok('clicking opens the dialog', (await dialog(p).count()) === 1)
  // Case-insensitively: btn-primary uppercases its label, so innerText says
  // CONNECT GMAIL and a literal match reads as a missing button.
  ok('  which asks before touching anyone’s mail',
    /connect gmail/i.test(await dialog(p).innerText()), await dialog(p).innerText())
  ok('  and says what it is going to read',
    /four months/i.test(await dialog(p).innerText()), await dialog(p).innerText())

  // ── Connect, list, pick ───────────────────────────────────────────────
  await p.locator('[role=dialog] button:has-text("Connect Gmail")').click()
  await p.waitForTimeout(1200)
  const text = await dialog(p).innerText()
  ok('the attachments are listed', text.includes('TI-8841.pdf') && text.includes('sept-ra-bill.png'), text)
  ok('  by sender name rather than address', text.includes('Kadam Hardware') && !text.includes('billing@kadam.example'), text)
  ok('  with the quoted name unquoted', text.includes('Shinde Contractors'), text)
  ok('  and the subject beside it', text.includes('Tax invoice TI-8841'), text)

  await p.locator('[role=dialog] button', { hasText: 'TI-8841.pdf' }).first().click()
  await p.waitForTimeout(500)
  ok('picking one closes the dialog', (await dialog(p).count()) === 0)
  ok('  and the receipt is attached to the form',
    (await p.locator('#main-content').innerText()).includes('TI-8841.pdf'),
    (await p.locator('#main-content').innerText()).slice(0, 200))
  ok('  so the two file buttons are gone, as with any other attachment',
    (await button(p).count()) === 0)
  await ctx.close()
}

// ── What it does when the mail cannot be read ───────────────────────────
{
  const { ctx, p } = await boot()
  await p.unroute('**gmail.googleapis.com/**')
  await p.route('**gmail.googleapis.com/**', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: '{}' }))
  await button(p).click()
  await p.waitForTimeout(200)
  await p.locator('[role=dialog] button:has-text("Connect Gmail")').click()
  await p.waitForTimeout(900)
  const text = await dialog(p).innerText()
  ok('a refused request says so', /could not read/i.test(text), text)
  ok('  and gives the reason rather than "something went wrong"', text.includes('403'), text)
  ok('  and offers to try again', (await p.locator('[role=dialog] button:has-text("Try again")').count()) === 1)
  await ctx.close()
}

// ── An empty inbox is not an error ──────────────────────────────────────
{
  const { ctx, p } = await boot()
  await p.unroute('**gmail.googleapis.com/**')
  await p.route('**gmail.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await button(p).click()
  await p.waitForTimeout(200)
  await p.locator('[role=dialog] button:has-text("Connect Gmail")').click()
  await p.waitForTimeout(900)
  const text = await dialog(p).innerText()
  ok('no bills reads as no bills, not as a failure', /no bills/i.test(text) && !/could not/i.test(text), text)
  await ctx.close()
}

// ── Closing and reopening does not show a stale list ────────────────────
{
  const { ctx, p } = await boot()
  await button(p).click()
  await p.waitForTimeout(200)
  await p.locator('[role=dialog] button:has-text("Connect Gmail")').click()
  await p.waitForTimeout(1200)
  ok('listed once', (await dialog(p).innerText()).includes('TI-8841.pdf'))
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  ok('Escape closes it', (await dialog(p).count()) === 0)
  await button(p).click()
  await p.waitForTimeout(300)
  const again = await dialog(p).innerText()
  ok('reopening asks again rather than showing the last search',
    /connect gmail/i.test(again) && !again.includes('TI-8841.pdf'), again)
  await ctx.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)

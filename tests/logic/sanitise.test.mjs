// What a template may not do — tried, rather than assumed.
//
// A sanitiser is only ever as good as the payloads someone thought to throw at
// it, and two of these got through the first version: HTML lets a solidus stand
// in for a space between attributes, so `<img/onerror=alert(1)>` is an ordinary
// image tag to a parser; and `&colon;` is a real named entity that was missing
// from the decode table, so `javascript&colon;alert(1)` is what a browser reads
// as `javascript:alert(1)`.
//
// The control that actually holds is the sandbox — the print frame is
// `allow-same-origin` without `allow-scripts`, and the preview iframe is
// `sandbox=""`. This is the second layer, and it exists for the day somebody
// adds `allow-scripts` to make printing work.
import { sanitiseTemplate } from '../../src/lib/invoiceTemplate.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }

// Whatever a browser would act on: a handler, a scheme that runs, a tag that
// carries its own document.
const executable = (html) =>
  /(?:^|[\s/])on[a-z]+\s*=/i.test(html) ||
  /javascript\s*(?::|&colon;|&#0*58;)/i.test(html) ||
  /<\s*(script|iframe|object|embed|applet|frame)/i.test(html)

console.log('── NOTHING RUNS ──')
for (const [name, payload] of [
  ['a handler on an image', '<img src=x onerror=alert(1)>'],
  ['a handler after a solidus', '<img/onerror=alert(1) src=x>'],
  ['the same one quoted', '<img/onerror="alert(1)" src=x>'],
  ['a handler after a newline', '<img\nonerror=alert(1) src=x>'],
  ['a handler with spaces round the equals', '<img src=x onerror = alert(1)>'],
  ['a handler in upper case', '<IMG SRC=x ONERROR=alert(1)>'],
  ['an SVG load handler', '<svg/onload=alert(1)>'],
  ['a body load handler', '<body onload=alert(1)>'],
  ['an animation begin handler', '<svg><animate onbegin=alert(1)></svg>'],
  ['a script tag', '<script>alert(1)</script>'],
  ['a script tag never closed', '<script>alert(1)'],
  ['a script split by another tag', '<scr<script>ipt>alert(1)</script>'],
  ['an iframe carrying a document', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ['srcdoc smuggled onto something else', '<div srcdoc="<script>alert(1)</script>">x</div>'],
  ['an object', '<object data="evil.swf"></object>'],
  ['a javascript: link', '<a href="javascript:alert(1)">x</a>'],
  ['the scheme in mixed case', '<a href="JaVaScRiPt:alert(1)">x</a>'],
  ['the colon as a named entity', '<a href="javascript&colon;alert(1)">x</a>'],
  ['the colon numerically', '<a href="javascript&#58;alert(1)">x</a>'],
  ['the colon in hex', '<a href="javascript&#x3a;alert(1)">x</a>'],
  ['a letter as an entity', '<a href="jav&#97;script:alert(1)">x</a>'],
  ['a newline entity inside the scheme', '<a href="java&NewLine;script:alert(1)">x</a>'],
  ['an entity nobody has heard of', '<a href="javascript&nosuchentity;alert(1)">x</a>'],
  ['leading control characters', '<a href="&#01;javascript:alert(1)">x</a>'],
  ['vbscript', '<a href="vbscript:msgbox(1)">x</a>'],
  ['a document in a data: URL', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
  ['a formaction', '<form><button formaction="javascript:alert(1)">x</button></form>'],
  ['a poster', '<video poster="javascript:alert(1)"></video>'],
]) {
  ok(name, !executable(sanitiseTemplate(payload)), JSON.stringify(sanitiseTemplate(payload)).slice(0, 80))
}

console.log('\n── AND A REAL TEMPLATE IS LEFT ALONE ──')
// The other half of the job. A sanitiser that quietly breaks an invoice
// letterhead is a sanitiser people will turn off.
for (const [name, html] of [
  ['an embedded logo', '<img src="data:image/png;base64,iVBORw0KGgo=" alt="logo">'],
  ['an inline SVG mark', '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'],
  ['a self-closing break', '<p>Line one<br/>Line two</p>'],
  ['a query string with an ampersand', '<a href="https://acme.example/pay?id=1&amp;ref=2">Pay</a>'],
  ['a mailto link', '<a href="mailto:billing@acme.example">Email</a>'],
  ['a telephone link', '<a href="tel:+919876543210">Call</a>'],
  ['a relative path', '<a href="/invoices/2026">Archive</a>'],
  // Both of these look like a handler to a pattern that cannot see quotes.
  ['a path that begins with "on"', '<a href="/onboarding">Start</a>'],
  ['a path with an equals in it', '<a href="/online=1">Online</a>'],
  ['a title containing a greater-than', '<span title="a > b">x</span>'],
  ['a styled table', '<table style="width:100%"><tr><td class="r">1,000</td></tr></table>'],
  ['handlebars', '<td>{{description}}</td>{{#each lines}}<td>{{n}}</td>{{/each}}'],
]) {
  const out = sanitiseTemplate(html)
  ok(name, out === html, `-> ${JSON.stringify(out).slice(0, 80)}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

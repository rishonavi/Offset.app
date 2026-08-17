# Invoices

Offset builds an invoice from entries that are already in your ledger, and
prints it in **your** format — the letterhead, wording and column order your
accountant already expects, rather than a layout Offset invented.

A format is an ordinary HTML file with `{{tokens}}` in it. Import it once on the
Invoices page and it becomes a choice alongside the built-in one.

## Writing a format

Three constructs, which is all a document needs:

```html
{{issuer.name}}                     <!-- a value -->
{{#each lines}} … {{/each}}         <!-- repeat per line item -->
{{#if is_intra_state}} … {{/if}}    <!-- include only when true -->
```

`{{#unless x}}` is the mirror of `{{#if}}`. Blocks nest. Inside `{{#each lines}}`
a bare `{{description}}` means this line's description, while `{{issuer.name}}`
still reaches the document; `{{this.description}}` works too if you prefer it
explicit.

Bring your own `<style>` and Offset leaves your styling alone. Without one, it
applies its own so the page isn't unstyled.

The full token list is on the page itself, under **Show what you can put in a
format** — values, the ones valid inside a line loop, and the conditions.

### It checks your format

On import, Offset reads the file and tells you about:

- **tokens it doesn't recognise** — `{{client.gst}}` instead of `{{client.gstin}}`
  would otherwise print as a blank space on a sent invoice;
- **blocks you didn't close**;
- **missing essentials** — no line loop, no total, no invoice number.

These are warnings, not refusals. It's your format, and a delivery note
legitimately has no total.

### Sharing a format

Export writes a `.json` file carrying the layout, name and paper size. Import it
in another browser, or send it to whoever else needs to raise the same invoice.

## The numbers

- **GST** splits automatically from the two GSTINs: same state code means CGST +
  SGST, different means IGST, and no GSTIN on either side means no tax lines at
  all. A line may carry its own rate when one invoice mixes them.
- Arithmetic is done in paise, and the halves of a CGST/SGST split always add
  back to the tax charged even when it can't be halved evenly.
- **Amounts in words** use Indian grouping — "one lakh twenty thousand", not
  "one hundred twenty thousand".
- **Numbering** is a pattern, not a counter: `INV-{FY}-{0001}` gives
  `INV-26-27-0007`. `{FY}` is the April–March financial year, `{YYYY}` and
  `{MM}` are available, and the zeros in `{0001}` set both the starting number
  and the padding. The counter advances when you download a PDF.
- **From ledger** pulls the chosen asset's income for the chosen period
  (`YYYY-MM`) straight in as line items.

Your own details are remembered on the device; the client's are per invoice.

## Output

- **Download PDF** renders the document offscreen and paginates it onto A4 or
  Letter. The layout is exactly what the preview shows.
- **Print** hands the document to the browser's own print pipeline, which keeps
  the text as text — selectable, searchable and much smaller. If you want the
  crispest possible PDF, print to PDF.

## Safety

A format may have been emailed to you by your accountant, so it isn't trusted:
`<script>` blocks, inline event handlers and `javascript:` URLs are stripped
before it is stored, and the preview runs in a fully sandboxed iframe. Values
from your ledger are HTML-escaped, so a tenant called "Smith & Sons" can't break
the markup and an entry can't inject anything into the document.

Formats are stored in this browser, not in your account.

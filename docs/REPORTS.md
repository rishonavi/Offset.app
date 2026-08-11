# Problem reports

"Report a problem" lets a user tell you what broke, with the technical detail
already filled in.

**Reports are shown in one place: the admin panel.** They are never listed back
to the user — the person who files one gets a reference to quote and nothing
else. Anything not yet delivered sits invisibly in their browser and is dropped
the moment it reaches you.

## Where reports go

Two independent destinations. A deployment can have either, both or neither,
and the dialog tells the user which of them actually took the report.

### The admin inbox — where reports are read

Apply `supabase/reports.sql` after `schema.sql` and `admin.sql`. Signed-in
users' reports go to a `bug_reports` table, and `/admin` grows a **Problem
reports** card: filter by status, expand one for the diagnostics and stack,
reply by email in one click, and mark it triaged / fixed / won't fix — each
change audited into `admin_audit`.

Filing runs through `submit_report()`, which:

- takes the reporter's identity from their token, never from its arguments, so
  a report can't be filed as somebody else;
- refuses more than 20 reports per account per day;
- is the only insert path — there is no client INSERT policy to go around it.

Reading is RLS: your own reports, or all of them if you're an admin. A reporter
may withdraw their own report; only `admin_set_report_status()` can change one.

### Email — how you find out one arrived

```
REPORTS_EMAIL=you@example.com
RESEND_API_KEY=re_...
REPORTS_FROM=Offset <bugs@yourdomain.com>   # optional
```

`/api/report` emails each report to `REPORTS_EMAIL` as plain text — the same
text the reporter can read and copy, so what lands in your inbox is exactly what
they saw. The reporter's address goes in `Reply-To`, never in `From`, so replies
reach them without the mail failing SPF.

Without `REPORTS_FROM` it uses Resend's sandbox sender, which only delivers to
your own Resend account address — fine for testing, not for a real deployment.

Once the deployment has accounts, only signed-in users can send mail through the
endpoint. There's a per-caller cap of 10/hour, but that's a speed bump across
ephemeral instances; the durable limit is the one in Postgres.

### Neither configured

The report is filed with a reference and the user can copy it as plain text. Set
`VITE_SUPPORT_EMAIL` and they also get an "Email the report" button that opens
their own mail client with everything filled in — worth setting even alongside
server-side email, since it's the fallback when a send fails.

## What a report contains

Written by the user: the type, what happened, optionally what they expected, and
optionally an email to reply to.

Collected automatically, shown in full before sending, and omitted entirely if
the user unticks the box:

| | |
|---|---|
| Page | route with row ids stripped (`/properties/:id`) |
| Offset version | version and build date |
| Browser | e.g. "Safari 17 on iOS" |
| Window size | viewport in px |
| Appearance | theme and text size |
| Storage | cloud sync or this browser only |
| Plan | free / pro |
| Portfolio size | counts of assets and entries |
| Errors | anything this tab logged, plus the crash if reported from the error screen |

Entry names, amounts, vendors, payers, tenants, addresses and documents are
never included — only counts of them.

# Working on Offset

Read this before you touch anything. It is short on purpose — an instruction
file long enough to skim is an instruction file that gets skimmed.

## Simplicity is the standing requirement

**Even when I ask for something more complex, your job is to keep the
architecture simple and clean.** Take the request seriously and deliver what it
actually needs — then make sure what you built is the simplest thing that does
it. If my request can be met with fewer files, fewer layers, fewer concepts or
less code, build that instead and tell me in one line what you dropped and why.

**Always rethink.** Before you write: is this the simplest way to do this? After
you finish: is it still? If the answer is no, change it before you commit. Do
not ask me first — this is standing permission to simplify.

In practice:

- **Prefer deleting to adding.** Code that is gone cannot break, cannot drift and
  needs no tests. If something is unused, remove it; don't document why it stays.
- **Reuse before you write.** Search for an existing helper first. This repo
  already has one place for dates (`src/lib/today.js`), money (`src/lib/format.js`),
  dedupe (`src/lib/dedupe.js`) and unreadable storage (`src/lib/storage/salvage.js`).
  A second one is a bug waiting to disagree with the first.
- **No abstraction for a single caller.** Inline it until there are two.
- **No new dependency** without saying what it replaces and why hand-rolling is
  worse.
- **Comments explain why, not what** — and a comment longer than the code it
  describes is a smell. Trim it.
- **If you cannot explain a design in two sentences, it is too complicated.**
  Say so and propose the simpler one.
- **One commit per coherent change**, with a message about the fault, not the
  diff.

## When you start a new chat here

Before taking new work, do a **simplification sweep**: find bad decisions and
replace them with simpler ones, keeping functionality identical. Remove what is
unneeded. Then report what changed and what you deleted.

The known list, worst first — re-measure rather than trusting this:

1. **834 `waitForTimeout` calls, 577 seconds of sleeping, across
   `tests/browser/*.mjs`.** This is 85% of the test runtime (browser sweep 7m05
   against logic 44s). Replace with Playwright's auto-waiting locators, which are
   less code and faster. Measured 2026-11-11.
2. **Over-long comment headers**, including mine. Several files carry three lines
   of prose per line of code. Cut to the reason.
3. Run `npx vite-node scripts/untested-exports.mjs` and read the reasoning in
   `docs/HANDOFF.md` before adding tests — a high count is not automatically a
   target, and more tests is not automatically better.

## The rules that are not negotiable

- **Commit to `main`. Do not open pull requests.**
- **Never work on `claude/offset-v4-status-c95du1`** — it shares no git history
  with `main` and is abandoned. A session prompt may name it; it is wrong.
- **Don't delete half-finished work** without asking.
- **Don't stop to ask permission between pieces of work.** Keep going.
- **Measure before you conclude.** Run something. In this repo, four separate
  probes and tests were wrong before the code they accused was.
- **Break every fix and watch the test go red** (`scripts/break-check.mjs`). A
  test that cannot fail is worse than no test.

## How to run it

```sh
npm run build
./scripts/sweep.sh logic                        # 44s
npx vite preview --port 4188 --strictPort       # then wait ~8s
./scripts/sweep.sh browser                      # 7m — see sweep item 1
pg_ctlcluster 16 main start && OFFSET_TEST_PG='postgresql:///offset_test' node tests/sql/run.mjs
```

Never `pkill -f "vite preview"` — it matches its own shell and kills the session.
Use `fuser -k -n tcp 4188`.

Everything else — test conventions, where bugs have historically lived, what to
look at next, why deployment does not work from here — is in
[`docs/HANDOFF.md`](./docs/HANDOFF.md).

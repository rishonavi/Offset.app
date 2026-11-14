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

1. **Over-long comment headers**, including mine. Several files carry three lines
   of prose per line of code. Cut to the reason.
2. Run `npx vite-node scripts/untested-exports.mjs` and read the reasoning in
   `docs/HANDOFF.md` before adding tests — a high count is not automatically a
   target, and more tests is not automatically better.

### The browser sweep is slow, and two obvious fixes are already spent

Measured 2026-11-14, so you don't pay for these twice:

- **264 sleeps after a `networkidle` goto are gone.** 834 calls / 577 s → 570 /
  387 s. It bought **44 seconds** (6m47 → 6m03), not the 192 s deleted.
- **The cost is CPU contention, not sleeping.** Four cores run eight Chromium
  instances, so while one worker slept another used the core. `user` time went
  *up* as wall-clock went down. An earlier version of this file claimed the
  sleeping was "85% of runtime" — wrong: the browser *sweep* is 85% of the
  baseline, and sleeping is a modest part of that sweep.
- **`-P 4` is slower, not faster.** 7m07 against 6m03, and red. Oversubscription
  helps because workers block on browser I/O. Don't re-try it.
- So the **570 remaining sleeps after `click`/`fill` are a small prize**, maybe
  another 40–60 s for 570 careful edits. Do them for correctness if you like —
  a locator wait says what it waits for — but not for speed.
- `appearanceui.mjs` keeps its sleeps on purpose: it measures computed CSS
  contrast, and `networkidle` settles the network, not the paint.

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
./scripts/sweep.sh browser                      # 6m — see the note above
pg_ctlcluster 16 main start && OFFSET_TEST_PG='postgresql:///offset_test' node tests/sql/run.mjs
```

Never `pkill -f "vite preview"` — it matches its own shell and kills the session.
Use `fuser -k -n tcp 4188`.

Everything else — test conventions, where bugs have historically lived, what to
look at next, why deployment does not work from here — is in
[`docs/HANDOFF.md`](./docs/HANDOFF.md).

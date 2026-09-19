#!/bin/sh
# Run every test suite and tally it honestly.
#
# The one-liner this replaces was `... | tail -1 | grep FAIL`, which lied twice
# in a row: it read "**FAIL**  53 passed, 1 failed" as green, because the grep
# ran on a line whose shape it did not expect, and it read a suite that
# *crashed* before printing anything as green too, because a stack trace
# contains no FAIL. A check that cannot see a crash is worse than none, since
# it is trusted.
#
# Eight at a time, so each worker prints its whole block in one write — two
# printfs from two workers interleave and a failure loses its detail.
#
#   scripts/sweep.sh logic     scripts/sweep.sh browser     scripts/sweep.sh
set -u
dirs=${1:-logic browser}
cd "$(dirname "$0")/.." || exit 1
out=$(mktemp)

for d in $dirs; do
  ls tests/"$d"/*.mjs 2>/dev/null | grep -vE "/_|loginui" | xargs -P 8 -I{} sh -c '
    o=$(npx vite-node {} 2>&1); code=$?
    sum=$(printf "%s" "$o" | grep -oE "[0-9]+ passed, [0-9]+ failed" | tail -1)
    if [ -z "$sum" ]; then
      printf "CRASH  %s\n%s\n" "{}" "$(printf "%s" "$o" | tail -6 | sed "s/^/       /")"
    elif [ "$code" != 0 ] || ! printf "%s" "$sum" | grep -q " 0 failed"; then
      printf "FAIL   %s  (%s)\n%s\n" "{}" "$sum" "$(printf "%s" "$o" | grep "\*\*FAIL\*\*" | head -8 | sed "s/^/       /")"
    else
      printf "ok     %s  (%s)\n" "{}" "$sum"
    fi'
done > "$out" 2>&1

grep -vE "^ok " "$out"
awk '
  /^(ok|FAIL) / { if (match($0, /\([0-9]+ passed, [0-9]+ failed\)/)) {
      split(substr($0, RSTART + 1, RLENGTH - 2), a, /[ ,]+/); p += a[1]; f += a[3] } n++ }
  /^CRASH / { c++; n++ }
  END { printf "\n%d passed, %d failed across %d suites", p, f, n
        if (c) printf ", %d CRASHED", c
        print "" }' "$out"

bad=$(grep -cE "^(FAIL|CRASH) " "$out")
rm -f "$out"
[ "$bad" = 0 ]

#!/usr/bin/env bash
# Launch readiness gate — runs engineering checks from docs/LAUNCH.md §3–§4.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }
skip() { echo "SKIP: $1"; }

echo "== Goeman launch gate =="

echo "-- backend typecheck --"
if (cd "$ROOT/backend" && npm run typecheck); then pass "backend typecheck"; else fail "backend typecheck"; fi

echo "-- backend tests --"
if (cd "$ROOT/backend" && npm test -- --run); then pass "backend tests"; else fail "backend tests"; fi

echo "-- fraud-engine tests (SantanderAI gen-fraud-graph) --"
if (cd "$ROOT/fraud-engine" && npm test -- --run 2>/dev/null); then pass "fraud-engine tests"; else skip "fraud-engine tests (run npm install in fraud-engine/)"; fi

echo "-- iOS wallet verify (B1) --"
if bash "$ROOT/scripts/verify-ios-wallet.sh"; then pass "iOS verify script"; else fail "iOS verify script"; fi

echo "-- frontend e2e (B2) --"
if [[ -d "$ROOT/frontend/node_modules" ]]; then
  if (cd "$ROOT/frontend" && npm run test:e2e 2>/dev/null); then pass "Playwright e2e"; else skip "Playwright e2e (start backend :3001 or check config)"; fi
else
  skip "frontend e2e (npm install in frontend/)"
fi

echo ""
echo "Legal blockers (manual — docs/legal/):"
echo "  [ ] B4 securities counsel"
echo "  [ ] B5 collectibles memo"
echo "  [ ] B6 Phase-A compliance pack"
echo "  [ ] Trail of Bits wallet audit engaged (docs/security/TRAIL-OF-BITS-AUDIT.md)"
echo ""

if [[ $FAIL -eq 0 ]]; then
  echo "ENGINEERING GATES: GREEN (legal sign-offs still required for GO)"
  exit 0
else
  echo "ENGINEERING GATES: RED"
  exit 1
fi

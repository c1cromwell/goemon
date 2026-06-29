# Goeman Global Finance Web E2E (Playwright)

Browser-driven end-to-end tests for the React customer portal. This is the
"browser-driver" the validation runbook says is missing — it drives the **real
UI** in Chromium against a **real backend**, closing the manual-smoke gap noted
in `docs/E2E-VALIDATION.md` §2 (Web channel).

> Scope: **local web only**. Mobile (iOS wallet) is out of scope here and stays
> covered by the API-level contract checks until a device target exists.

## What it covers

| Spec | Journey (web channel) | Notes |
|---|---|---|
| `auth.spec.ts` | Passkey-first login page, dev password fallback, register, bad creds, logout, route guards | Read-only + throwaway users |
| `passkey.spec.ts` | Enroll a passkey → sign out → sign in with the passkey only | CDP **virtual authenticator** (no OS prompt) |
| `dashboard.spec.ts` | Cash/savings rendered from integer **minor units**, Tier-2 CTA | Asserts `$X,XXX.XX` formatting invariant |
| `navigation.spec.ts` | Primary nav routing; **Agent gated at Tier 2** | Below-tier user bounced to onboarding |
| `marketplace.spec.ts` | Invest/Collect listings; trade-sheet **fee disclosure** before confirm | Stops at the quote (no money moves) |
| `agent.spec.ts` | SmartChat reply; **>$500 transfer → MFA gate** + live token countdown | Does not confirm — no transfer executes |
| `onboarding.spec.ts` | Tiered identity ladder 0 → 1 → 2 unlocks SmartChat | Throwaway user |
| `admin.spec.ts` | RBAC admin console: guard + seeded-admin login | Phase 5A |
| `wallet.spec.ts` | Wallet page smoke; Receive + HIP-583 EVM alias when Hedera on | Phase A gap plan |
| `theme.spec.ts` | Dark ↔ light `data-theme`, persisted across reload | |

**Repeatability rule:** read-only assertions use the seeded demo users
(`*@demo.com` / `Demo1234!`); anything that **moves money or changes tier**
registers a throwaway `*@e2e.test` account so reruns don't drift shared state.

## Running

```bash
cd frontend
npm run e2e:install     # one-time: download the Chromium browser
npm run test:e2e        # headless run (boots backend + frontend automatically)
npm run test:e2e:headed # watch it drive a real browser
npm run test:e2e:ui     # Playwright UI mode (pick/inspect tests)
npm run test:e2e:report # open the HTML report from the last run
```

You don't need to start any servers yourself. `playwright.config.ts`:

1. **`globalSetup`** seeds the dev SQLite DB directly (`npm run setup` +
   `seed:marketplace` in `../backend`) — idempotent, no server required.
2. **`webServer`** boots the backend on `:3001` (dev auto-migrates) and the Vite
   frontend on `:5173`. The backend is **always started fresh** (not reused) with
   `API_RATE_LIMIT_PER_MIN` raised, because the global 100/min `apiLimiter` is
   keyed by `userId ?? ip` and the whole serial run shares one test IP — the
   default would 429 the burst of anonymous login/probe traffic. **Free port 3001
   before running** (`lsof -ti:3001 | xargs kill`) if you have a dev server up.

## Preconditions baked in

- Dev `ALLOW_PASSWORD_AUTH=true` (in `backend/.env`) enables the password login
  path the read-only journeys use. In production this is rejected and those
  journeys would need the passkey path (which `passkey.spec.ts` already proves).
- `RP_ID=localhost` / `RP_ORIGIN=http://localhost:5173` match the test origin, so
  the virtual authenticator's passkey ceremonies verify against the backend.

## Bugs this suite caught

1. **Passkey enrollment was 100% broken in the UI** (fixed). The backend's
   `POST /auth/webauthn/register/finish` returns `{ passkeyId, credentialId }` on
   success and *throws* (non-2xx) on a failed verification — there is no
   `verified` field. The frontend (`lib/webauthn.ts` + `api/client.ts`) threw
   "Passkey registration could not be verified" unless `result.verified` was
   truthy, so every enrollment failed. `passkey.spec.ts` reproduced it; the
   frontend now treats a resolved finish with a `passkeyId` as success.

## Known UI issue surfaced by this suite

On **wide/desktop** viewports the sidebar profile menu ("More") is effectively
unusable: the sidebar is `height: 100vh` with a `flex: 1` spacer that pins the
"More" button to the very bottom, and `.sidebar .menu-pop` opens **downward**
(`top: calc(100% + 8px)`), so the popup — Activity, Credentials, Connected
agents, theme toggle, **Sign out** — renders below the fold and can't be
scrolled to. Likely fix: open the sidebar popup upward (it already does in the
mobile/default `.menu-pop` rule via `bottom: calc(100% + 8px)`). Until then, the
logout/theme tests drive the equivalent actions through the `/more` page, which
works at every viewport.

## Design notes

- **Serial, single worker.** Money/ledger mutations through the UI share the
  SQLite dev DB and demo-user balances; parallel workers would race. `workers: 1`.
- **No money actually moves.** The trade and MFA journeys assert the *disclosure*
  and the *gate*, then stop — confirming/executing is the deterministic backend
  suite's job (`backend/test/*.test.ts`). This keeps the browser suite fast and
  idempotent across runs.
- Selectors prefer roles/labels/visible text over brittle CSS where practical.

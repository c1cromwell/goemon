# Frontend UX Review — the simple-flow approach across all pages

A review of every customer-facing page to confirm a consistent, simple approach to all flows — done
after surfacing the X-Money-response features (Earn, Requests, Send abroad, Drops, Self-custody, card
cashback) on the frontend.

> **Verdict: consistent and simple.** All 28 portal pages share one design system ("Quiet Premium") and
> one flow pattern; the six new features were built to match it. Frontend typechecks and builds clean
> (83 modules, ~98 kB gzip). A few small recommendations below; none block.

---

## 1. The shared flow pattern (every page follows it)

Each page is the same shape, which is *why* the app feels simple:

```
<div className="page stack lg">
  <h1> + one muted subtitle            ← what this is, in one line
  hero card (a number + ONE primary action)   ← the main thing
  one or two small cards (inputs)      ← minimal fields, then a button
  a list / Empty state                 ← what's happened
</div>
```

Cross-cutting conventions, applied uniformly:
- **Money only from integer minor units** via `formatMoney`/`formatUnits` (never floats).
- **Idempotency-Key auto-attached** to money POSTs (`umoney` + `newIdempotencyKey`).
- **Graceful states**: `<Loading/>` while fetching, `<Empty/>` for empty lists, a friendly notice when a
  feature is disabled (kill-switch off) instead of an error.
- **One feedback channel**: `useToast` for every success/failure; errors branch on the stable `ApiError.code`.
- **One accent, type-led hierarchy, dark+light** (`data-theme`); flat nav + a "More" menu for secondary pages.

---

## 2. Consistency matrix (audit)

`✓` = present and appropriate; `—` = not applicable to that page type.

| Page | h1 | Loading | Empty | Toast | Money | ApiError | Notes |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Dashboard | ✓ | ✓ | — | — | ✓ | — | hero + quick actions (now incl. **Earn**) |
| **Earn** (F1) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | position hero + APY pill; buy/redeem; disabled notice |
| **Requests** (F3) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | create + received/sent toggle + pay/decline/cancel |
| **Send abroad** (F6) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | quote-then-send; currency selectors |
| **Drops** (F5) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Browse/Create/Owned tabs; disabled notice |
| **Self-custody** (F2) | ✓ | ✓ | — | ✓ | ✓ | ✓ | report + guarantee + export (report, not a list → no Empty) |
| Cards (+F4 cashback) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | cashback card surfaces when > 0 |
| Bank · Bills · Pay · Fx · Escrow · Trade · Wallet | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | money pages — fully consistent |
| Starter (guardian/teen) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | consistent |
| Market · AssetDetail · CollectPurchases/Sell · Activity | ✓ | ✓ | ✓ | mixed | ✓ | mixed | consistent for their type |
| Agent · Console | ✓ | — | — | — | — | ✓ | specialized (chat / terminal) — own UX, intentionally |
| Login · Register · Onboarding · AdminLogin | ✓ | — | — | — | — | — | auth/forms — no list/money, correct |
| More | ✓ | — | — | — | — | — | a menu |

**Reading of the matrix:** every *money/feature* page has the full set (Loading/Empty/Toast/Money/ApiError);
the only blanks are on page types that legitimately don't need them (auth forms, the menu, the chat/terminal
specialists). No page is an outlier on the core pattern.

---

## 3. The six new flows — each is one screen, one primary action

- **Earn** — a balance hero (value + "X.XX% APY" pill) and a single amount field with **Move to Treasury** /
  **Redeem**. Two taps to earn; the differentiator ("yours, redeemable anytime") is in the subtitle.
- **Requests** — one create form + a **Received/Sent** toggle; received items have **Pay**/**Decline**, sent
  have **Cancel**. No modal, no wizard.
- **Send abroad** — recipient + two currency dropdowns + amount → **Preview** ("they receive X") → **Send**.
  The quote-before-commit is the only "step," and it's optional clarity, not friction.
- **Drops** — **Browse / Create / Owned** tabs; Browse has a one-tap **Claim**; Create is 3 fields.
- **Self-custody** — read-only: "Yours (no one can freeze)" vs. "Custodial (disclosed)" + the guarantee +
  one **Export my data** button (downloads the signed manifest).
- **Card cashback** — a single card on the Cards page showing total earned in USDC; appears only when > 0
  (no empty clutter).

All degrade gracefully when their kill-switch is off (a one-line "set X_ENABLED" notice, never a raw error).

---

## 4. Findings & small recommendations (non-blocking)

- ✅ **Discoverability improved**: added **Earn** to the Dashboard quick actions (next to Invest/Collect) —
  the flagship anti-6%-APY feature is now one tap from Home, not buried in More.
- 🟡 **Recipient by id, not handle**: Requests / Send abroad take a `userId`. Fine for the prototype; a
  username/contact picker is the obvious polish before real users (a small follow-up, not a redesign).
- 🟡 **More menu is getting long** (now ~20 entries). Consider grouping ("Money", "Collect", "Trust",
  "Account") when it grows further. Not urgent.
- 🟢 **Consistent empties/disabled**: every new page handles the kill-switch-off and empty cases the same
  way as the existing pages — no dead-ends.

---

## 5. Conclusion

The frontend **already embodies a simple, consistent approach** — one design system, one page shape, one
feedback channel, money rendered safely, graceful states everywhere. The six X-Money-response features were
surfaced **inside that pattern**, so they feel native, not bolted on. No flow requires more than one screen
and one primary action; nothing needs a redesign. The only forward polish is cosmetic (contact pickers,
eventual nav grouping).

*Surfaced features: `Earn.tsx` (F1), `SelfCustody.tsx` (F2), `Requests.tsx` (F3), `Cards.tsx` cashback (F4),
`Drops.tsx` (F5), `SendAbroad.tsx` (F6) + client methods in `api/client.ts`, routes in `main.tsx`, nav in
`More.tsx`, Dashboard quick action.*

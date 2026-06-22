# Corp B — In-app collectible escrow (no vault partner)

Legal and product posture for **seller P2P slab listings** where Argus holds buyer USDC in escrow until receipt is confirmed. This is **Tier 2** in the collectibles strategy: Argus is the payment intermediary; the seller ships directly; no Courtyard/vault custody partner is required for the money path.

## What ships in the prototype

| Layer | Implementation |
|---|---|
| Money | Existing `escrowService` — payer_cash → escrow → payee_cash (USDC on Hedera when enabled) |
| Asset | Tokenized HTS collectible (qty 1) delivered from treasury on buyer confirm |
| Listing | `listingType: seller_p2p` in asset metadata; instant `placeOrder` blocked |
| State | `collectible_purchases` + escrow row; listing paused while open |
| Kill-switch | `COLLECTIBLES_ESCROW_ENABLED` (off by default; **prod-fatal** when on) |

## User flow

1. **Seller** — cert verify → human review → public listing (`/collect/sell`)
2. **Buyer** — `Buy with escrow` on asset detail → USDC held (`POST /api/collectibles/purchase`)
3. **Seller** — marks shipped (`POST /api/collectibles/purchases/:id/ship`)
4. **Buyer** — confirms receipt → escrow release + asset to buyer (`POST .../confirm`)
5. **Dispute** — either party disputes; compliance/admin resolves via existing `/api/admin/escrow/:id/resolve` (asset delivery syncs automatically)

## Corp B triggers (counsel before production)

- **Money transmission / MSB** — holding third-party funds pending performance
- **Marketplace intermediary** — connecting buyers and sellers; dispute mediation
- **Not custody** — Argus does not take possession of the physical slab in this lane (seller ships)
- **Securities** — seller P2P collectibles are non-security HTS collectibles (`isSecurity: false`)

## Config

```bash
# Dev/demo — enable in-app buy/escrow
COLLECTIBLES_ESCROW_ENABLED=true

# Production — blocked until counsel + licensing path (see CORP-B-RAMP.md)
# COLLECTIBLES_ESCROW_ENABLED=true  # → process refuses to start
```

## API surface

```
POST   /api/collectibles/purchase              Idempotency-Key required
GET    /api/collectibles/purchases
GET    /api/collectibles/purchases/:id
POST   /api/collectibles/purchases/:id/ship    seller
POST   /api/collectibles/purchases/:id/confirm buyer
POST   /api/collectibles/purchases/:id/cancel  seller (before ship)
POST   /api/collectibles/purchases/:id/dispute either party
```

Generic `/api/escrow/:id/release|refund` is **blocked** when the escrow row is tied to a collectible purchase — use the purchase endpoints instead.

## Differentiation from Tier 3 (Courtyard)

| | Tier 2 (this) | Tier 3 (partner) |
|---|---|---|
| Physical custody | Seller ships | Vault partner holds |
| Cert attestation | PSA/GemRate API + human review | Partner inventory sync |
| Config | `COLLECTIBLES_ESCROW_ENABLED` | `COLLECTIBLES_PROVIDER=courtyard` |
| Legal surface | MSB / marketplace intermediary | Custody + bailee agreements |

## Frontend

- Asset detail — **Buy with escrow** for `purchaseMode: escrow`
- `/collect/purchases` — buyer/seller actions (ship, confirm, dispute)
- Admin dispute queue unchanged (`/admin` → escrow disputes)

## Related docs

- `docs/business/CORP-B-RAMP.md` — partner cutover matrix
- `docs/legal/B5-collectibles-memo.md` — collectibles legal memo (if present)

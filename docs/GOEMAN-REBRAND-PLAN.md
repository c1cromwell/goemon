# Goeman Global Finance — full rebrand & repo migration plan

**Status: R2 complete (June 2026). R3 verify ✅. R4 repo rename next.**

| Field | Value |
|---|---|
| **Legal name** | Goeman Global Finance, LLC (Phase A — **new Wyoming LLC**; convert to Delaware C-corp at raise) |
| **DBA / product name** | **Goeman** |
| **Domain** | [goemanglobal.com](https://goemanglobal.com) |
| **Repo** | **`goeman`** (`github.com/c1cromwell/goeman`) |
| **Local directory** | `~/Projects/goeman` (from `bankai`) |
| **Replaces** | Goeman Global Finance · repo `bankai` · `@goemanglobal.com` demo seeds |

### Decisions locked (CEO, June 2026)

| ID | Decision |
|---|---|
| QG-1 | Repo name: **`goeman`** |
| QG-3 | Entity: **new Wyoming LLC** (Goeman Global Finance, LLC) — not amend/convert Argus LLC |
| QG-6 | Repo migration: **rename in place** (§5.1) — easiest and best for this project |
| QG-4 | Logo direction: **deferred** (concepts in `docs/goeman/logo-concepts/`) |
| QG-5 | Public folklore on marketing: **deferred** |
| QG-2 | `CLAUDE.md` filename: **open** — default keep for AI tool compatibility |

---

## 1. Brand narrative (for docs, counsel, design)

### Folklore anchor — Ishikawa Goemon (石川 五右衛門)

In Japanese folklore, Goemon robbed the rich and powerful and redistributed to the oppressed — a **Robin Hood figure** and symbol of resistance to unjust rulers. Historically he was likely an **Iga-trained operative** turned outlaw. For Goeman Global Finance this maps to product truth, not marketing fiction:

| Folklore theme | Goeman product expression |
|---|---|
| Rob from oppressive intermediaries | Zero-interchange native rail, agent-native commerce, transparent fees |
| Protect the vulnerable | Non-custodial wallet, VP-gated agents, fraud freeze, escrow |
| Outlaw vs. establishment | Tokenization + stablecoin rail vs. legacy bank/card stack |
| Iga discipline | Double-entry ledger, append-only audit, human gates on money/legal |

**Do not** claim Goemon as a trademarked character or use exploitative ninja caricature in regulated copy. Use **abstract** katana / 誠 / discipline motifs (see logo concepts).

### Japanese framing

| Text | Meaning | Use |
|---|---|---|
| **剣に生き剣に死す** | Live by the sword, die by the sword | Founder/culture doc; optional brand story (heavy) |
| **誠** (*makoto* — sincerity) | Honor every word and decision | Primary kanji mark; subtler customer-facing option |
| Product translation | *We honor every decision for our customers, or we cease to exist.* | About page, Agentic OS charter, compliance culture |

### Motto (customer-facing)

> **Build | Protect | Preserve** — *Your Trust & Your Assets*

| Pillar | Product proof |
|---|---|
| **Build** | Tokenized assets, savings, agent commerce, wealth tools |
| **Protect** | Non-custodial keys, VP/MCP scopes, fraud, reconciliation gates |
| **Preserve** | Ledger truth, append-only audit, human CEO/legal gates |

---

## 2. Scope audit — what “replace Argus” touches

Automated scan (June 2026): **~250+ files** contain `argus` / `Argus` / `ARGUS` (case variants). **`bankai` appears 0 times** in content — only the GitHub repo name and local folder matter for that string.

### 2.1 Categories (replace strategy)

| Category | Examples | Strategy |
|---|---|---|
| **A — Customer-visible** | UI copy, `index.html` titles, emails, `@goemanglobal.com` seeds | **Replace** → Goeman / goemanglobal.com |
| **B — Legal / corporate** | `CORPORATE-STRUCTURE.md`, B6 pack, entity names | **Replace** → Goeman Global Finance LLC |
| **C — Repo / package names** | `argus-backend`, `ArgusWallet`, `argus-agent`, `com.argusfinancial.wallet` | **Rename dirs + package IDs** (breaking for mobile) |
| **D — Internal protocol IDs** | `did:argus:checkout`, `CHECKOUT_VERIFIER_DID`, Conductor task queues | **Migrate** with compatibility window or one-shot test DB reset |
| **E — Env / config** | `SQLITE_PATH=./data/argus.db`, `RP_NAME`, docker compose service names | **Replace** defaults; document migration |
| **F — Feature flags** | `ARGUS_PAY_ENABLED` | **Rename** → `GOEMAN_PAY_ENABLED` (+ alias period) |
| **G — Docs archive** | `docs/goeman_prdv1/` | **Rename** → `docs/goeman_prdv1/` + content pass |
| **H — AI / skills** | `argus-mcp-test-harness`, `CLAUDE.md` | **Rename** skills; add `GOEMAN.md` or retitle `CLAUDE.md` |
| **I — Historical** | Git commit messages, old PDFs | **Leave** or add redirect note in README |

### 2.2 Do NOT blindly global-replace

| Pattern | Why careful |
|---|---|
| `argus` in `package-lock.json` | Regenerate via `npm install` after `package.json` rename |
| Mirror node / Hedera token IDs | Unrelated strings |
| Third-party docs quoting competitors | Editorial only |
| `Argus` in git history | Preserve; optional `git filter-repo` only if secrets leaked |

---

## 3. Naming matrix (authoritative)

| Old | New |
|---|---|
| Goeman Global Finance | **Goeman Global Finance** (legal) / **Goeman** (product) |
| Goeman Global Finance, LLC | **Goeman Global Finance, LLC** |
| argus / bankai (repo) | **goeman** (recommended short repo name) |
| `backend/` package `argus-backend` | `goeman-backend` |
| `frontend/` package `argus-frontend` | `goeman-portal` |
| `argus-agent/` | `goeman-agent/` |
| `ArgusWallet/` | `GoemanWallet/` |
| `ArgusWalletAndroid/` | `GoemanWalletAndroid/` |
| `fraud-engine/` | keep or `goeman-fraud-engine` (optional) |
| `@goemanglobal.com` | `@goemanglobal.com` (demo seeds) |
| `admin@goemanglobal.com` | `admin@goemanglobal.com` |
| `did:argus:*` | `did:goeman:*` |
| `ARGUS_PAY_ENABLED` | `GOEMAN_PAY_ENABLED` |
| `GOEMAN-PLAN.md` | `GOEMAN-PLAN.md` |
| `docs/AGENTIC-OS.md` | Retitle → **Goeman Agentic OS** (content pass) |
| Quiet Premium jade `#2dd4a7` | **Keep** or shift to deeper 誠-green — design pass after logo pick |

---

## 4. Corporate & legal doc updates

Update in **Phase R2** (before external launch):

| Document | Key edits |
|---|---|
| `docs/business/CORPORATE-STRUCTURE.md` | Entity → Goeman Global Finance LLC; subsidiary names → Goeman Tech / Goeman Markets; §9 bank naming |
| `docs/legal/B6-phase-a-compliance-pack.md` | Wyoming formation checklist |
| `docs/legal/B4-securities-counsel-memo.md` | Product description |
| `docs/legal/B5-collectibles-legal-memo.md` | Marketplace operator name |
| `docs/business/GO-LIVE-PLAN.md` | All Argus references |
| `docs/business/LAUNCH-READINESS.md` | Brand gate Q-BRAND-001 → **closed** |
| `docs/goeman_prdv1/*` | Rename folder + module 11 brand question → resolved |
| IP assignment | Assign repo IP to **Goeman Global Finance, LLC** (not Argus LLC) |

**Counsel actions (parallel):**

1. Form **Goeman Global Finance, LLC** (WY) or amend existing entity via conversion
2. File **DBA “Goeman”** in operating states
3. Trademark search: “Goeman”, “Goeman Global Finance”, logo marks
4. Domain: `goemanglobal.com` DNS + email (Google Workspace / Proton)
5. Update MSB/partner questionnaires when Corp B starts

---

## 5. GitHub & local directory migration runbook

### 5.1 **Recommended: rename repo in place** (easiest + best here)

**Why this over a new repo:** one GitHub Settings change; GitHub **auto-redirects** `…/bankai` → `…/goeman`; CI secrets, issues, and full history stay attached; no second remote or archive stub. Commit messages may still say “bankai” — that is fine and auditable.

**When to use §5.2 instead:** you need a hard split (different GitHub org, scrubbed history, or incompatible access controls). Not needed for this rebrand.

**Order:** finish R1–R3 on a `rebrand/goeman` branch, merge to `main`, **then** rename (so the default branch already says Goeman).

```bash
# --- GitHub (web UI) ---
# Repo Settings → General → Repository name: bankai → goeman → Rename

# --- Local (after rename on GitHub) ---
cd ~/Projects/bankai
git remote set-url origin git@github.com:c1cromwell/goeman.git
git fetch origin
cd ~/Projects && mv bankai goeman && cd goeman

# --- Cursor / IDE ---
# File → Open Folder → ~/Projects/goeman
```

Old clone URLs keep working via GitHub redirect; update remotes when convenient.

### 5.2 Alternative: **new repo + mirror push + archive `bankai`**

Use only if you want `bankai` archived as a tombstone with a pointer README.

```bash
cd ~/Projects/bankai
git checkout -b rebrand/goeman
# ... R1–R3 ...
git remote add goeman git@github.com:c1cromwell/goeman.git
git push goeman rebrand/goeman:main
cd ~/Projects && mv bankai goeman && cd goeman
git remote remove origin
git remote add origin git@github.com:c1cromwell/goeman.git
# Archive c1cromwell/bankai on GitHub
```

### 5.3 CI / deploy / secrets checklist

| System | Action |
|---|---|
| GitHub Actions | Update repo name; secrets unchanged if keys are env-based |
| Vercel / Fly / Render | New project linked to `goeman` repo |
| Docker images | Retag `argus-backend` → `goeman-backend` |
| Cursor / Claude project | Update workspace path to `~/Projects/goeman` |
| npm publish (if any) | New scope `@goemanglobal/*` |

---

## 6. Engineering execution phases

### Phase R0 — Decision gate (1 day)

- [x] CEO: repo **`goeman`**, entity **new WY LLC**, migration **rename in place**
- [ ] Form **Goeman Global Finance, LLC** (Wyoming) + IP assignment to new LLC
- [ ] Register domain + email on `goemanglobal.com`
- [ ] Logo direction — **deferred**
- [ ] Public folklore copy — **deferred**

### Phase R1 — Docs & brand ✅ (June 2026)

- [x] Add `docs/GOEMAN-BRAND.md` (narrative §1 + voice/tone)
- [x] Replace customer/legal strings in `docs/business/*`, `docs/legal/*`, PRD folder rename → `docs/goeman_prdv1/`
- [x] HTML/PDF regen complete (June 2026) — all `docs/business/*.md` exports
- [x] Update `CLAUDE.md` → Goeman Global Finance; kept filename for AI tool compatibility
- [x] Close PRD Q-BRAND-001 in module 11

**Regenerate HTML/PDF** (if business `.md` changes later):

```bash
cd docs/build && npm install
for f in ../business/*.md; do node render.mjs "$f" --title "$(basename "$f" .md)"; done
```

### Phase R2 — Code identifiers ✅ (June 2026)

1. **Package names** — `goeman-backend`, `goeman-portal`, `goeman-agent`, `goeman-fraud-engine`
2. **Config defaults** — `RP_NAME`, `SQLITE_PATH=goeman.db`, `GOEMAN_PAY_ENABLED` (+ `ARGUS_PAY_ENABLED` env alias)
3. **DIDs** — `did:goeman:*`, `did:web:goemanglobal.com`, `CHECKOUT_VERIFIER_DID`
4. **Seeds** — `@goemanglobal.com` admin/CEO/CS/demo paths
5. **Directories** — `goeman-agent/`, `GoemanWallet/`, `GoemanWalletAndroid/`, `goeman-mcp-test-harness`
6. **Deep links** — `goeman-wallet://`, `GOEMAN_API_BASE`
7. **Tests** — backend **419 pass** / fraud-engine **44 pass**

### Phase R3 — Verify ✅ (June 2026)

```bash
cd backend && npm run typecheck && npm test
cd fraud-engine && npm test
```

### Phase R4 — Repo rename (§5.1) + local `mv bankai goeman`

### Phase R5 — External surfaces

- [ ] App Store / Play listing placeholders
- [ ] Website landing on `goemanglobal.com`
- [ ] Update LinkedIn / deck / investor materials

---

## 7. Test & breaking-change notes

| Change | Impact | Mitigation |
|---|---|---|
| `did:argus:*` → `did:goeman:*` | MCP clients, wallet binding, grants | Re-run `npm run setup`; re-link agent app |
| `@goemanglobal.com` seeds | All e2e login tables | Update `frontend/e2e/helpers/users.ts`, admin seeds |
| Android/iOS bundle ID | New app identity | New TestFlight / internal track |
| `ARGUS_PAY_ENABLED` rename | `.env` files | Document in `.env.example`; support alias 1 release |
| SQLite path `argus.db` | Local dev only | Default `goeman.db`; delete old db or migrate |

---

## 8. Agentic OS re-expression

The Agentic OS (M1–M6) stays architecturally identical; rebrand is **nominal + charter**:

- Corporate agents: CFO/CLO/CISO/CPO → serve **Goeman Global Finance**
- CEO gate categories unchanged
- `docs/AGENTIC-OS.md` → `docs/GOEMAN-AGENTIC-OS.md` (optional)
- Logo panel in `/admin/approvals` → Goeman mark
- Ninja/誠 motifs align with existing `docs/agentic-os/logo-concepts/` — **migrate best concepts to `docs/goeman/logo-concepts/`**

---

## 9. Logo concepts (10 samples)

See **`docs/goeman/logo-concepts/`** — SVG concepts 01–10:

| # | File | Idea |
|---|---|---|
| 01 | `01-kanji-makoto.svg` | 誠 sincerity — primary subtler mark |
| 02 | `02-crossed-katanas.svg` | Discipline + balance (Build/Protect) |
| 03 | `03-globe-katana.svg` | Goeman **Global** + blade arc |
| 04 | `04-shield-blade.svg` | Protect pillar |
| 05 | `05-wordmark-goeman.svg` | Typographic DBA lockup |
| 06 | `06-three-pillars.svg` | Build \| Protect \| Preserve |
| 07 | `07-hanko-go.svg` | Seal-style 豪 / G monogram |
| 08 | `08-ichimonji-ken.svg` | Single horizontal cut — 剣に生き |
| 09 | `09-ninja-negative.svg` | Abstract hood + coin (folklore, not cartoon) |
| 10 | `10-full-lockup.svg` | Mark + Goeman + motto strip |

Open `docs/goeman/logo-concepts/index.html` in browser for side-by-side review.

**Next design step:** pick 1–2 directions → vector polish → trademark screen → favicon/app icon set.

---

## 10. Open questions

| ID | Question | Status |
|---|---|---|
| QG-1 | Repo name | **Resolved:** `goeman` |
| QG-2 | `CLAUDE.md` vs `GOEMAN.md` | Open — default **keep `CLAUDE.md`** |
| QG-3 | Entity path | **Resolved:** new **WY LLC** |
| QG-4 | Color palette | Deferred (logo decision deferred) |
| QG-5 | Public folklore on site | **Deferred** |
| QG-6 | Repo migration | **Resolved:** **rename in place** (§5.1) |

---

## 11. Execution checklist summary

```
R0  Sign-off + domain + entity
R1  Docs / PRD / corporate structure / brand guide
R2  Code + packages + DIDs + seeds + dir renames
R3  typecheck + test + e2e
R4  GitHub rename bankai→goeman + mv ~/Projects/bankai → goeman
R5  Logo final + app stores + website (logo deferred)
```

**Do not start R2 until Wyoming LLC formation + IP assignment path is filed** — assign repo IP to **Goeman Global Finance, LLC**, not Argus LLC.

---

*Plan only — not legal advice. Run entity, trademark, and marketing claims past counsel before filing or launching.*

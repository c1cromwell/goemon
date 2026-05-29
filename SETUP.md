# BankAI — Setup Guide

Step-by-step setup for working on BankAI with Claude Code. macOS-first (you'll need macOS for the iOS wallet later); notes for Linux/Windows where they differ.

## 0. Prerequisites

- **Node.js 18+** (Node 22 LTS recommended). Check: `node --version`. Install via [nvm](https://github.com/nvm-sh/nvm) or nodejs.org.
- **An Anthropic account** for Claude Code — a Claude Pro/Max subscription or Console (API) credits.
- **git**.
- (Later, for the iOS wallet) **Xcode** on macOS.
- (Optional, for Postgres instead of SQLite) **Docker**.

## 1. Install Claude Code

Two options — the native installer (recommended, no Node dependency) or npm.

**Native installer (macOS/Linux):**
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**npm (cross-platform, requires Node 18+):**
```bash
npm install -g @anthropic-ai/claude-code
```
Do **not** use `sudo` with the npm install. If you hit `EACCES` errors, configure a user-writable npm prefix:
```bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Verify:
```bash
claude --version
```

(Windows: install under WSL — Ubuntu 20.04+ — and run the same commands inside WSL.)

## 2. Get the project onto your machine

1. Download the `bankai.zip` bundle (the file presented alongside this guide in the chat).
2. Unzip it to wherever you keep code, e.g.:
   ```bash
   cd ~/code
   unzip ~/Downloads/bankai.zip
   cd bankai
   ```
3. Initialize git (recommended):
   ```bash
   git init && git add -A && git commit -m "Phase 0 + 1 foundation"
   ```

> If you already have an existing `bankai` repo from the original prototype, don't overwrite it. Unzip this somewhere separate and copy `backend/`, `CLAUDE.md`, and `docs/` in, reconciling by hand. The v2 `backend/` is a clean rebuild, so the safest path is to treat it as the new source of truth for the backend.

## 3. Authenticate Claude Code

From anywhere, run:
```bash
claude
```
On first launch it opens your browser to authenticate with your Anthropic account (OAuth); the token is stored locally in `~/.claude/`. Alternatively, set `ANTHROPIC_API_KEY` in your environment before launching to use API billing.

## 4. Open the project in Claude Code

```bash
cd ~/code/bankai
claude
```
Claude Code automatically reads `CLAUDE.md` at the project root — that file tells it what BankAI is, the current build status, the commands, and the non-negotiable conventions. You do **not** need to run `/init` (the CLAUDE.md already exists).

Good first thing to type in the Claude Code session:
```
Read CLAUDE.md and docs/REBUILD-PLAN-v2.md, then summarize the current build status and what Phase 2 involves.
```

## 5. Verify the backend foundation builds

You can do this yourself, or ask Claude Code to. Manually:
```bash
cd backend
cp .env.example .env
# Open .env and set JWT_SECRET to a strong random value:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npm install
npm run typecheck     # should pass with no errors
npm test              # foundation/security invariants should pass
npm run dev           # boots on http://localhost:3001
```
In another terminal:
```bash
curl http://localhost:3001/api/health
# {"status":"ok","dialect":"sqlite","env":"development"}
```

If `npm run typecheck` reports anything, paste the exact error into your Claude Code session — most likely a small `@types` or `jose` version nuance, quick to fix.

## 6. Continue building, phase by phase

In the Claude Code session, work one phase at a time. For each phase you can either:

- **Point Claude Code at the plan:**
  ```
  Implement Phase 2 from docs/REBUILD-PLAN-v2.md. Follow the conventions in CLAUDE.md
  and backend/CONVENTIONS.md. When done, run `npm run typecheck && npm test` and fix
  anything that fails, then update the build-status checklist in CLAUDE.md.
  ```
- Or **paste the phase's prompt block** directly from `docs/REBUILD-PLAN-v2.md`.

After each phase: review the diff, run the checks, and commit:
```bash
git add -A && git commit -m "Phase 2: DID & Verifiable Credentials"
```

## Recommended phase order

The plan lists Phase 2 next. If you'd rather build all monetary code on correct primitives first, do **Phase 4 (double-entry ledger)** before Phase 2/3 — both are valid. Phases 5 (Hedera) and 7 (MCP/VP verification) are the highest-stakes; give those extra review.

## Tips for Claude Code on this project

- Tell it to run the test command after changes (it's in CLAUDE.md, but reinforcing helps): "verify with `npm run typecheck && npm test`."
- Keep changes scoped to one phase per session where you can — easier to review.
- The money rules are the thing to watch. If you ever see a `number` used for an amount, that's a bug — call it out.
- Commit `CLAUDE.md` and `.claude/settings.json` (if you create one) so the setup is reproducible.

## Useful references

- Claude Code docs: https://docs.claude.com/en/docs/claude-code/overview
- This project's plan: `docs/REBUILD-PLAN-v2.md`
- Product requirements: `docs/prd/README.md`
- Backend conventions: `backend/CONVENTIONS.md`

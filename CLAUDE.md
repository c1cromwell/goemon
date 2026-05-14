# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bankai is a CLI-first agentic banking application. Users enroll with KYC/ID verification, then interact with a Claude-powered agent (via Anthropic SDK tool use) that can check balances, transfer funds, pay bills, and manage their profile — with a full append-only audit log and short-lived scoped transaction tokens.

## Stack

- **Python** with `pyproject.toml` (uv or pip)
- **Typer** — CLI framework
- **Rich** — terminal output
- **SQLAlchemy + SQLite** — ORM and persistence
- **Alembic** — database migrations
- **Anthropic SDK** — Claude with tool use and prompt caching on the system prompt
- **PyJWT** — short-lived scoped tokens
- **bcrypt** — password hashing

## Commands

```bash
# Install dependencies
pip install -e ".[dev]"

# Run the CLI
python -m bankai

# Run all tests
pytest

# Run a single test
pytest tests/path/to/test_file.py::test_name -v

# Apply database migrations
alembic upgrade head

# Create a new migration
alembic revision --autogenerate -m "description"

# Lint and format
ruff check .
ruff format .
```

## Architecture

```
bankai/
  cli/           — Typer commands (enroll, login, logout, agent)
  agent/
    tools.py     — Claude tool schemas (JSON schema definitions)
    executor.py  — Scope check, step-up enforcement, transaction token dispatch
  core/
    tokens.py    — JWT encode/decode for all token types
  db/
    models.py    — All SQLAlchemy ORM models
    migrations/  — Alembic migration files
  services/
    audit_service.py  — Append-only audit writes
    kyc_service.py    — Mock identity provider (Phase 1), Persona API stub (Phase 3)
```

### Token Design

| Token | TTL | Scope |
|---|---|---|
| Session | 15 min | scoped by enrollment status |
| Transaction | 90 sec | single-use, cryptographically bound to amount/account/idempotency key |
| Step-up | 5 min | single-use, required for transfers >$500, issued after password re-entry |
| Refresh | 7 days | hashed in DB, stored raw in `~/.bankai/credentials` (chmod 600) |

### Agent Tools

`get_balance`, `initiate_transfer`, `schedule_bill_pay`, `list_transactions`, `update_profile`, `list_payees`, `list_external_accounts`, `request_step_up`, `get_agent_activity`

## Security Constraints

These are non-negotiable — do not relax them:

- All monetary amounts stored as **integer cents** (never float)
- SSN: store **last4 + bcrypt hash only**, never plaintext at rest
- Transaction token `jti` stored after first use — **single-use enforced**
- `AuditEvent` table is **append-only**: SQLite triggers block UPDATE and DELETE
- Agent **never receives unmasked account numbers**
- Transfer confirmation prompts generated from the transaction token payload, not from Claude's text output
- Rate limit: **5 auth failures → 30-min lockout**; **3 enrollment attempts/hour/IP**

## Build Phases

1. Foundation — pyproject, DB models, Alembic, CLI skeleton
2. Enrollment & Auth — KYC mock, JWT, login/logout, credentials file
3. Agent Core — REPL, read-only tools, prompt caching, audit
4. Mutating Operations — transfer, bill pay, profile, step-up, transaction tokens
5. Hardening — scheduler, token rotation, rate limiting, Persona stub
6. Polish — session resume, Rich output, admin audit export

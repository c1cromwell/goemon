-- Pre-launch waitlist capture. No money, minimal PII (email + optional source).
-- Public POST /api/waitlist appends a signup (idempotent on email); RBAC admin
-- reads count + recent. Portable across SQLite/Postgres (TEXT columns only).

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  source      TEXT,                        -- which page/campaign (e.g. 'waitlist', 'home')
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist_signups (created_at);

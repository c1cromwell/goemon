-- Phase 22.0 — Argus Starter: households + guardian↔teen linkage + minor account type.

CREATE TABLE IF NOT EXISTS households (
  id               TEXT PRIMARY KEY,
  guardian_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  name             TEXT NOT NULL DEFAULT 'My Household',
  created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE identity_profiles ADD COLUMN account_type TEXT DEFAULT 'standard';
ALTER TABLE identity_profiles ADD COLUMN guardian_user_id TEXT REFERENCES users(id);
ALTER TABLE identity_profiles ADD COLUMN dob TEXT;
ALTER TABLE identity_profiles ADD COLUMN is_minor INTEGER DEFAULT 0;
ALTER TABLE identity_profiles ADD COLUMN household_id TEXT REFERENCES households(id);

CREATE INDEX IF NOT EXISTS idx_identity_profiles_household ON identity_profiles(household_id);
CREATE INDEX IF NOT EXISTS idx_identity_profiles_guardian ON identity_profiles(guardian_user_id);

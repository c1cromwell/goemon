-- Phase 29 P2 — accredited-investor flag on the identity profile.
-- Wires the compliance-profile "accreditation" dimension to a real, admin-set field
-- (Reg D). 0 = not accredited (default), 1 = accredited. Set by compliance/admin via
-- /api/admin/identities/:userId/accreditation. Portable (INTEGER) across SQLite/Postgres.

ALTER TABLE identity_profiles ADD COLUMN accredited INTEGER DEFAULT 0;

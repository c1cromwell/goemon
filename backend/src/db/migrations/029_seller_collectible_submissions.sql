-- Seller P2P collectible submissions (slabbed cards) with cert verify + human review.

CREATE TABLE IF NOT EXISTS seller_collectible_submissions (
  id                TEXT PRIMARY KEY,
  seller_user_id    TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN ('sports', 'pokemon')),
  grader            TEXT NOT NULL CHECK (grader IN ('psa', 'bgs', 'sgc', 'cgc')),
  cert_number       TEXT NOT NULL,
  title             TEXT,
  description       TEXT,
  ask_usdc_micro    TEXT NOT NULL,
  image_urls        TEXT NOT NULL DEFAULT '[]',
  cert_verified     INTEGER NOT NULL DEFAULT 0,
  cert_source       TEXT,
  cert_payload      TEXT NOT NULL DEFAULT '{}',
  comp_price_minor  TEXT,
  comp_source       TEXT,
  comp_as_of        TEXT,
  ai_grade_payload  TEXT,
  status            TEXT NOT NULL DEFAULT 'pending_human'
                    CHECK (status IN ('pending_cert', 'pending_human', 'approved', 'rejected')),
  rejection_reason  TEXT,
  reviewed_by       TEXT,
  reviewed_at       TEXT,
  asset_id          TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seller_collectibles_seller ON seller_collectible_submissions(seller_user_id);
CREATE INDEX IF NOT EXISTS idx_seller_collectibles_status ON seller_collectible_submissions(status, created_at);

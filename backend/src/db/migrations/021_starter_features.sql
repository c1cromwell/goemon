-- Phase 22.1–22.3 — teen debit controls, savings/goals, gamification.

ALTER TABLE cards ADD COLUMN card_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE cards ADD COLUMN guardian_user_id TEXT REFERENCES users(id);

CREATE TABLE IF NOT EXISTS teen_spend_policies (
  id                  TEXT PRIMARY KEY,
  teen_user_id        TEXT NOT NULL UNIQUE REFERENCES users(id),
  guardian_user_id    TEXT NOT NULL REFERENCES users(id),
  daily_limit_minor   TEXT NOT NULL DEFAULT '5000',
  weekly_limit_minor  TEXT NOT NULL DEFAULT '15000',
  monthly_limit_minor TEXT NOT NULL DEFAULT '50000',
  category_limits     TEXT NOT NULL DEFAULT '{}',
  blocked_merchants   TEXT NOT NULL DEFAULT '[]',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teen_spend_requests (
  id               TEXT PRIMARY KEY,
  teen_user_id     TEXT NOT NULL REFERENCES users(id),
  guardian_user_id TEXT NOT NULL REFERENCES users(id),
  review_id        TEXT REFERENCES agent_reviews(id),
  card_id          TEXT NOT NULL REFERENCES cards(id),
  amount_minor     TEXT NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  merchant         TEXT,
  category         TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  idempotency_key  TEXT UNIQUE,
  card_auth_id     TEXT,
  created_at       TEXT NOT NULL,
  decided_at       TEXT
);

CREATE TABLE IF NOT EXISTS teen_savings_settings (
  teen_user_id          TEXT PRIMARY KEY REFERENCES users(id),
  guardian_user_id      TEXT NOT NULL REFERENCES users(id),
  apy_bps               INTEGER NOT NULL DEFAULT 400,
  guardian_match_bps    INTEGER NOT NULL DEFAULT 5000,
  savings_locked        INTEGER NOT NULL DEFAULT 1,
  round_up_goal_id      TEXT,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS savings_goals (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  name             TEXT NOT NULL,
  target_minor     TEXT NOT NULL,
  allocated_minor  TEXT NOT NULL DEFAULT '0',
  status           TEXT NOT NULL DEFAULT 'active',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_savings_goals_user ON savings_goals(user_id);

CREATE TABLE IF NOT EXISTS interest_accruals (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  period              TEXT NOT NULL,
  apy_bps             INTEGER NOT NULL,
  balance_basis_minor TEXT NOT NULL,
  accrued_minor       TEXT NOT NULL,
  journal_id          TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE(user_id, period)
);

CREATE TABLE IF NOT EXISTS user_streaks (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  streak_type    TEXT NOT NULL,
  current_count  INTEGER NOT NULL DEFAULT 0,
  last_tick_date TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE(user_id, streak_type)
);

CREATE TABLE IF NOT EXISTS user_streak_ticks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  streak_type TEXT NOT NULL,
  tick_date   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_quest_progress (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  quest_id     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  completed_at TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE(user_id, quest_id)
);

CREATE TABLE IF NOT EXISTS user_badges (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id),
  badge_id  TEXT NOT NULL,
  earned_at TEXT NOT NULL,
  UNIQUE(user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS lesson_completions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  lesson_id    TEXT NOT NULL,
  score        INTEGER,
  completed_at TEXT NOT NULL,
  UNIQUE(user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS coach_insights (
  id               TEXT PRIMARY KEY,
  teen_user_id     TEXT NOT NULL REFERENCES users(id),
  guardian_user_id TEXT NOT NULL REFERENCES users(id),
  insight_type     TEXT NOT NULL,
  summary          TEXT NOT NULL,
  payload          TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coach_insights_teen ON coach_insights(teen_user_id);

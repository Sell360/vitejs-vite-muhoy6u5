-- ─────────────────────────────────────────────────────────────────────────
-- BETZ360 — HOUSE PICKS TABLE
-- ─────────────────────────────────────────────────────────────────────────
-- Run in Supabase SQL Editor.
-- Stores the system's daily auto-generated parlays as a public track record.
-- Picks are recorded at lock-time (when the daily picker runs), then auto-
-- settled after games complete via the settle-house-picks scheduled function.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS house_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_date DATE NOT NULL,
  rank INTEGER NOT NULL,           -- 1 = top S-tier parlay of the day, 2/3 = next
  sport TEXT NOT NULL,
  legs JSONB NOT NULL,             -- array of { player, propType, line, pick, odds, gameId }
  combined_odds INTEGER NOT NULL,
  confidence INTEGER NOT NULL,
  tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pending_review', 'won', 'lost', 'push')),
  legs_won INTEGER,                -- how many legs hit (null until settled)
  legs_lost INTEGER,
  legs_pushed INTEGER,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_house_picks_date ON house_picks (pick_date DESC, rank ASC);
CREATE INDEX IF NOT EXISTS idx_house_picks_status ON house_picks (status, pick_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_house_picks_date_rank_sport ON house_picks (pick_date, rank, sport);

-- Anyone can read the public track record
ALTER TABLE house_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "House picks readable by anyone" ON house_picks;
CREATE POLICY "House picks readable by anyone"
  ON house_picks FOR SELECT USING (TRUE);

-- Anon can insert (used by scheduled function with anon key)
DROP POLICY IF EXISTS "Anon can insert house picks" ON house_picks;
CREATE POLICY "Anon can insert house picks"
  ON house_picks FOR INSERT WITH CHECK (TRUE);

-- Anon can update for settlement (also via scheduled function)
DROP POLICY IF EXISTS "Anon can settle house picks" ON house_picks;
CREATE POLICY "Anon can settle house picks"
  ON house_picks FOR UPDATE USING (TRUE);

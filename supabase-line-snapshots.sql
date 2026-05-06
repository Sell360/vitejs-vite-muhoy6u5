-- ─────────────────────────────────────────────────────────────────────────
-- BETZ360 SUPABASE — LINE SNAPSHOTS (for reversal detection)
-- ─────────────────────────────────────────────────────────────────────────
-- Run in Supabase SQL Editor.
-- Stores periodic snapshots of game lines so we can detect reversals
-- (lines that drift one way then snap back — the strongest single sharp signal).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS line_snapshots (
  id BIGSERIAL PRIMARY KEY,
  sport TEXT NOT NULL,
  event_id TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  game_time TIMESTAMPTZ NOT NULL,

  -- Lines at snapshot time
  home_ml NUMERIC,
  away_ml NUMERIC,
  home_spread NUMERIC,
  home_spread_odds NUMERIC,
  away_spread NUMERIC,
  away_spread_odds NUMERIC,
  total NUMERIC,
  over_odds NUMERIC,
  under_odds NUMERIC,

  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_event ON line_snapshots (event_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_sport_time ON line_snapshots (sport, taken_at DESC);

-- Anyone can read snapshots (used to detect reversals)
ALTER TABLE line_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Snapshots readable by anyone" ON line_snapshots;
CREATE POLICY "Snapshots readable by anyone"
  ON line_snapshots FOR SELECT USING (TRUE);

-- Only service_role can insert (the Netlify scheduled function uses anon key
-- so we'll need a permissive insert policy for the anon role)
DROP POLICY IF EXISTS "Anon can insert snapshots" ON line_snapshots;
CREATE POLICY "Anon can insert snapshots"
  ON line_snapshots FOR INSERT WITH CHECK (TRUE);

-- Auto-cleanup snapshots older than 7 days (call this manually or in a cron)
-- DELETE FROM line_snapshots WHERE taken_at < NOW() - INTERVAL '7 days';

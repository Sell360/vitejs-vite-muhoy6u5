-- HOUSE PICKS V2 MIGRATION
-- Adds columns for the single-leg, signal-gated picker.
-- Wipes existing parlay-era picks (clean slate).

DELETE FROM house_picks;

ALTER TABLE house_picks
  ADD COLUMN IF NOT EXISTS signal_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS signals JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bet_type TEXT,
  ADD COLUMN IF NOT EXISTS pick_side TEXT,
  ADD COLUMN IF NOT EXISTS pick_label TEXT,
  ADD COLUMN IF NOT EXISTS event_id TEXT,
  ADD COLUMN IF NOT EXISTS line NUMERIC;

CREATE INDEX IF NOT EXISTS idx_house_picks_signal_count ON house_picks (signal_count DESC);

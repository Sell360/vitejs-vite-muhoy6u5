-- ─────────────────────────────────────────────────────────────────────────
-- BETZ360 SUPABASE SETUP
-- ─────────────────────────────────────────────────────────────────────────
-- Run this entire file in: Supabase Dashboard → SQL Editor → New Query
-- It creates:
--   1. profiles table (one row per user with username, bankroll)
--   2. mock_bets table (every logged bet + CLV tracking)
--   3. Row Level Security policies (users only see/edit their own data)
--   4. A trigger that auto-creates a profile on signup
-- ─────────────────────────────────────────────────────────────────────────

-- ─── PROFILES TABLE ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  bankroll NUMERIC NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles (username);

-- ─── MOCK BETS TABLE ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mock_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  sport TEXT NOT NULL,
  event_id TEXT,
  game_time TIMESTAMPTZ NOT NULL,
  matchup TEXT NOT NULL,
  bet_type TEXT NOT NULL CHECK (bet_type IN ('ML', 'SPREAD', 'TOTAL', 'PROP', 'PARLAY')),
  pick_label TEXT NOT NULL,
  pick_side TEXT,
  line NUMERIC,
  odds NUMERIC NOT NULL,
  stake NUMERIC NOT NULL CHECK (stake > 0),
  legs JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'push', 'cashed')),
  payout NUMERIC,

  -- CLV tracking
  closing_odds NUMERIC,
  closing_line NUMERIC,
  clv_pct NUMERIC,
  beat_close BOOLEAN,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mock_bets_user ON mock_bets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mock_bets_status ON mock_bets (status);

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_bets ENABLE ROW LEVEL SECURITY;

-- Profiles: anyone authenticated can read (for leaderboard), only owner edits
DROP POLICY IF EXISTS "Profiles are public to read" ON profiles;
CREATE POLICY "Profiles are public to read"
  ON profiles FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Mock bets: only owner can read/write their own bets
DROP POLICY IF EXISTS "Users can read own bets" ON mock_bets;
CREATE POLICY "Users can read own bets"
  ON mock_bets FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own bets" ON mock_bets;
CREATE POLICY "Users can insert own bets"
  ON mock_bets FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own bets" ON mock_bets;
CREATE POLICY "Users can update own bets"
  ON mock_bets FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own bets" ON mock_bets;
CREATE POLICY "Users can delete own bets"
  ON mock_bets FOR DELETE USING (auth.uid() = user_id);

-- ─── DONE ─────────────────────────────────────────────────────────────────
-- After running:
-- 1. Go to Authentication → Settings → confirm email signup is enabled
--    (or disable email confirmation for instant signups during testing)
-- 2. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to Netlify env vars
-- 3. Redeploy

-- ─────────────────────────────────────────────────────────────────────────
-- BETZ360 SUPABASE — BANKROLL & ADMIN MIGRATION
-- ─────────────────────────────────────────────────────────────────────────
-- Run this in Supabase SQL Editor after the initial setup.
-- Adds:
--   - is_admin flag on profiles
--   - max_bankroll column (admin-set ceiling, default unlimited)
--   - starting_bankroll (the value a user resets to)
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_bankroll NUMERIC,
  ADD COLUMN IF NOT EXISTS starting_bankroll NUMERIC NOT NULL DEFAULT 1000;

-- Allow admins to update any profile (for setting per-user limits)
DROP POLICY IF EXISTS "Admins can update any profile" ON profiles;
CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = TRUE
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- MAKE YOURSELF AN ADMIN
-- ─────────────────────────────────────────────────────────────────────────
-- After your first signup, find your user ID:
--   SELECT id, username FROM profiles;
-- Then update yourself to admin (replace YOUR_USERNAME):
--   UPDATE profiles SET is_admin = TRUE WHERE username = 'your_username_here';
-- ─────────────────────────────────────────────────────────────────────────

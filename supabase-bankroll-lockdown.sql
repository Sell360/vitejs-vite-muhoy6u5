-- ─────────────────────────────────────────────────────────────────────────
-- BETZ360 — BANKROLL ADMIN-ONLY (with bet settlement allowance)
-- ─────────────────────────────────────────────────────────────────────────
-- Run in Supabase SQL Editor.
--
-- Goal: Users cannot manually set their bankroll, but bet settlement
-- (won/lost/push) still updates their bankroll automatically.
--
-- Solution: Move bet settlement bankroll updates server-side via a
-- Postgres function that runs with elevated privileges, then strip
-- direct profile-update permission from regular users.
-- ─────────────────────────────────────────────────────────────────────────

-- Function: settle a bet and update bankroll atomically
-- SECURITY DEFINER means it runs as the table owner, bypassing RLS for the
-- bankroll update. We still verify the bet belongs to the calling user.
CREATE OR REPLACE FUNCTION settle_bet_and_update_bankroll(
  p_bet_id UUID,
  p_status TEXT,
  p_payout NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bet mock_bets%ROWTYPE;
  v_profit NUMERIC;
BEGIN
  SELECT * INTO v_bet FROM mock_bets WHERE id = p_bet_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet not found or not owned by user';
  END IF;

  IF p_status NOT IN ('won', 'lost', 'push', 'cashed') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  IF v_bet.status != 'pending' THEN
    RAISE EXCEPTION 'Bet already settled with status: %', v_bet.status;
  END IF;

  UPDATE mock_bets
  SET status = p_status, payout = p_payout, settled_at = NOW()
  WHERE id = p_bet_id;

  v_profit := p_payout - v_bet.stake;
  UPDATE profiles SET bankroll = bankroll + v_profit WHERE id = v_bet.user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION settle_bet_and_update_bankroll(UUID, TEXT, NUMERIC) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- LOCK DOWN PROFILE UPDATES TO ADMIN-ONLY
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

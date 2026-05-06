-- ─────────────────────────────────────────────────────────────────────────
-- BETZ360 — PRO SUBSCRIPTION SCHEMA
-- ─────────────────────────────────────────────────────────────────────────
-- Run in Supabase SQL Editor.
-- Adds Pro subscription tracking to profiles. Stripe webhook writes here
-- via the Netlify function. Frontend reads is_pro to gate premium features.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pro_grandfathered BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT,
       -- 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | null
  ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;

-- Helpful indices
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer ON profiles (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_subscription ON profiles (stripe_subscription_id);

-- ─────────────────────────────────────────────────────────────────────────
-- GRANDFATHER ALL EXISTING USERS
-- ─────────────────────────────────────────────────────────────────────────
-- Anyone who signed up before today gets pro forever, no payment required.
UPDATE profiles
SET is_pro = TRUE, pro_grandfathered = TRUE
WHERE pro_grandfathered = FALSE;

-- New signups going forward will be is_pro = FALSE (default) and need to
-- subscribe via Stripe to unlock pro features.

-- ─────────────────────────────────────────────────────────────────────────
-- ADMIN-CONTROLLED PRO TOGGLE
-- ─────────────────────────────────────────────────────────────────────────
-- The bankroll lockdown removed all profile UPDATE access from regular users.
-- Admin policy lets admins set is_pro manually if needed (comp accounts,
-- support cases, refunds).
-- Stripe webhook uses service-role key (bypasses RLS) for automated updates.

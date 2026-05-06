-- ─────────────────────────────────────────────────────────────────────────
-- BETZ360 — LOCK DOWN BANKROLL TO ADMIN-ONLY
-- ─────────────────────────────────────────────────────────────────────────
-- Run in Supabase SQL Editor.
-- Removes the broad "users can update own profile" policy and replaces
-- it with one that lets users update only their non-financial fields.
-- bankroll, starting_bankroll, max_bankroll become admin-edit-only.
-- ─────────────────────────────────────────────────────────────────────────

-- Drop the overly permissive user update policy
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

-- Keep "Admins can update any profile" — already exists from migration 2

-- Service role / future settings updates by users go here. For now the only
-- field a user can self-update is their username (handled at signup time).
-- We don't grant any user-level UPDATE to keep bankroll fully admin-controlled.
-- If users need self-edit on a non-financial field later, add a column-scoped
-- policy here.

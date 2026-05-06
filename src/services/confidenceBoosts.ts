// Cascade Edge — confidence model boosters
// These three functions add real measurable signal to our confidence scores.
// All three use data we already collect — no new API calls or storage.

import type { ReversalSignal } from './lineMovement';
import type { SharpComparison } from './polymarket';

export interface ConfidenceBoost {
  delta: number;       // points to add/subtract from confidence
  reason: string;      // short explanation for UI
  flag?: string;       // optional badge to show
}

// ─── 1. SHARP MONEY / REVERSE LINE MOVEMENT ───────────────────────────────
// If a reversal or steam signal exists for a game and our pick aligns with
// the sharp side, that's confirmation. If our pick is on the *opposite*
// side, that's a warning.
export function reversalBoost(
  signal: ReversalSignal | null,
  pickSide: 'home' | 'away' | 'over' | 'under',
): ConfidenceBoost {
  if (!signal) return { delta: 0, reason: '' };

  const aligned = signal.side === pickSide;
  const isStrong = signal.strength >= 6;

  if (aligned && signal.direction === 'reversal') {
    return {
      delta: isStrong ? 10 : 6,
      reason: 'sharp money fading public on this side',
      flag: '🔄 SHARP CONFIRMED',
    };
  }
  if (aligned && signal.direction === 'steam') {
    return {
      delta: isStrong ? 7 : 4,
      reason: 'steam moving toward this side',
      flag: '🔥 STEAM ALIGNED',
    };
  }
  if (!aligned && signal.direction === 'reversal') {
    return {
      delta: -8,
      reason: 'sharp money on opposite side',
      flag: '⚠ FADING SHARPS',
    };
  }
  return { delta: 0, reason: '' };
}

// ─── 2. SCHEDULE FATIGUE (already have edgeSignals, this just exposes the value) ──
// edgeSignals.ts already has timezone + back-to-back logic. This wraps it
// so non-prop bets (game lines / parlay legs) can also use it.
export function fatigueBoost(
  hasFatigue: boolean,
  severity: 'severe' | 'moderate' | 'none',
  pickSide: 'home' | 'away' | 'over' | 'under',
  fatiguedTeam: 'home' | 'away',
): ConfidenceBoost {
  if (!hasFatigue || severity === 'none') return { delta: 0, reason: '' };

  // Picking against the fatigued team = good
  // Picking the fatigued team = bad
  const pickingFatiguedTeam =
    (pickSide === 'home' && fatiguedTeam === 'home') ||
    (pickSide === 'away' && fatiguedTeam === 'away');

  if (pickSide !== 'home' && pickSide !== 'away') {
    // Totals: fatigue typically suppresses scoring → favors UNDER
    if (pickSide === 'under') return { delta: severity === 'severe' ? 5 : 3, reason: 'fatigue favors under' };
    return { delta: severity === 'severe' ? -4 : -2, reason: 'fatigue suppresses overs' };
  }

  if (pickingFatiguedTeam) {
    return { delta: severity === 'severe' ? -8 : -4, reason: 'team is on tired legs' };
  }
  return {
    delta: severity === 'severe' ? 6 : 3,
    reason: 'opponent on tired legs',
    flag: severity === 'severe' ? '✈ REST EDGE' : undefined,
  };
}

// ─── 3. POLYMARKET DIVERGENCE ─────────────────────────────────────────────
// When Polymarket disagrees with the book by 3%+, sharp crypto money is
// telling us something. Aligning with Polymarket = confirmation. Opposing
// it = warning.
export function polymarketBoost(
  comparison: SharpComparison | null,
  pickSide: 'home' | 'away' | 'over' | 'under',
): ConfidenceBoost {
  if (!comparison || !comparison.found || !comparison.sharpSide) return { delta: 0, reason: '' };
  if (pickSide !== 'home' && pickSide !== 'away') return { delta: 0, reason: '' };

  const aligned = comparison.sharpSide === pickSide;
  const edge = comparison.edgePct;
  const liquidityWeight = comparison.liquidity > 10000 ? 1 : comparison.liquidity > 1000 ? 0.7 : 0.4;

  if (aligned) {
    const boost = Math.min(edge * 1.5, 12) * liquidityWeight;
    return {
      delta: Math.round(boost),
      reason: `crypto traders agree (+${edge.toFixed(1)}%)`,
      flag: edge >= 5 ? '📊 SHARP $' : undefined,
    };
  }
  // Picking against polymarket
  const penalty = Math.min(edge * 1.2, 10) * liquidityWeight;
  return {
    delta: -Math.round(penalty),
    reason: `crypto traders disagree (-${edge.toFixed(1)}%)`,
    flag: edge >= 5 ? '⚠ FADING POLY' : undefined,
  };
}

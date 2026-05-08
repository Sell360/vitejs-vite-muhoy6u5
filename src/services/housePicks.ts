// House Picks — the system's public daily parlay track record.
// Data is read by anyone (public RLS), settled by admins only via the
// settleHousePick() helper (uses the same RLS that allows admin updates).

import { supabase, isSupabaseConfigured } from './supabase';

export interface HousePickLeg {
  player: string;
  propType: string;
  line: number;
  pick: 'over' | 'under';
  odds: number;
  gameId: string;
  matchup: string;
}

export interface HousePick {
  id: string;
  pick_date: string;       // YYYY-MM-DD
  rank: number;
  sport: string;
  legs: HousePickLeg[];
  combined_odds: number;
  confidence: number;
  tier: 'S' | 'A' | 'B';
  status: 'pending' | 'pending_review' | 'won' | 'lost' | 'push';
  legs_won: number | null;
  legs_lost: number | null;
  legs_pushed: number | null;
  settled_at: string | null;
  created_at: string;
}

export interface TrackRecord {
  totalPicks: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  winRate: number;       // 0-100
  unitsPL: number;       // assuming 1 unit per pick
  roi: number;           // unitsPL / totalSettled * 100
  byTier: Record<string, { picks: number; wins: number; winRate: number }>;
  bySport: Record<string, { picks: number; wins: number; winRate: number }>;
  recentForm: ('W' | 'L' | 'P' | '?')[];  // last 10
  // Per-leg hit rate: across all settled parlays, how many individual legs hit.
  // Always higher than parlay W/L because losing parlays still have legs that
  // hit. This is the metric sharps publish — much more honest than parlay W/L
  // alone, which punishes a 4-leg parlay with one bad leg as a full 'loss'.
  legsHit: number;
  legsTotal: number;
  legHitRate: number;    // 0-100
}

export async function getHousePicks(daysBack = 30, limit = 100): Promise<HousePick[]> {
  if (!isSupabaseConfigured()) return [];
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data } = await supabase
    .from('house_picks')
    .select('*')
    .gte('pick_date', since)
    .order('pick_date', { ascending: false })
    .order('rank', { ascending: true })
    .limit(limit);
  return (data as HousePick[]) ?? [];
}

export async function getTodaysPicks(): Promise<HousePick[]> {
  if (!isSupabaseConfigured()) return [];
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('house_picks')
    .select('*')
    .eq('pick_date', today)
    .order('rank', { ascending: true });
  return (data as HousePick[]) ?? [];
}

function americanToDecimal(o: number) {
  if (!o) return 1;
  return o > 0 ? o / 100 + 1 : 100 / Math.abs(o) + 1;
}

export function computeTrackRecord(picks: HousePick[]): TrackRecord {
  const settled = picks.filter(p => p.status === 'won' || p.status === 'lost' || p.status === 'push');
  const wins = picks.filter(p => p.status === 'won').length;
  const losses = picks.filter(p => p.status === 'lost').length;
  const pushes = picks.filter(p => p.status === 'push').length;
  const pending = picks.filter(p => p.status === 'pending' || p.status === 'pending_review').length;

  // P/L assuming flat 1u stake per pick. Win pays decimal-1 units, loss is -1.
  const unitsPL = picks.reduce((sum, p) => {
    if (p.status === 'won') return sum + (americanToDecimal(p.combined_odds) - 1);
    if (p.status === 'lost') return sum - 1;
    return sum;
  }, 0);

  const totalRisk = settled.length - pushes;
  const roi = totalRisk > 0 ? (unitsPL / totalRisk) * 100 : 0;
  const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

  // Tier breakdown
  const byTier: TrackRecord['byTier'] = {};
  ['S', 'A', 'B'].forEach(t => {
    const tierPicks = settled.filter(p => p.tier === t);
    const tierWins = tierPicks.filter(p => p.status === 'won').length;
    const tierLosses = tierPicks.filter(p => p.status === 'lost').length;
    byTier[t] = {
      picks: tierPicks.length,
      wins: tierWins,
      winRate: (tierWins + tierLosses) > 0 ? (tierWins / (tierWins + tierLosses)) * 100 : 0,
    };
  });

  // Sport breakdown
  const bySport: TrackRecord['bySport'] = {};
  for (const p of settled) {
    if (!bySport[p.sport]) bySport[p.sport] = { picks: 0, wins: 0, winRate: 0 };
    bySport[p.sport].picks++;
    if (p.status === 'won') bySport[p.sport].wins++;
  }
  for (const s in bySport) {
    const total = bySport[s].picks - settled.filter(p => p.sport === s && p.status === 'push').length;
    bySport[s].winRate = total > 0 ? (bySport[s].wins / total) * 100 : 0;
  }

  // Recent form (last 10 settled, newest first)
  const recentForm = settled.slice(0, 10).map(p =>
    p.status === 'won' ? 'W' : p.status === 'lost' ? 'L' : p.status === 'push' ? 'P' : '?'
  ) as TrackRecord['recentForm'];

  // Per-leg hit rate. We use the legs_won / legs_lost columns populated by
  // the auto-settler (auto-settle-picks.js writes these once a pick resolves).
  // Falls back to assuming all legs hit on 'won' picks and zero on 'lost' picks
  // when the per-leg counts are missing (older picks before settler upgrade).
  let legsHit = 0;
  let legsTotal = 0;
  for (const p of settled) {
    if (p.legs_won != null && p.legs_lost != null) {
      legsHit += p.legs_won;
      legsTotal += p.legs_won + p.legs_lost + (p.legs_pushed || 0);
    } else if (p.status === 'won') {
      legsHit += p.legs.length;
      legsTotal += p.legs.length;
    } else if (p.status === 'lost') {
      legsTotal += p.legs.length;
    }
  }
  const legHitRate = legsTotal > 0 ? (legsHit / legsTotal) * 100 : 0;

  return {
    totalPicks: picks.length, wins, losses, pushes, pending,
    winRate: Math.round(winRate * 10) / 10,
    unitsPL: Math.round(unitsPL * 100) / 100,
    roi: Math.round(roi * 10) / 10,
    byTier, bySport, recentForm,
    legsHit, legsTotal,
    legHitRate: Math.round(legHitRate * 10) / 10,
  };
}

// ─── ADMIN SETTLEMENT ─────────────────────────────────────────────────────
export async function settleHousePick(
  id: string,
  status: 'won' | 'lost' | 'push',
  legsWon?: number,
  legsLost?: number,
  legsPushed?: number,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('house_picks')
    .update({
      status,
      legs_won: legsWon ?? null,
      legs_lost: legsLost ?? null,
      legs_pushed: legsPushed ?? null,
      settled_at: new Date().toISOString(),
    })
    .eq('id', id);
  return { error: error?.message ?? null };
}

// Manually grade a pick by providing the actual stat for each leg.
// Computes parlay outcome by parlay rules:
//   any leg lost = parlay lost
//   all legs won (pushes drop out) = parlay won
//   all pushes = push
export async function manualGradeLegs(
  pick: HousePick,
  actualStats: number[],
): Promise<{ error: string | null }> {
  if (actualStats.length !== pick.legs.length) {
    return { error: 'Wrong number of stats provided' };
  }
  let wonCount = 0, lostCount = 0, pushCount = 0;
  for (let i = 0; i < pick.legs.length; i++) {
    const leg = pick.legs[i];
    const actual = actualStats[i];
    if (actual === leg.line) pushCount++;
    else if (leg.pick === 'over' && actual > leg.line) wonCount++;
    else if (leg.pick === 'over' && actual < leg.line) lostCount++;
    else if (leg.pick === 'under' && actual < leg.line) wonCount++;
    else if (leg.pick === 'under' && actual > leg.line) lostCount++;
  }
  let finalStatus: 'won' | 'lost' | 'push';
  if (lostCount > 0) finalStatus = 'lost';
  else if (wonCount === 0) finalStatus = 'push';
  else finalStatus = 'won';
  return settleHousePick(pick.id, finalStatus, wonCount, lostCount, pushCount);
}

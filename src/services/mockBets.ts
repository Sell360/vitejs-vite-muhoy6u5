// Mock bet tracking service — backed by Supabase
// Handles bet logging, settlement, CLV snapshot fetching
import { supabase } from './supabase';

export interface MockBet {
  id?: string;
  user_id: string;
  sport: string;
  event_id: string | null;        // The Odds API event ID (for CLV lookup)
  game_time: string;               // ISO timestamp
  matchup: string;                 // "Yankees @ Red Sox"
  bet_type: 'ML' | 'SPREAD' | 'TOTAL' | 'PROP' | 'PARLAY';
  pick_label: string;              // "Yankees -1.5" or "Mahomes Over 285.5"
  pick_side: 'home' | 'away' | 'over' | 'under' | null;
  line: number | null;             // spread/total line at bet time
  odds: number;                    // American odds at bet time
  stake: number;                   // Mock dollars
  legs?: BetLeg[] | null;          // For parlays
  status: 'pending' | 'won' | 'lost' | 'push' | 'cashed';
  payout: number | null;           // Computed when settled
  closing_odds: number | null;     // Snapshotted closing line for CLV
  closing_line: number | null;     // Snapshotted closing spread/total
  clv_pct: number | null;          // (modelImpl - closingImpl) — sharp metric
  beat_close: boolean | null;      // Whether bet beat the closing line
  created_at: string;
  settled_at: string | null;
}

export interface BetLeg {
  matchup: string;
  bet_type: string;
  pick: string;
  odds: number;
}

// ─── ODDS MATH ────────────────────────────────────────────────────────────
export function americanToDecimal(odds: number): number {
  if (!odds) return 1;
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}
export function impliedProb(odds: number): number {
  if (!odds) return 50;
  const dec = americanToDecimal(odds);
  return Math.round((1 / dec) * 100);
}
export function calculateClv(betOdds: number, closingOdds: number): number {
  // Positive CLV = you got better odds than the closing line
  // CLV % = closing implied prob - bet implied prob (since lower implied = better odds)
  const betImpl = (1 / americanToDecimal(betOdds)) * 100;
  const closeImpl = (1 / americanToDecimal(closingOdds)) * 100;
  // If your bet was at lower implied prob (higher payout) than the close, you got positive CLV
  return Math.round((closeImpl - betImpl) * 10) / 10;
}

// ─── BET LOGGING ──────────────────────────────────────────────────────────
export async function logBet(
  bet: Omit<MockBet, 'id' | 'created_at' | 'closing_odds' | 'closing_line' | 'clv_pct' | 'beat_close' | 'payout' | 'settled_at'>
): Promise<{ data: MockBet | null; error: string | null }> {
  const insert = {
    ...bet,
    created_at: new Date().toISOString(),
    closing_odds: null,
    closing_line: null,
    clv_pct: null,
    beat_close: null,
    payout: null,
    settled_at: null,
  };

  const { data, error } = await supabase
    .from('mock_bets')
    .insert(insert)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as MockBet, error: null };
}

// ─── BET SETTLEMENT ───────────────────────────────────────────────────────
export async function settleBet(
  betId: string,
  result: 'won' | 'lost' | 'push' | 'cashed'
): Promise<{ error: string | null }> {
  const { data: bet } = await supabase.from('mock_bets').select('*').eq('id', betId).single();
  if (!bet) return { error: 'Bet not found' };

  let payout = 0;
  if (result === 'won') {
    payout = Math.round(bet.stake * americanToDecimal(bet.odds) * 100) / 100;
  } else if (result === 'push' || result === 'cashed') {
    payout = bet.stake;
  }

  const { error } = await supabase
    .from('mock_bets')
    .update({ status: result, payout, settled_at: new Date().toISOString() })
    .eq('id', betId);

  if (error) return { error: error.message };

  // Update user bankroll: add (payout - stake) to bankroll
  const profitDelta = payout - bet.stake;
  const { data: profile } = await supabase
    .from('profiles')
    .select('bankroll')
    .eq('id', bet.user_id)
    .single();
  if (profile) {
    await supabase
      .from('profiles')
      .update({ bankroll: profile.bankroll + profitDelta })
      .eq('id', bet.user_id);
  }

  return { error: null };
}

// ─── CLV SNAPSHOT ─────────────────────────────────────────────────────────
// Fetch closing line for a bet AFTER the game starts, then store CLV
export async function snapshotClosingLine(betId: string): Promise<{ error: string | null }> {
  const { data: bet } = await supabase.from('mock_bets').select('*').eq('id', betId).single();
  if (!bet) return { error: 'Bet not found' };
  if (bet.closing_odds !== null) return { error: null }; // already snapshotted
  if (!bet.event_id) return { error: 'No event_id — cannot fetch closing line' };

  // Don't snapshot until game has started (closing line is locked at game time)
  if (new Date(bet.game_time).getTime() > Date.now()) {
    return { error: 'Game has not started yet' };
  }

  try {
    const market = bet.bet_type === 'ML' ? 'h2h' : bet.bet_type === 'SPREAD' ? 'spreads' : bet.bet_type === 'TOTAL' ? 'totals' : 'h2h,spreads,totals';
    const res = await fetch(`/api/closing-line?sport=${bet.sport}&eventId=${bet.event_id}&gameTime=${encodeURIComponent(bet.game_time)}&market=${market}`);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!data.available) return { error: 'No closing line available' };

    let closingOdds: number | null = null;
    let closingLine: number | null = null;
    if (bet.bet_type === 'ML') {
      closingOdds = bet.pick_side === 'home' ? data.moneyline.home : data.moneyline.away;
    } else if (bet.bet_type === 'SPREAD') {
      closingOdds = bet.pick_side === 'home' ? data.spread.homeOdds : data.spread.awayOdds;
      closingLine = data.spread.line;
    } else if (bet.bet_type === 'TOTAL') {
      closingOdds = bet.pick_side === 'over' ? data.total.overOdds : data.total.underOdds;
      closingLine = data.total.line;
    }

    if (closingOdds === null) return { error: 'Closing line unavailable for this market' };

    const clvPct = calculateClv(bet.odds, closingOdds);
    const beatClose = clvPct > 0;

    const { error } = await supabase
      .from('mock_bets')
      .update({ closing_odds: closingOdds, closing_line: closingLine, clv_pct: clvPct, beat_close: beatClose })
      .eq('id', betId);
    if (error) return { error: error.message };

    return { error: null };
  } catch (e) {
    return { error: String(e) };
  }
}

// ─── QUERIES ──────────────────────────────────────────────────────────────
export async function getUserBets(userId: string, limit = 50): Promise<MockBet[]> {
  const { data, error } = await supabase
    .from('mock_bets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as MockBet[];
}

export async function getUserStats(userId: string) {
  const bets = await getUserBets(userId, 1000);
  const settled = bets.filter(b => b.status === 'won' || b.status === 'lost');
  const wins = settled.filter(b => b.status === 'won').length;
  const losses = settled.filter(b => b.status === 'lost').length;
  const pushes = bets.filter(b => b.status === 'push').length;
  const totalStaked = settled.reduce((s, b) => s + b.stake, 0);
  const totalReturned = settled.reduce((s, b) => s + (b.payout ?? 0), 0);
  const profit = totalReturned - totalStaked;
  const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;
  const winRate = settled.length > 0 ? (wins / settled.length) * 100 : 0;

  // CLV stats — only count bets with snapshotted closing lines
  const clvBets = bets.filter(b => b.clv_pct !== null);
  const avgClv = clvBets.length > 0
    ? clvBets.reduce((s, b) => s + (b.clv_pct ?? 0), 0) / clvBets.length
    : 0;
  const beatCloseRate = clvBets.length > 0
    ? (clvBets.filter(b => b.beat_close).length / clvBets.length) * 100
    : 0;

  return {
    totalBets: bets.length,
    wins, losses, pushes,
    pending: bets.filter(b => b.status === 'pending').length,
    winRate: Math.round(winRate * 10) / 10,
    profit: Math.round(profit * 100) / 100,
    roi: Math.round(roi * 10) / 10,
    totalStaked: Math.round(totalStaked * 100) / 100,
    avgClv: Math.round(avgClv * 10) / 10,
    beatCloseRate: Math.round(beatCloseRate * 10) / 10,
    clvBetCount: clvBets.length,
  };
}

export async function getBankroll(userId: string): Promise<number> {
  const { data } = await supabase.from('profiles').select('bankroll').eq('id', userId).single();
  return data?.bankroll ?? 1000;
}

// ─── BANKROLL MANAGEMENT ──────────────────────────────────────────────────
export async function getProfile(userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('bankroll, starting_bankroll, max_bankroll, is_admin')
    .eq('id', userId)
    .single();
  return data;
}

// User can reset their own bankroll to their starting amount
export async function resetBankroll(userId: string): Promise<{ error: string | null }> {
  const profile = await getProfile(userId);
  const startAmount = profile?.starting_bankroll ?? 1000;
  const { error } = await supabase
    .from('profiles')
    .update({ bankroll: startAmount })
    .eq('id', userId);
  return { error: error?.message ?? null };
}

// User can set a custom starting bankroll (subject to admin max if set)
export async function setStartingBankroll(userId: string, amount: number): Promise<{ error: string | null }> {
  if (amount < 100 || amount > 1000000) {
    return { error: 'Starting bankroll must be between $100 and $1,000,000' };
  }
  const profile = await getProfile(userId);
  if (profile?.max_bankroll && amount > profile.max_bankroll) {
    return { error: `Admin has set a max bankroll of $${profile.max_bankroll}` };
  }
  const { error } = await supabase
    .from('profiles')
    .update({ starting_bankroll: amount, bankroll: amount })
    .eq('id', userId);
  return { error: error?.message ?? null };
}

// ─── ADMIN FUNCTIONS ──────────────────────────────────────────────────────
export interface AdminUser {
  id: string;
  username: string;
  bankroll: number;
  starting_bankroll: number;
  max_bankroll: number | null;
  is_admin: boolean;
  total_bets: number;
  created_at: string;
}

export async function getAllUsers(): Promise<AdminUser[]> {
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, bankroll, starting_bankroll, max_bankroll, is_admin, created_at')
    .order('created_at', { ascending: false });
  if (!profiles) return [];

  const result: AdminUser[] = [];
  for (const p of profiles) {
    const { count } = await supabase
      .from('mock_bets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', p.id);
    result.push({ ...p, total_bets: count || 0 });
  }
  return result;
}

export async function adminSetUserLimit(userId: string, maxBankroll: number | null): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ max_bankroll: maxBankroll })
    .eq('id', userId);
  return { error: error?.message ?? null };
}

export async function adminAdjustBankroll(userId: string, newBankroll: number): Promise<{ error: string | null }> {
  if (newBankroll < 0) return { error: 'Bankroll cannot be negative' };
  const { error } = await supabase
    .from('profiles')
    .update({ bankroll: newBankroll })
    .eq('id', userId);
  return { error: error?.message ?? null };
}

// ─── UNDERDOG CAP HELPER ──────────────────────────────────────────────────
// Standard sportsbook rule: max 2 underdogs per parlay (positive odds = underdog).
// Returns whether adding this leg would violate the cap.
export const MAX_UNDERDOGS_PER_PARLAY = 2;

export function countUnderdogs(legs: { odds: number }[]): number {
  return legs.filter(l => l.odds > 0).length;
}

export function wouldExceedUnderdogCap(currentLegs: { odds: number }[], newOdds: number): boolean {
  if (newOdds <= 0) return false; // adding a favorite is always fine
  return countUnderdogs(currentLegs) >= MAX_UNDERDOGS_PER_PARLAY;
}

// ─── LEADERBOARD ──────────────────────────────────────────────────────────
export interface LeaderboardEntry {
  username: string;
  bankroll: number;
  total_bets: number;
  win_rate: number;
  avg_clv: number;
  beat_close_rate: number;
  rank: number;
}

export async function getLeaderboard(metric: 'bankroll' | 'clv' | 'winrate' = 'clv', limit = 25): Promise<LeaderboardEntry[]> {
  // Pull all profiles with their aggregated stats
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, bankroll')
    .limit(200);
  if (!profiles) return [];

  const entries: LeaderboardEntry[] = [];
  for (const p of profiles) {
    const stats = await getUserStats(p.id);
    if (stats.totalBets < 3) continue; // require min 3 bets to appear
    entries.push({
      username: p.username,
      bankroll: p.bankroll,
      total_bets: stats.totalBets,
      win_rate: stats.winRate,
      avg_clv: stats.avgClv,
      beat_close_rate: stats.beatCloseRate,
      rank: 0,
    });
  }

  if (metric === 'bankroll') entries.sort((a, b) => b.bankroll - a.bankroll);
  else if (metric === 'winrate') entries.sort((a, b) => b.win_rate - a.win_rate);
  else entries.sort((a, b) => b.avg_clv - a.avg_clv);

  return entries.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));
}

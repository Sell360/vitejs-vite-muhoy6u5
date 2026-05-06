// Polymarket sharp-line overlay service.
// Routes through /api/polymarket Netlify function which:
//   - Fetches gamma-api.polymarket.com server-side (handles potential CORS)
//   - Filters markets by sport keywords (Polymarket tag system is unreliable)
//   - Caches for 10 minutes
//   - Properly parses outcomePrices (JSON-stringified array)
//
// Free public API, no auth, no cost.

import { supabase, isSupabaseConfigured } from './supabase';

const TTL_MS = 10 * 60 * 1000;
const cache: Record<string, { data: PolymarketMarket[]; ts: number }> = {};
const inflight: Record<string, Promise<PolymarketMarket[]>> = {};
let polyFailCount = 0;
let polyDisabledUntil = 0;

interface PolymarketMarket {
  conditionId: string;
  question: string;
  slug: string;
  yesPrice: number;
  noPrice: number;
  liquidity: number;
  volume24hr: number;
  endDate: string;
}

export interface PolymarketMatch {
  conditionId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  liquidity: number;
  volume24hr: number;
  url: string;
  yesIsHomeTeam: boolean;
}

export interface SharpComparison {
  found: boolean;
  bookHomeImplied: number;
  bookAwayImplied: number;
  polyHomeImplied: number;
  polyAwayImplied: number;
  divergenceHome: number;
  sharpSide: 'home' | 'away' | null;
  edgePct: number;
  liquidity: number;
  marketUrl: string;
  poly: PolymarketMatch | null;
}

// ─── ODDS MATH ────────────────────────────────────────────────────────────
function americanToImplied(odds: number): number {
  if (!odds) return 0;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function devig(homeImpl: number, awayImpl: number): { home: number; away: number } {
  const total = homeImpl + awayImpl;
  if (total === 0) return { home: 0, away: 0 };
  return { home: homeImpl / total, away: awayImpl / total };
}

// ─── FETCH ACTIVE MARKETS ─────────────────────────────────────────────────
async function getActiveMarkets(sport: string): Promise<PolymarketMarket[]> {
  if (Date.now() < polyDisabledUntil) return [];

  const ck = `poly-${sport}`;
  const hit = cache[ck];
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.data;

  const existing = inflight[ck];
  if (existing) return existing;

  const fetchPromise = (async (): Promise<PolymarketMarket[]> => {
    try {
      const res = await fetch(`/api/polymarket?sport=${sport}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const markets = Array.isArray(data?.markets) ? data.markets as PolymarketMarket[] : [];
      cache[ck] = { data: markets, ts: Date.now() };
      polyFailCount = 0;
      return markets;
    } catch {
      polyFailCount++;
      if (polyFailCount >= 3) {
        polyDisabledUntil = Date.now() + 5 * 60 * 1000;
        console.warn('[Betz360] Polymarket proxy unavailable — disabled for 5 min');
      }
      return [];
    } finally {
      delete inflight[ck];
    }
  })();

  inflight[ck] = fetchPromise;
  return fetchPromise;
}

// ─── MATCH POLYMARKET QUESTION TO OUR GAME ────────────────────────────────
function matchGame(
  markets: PolymarketMarket[],
  homeTeam: string,
  awayTeam: string,
): PolymarketMatch | null {
  const homeKey = (homeTeam.split(' ').pop() || '').toLowerCase();
  const awayKey = (awayTeam.split(' ').pop() || '').toLowerCase();
  const homeFull = homeTeam.toLowerCase();
  const awayFull = awayTeam.toLowerCase();

  const candidates = markets.map(m => {
    const haystack = `${m.question} ${m.slug}`.toLowerCase();
    const hasHome = haystack.includes(homeKey) || haystack.includes(homeFull);
    const hasAway = haystack.includes(awayKey) || haystack.includes(awayFull);

    if (!hasHome || !hasAway) return null;
    if (m.yesPrice <= 0 || m.yesPrice >= 1) return null;
    if (m.liquidity < 50) return null;

    const homeIdx = haystack.indexOf(homeKey);
    const awayIdx = haystack.indexOf(awayKey);
    const homeFirst = homeIdx >= 0 && (awayIdx < 0 || homeIdx < awayIdx);
    let yesIsHome = homeFirst;
    if (haystack.includes('beat') || haystack.includes('defeat') || /will .+ win/.test(haystack)) {
      yesIsHome = homeFirst;
    }

    return { market: m, score: m.liquidity, yesIsHome };
  }).filter((c): c is NonNullable<typeof c> => c !== null);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];

  return {
    conditionId: top.market.conditionId,
    question: top.market.question,
    yesPrice: top.market.yesPrice,
    noPrice: top.market.noPrice,
    liquidity: top.market.liquidity,
    volume24hr: top.market.volume24hr,
    url: `https://polymarket.com/event/${top.market.slug}`,
    yesIsHomeTeam: top.yesIsHome,
  };
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────
export async function getSharpComparison(
  sport: string,
  homeTeam: string,
  awayTeam: string,
  homeML: number | null,
  awayML: number | null,
): Promise<SharpComparison> {
  const empty: SharpComparison = {
    found: false,
    bookHomeImplied: 0, bookAwayImplied: 0,
    polyHomeImplied: 0, polyAwayImplied: 0,
    divergenceHome: 0, sharpSide: null, edgePct: 0,
    liquidity: 0, marketUrl: '', poly: null,
  };

  if (!homeML || !awayML) return empty;

  const markets = await getActiveMarkets(sport);
  if (markets.length === 0) return empty;

  const match = matchGame(markets, homeTeam, awayTeam);
  if (!match) return empty;

  const bookHome = americanToImplied(homeML) * 100;
  const bookAway = americanToImplied(awayML) * 100;
  const devigged = devig(bookHome, bookAway);
  const bookHomeNoVig = devigged.home * 100;
  const bookAwayNoVig = devigged.away * 100;

  const polyHome = (match.yesIsHomeTeam ? match.yesPrice : match.noPrice) * 100;
  const polyAway = (match.yesIsHomeTeam ? match.noPrice : match.yesPrice) * 100;

  const divergence = polyHome - bookHomeNoVig;
  const edgePct = Math.abs(divergence);
  const sharpSide: 'home' | 'away' | null = edgePct < 2 ? null : (divergence > 0 ? 'home' : 'away');

  return {
    found: true,
    bookHomeImplied: Math.round(bookHomeNoVig * 10) / 10,
    bookAwayImplied: Math.round(bookAwayNoVig * 10) / 10,
    polyHomeImplied: Math.round(polyHome * 10) / 10,
    polyAwayImplied: Math.round(polyAway * 10) / 10,
    divergenceHome: Math.round(divergence * 10) / 10,
    sharpSide,
    edgePct: Math.round(edgePct * 10) / 10,
    liquidity: match.liquidity,
    marketUrl: match.url,
    poly: match,
  };
}

// ─── LIQUIDITY SLIPPAGE ESTIMATE ──────────────────────────────────────────
export function estimateSlippage(stakeUSD: number, totalLiquidity: number): {
  expectedSlippagePct: number;
  warning: 'low' | 'medium' | 'high' | 'severe';
} {
  if (totalLiquidity < 100) return { expectedSlippagePct: 50, warning: 'severe' };
  const ratio = stakeUSD / totalLiquidity;
  if (ratio > 0.25) return { expectedSlippagePct: Math.round(ratio * 100), warning: 'severe' };
  if (ratio > 0.10) return { expectedSlippagePct: Math.round(ratio * 80),  warning: 'high' };
  if (ratio > 0.05) return { expectedSlippagePct: Math.round(ratio * 50),  warning: 'medium' };
  return { expectedSlippagePct: Math.round(ratio * 20), warning: 'low' };
}

// ─── SIMILAR-GAMES VECTOR LOOKUP ──────────────────────────────────────────
export interface SimilarGame {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  gameTime: string;
  similarity: number;
  openSpread: number | null;
  openTotal: number | null;
}

export async function getSimilarGames(
  sport: string,
  currentSpread: number | null,
  currentTotal: number | null,
  limit = 10,
): Promise<SimilarGame[]> {
  if (!isSupabaseConfigured() || (!currentSpread && !currentTotal)) return [];

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('line_snapshots')
    .select('event_id, home_team, away_team, game_time, home_spread, total, taken_at')
    .eq('sport', sport)
    .lt('game_time', new Date().toISOString())
    .gte('taken_at', since)
    .order('taken_at', { ascending: true });

  if (!data || data.length === 0) return [];

  const seen = new Set<string>();
  const opens = data.filter(s => {
    if (seen.has(s.event_id)) return false;
    seen.add(s.event_id);
    return true;
  });

  const scored = opens.map(o => {
    let score = 0;
    let factors = 0;
    if (currentSpread !== null && o.home_spread !== null) {
      const spreadDiff = Math.abs(currentSpread - Number(o.home_spread));
      score += Math.max(0, 1 - spreadDiff / 14);
      factors++;
    }
    if (currentTotal !== null && o.total !== null) {
      const totalDiff = Math.abs(currentTotal - Number(o.total));
      const maxGap = sport === 'nfl' ? 30 : sport === 'mlb' ? 6 : 50;
      score += Math.max(0, 1 - totalDiff / maxGap);
      factors++;
    }
    if (factors === 0) return null;
    return {
      eventId: o.event_id,
      homeTeam: o.home_team,
      awayTeam: o.away_team,
      gameTime: o.game_time,
      similarity: score / factors,
      openSpread: o.home_spread !== null ? Number(o.home_spread) : null,
      openTotal: o.total !== null ? Number(o.total) : null,
    };
  }).filter(Boolean) as SimilarGame[];

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

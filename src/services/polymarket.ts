// Polymarket sharp-line overlay service.
// Calls the free public Gamma API directly from the browser (Polymarket blocks cloud IPs,
// so this MUST run client-side, not in a Netlify function — confirmed from prior PolyBot work).
// No auth, no key, no cost.

import { supabase, isSupabaseConfigured } from './supabase';

const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const TTL_MS = 10 * 60 * 1000; // 10-minute cache (Polymarket prices update every few seconds but we don't need real-time)
const cache: Record<string, { data: unknown; ts: number }> = {};

// Circuit breaker: if Polymarket fails 3 times, stop trying for 5 minutes
// Prevents flooding their API (CORS errors, rate limits) and our console
let polyFailCount = 0;
let polyDisabledUntil = 0;

// Inflight request dedupe: if 30 game cards mount and all want MLB markets,
// only fire one HTTP request and let them all share the result
const inflight: Record<string, Promise<unknown[]>> = {};

export interface PolymarketMatch {
  conditionId: string;
  question: string;
  yesPrice: number;     // 0-1 implied probability of YES
  noPrice: number;      // 0-1 implied probability of NO
  liquidity: number;    // pUSD available in order book
  volume24hr: number;   // dollars traded in last 24 hours
  url: string;          // direct link to the market
  matchedTeam: 'home' | 'away' | null;
  yesIsHomeTeam: boolean;  // true = "Yankees" YES means Yankees win; if "Red Sox" YES, this flips
}

export interface SharpComparison {
  found: boolean;
  bookHomeImplied: number;   // book's implied prob for home (0-100)
  bookAwayImplied: number;
  polyHomeImplied: number;   // polymarket's implied prob for home (0-100) — vig-free
  polyAwayImplied: number;
  divergenceHome: number;    // poly - book implied prob % for home (positive = poly thinks home more likely)
  sharpSide: 'home' | 'away' | null;  // which side polymarket favors vs the book
  edgePct: number;            // magnitude of the divergence (0-100)
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

// ─── POLYMARKET SPORT TAGS ────────────────────────────────────────────────
// Polymarket organizes events under category tags. Note: Polymarket's NFL/NBA/MLB
// markets are typically formatted as "Will [TEAM] win on [DATE]" — single-team yes/no.
// The tag IDs below are the published sports parent tags. We filter further by team
// names matching our game.

const SPORT_TAG_MAP: Record<string, string[]> = {
  mlb: ['100381', 'mlb', 'baseball'],
  nba: ['100382', 'nba', 'basketball'],
  nfl: ['100383', 'nfl', 'football'],
  nhl: ['100384', 'nhl', 'hockey'],
  wnba: ['100382', 'wnba', 'basketball'],
  ncaaf: ['100383', 'ncaaf', 'college-football'],
  ufc: ['ufc', 'mma'],
};

// ─── FETCH ACTIVE MARKETS FOR A SPORT ─────────────────────────────────────
async function getActiveMarkets(sport: string): Promise<unknown[]> {
  // Circuit breaker
  if (Date.now() < polyDisabledUntil) return [];

  const ck = `polymarkets-${sport}`;
  const hit = cache[ck];
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.data as unknown[];

  // If a fetch is already in-flight for this sport, return that promise instead
  // of starting a new one. Prevents 30 game cards from each firing a request.
  const existing = inflight[ck];
  if (existing) return existing;

  const sportSlugs = SPORT_TAG_MAP[sport] || [];
  const slug = sportSlugs.find(s => isNaN(Number(s))) || 'sports';

  const fetchPromise = (async (): Promise<unknown[]> => {
    try {
      const today = new Date().toISOString();
      const url = `${GAMMA_BASE}/markets?active=true&closed=false&tag_slug=${slug}&end_date_min=${today}&limit=100&order=volume24hr&ascending=false`;
      const res = await fetch(url);
      if (!res.ok) {
        // Try without slug — slug might not be recognized for this sport
        const fallbackUrl = `${GAMMA_BASE}/markets?active=true&closed=false&end_date_min=${today}&limit=100&order=volume24hr&ascending=false`;
        const fallback = await fetch(fallbackUrl);
        if (!fallback.ok) throw new Error(`HTTP ${fallback.status}`);
        const data = await fallback.json();
        const arr = Array.isArray(data) ? data : [];
        cache[ck] = { data: arr, ts: Date.now() };
        polyFailCount = 0;
        return arr;
      }
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [];
      cache[ck] = { data: arr, ts: Date.now() };
      polyFailCount = 0; // Successful call resets the counter
      return arr;
    } catch (err) {
      polyFailCount++;
      if (polyFailCount >= 3) {
        polyDisabledUntil = Date.now() + 5 * 60 * 1000; // 5-minute cooldown
        console.warn('[Betz360] Polymarket API unavailable — disabled for 5 min');
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
// Polymarket questions look like:
//   "Will the Yankees win on October 15?"
//   "Yankees vs Red Sox - October 15"
//   "Will the Lakers beat the Celtics on Friday?"
// We try multiple fuzzy-match patterns to find the right market.
function matchGame(
  markets: unknown[],
  homeTeam: string,
  awayTeam: string,
): PolymarketMatch | null {
  // Last word of team name is usually the team identifier ("Yankees", "Red Sox" → "Sox")
  const homeKey = (homeTeam.split(' ').pop() || '').toLowerCase();
  const awayKey = (awayTeam.split(' ').pop() || '').toLowerCase();
  const homeFull = homeTeam.toLowerCase();
  const awayFull = awayTeam.toLowerCase();

  for (const m of markets) {
    const market = m as Record<string, unknown>;
    const q = String(market.question || '').toLowerCase();
    const slug = String(market.slug || '').toLowerCase();
    const haystack = `${q} ${slug}`;

    // Need both team identifiers to appear in the question/slug
    const hasHome = haystack.includes(homeKey) || haystack.includes(homeFull);
    const hasAway = haystack.includes(awayKey) || haystack.includes(awayFull);
    if (!hasHome || !hasAway) continue;

    // Determine which team the YES outcome refers to
    // Pattern: "Will [TEAM A] beat/win against/over [TEAM B]" — YES = team A
    // Pattern: "[TEAM A] vs [TEAM B]" — convention varies, try to detect
    let yesIsHome: boolean;
    const homeBeforeAway = haystack.indexOf(homeKey) < haystack.indexOf(awayKey);
    if (haystack.includes('beat') || haystack.includes('win') || haystack.includes('defeat')) {
      yesIsHome = homeBeforeAway;
    } else {
      // For "vs" markets and ambiguous cases, default to home being YES (most common)
      yesIsHome = homeBeforeAway;
    }

    const lastTradePrice = parseFloat(String(market.lastTradePrice || '0'));
    const liquidity = parseFloat(String(market.liquidity || '0'));
    const volume24hr = parseFloat(String(market.volume24hr || '0'));

    // Skip markets with no recent activity — stale prices are dangerous to compare
    if (lastTradePrice === 0 || liquidity < 10) continue;

    return {
      conditionId: String(market.conditionId || ''),
      question: String(market.question || ''),
      yesPrice: lastTradePrice,
      noPrice: 1 - lastTradePrice,
      liquidity,
      volume24hr,
      url: `https://polymarket.com/event/${market.slug}`,
      matchedTeam: yesIsHome ? 'home' : 'away',
      yesIsHomeTeam: yesIsHome,
    };
  }

  return null;
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

  // Derive implied probs
  const bookHome = americanToImplied(homeML) * 100;
  const bookAway = americanToImplied(awayML) * 100;
  const devigged = devig(bookHome, bookAway);
  const bookHomeNoVig = devigged.home * 100;
  const bookAwayNoVig = devigged.away * 100;

  // Polymarket prices are already vig-free (no house edge)
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
// Given a stake size, estimate how much the user's order would move the price.
// Polymarket order books have variable depth; this is a rough estimate based on
// total liquidity. Real slippage requires fetching the orderbook which costs a
// separate API call we can do lazily.
export function estimateSlippage(stakeUSD: number, totalLiquidity: number): {
  expectedSlippagePct: number;
  warning: 'low' | 'medium' | 'high' | 'severe';
} {
  if (totalLiquidity < 100) return { expectedSlippagePct: 50, warning: 'severe' };

  // Rough rule: if your stake is 10%+ of total liquidity, expect heavy slippage
  const ratio = stakeUSD / totalLiquidity;
  if (ratio > 0.25) return { expectedSlippagePct: Math.round(ratio * 100), warning: 'severe' };
  if (ratio > 0.10) return { expectedSlippagePct: Math.round(ratio * 80),  warning: 'high' };
  if (ratio > 0.05) return { expectedSlippagePct: Math.round(ratio * 50),  warning: 'medium' };
  return { expectedSlippagePct: Math.round(ratio * 20), warning: 'low' };
}

// ─── SIMILAR-GAMES VECTOR LOOKUP (uses Supabase) ──────────────────────────
// Given a current game's feature vector, find the most similar historical games
// from our line_snapshots table. Note: we don't have full game outcomes stored
// (just snapshots), so this returns nearest-neighbor matches based on opening
// lines and game context.

export interface SimilarGame {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  gameTime: string;
  similarity: number;     // 0-1
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

  // Pull historical snapshots from the same sport (last 30 days)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('line_snapshots')
    .select('event_id, home_team, away_team, game_time, home_spread, total, taken_at')
    .eq('sport', sport)
    .lt('game_time', new Date().toISOString())  // games in the past
    .gte('taken_at', since)
    .order('taken_at', { ascending: true });

  if (!data || data.length === 0) return [];

  // Take first snapshot per event (= opening line)
  const seen = new Set<string>();
  const opens = data.filter(s => {
    if (seen.has(s.event_id)) return false;
    seen.add(s.event_id);
    return true;
  });

  // Score each historical game by similarity to current game
  const scored = opens.map(o => {
    let score = 0;
    let factors = 0;

    if (currentSpread !== null && o.home_spread !== null) {
      const spreadDiff = Math.abs(currentSpread - Number(o.home_spread));
      score += Math.max(0, 1 - spreadDiff / 14); // 14-point max gap
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

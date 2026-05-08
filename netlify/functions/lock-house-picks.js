// SCHEDULED FUNCTION — runs daily at 13:00 UTC (≈9am ET).
// 1. Fetches today's player props from Odds API (reuses our existing /api/props cache logic)
// 2. Scores each prop with a simplified version of the parlay-builder algorithm
// 3. Builds top S-tier 3-leg parlay per sport (NFL/NBA/MLB)
// 4. Stores top 3 picks of the day in house_picks table
// 5. Returns count for monitoring
const https = require('https');

const ODDS_KEY = process.env.ODDS_API_KEY;
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.supabase_url || process.env.vite_supabase_url;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.supabase_service_role_key || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// Active sports rotation: try MLB first (most volume), then NBA, then NFL
const PICK_SPORTS = [
  { sport: 'mlb',  oddsKey: 'baseball_mlb',           propMarkets: 'batter_hits,batter_total_bases,pitcher_strikeouts,batter_rbis' },
  { sport: 'nba',  oddsKey: 'basketball_nba',         propMarkets: 'player_points,player_rebounds,player_assists,player_threes' },
  { sport: 'nfl',  oddsKey: 'americanfootball_nfl',   propMarkets: 'player_pass_yds,player_rush_yds,player_reception_yds,player_receptions' },
  { sport: 'nhl',  oddsKey: 'icehockey_nhl',          propMarkets: 'player_shots_on_goal,player_points' },
  { sport: 'wnba', oddsKey: 'basketball_wnba',        propMarkets: 'player_points,player_rebounds,player_assists' },
];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Betz360/1.0' } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function postJSON(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function americanToDecimal(o) {
  if (!o) return 1;
  return o > 0 ? o / 100 + 1 : 100 / Math.abs(o) + 1;
}
function decimalToAmerican(d) {
  if (d <= 1) return 0;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function impliedProb(o) {
  return Math.round((1 / americanToDecimal(o)) * 100);
}

// Simplified leg scoring: prefer slight underdogs (-130 to +110), penalize heavy favorites
function scoreLeg(odds) {
  if (!odds || odds === 0) return 0;
  if (odds < -200 || odds > 200) return 35;       // too extreme either way
  if (odds >= -130 && odds <= 110) return 75;     // sweet spot
  if (odds >= -180 && odds <= 150) return 65;
  return 50;
}

// Build the best 3-leg parlay from a pool of legs. Each leg = {prop, pick, odds, conf}.
function build3LegParlay(pool, skipTop = 0) {
  if (pool.length < 3 + skipTop) return null;
  // Sort by confidence, then walk down the list picking legs that:
  //  - aren't the same player+propType (no duplicating "Curry over points" twice)
  //  - respect the underdog cap (max 2 dogs per parlay)
  // Same-game multi-legs (SGPs) are allowed — that's how modern parlays work.
  const sorted = pool.slice().sort((a, b) => b.confidence - a.confidence);
  const seenPlayerProps = new Set();
  const legs = [];
  let underdogs = 0;
  let skippedSoFar = 0;
  for (const l of sorted) {
    if (legs.length >= 3) break;
    const key = `${l.playerName}-${l.propType}`;
    if (seenPlayerProps.has(key)) continue;
    if (l.odds > 0 && underdogs >= 2) continue;
    // Skip the first `skipTop` qualifying legs so a second/third parlay
    // built from the same pool produces meaningfully different picks
    if (skippedSoFar < skipTop) { skippedSoFar++; continue; }
    seenPlayerProps.add(key);
    if (l.odds > 0) underdogs++;
    legs.push(l);
  }
  if (legs.length < 3) return null;
  const dec = legs.reduce((a, l) => a * americanToDecimal(l.odds), 1);
  const combinedOdds = decimalToAmerican(dec);
  const avgConf = Math.round(legs.reduce((a, l) => a + l.confidence, 0) / legs.length);
  return {
    legs: legs.map(l => ({
      player: l.playerName,
      propType: l.propType,
      line: l.line,
      pick: l.pick,
      odds: l.odds,
      gameId: l.gameId,
      matchup: l.matchup,
    })),
    combinedOdds,
    confidence: avgConf,
    // Tier boundaries: S=80+, A=65-79, B=below 65. Raised S threshold from
    // 75 to 80 so the public 'S-tier track record' on the landing hero is
    // built only from genuinely top-confidence picks, not borderline ones.
    tier: avgConf >= 80 ? 'S' : avgConf >= 65 ? 'A' : 'B',
  };
}

async function fetchSportProps(sport, oddsKey, propMarkets) {
  // Step 1: get today's events
  const evRes = await fetchJSON(`https://api.the-odds-api.com/v4/sports/${oddsKey}/events?apiKey=${ODDS_KEY}`);
  if (evRes.status !== 200 || !Array.isArray(evRes.data)) return [];

  const events = evRes.data
    .filter(e => {
      const t = new Date(e.commence_time).getTime();
      return t > Date.now() - 30 * 60 * 1000 && t < Date.now() + 24 * 60 * 60 * 1000;
    })
    .slice(0, 4); // limit to 4 games to control credit cost

  // Step 2: fetch props per event
  const allLegs = [];
  for (const ev of events) {
    const propRes = await fetchJSON(`https://api.the-odds-api.com/v4/sports/${oddsKey}/events/${ev.id}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${propMarkets}&oddsFormat=american`);
    if (propRes.status !== 200) continue;

    const book = propRes.data.bookmakers?.find(b => b.key === 'draftkings') || propRes.data.bookmakers?.[0];
    if (!book) continue;

    for (const market of book.markets || []) {
      for (const o of market.outcomes || []) {
        const playerName = o.description || o.name;
        const pick = o.name === 'Over' ? 'over' : o.name === 'Under' ? 'under' : null;
        if (!pick || !o.price) continue;
        allLegs.push({
          playerName,
          propType: market.key.replace(/^(player_|batter_|pitcher_)/, '').replace(/_/g, ' '),
          line: o.point,
          pick,
          odds: o.price,
          gameId: ev.id,
          matchup: `${ev.away_team} @ ${ev.home_team}`,
          confidence: scoreLeg(o.price) + Math.round(Math.random() * 10), // small randomness for variety
        });
      }
    }
  }

  return allLegs;
}

exports.handler = async (event) => {
  if (!ODDS_KEY || !SUPA_URL || !SUPA_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const inserted = [];
  const errors = [];
  const force = event?.queryStringParameters?.force === '1';

  // Force re-lock requires admin auth (otherwise anyone could keep
  // triggering the picker, burning Odds API credits)
  if (force) {
    const ADMIN_KEY = process.env.ADMIN_STATS_KEY || process.env.admin_stats_key;
    const key = event?.queryStringParameters?.key;
    if (!ADMIN_KEY || key !== ADMIN_KEY) {
      return { statusCode: 403, body: JSON.stringify({ error: 'force=1 requires admin key' }) };
    }
  }

  // Check if today's picks are already locked in (idempotency)
  // Skipped when ?force=1 is passed so we can manually re-lock
  if (!force) {
  const checkRes = await fetchJSON(`${SUPA_URL}/rest/v1/house_picks?pick_date=eq.${today}&select=id`)
    .catch(() => null);
  // Note: this check requires the supabase REST headers — we'll do it with proper headers
  const existingRes = await new Promise((resolve) => {
    const u = new URL(`${SUPA_URL}/rest/v1/house_picks?pick_date=eq.${today}&select=id`);
    https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });

  if (Array.isArray(existingRes) && existingRes.length > 0) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'already_locked', date: today, existing: existingRes.length, hint: 'add ?force=1 to re-lock today' }),
    };
  }
  } // end !force

  // Generate up to 3 parlays per sport (varying difficulty), keep top 8 overall
  const candidates = [];
  const skipped = [];
  for (const { sport, oddsKey, propMarkets } of PICK_SPORTS) {
    try {
      const legs = await fetchSportProps(sport, oddsKey, propMarkets);
      if (legs.length < 3) {
        skipped.push({ sport, reason: `only ${legs.length} valid props found` });
        continue;
      }
      // Build a top parlay, then a second one skipping the top 3 picks, then
      // a third one skipping 6 — produces three meaningfully different parlays
      // per sport instead of one. Smaller pools may only support 1-2.
      let builtCount = 0;
      for (const skipTop of [0, 3, 6]) {
        const parlay = build3LegParlay(legs, skipTop);
        if (parlay) { candidates.push({ sport, parlay }); builtCount++; }
      }
      if (builtCount === 0) skipped.push({ sport, reason: `${legs.length} legs but no valid 3-leg parlay` });
    } catch (e) {
      errors.push({ sport, error: String(e) });
    }
  }

  // Sort by confidence, take top 8 overall — gives users a meaningful set of
  // picks to follow each day across all in-season sports
  candidates.sort((a, b) => b.parlay.confidence - a.parlay.confidence);
  const topPicks = candidates.slice(0, 8);

  // On force re-lock, today may already have picks 1-N for some sports.
  // Look up the existing max rank per sport so we append (e.g. rank 4, 5, 6)
  // instead of colliding on the unique constraint.
  const existingMaxRankBySport = {};
  if (force) {
    const existingRes = await new Promise((resolve) => {
      const u = new URL(`${SUPA_URL}/rest/v1/house_picks?pick_date=eq.${today}&select=sport,rank`);
      https.get({
        hostname: u.hostname, path: u.pathname + u.search,
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { resolve([]); }
        });
      }).on('error', () => resolve([]));
    });
    if (Array.isArray(existingRes)) {
      for (const r of existingRes) {
        const s = r.sport;
        if (!existingMaxRankBySport[s] || r.rank > existingMaxRankBySport[s]) {
          existingMaxRankBySport[s] = r.rank;
        }
      }
    }
  }

  // Track per-sport rank counters so we can assign sport-scoped ranks
  // (rank 1 in mlb is independent of rank 1 in nba — the unique constraint
  // is on (date, rank, sport) so duplicates across sports are fine)
  const nextRankBySport = {};
  for (const s in existingMaxRankBySport) {
    nextRankBySport[s] = existingMaxRankBySport[s] + 1;
  }

  for (let i = 0; i < topPicks.length; i++) {
    const { sport, parlay } = topPicks[i];
    const rank = nextRankBySport[sport] || 1;
    nextRankBySport[sport] = rank + 1;

    const row = {
      pick_date: today,
      rank,
      sport,
      legs: parlay.legs,
      combined_odds: parlay.combinedOdds,
      confidence: parlay.confidence,
      tier: parlay.tier,
      status: 'pending',
    };
    const res = await postJSON(
      `${SUPA_URL}/rest/v1/house_picks`,
      row,
      { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: 'return=minimal' }
    );
    if (res.status >= 200 && res.status < 300) {
      inserted.push({ sport, rank, tier: parlay.tier, conf: parlay.confidence });
    } else {
      errors.push({ sport, supabaseStatus: res.status, body: res.body.slice(0, 200) });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: today, inserted, skipped, errors, ts: new Date().toISOString() }),
  };
};

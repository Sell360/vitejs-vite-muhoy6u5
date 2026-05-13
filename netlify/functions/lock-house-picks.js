// HOUSE PICKS V2 — single-leg game-line picks gated by 2+ hard signals.
// SIGNALS: polymarket disagree 3%+, RLM 5+ cents against public, steam (3
// snapshots same direction 8+ cents total), public 75%+ on opposite side,
// AI projection 5%+ better than DK. 3+ signals = S, 2 = A, less = filtered.

const https = require('https');
const ODDS_KEY = process.env.ODDS_API_KEY;
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.supabase_url || process.env.vite_supabase_url;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.supabase_service_role_key || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const PICK_SPORTS = [
  { sport: 'mlb',  oddsKey: 'baseball_mlb' },
  { sport: 'nba',  oddsKey: 'basketball_nba' },
  { sport: 'nhl',  oddsKey: 'icehockey_nhl' },
  { sport: 'wnba', oddsKey: 'basketball_wnba' },
];
const POLY_PCT = 3, RLM_TICKS = 5, PUBLIC_PCT = 75, AI_PCT = 5, MIN_SIG = 2;
// Track record optics: don't lock extreme dogs that look reckless even when
// signals fire. +450 max — past that the bet is too speculative for a public
// pick list, regardless of edge.
const MAX_ODDS = 450;
// Daily cap on total picks across all sports (avoid spamming the page)
const MAX_PICKS_PER_DAY = 10;
// Odds bucket distribution — picker tries to fill each bucket so the slate
// isn't 100% dogs. Buckets are checked in priority order until full.
const ODDS_BUCKETS = [
  { name: 'favorite',  min: -300, max: -130, target: 2 },
  { name: 'pickem',    min: -130, max:  130, target: 2 },
  { name: 'mild_dog',  min:  130, max:  250, target: 3 },
  { name: 'long_dog',  min:  250, max:  450, target: 3 },
];

function fetchJSON(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Betz360/1.0', ...(headers || {}) } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function postJSON(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}
function impliedPct(o) { if (!o) return 50; const d = o > 0 ? o / 100 + 1 : 100 / Math.abs(o) + 1; return (1 / d) * 100; }
function publicEstimate(homeML, awayML) {
  const homeFav = homeML < 0;
  const ml = homeFav ? Math.abs(homeML) : Math.abs(awayML);
  const skew = Math.min(ml / 10, 35);
  const home = Math.round(homeFav ? 50 + skew : 50 - skew);
  return { home, away: 100 - home };
}
async function getHistory(eventId) {
  if (!eventId || !SUPA_URL || !SUPA_KEY) return [];
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(eventId)) return [];
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const url = SUPA_URL + '/rest/v1/line_snapshots?event_id=eq.' + eventId + '&taken_at=gte.' + encodeURIComponent(since) + '&order=taken_at.asc&select=*';
  try { const r = await fetchJSON(url, { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }); return Array.isArray(r.data) ? r.data : []; } catch { return []; }
}
function detectRLM(snaps, publicSide) {
  if (!Array.isArray(snaps) || snaps.length < 2) return false;
  const f = snaps[0], l = snaps[snaps.length - 1];
  if (!f || !l || f.home_ml == null || l.home_ml == null) return false;
  const d = l.home_ml - f.home_ml;
  if (publicSide === 'home' && d >= RLM_TICKS) return true;
  if (publicSide === 'away' && d <= -RLM_TICKS) return true;
  return false;
}
function detectSteam(snaps, side) {
  if (!Array.isArray(snaps) || snaps.length < 3) return false;
  const r = snaps.slice(-3);
  const d = r[2].home_ml - r[0].home_ml;
  if (side === 'home' && d <= -8) return true;
  if (side === 'away' && d >= 8) return true;
  return false;
}
function aiProj(homeML_dk, awayML_dk, allBooks) {
  if (!allBooks || allBooks.length < 3) return { home: false, away: false, homeChalk: false, awayChalk: false };
  let hs = 0, as = 0, n = 0;
  for (const b of allBooks) {
    const h2h = b.markets && b.markets.find(m => m.key === 'h2h');
    if (!h2h || !h2h.outcomes || h2h.outcomes.length < 2) continue;
    const h = h2h.outcomes[0] && h2h.outcomes[0].price;
    const a = h2h.outcomes[1] && h2h.outcomes[1].price;
    if (!h || !a) continue;
    hs += impliedPct(h); as += impliedPct(a); n++;
  }
  if (n < 3) return { home: false, away: false, homeChalk: false, awayChalk: false };
  const ha = hs / n, aa = as / n;
  const dh = impliedPct(homeML_dk), da = impliedPct(awayML_dk);
  // Standard signal: consensus prices the side better than DK (positive EV)
  // Fires more on dogs since favorites are typically shaded too tight.
  const homeValue = (ha - dh) >= AI_PCT;
  const awayValue = (aa - da) >= AI_PCT;
  // Chalk signal: heavy favorite (-130 or worse) where market consensus
  // confirms the price within 2%. This means the favorite is correctly priced
  // by both DK and the market — a strong-fundamentals signal. Lets us lock
  // legitimate favorites without distorting the dog-finding signals.
  const homeChalk = homeML_dk <= -130 && Math.abs(ha - dh) <= 2;
  const awayChalk = awayML_dk <= -130 && Math.abs(aa - da) <= 2;
  return { home: homeValue, away: awayValue, homeChalk, awayChalk };
}
async function getPolyEdge(sport, awayTeam, homeTeam) {
  try {
    const r = await fetchJSON('https://betz360.com/api/polymarket?sport=' + sport);
    if (r.status !== 200 || !r.data || !r.data.markets) return null;
    const home = (homeTeam || '').toLowerCase();
    const away = (awayTeam || '').toLowerCase();
    const m = r.data.markets.find(x => { const q = (x.question || '').toLowerCase(); return q.includes(home) && q.includes(away); });
    if (!m) return null;
    return {
      homeProb: m.outcomePrices && m.outcomePrices[0] ? parseFloat(m.outcomePrices[0]) * 100 : null,
      awayProb: m.outcomePrices && m.outcomePrices[1] ? parseFloat(m.outcomePrices[1]) * 100 : null,
    };
  } catch { return null; }
}

exports.handler = async (event) => {
  if (!ODDS_KEY || !SUPA_URL || !SUPA_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  const today = new Date().toISOString().split('T')[0];
  const inserted = [], errors = [], skipped = [];
  const force = event && event.queryStringParameters && event.queryStringParameters.force === '1';
  if (force) {
    const ADMIN_KEY = process.env.ADMIN_STATS_KEY || process.env.admin_stats_key;
    const key = event.queryStringParameters.key;
    if (!ADMIN_KEY || key !== ADMIN_KEY) return { statusCode: 403, body: JSON.stringify({ error: 'force=1 requires admin key' }) };
  }
  if (!force) {
    const ex = await fetchJSON(SUPA_URL + '/rest/v1/house_picks?pick_date=eq.' + today + '&select=id', { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }).catch(() => ({ data: [] }));
    if (Array.isArray(ex.data) && ex.data.length > 0) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'already_locked', existing: ex.data.length, hint: 'add ?force=1&key=ADMIN_KEY to re-lock' }) };
    }
  }
  const candidates = [];
  for (const sportConf of PICK_SPORTS) {
    const sport = sportConf.sport, oddsKey = sportConf.oddsKey;
    try {
      const r = await fetchJSON('https://api.the-odds-api.com/v4/sports/' + oddsKey + '/odds?apiKey=' + ODDS_KEY + '&regions=us&markets=h2h,spreads&oddsFormat=american');
      if (r.status !== 200) { skipped.push({ sport, reason: 'odds api ' + r.status }); continue; }
      const games = Array.isArray(r.data) ? r.data : [];
      if (!games.length) { skipped.push({ sport, reason: 'no games today' }); continue; }
      for (const game of games) {
        const dkBook = (game.bookmakers || []).find(b => b.key === 'draftkings') || (game.bookmakers || []).find(b => b.key === 'fanduel') || (game.bookmakers || [])[0];
        if (!dkBook) continue;
        const h2h = dkBook.markets && dkBook.markets.find(m => m.key === 'h2h');
        const spreadM = dkBook.markets && dkBook.markets.find(m => m.key === 'spreads');
        if (!h2h) continue;
        const homeOutcome = h2h.outcomes && h2h.outcomes.find(o => o.name === game.home_team);
        const awayOutcome = h2h.outcomes && h2h.outcomes.find(o => o.name === game.away_team);
        const homeML = homeOutcome && homeOutcome.price;
        const awayML = awayOutcome && awayOutcome.price;
        if (homeML == null || awayML == null) continue;
        if (Math.abs(homeML) > 2500 || Math.abs(awayML) > 2500) continue;
        const pPub = publicEstimate(homeML, awayML);
        const hist = await getHistory(game.id);
        const poly = await getPolyEdge(sport, game.away_team, game.home_team);
        const ai = aiProj(homeML, awayML, game.bookmakers || []);
        const homeSig = [], awaySig = [];
        if (poly && poly.homeProb != null) { const dk = impliedPct(homeML); if (poly.homeProb - dk >= POLY_PCT) homeSig.push({ type: 'polymarket', detail: 'Polymarket ' + poly.homeProb.toFixed(1) + '% vs DK ' + dk.toFixed(1) + '%' }); }
        if (pPub.away >= PUBLIC_PCT) homeSig.push({ type: 'public_fade', detail: pPub.away + '% public on ' + game.away_team });
        if (detectRLM(hist, 'away')) homeSig.push({ type: 'rlm', detail: 'Line moved 5+ cents toward ' + game.home_team });
        if (detectSteam(hist, 'home')) homeSig.push({ type: 'steam', detail: 'Steam toward ' + game.home_team });
        if (ai.home) homeSig.push({ type: 'ai_proj', detail: 'Market consensus stronger on ' + game.home_team });
        if (ai.homeChalk) homeSig.push({ type: 'consensus_chalk', detail: game.home_team + ' is a fairly-priced favorite — DK and market agree' });
        if (poly && poly.awayProb != null) { const dk = impliedPct(awayML); if (poly.awayProb - dk >= POLY_PCT) awaySig.push({ type: 'polymarket', detail: 'Polymarket ' + poly.awayProb.toFixed(1) + '% vs DK ' + dk.toFixed(1) + '%' }); }
        if (pPub.home >= PUBLIC_PCT) awaySig.push({ type: 'public_fade', detail: pPub.home + '% public on ' + game.home_team });
        if (detectRLM(hist, 'home')) awaySig.push({ type: 'rlm', detail: 'Line moved 5+ cents toward ' + game.away_team });
        if (detectSteam(hist, 'away')) awaySig.push({ type: 'steam', detail: 'Steam toward ' + game.away_team });
        if (ai.away) awaySig.push({ type: 'ai_proj', detail: 'Market consensus stronger on ' + game.away_team });
        if (ai.awayChalk) awaySig.push({ type: 'consensus_chalk', detail: game.away_team + ' is a fairly-priced favorite — DK and market agree' });
        const cands = [];
        // Reject candidates with odds worse than MAX_ODDS to keep slate readable.
        // Long-shot picks with edge get filtered for track-record optics.
        if (homeSig.length >= MIN_SIG && homeML <= MAX_ODDS) cands.push({ sport, game, betType: 'ML', side: 'home', pickLabel: game.home_team + ' ML', line: null, odds: homeML, signals: homeSig });
        if (awaySig.length >= MIN_SIG && awayML <= MAX_ODDS) cands.push({ sport, game, betType: 'ML', side: 'away', pickLabel: game.away_team + ' ML', line: null, odds: awayML, signals: awaySig });
        if (spreadM) {
          const hS = spreadM.outcomes && spreadM.outcomes.find(o => o.name === game.home_team);
          const aS = spreadM.outcomes && spreadM.outcomes.find(o => o.name === game.away_team);
          if (hS && homeSig.length >= MIN_SIG && hS.price <= MAX_ODDS) cands.push({ sport, game, betType: 'SPREAD', side: 'home', pickLabel: game.home_team + ' ' + (hS.point > 0 ? '+' : '') + hS.point, line: hS.point, odds: hS.price, signals: homeSig });
          if (aS && awaySig.length >= MIN_SIG && aS.price <= MAX_ODDS) cands.push({ sport, game, betType: 'SPREAD', side: 'away', pickLabel: game.away_team + ' ' + (aS.point > 0 ? '+' : '') + aS.point, line: aS.point, odds: aS.price, signals: awaySig });
        }
        cands.sort((a, b) => { if (b.signals.length !== a.signals.length) return b.signals.length - a.signals.length; return a.betType === 'ML' ? -1 : 1; });
        if (cands[0]) candidates.push(cands[0]);
      }
    } catch (e) { errors.push({ sport, error: String(e) }); }
  }
  candidates.sort((a, b) => b.signals.length - a.signals.length);
  // Distribute picks across odds buckets so the slate isn't 100% dogs.
  // For each bucket (favorites → pickem → mild dogs → long dogs), pull the
  // strongest available candidates until either the bucket target is met or
  // we've hit the daily max.
  const selected = [];
  const used = new Set();
  for (const bucket of ODDS_BUCKETS) {
    const fitting = candidates.filter((c, i) => {
      if (used.has(i)) return false;
      const o = c.odds;
      return o >= bucket.min && o < bucket.max;
    });
    for (let i = 0; i < bucket.target && i < fitting.length && selected.length < MAX_PICKS_PER_DAY; i++) {
      const candIdx = candidates.indexOf(fitting[i]);
      selected.push(fitting[i]);
      used.add(candIdx);
    }
    if (selected.length >= MAX_PICKS_PER_DAY) break;
  }
  // If buckets didn't fill, top up with strongest remaining (regardless of bucket)
  if (selected.length < MAX_PICKS_PER_DAY) {
    for (let i = 0; i < candidates.length && selected.length < MAX_PICKS_PER_DAY; i++) {
      if (!used.has(i)) { selected.push(candidates[i]); used.add(i); }
    }
  }
  // Re-sort final selection by signal count (strongest first)
  selected.sort((a, b) => b.signals.length - a.signals.length);
  const nextRankBySport = {};
  if (force) {
    const r = await fetchJSON(SUPA_URL + '/rest/v1/house_picks?pick_date=eq.' + today + '&select=sport,rank', { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }).catch(() => ({ data: [] }));
    if (Array.isArray(r.data)) for (const row of r.data) nextRankBySport[row.sport] = Math.max(nextRankBySport[row.sport] || 0, row.rank);
    for (const s in nextRankBySport) nextRankBySport[s] += 1;
  }
  for (const c of selected) {
    const rank = nextRankBySport[c.sport] || 1;
    nextRankBySport[c.sport] = rank + 1;
    const tier = c.signals.length >= 3 ? 'S' : 'A';
    const confidence = Math.min(95, c.signals.length * 18 + 50);
    const row = {
      pick_date: today, rank, sport: c.sport,
      legs: [{ gameId: c.game.id, matchup: c.game.away_team + ' @ ' + c.game.home_team, betType: c.betType, side: c.side, line: c.line, label: c.pickLabel, odds: c.odds, signals: c.signals }],
      combined_odds: c.odds, confidence, tier, status: 'pending',
      bet_type: c.betType, pick_side: c.side, pick_label: c.pickLabel,
      event_id: c.game.id, line: c.line, signal_count: c.signals.length, signals: c.signals,
    };
    const res = await postJSON(SUPA_URL + '/rest/v1/house_picks', row, { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, Prefer: 'return=minimal' });
    if (res.status >= 200 && res.status < 300) inserted.push({ sport: c.sport, rank, tier, signals: c.signals.length, label: c.pickLabel });
    else errors.push({ sport: c.sport, supabaseStatus: res.status, body: res.body.slice(0, 200) });
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: today, inserted, skipped, errors, ts: new Date().toISOString() }) };
};

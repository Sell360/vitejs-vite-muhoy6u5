// Closing Line endpoint — uses our own line_snapshots table (free, no API cost)
// instead of The Odds API historical endpoint (which costs 10 credits per call).
// Falls back to historical only if no recent snapshot exists for this event.
const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=86400',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const ODDS_KEY = process.env.ODDS_API_KEY;

  const { sport, eventId, gameTime, market } = event.queryStringParameters || {};
  if (!eventId || !gameTime) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Required: eventId, gameTime (ISO)' }) };
  }

  const fetchJSON = (url, hdrs) => new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: hdrs || {} }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

  // ── 1. Try Supabase snapshots first (free) ──────────────────────────────
  if (SUPA_URL && SUPA_KEY) {
    try {
      const gameStart = new Date(gameTime).getTime();
      const windowStart = new Date(gameStart - 60 * 60 * 1000).toISOString(); // 1 hr before game
      const windowEnd = new Date(gameStart + 30 * 60 * 1000).toISOString();   // 30 min after start

      const url = `${SUPA_URL}/rest/v1/line_snapshots?event_id=eq.${eventId}&taken_at=gte.${windowStart}&taken_at=lte.${windowEnd}&order=taken_at.desc&limit=1`;
      const snap = await fetchJSON(url, { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` });

      if (snap.status === 200 && Array.isArray(snap.data) && snap.data.length > 0) {
        const s = snap.data[0];
        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            available: true, source: 'snapshot',
            timestamp: s.taken_at,
            eventId, homeTeam: s.home_team, awayTeam: s.away_team,
            moneyline: { home: s.home_ml, away: s.away_ml },
            spread: { home: s.home_spread, line: s.home_spread, homeOdds: s.home_spread_odds, awayOdds: s.away_spread_odds },
            total: { line: s.total, overOdds: s.over_odds, underOdds: s.under_odds },
          }),
        };
      }
    } catch {}
  }

  // ── 2. Fallback to historical endpoint (costs 10 credits) ───────────────
  if (!ODDS_KEY) {
    return { statusCode: 200, headers, body: JSON.stringify({ available: false, error: 'No snapshot or API key' }) };
  }

  const SPORT_KEYS = {
    mlb: 'baseball_mlb', nba: 'basketball_nba', nfl: 'americanfootball_nfl',
    ncaaf: 'americanfootball_ncaaf', nhl: 'icehockey_nhl', wnba: 'basketball_wnba',
    ufc: 'mma_mixed_martial_arts',
  };
  const sportKey = SPORT_KEYS[sport];
  if (!sportKey) return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown sport: ${sport}` }) };

  const closingTime = new Date(new Date(gameTime).getTime() - 5 * 60 * 1000).toISOString();
  const markets = market || 'h2h,spreads,totals';
  const url = `https://api.the-odds-api.com/v4/historical/sports/${sportKey}/events/${eventId}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${markets}&oddsFormat=american&date=${closingTime}`;

  try {
    const { status, data } = await fetchJSON(url);
    if (status !== 200) {
      return { statusCode: 200, headers, body: JSON.stringify({ available: false, error: data?.message || `HTTP ${status}` }) };
    }
    const snapshot = data?.data;
    if (!snapshot || !snapshot.bookmakers) {
      return { statusCode: 200, headers, body: JSON.stringify({ available: false }) };
    }

    // Compute consensus (median across books)
    const result = {
      available: true, source: 'historical',
      timestamp: data.timestamp,
      eventId: snapshot.id, homeTeam: snapshot.home_team, awayTeam: snapshot.away_team,
      moneyline: { home: null, away: null },
      spread: { home: null, line: null, homeOdds: null, awayOdds: null },
      total: { line: null, overOdds: null, underOdds: null },
    };

    const mlH = [], mlA = [], spLine = [], spH = [], spA = [], totLine = [], oOdds = [], uOdds = [];
    snapshot.bookmakers.forEach(bk => {
      bk.markets.forEach(m => {
        if (m.key === 'h2h') {
          m.outcomes.forEach(o => {
            if (o.name === snapshot.home_team) mlH.push(americanFromDec(o.price));
            if (o.name === snapshot.away_team) mlA.push(americanFromDec(o.price));
          });
        }
        if (m.key === 'spreads') {
          m.outcomes.forEach(o => {
            if (o.name === snapshot.home_team) { spLine.push(o.point); spH.push(americanFromDec(o.price)); }
            if (o.name === snapshot.away_team) spA.push(americanFromDec(o.price));
          });
        }
        if (m.key === 'totals') {
          m.outcomes.forEach(o => {
            if (o.name === 'Over') { totLine.push(o.point); oOdds.push(americanFromDec(o.price)); }
            if (o.name === 'Under') uOdds.push(americanFromDec(o.price));
          });
        }
      });
    });

    if (mlH.length) result.moneyline.home = median(mlH);
    if (mlA.length) result.moneyline.away = median(mlA);
    if (spLine.length) { result.spread.line = median(spLine); result.spread.homeOdds = median(spH); result.spread.awayOdds = median(spA); }
    if (totLine.length) { result.total.line = median(totLine); result.total.overOdds = median(oOdds); result.total.underOdds = median(uOdds); }

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(err) }) };
  }
};

function americanFromDec(d) {
  if (!d || d <= 1) return 0;
  if (d >= 2) return Math.round((d - 1) * 100);
  return Math.round(-100 / (d - 1));
}
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

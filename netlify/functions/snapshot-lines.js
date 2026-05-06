// SCHEDULED FUNCTION — runs every 30 minutes via Netlify schedule.
// 1. Fetches game lines for active sports
// 2. Inserts a snapshot row to Supabase
// 3. Returns count for monitoring
//
// Setup in netlify.toml:
//   [functions."snapshot-lines"]
//     schedule = "*/30 * * * *"
const https = require('https');

const SPORT_MAP = {
  mlb: 'baseball_mlb', nba: 'basketball_nba', nfl: 'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf', nhl: 'icehockey_nhl', wnba: 'basketball_wnba',
};

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function postJSON(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, body: text });
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

exports.handler = async () => {
  const ODDS_KEY = process.env.ODDS_API_KEY;
  const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!ODDS_KEY || !SUPA_URL || !SUPA_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  const inserted = {};
  const errors = [];

  for (const [sport, oddsSport] of Object.entries(SPORT_MAP)) {
    try {
      // First — free events check. If no games in next 6 hrs, skip this sport entirely.
      const evCheck = await fetchJSON(`https://api.the-odds-api.com/v4/sports/${oddsSport}/events?apiKey=${ODDS_KEY}`);
      if (evCheck.status !== 200 || !Array.isArray(evCheck.data)) continue;
      const upcomingGames = evCheck.data.filter(e => {
        const t = new Date(e.commence_time).getTime();
        return t > Date.now() - 30 * 60 * 1000 && t < Date.now() + 6 * 60 * 60 * 1000;
      });
      if (upcomingGames.length === 0) continue;

      // Now spend 3 credits on the full odds call
      const r = await fetchJSON(`https://api.the-odds-api.com/v4/sports/${oddsSport}/odds?apiKey=${ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`);
      if (r.status !== 200 || !Array.isArray(r.data)) {
        errors.push({ sport, status: r.status });
        continue;
      }

      const rows = r.data
        .filter(g => new Date(g.commence_time).getTime() > Date.now() - 30 * 60 * 1000)
        .map(g => {
          const book = g.bookmakers?.find(b => b.key === 'draftkings') || g.bookmakers?.find(b => b.key === 'fanduel') || g.bookmakers?.[0];
          if (!book) return null;
          const h2h = book.markets?.find(m => m.key === 'h2h');
          const sp  = book.markets?.find(m => m.key === 'spreads');
          const tot = book.markets?.find(m => m.key === 'totals');
          return {
            sport,
            event_id: g.id,
            home_team: g.home_team,
            away_team: g.away_team,
            game_time: g.commence_time,
            home_ml: h2h?.outcomes?.find(o => o.name === g.home_team)?.price ?? null,
            away_ml: h2h?.outcomes?.find(o => o.name === g.away_team)?.price ?? null,
            home_spread: sp?.outcomes?.find(o => o.name === g.home_team)?.point ?? null,
            home_spread_odds: sp?.outcomes?.find(o => o.name === g.home_team)?.price ?? null,
            away_spread: sp?.outcomes?.find(o => o.name === g.away_team)?.point ?? null,
            away_spread_odds: sp?.outcomes?.find(o => o.name === g.away_team)?.price ?? null,
            total: tot?.outcomes?.find(o => o.name === 'Over')?.point ?? null,
            over_odds: tot?.outcomes?.find(o => o.name === 'Over')?.price ?? null,
            under_odds: tot?.outcomes?.find(o => o.name === 'Under')?.price ?? null,
            taken_at: new Date().toISOString(),
          };
        })
        .filter(Boolean);

      if (rows.length === 0) continue;

      const insertRes = await postJSON(
        `${SUPA_URL}/rest/v1/line_snapshots`,
        rows,
        { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: 'return=minimal' }
      );

      if (insertRes.status >= 200 && insertRes.status < 300) {
        inserted[sport] = rows.length;
      } else {
        errors.push({ sport, supabaseStatus: insertRes.status, body: insertRes.body.slice(0, 200) });
      }
    } catch (e) {
      errors.push({ sport, error: String(e) });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inserted, errors, ts: new Date().toISOString() }),
  };
};

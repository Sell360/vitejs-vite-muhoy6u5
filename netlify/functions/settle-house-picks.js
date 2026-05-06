// SCHEDULED FUNCTION — runs nightly at 09:00 UTC (≈4-5am ET).
// Settles yesterday's house picks based on completed game scores.
//
// IMPORTANT LIMITATION: We don't have player-level box scores in our pipeline.
// True player-prop settlement requires box-score data per player which The
// Odds API doesn't provide on the standard plan. For now this function only
// resolves game-level picks (moneyline / spread / total) — which we don't
// currently lock as house picks.
//
// PRACTICAL APPROACH for player props:
// We use a heuristic: if a game has ended (status=completed in the scores
// endpoint), we mark the pick as 'pending_review'. Manual settlement via
// the admin panel is the safest path for player props until we add a box-
// score data source.
//
// This function therefore: marks games as completed, leaves player-prop
// picks for admin review.
const https = require('https');

const ODDS_KEY = process.env.ODDS_API_KEY;
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

function fetchJSON(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function patchJSON(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
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

const SPORT_KEYS = {
  mlb: 'baseball_mlb', nba: 'basketball_nba', nfl: 'americanfootball_nfl',
  nhl: 'icehockey_nhl', wnba: 'basketball_wnba', ncaaf: 'americanfootball_ncaaf',
};

exports.handler = async () => {
  if (!ODDS_KEY || !SUPA_URL || !SUPA_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  // Pull all pending picks from the last 7 days (catch any that missed yesterday)
  const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const picksUrl = `${SUPA_URL}/rest/v1/house_picks?status=eq.pending&pick_date=gte.${sinceDate}&select=*`;
  const picksRes = await fetchJSON(picksUrl, { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` });

  if (picksRes.status !== 200 || !Array.isArray(picksRes.data)) {
    return { statusCode: 500, body: JSON.stringify({ error: 'failed to fetch pending picks', status: picksRes.status }) };
  }

  const pending = picksRes.data;
  if (pending.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ status: 'no_pending', ts: new Date().toISOString() }) };
  }

  // Group picks by sport so we can fetch scores efficiently
  const bySport = {};
  for (const p of pending) {
    if (!bySport[p.sport]) bySport[p.sport] = [];
    bySport[p.sport].push(p);
  }

  const results = { updated: [], skipped: [], errors: [] };

  // For each sport, fetch completed game scores
  for (const [sport, picks] of Object.entries(bySport)) {
    const sportKey = SPORT_KEYS[sport];
    if (!sportKey) {
      results.errors.push({ sport, reason: 'unknown sport' });
      continue;
    }

    try {
      // Free endpoint: scores from the last 3 days
      const scoresRes = await fetchJSON(
        `https://api.the-odds-api.com/v4/sports/${sportKey}/scores?apiKey=${ODDS_KEY}&daysFrom=3`
      );
      if (scoresRes.status !== 200 || !Array.isArray(scoresRes.data)) {
        results.errors.push({ sport, status: scoresRes.status });
        continue;
      }

      const completedGames = new Set(
        scoresRes.data.filter(g => g.completed).map(g => g.id)
      );

      // For each pick, check if all of its leg gameIds are in completedGames
      for (const pick of picks) {
        const legs = Array.isArray(pick.legs) ? pick.legs : [];
        const allCompleted = legs.every(l => completedGames.has(l.gameId));
        if (!allCompleted) {
          results.skipped.push({ id: pick.id, reason: 'games not yet complete' });
          continue;
        }

        // All games complete — flag for admin review. Player props need box scores
        // we don't have. Admin panel will let you settle these manually.
        // For now we just mark as 'pending_review' status which the UI shows
        // distinctly.
        const patchRes = await patchJSON(
          `${SUPA_URL}/rest/v1/house_picks?id=eq.${pick.id}`,
          { status: 'pending_review', settled_at: null },
          { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: 'return=minimal' }
        );

        if (patchRes.status >= 200 && patchRes.status < 300) {
          results.updated.push({ id: pick.id, sport, status: 'pending_review' });
        } else {
          results.errors.push({ id: pick.id, supabaseStatus: patchRes.status });
        }
      }
    } catch (e) {
      results.errors.push({ sport, error: String(e) });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...results, ts: new Date().toISOString() }),
  };
};

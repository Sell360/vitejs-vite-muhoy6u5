// public-trap.js
// Identifies "Public Traps" — games where:
//   1. The public is heavily on one side (estimated 70%+)
//   2. (optional) Sharp money is moving the line AGAINST that public side
//      (reverse line movement detected from our line_snapshots history)
//
// Returns 3-5 games per sport ranked by trap confidence. Used by the
// "Public Trap" UI section to surface fade candidates daily.
//
// COST: zero new external API calls. Uses ESPN public betting (already
// called by the existing public-betting.js endpoint) and Supabase
// line_snapshots (populated every 2hrs by the snapshot-lines cron).
//
// HONESTY NOTE: ESPN doesn't expose real public betting %. We infer it
// from odds skew the same way the existing public-betting.js does. The
// real signal is the LINE MOVEMENT cross-reference — that's hard data.

const https = require('https');

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.supabase_url || process.env.vite_supabase_url;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.supabase_service_role_key || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const ESPN_PATHS = {
  mlb: 'baseball/mlb', nba: 'basketball/nba', nfl: 'football/nfl',
  nhl: 'hockey/nhl', ncaaf: 'football/college-football',
  wnba: 'basketball/wnba',
};

const PUBLIC_THRESHOLD = 70;       // 70%+ public action triggers consideration
const TRAP_RLM_MIN_TICKS = 5;      // minimum line movement (in ML cents) opposite public to confirm trap

const get = (url) => new Promise((resolve, reject) => {
  https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, (res) => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
      try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
      catch (e) { reject(e); }
    });
  }).on('error', reject);
});

// Read line snapshots for a given event over the past 24 hours
async function getLineHistory(eventId) {
  if (!SUPA_URL || !SUPA_KEY) return [];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = `${SUPA_URL}/rest/v1/line_snapshots?event_id=eq.${eventId}&taken_at=gte.${encodeURIComponent(since)}&order=taken_at.asc&select=*`;
  return new Promise((resolve) => {
    const u = new URL(url);
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
}

// Detect reverse line movement: did the line move AGAINST the heavy public side?
// Returns: { detected: bool, ticks: number, direction: 'fade-home'|'fade-away'|null }
function detectRLM(snapshots, publicSide) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return { detected: false, ticks: 0, direction: null };
  }
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  if (!first?.home_ml || !last?.home_ml) return { detected: false, ticks: 0, direction: null };

  // ML "ticks" we use: just absolute difference of the home ML.
  // If home was -150 → -135, ML moved away from home (line shorter on home).
  // If public was on home AND line moved off home, that's RLM (sharp fading public).
  const homeMlDelta = last.home_ml - first.home_ml;

  if (publicSide === 'home') {
    // public on home; we want home ML to have moved UP (line shortening on home)
    // (e.g. -150 → -135 = +15 delta, sharp money fading the home favorite)
    if (homeMlDelta >= TRAP_RLM_MIN_TICKS) {
      return { detected: true, ticks: homeMlDelta, direction: 'fade-home' };
    }
  } else if (publicSide === 'away') {
    // public on away; home ML should have moved DOWN (line lengthening on home,
    // shortening on away dog or shortening away favorite)
    if (homeMlDelta <= -TRAP_RLM_MIN_TICKS) {
      return { detected: true, ticks: Math.abs(homeMlDelta), direction: 'fade-away' };
    }
  }
  return { detected: false, ticks: 0, direction: null };
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport } = event.queryStringParameters || {};
  const path = ESPN_PATHS[sport];
  if (!path) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };
  }

  try {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const scoreRes = await get(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${today}&limit=20`);
    if (scoreRes.status !== 200) throw new Error(`ESPN ${scoreRes.status}`);

    const events = scoreRes.data?.events || [];
    const traps = [];

    await Promise.allSettled(events.map(async (ev) => {
      try {
        const comp = ev.competitions?.[0];
        const home = comp?.competitors?.find(c => c.homeAway === 'home');
        const away = comp?.competitors?.find(c => c.homeAway === 'away');
        const homeTeam = home?.team?.abbreviation || home?.team?.shortDisplayName || '';
        const awayTeam = away?.team?.abbreviation || away?.team?.shortDisplayName || '';

        const oddsRes = await get(
          `https://sports.core.api.espn.com/v2/sports/${path.split('/')[0]}/leagues/${path.split('/')[1]}/events/${ev.id}/competitions/${ev.id}/odds`
        );
        if (oddsRes.status !== 200) return;

        const items = oddsRes.data?.items || [];
        const book = items.find(i => i.provider?.name?.toLowerCase().includes('draftkings'))
          || items.find(i => i.provider?.name?.toLowerCase().includes('espn'))
          || items[0];
        if (!book) return;

        const homeML = book.homeTeamOdds?.moneyLine;
        const awayML = book.awayTeamOdds?.moneyLine;
        if (homeML == null || awayML == null) return;

        // Estimate public % (no free real source — same skew model as public-betting.js).
        // Public consistently overweights favorites; we lean public toward the
        // bigger favorite roughly proportional to ML magnitude.
        const homeFavorite = homeML < 0;
        const ml = homeFavorite ? Math.abs(homeML) : Math.abs(awayML);
        const skew = Math.min(ml / 10, 35);
        const homeBetPct = Math.round(homeFavorite ? 50 + skew : 50 - skew);
        const awayBetPct = 100 - homeBetPct;

        let publicSide = null;
        let publicPct = 0;
        if (homeBetPct >= PUBLIC_THRESHOLD)      { publicSide = 'home'; publicPct = homeBetPct; }
        else if (awayBetPct >= PUBLIC_THRESHOLD) { publicSide = 'away'; publicPct = awayBetPct; }
        if (!publicSide) return; // not a trap candidate

        // Cross-reference with line history. If we have RLM, this becomes a CONFIRMED trap.
        const history = await getLineHistory(ev.id);
        const rlm = detectRLM(history, publicSide);

        const trapLevel = rlm.detected ? 'confirmed' : 'watch';
        const teamName = publicSide === 'home' ? homeTeam : awayTeam;
        const fadeName = publicSide === 'home' ? awayTeam : homeTeam;

        const reason = rlm.detected
          ? `${publicPct}% public on ${teamName} · line moved ${rlm.ticks}+ cents toward ${fadeName} despite public action`
          : `${publicPct}% public on ${teamName} · no sharp counter-move yet (watch)`;

        traps.push({
          gameId: ev.id,
          matchup: `${awayTeam} @ ${homeTeam}`,
          homeTeam, awayTeam,
          startTime: ev.date,
          publicPercent: { home: homeBetPct, away: awayBetPct },
          publicSide,
          fadeSide: publicSide === 'home' ? 'away' : 'home',
          fadeTeam: fadeName,
          trapLevel,
          rlmTicks: rlm.ticks,
          reason,
          homeML, awayML,
        });
      } catch { }
    }));

    // Rank: confirmed traps first, then watch traps. Within each group, by
    // public % descending (heavier public = stronger fade signal).
    traps.sort((a, b) => {
      if (a.trapLevel !== b.trapLevel) return a.trapLevel === 'confirmed' ? -1 : 1;
      const aPub = Math.max(a.publicPercent.home, a.publicPercent.away);
      const bPub = Math.max(b.publicPercent.home, b.publicPercent.away);
      return bPub - aPub;
    });

    // Cap at top 5 to keep the UI focused
    const top = traps.slice(0, 5);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        sport,
        ts: new Date().toISOString(),
        traps: top,
        totalCandidates: traps.length,
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

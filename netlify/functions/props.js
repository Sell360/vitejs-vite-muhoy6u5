const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = '/tmp/betz360_cache.json';

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch { return {}; }
}

function saveCache(cache) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch { }
}

function isCacheValid(entry, ttlMinutes) {
  if (!entry) return false;
  const now = Date.now();
  // Expire at midnight
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  if (now >= midnight.getTime()) return false;
  // Check TTL
  return (now - entry.ts) < ttlMinutes * 60 * 1000;
}

const PROP_LABELS = {
  batter_hits: 'Hits', batter_total_bases: 'Total Bases', pitcher_strikeouts: 'Strikeouts',
  batter_rbis: 'RBIs', batter_home_runs: 'Home Runs', batter_walks: 'Walks',
  player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
  player_threes: '3-Pointers', player_points_rebounds_assists: 'Pts+Reb+Ast',
  player_steals: 'Steals', player_blocks: 'Blocks',
  player_pass_yds: 'Pass Yards', player_rush_yds: 'Rush Yards',
  player_reception_yds: 'Rec Yards', player_receptions: 'Receptions',
  player_pass_tds: 'Pass TDs', player_rush_attempts: 'Rush Attempts',
  player_shots_on_goal: 'Shots on Goal', player_saves: 'Saves',
  player_goals: 'Goals', player_method_of_victory: 'Method of Victory',
  player_total_rounds: 'Total Rounds',
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'X-Lines-Fetched-At',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport, type } = event.queryStringParameters || {};
  // SECURITY: This function runs on Netlify's server, never the client.
  // The key is read from an environment variable that does NOT start with VITE_
  // so it's not bundled into the public frontend. Set in Netlify dashboard:
  //   Site settings → Environment variables → ODDS_API_KEY
  const ODDS_KEY = process.env.ODDS_API_KEY;
  if (!ODDS_KEY) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'ODDS_API_KEY not configured on server' }) };
  }

  const SPORT_MAP = {
    ncaaf: 'americanfootball_ncaa',
    mlb:  'baseball_mlb',
    nba:  'basketball_nba',
    nfl:  'americanfootball_nfl',
    nhl:  'icehockey_nhl',
    wnba: 'basketball_wnba',
    ufc:  'mma_mixed_martial_arts',
  };

  // Soccer is multi-league. Each league has its own Odds API sport key,
  // and we fetch all 5 leagues and merge results when sport==='soccer'.
  // Order here = order results appear in.
  const SOCCER_LEAGUES = [
    { key: 'soccer_epl',                       league: 'epl',         label: 'Premier League' },
    { key: 'soccer_spain_la_liga',             league: 'laliga',      label: 'La Liga' },
    { key: 'soccer_uefa_champs_league',        league: 'ucl',         label: 'Champions League' },
    { key: 'soccer_italy_serie_a',             league: 'seriea',      label: 'Serie A' },
    { key: 'soccer_germany_bundesliga',        league: 'bundesliga',  label: 'Bundesliga' },
  ];

  const PROP_MARKETS = {
    ncaaf: 'player_pass_yds,player_rush_yds,player_reception_yds,player_receptions',
    mlb:  'batter_hits,batter_total_bases,pitcher_strikeouts,batter_rbis,batter_home_runs',
    nba:  'player_points,player_rebounds,player_assists,player_threes',
    nfl:  'player_pass_yds,player_rush_yds,player_reception_yds,player_receptions',
    nhl:  'player_shots_on_goal,player_saves,player_points',
    wnba: 'player_points,player_rebounds,player_assists,player_threes',
    ufc:  'player_method_of_victory,player_total_rounds',
  };

  const oddsSport = SPORT_MAP[sport];
  // Soccer skips the singular SPORT_MAP check because it uses SOCCER_LEAGUES
  if (sport !== 'soccer' && !oddsSport) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };
  }

  // Cache key includes date — auto-expires daily
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${sport}-${type || 'props'}-${today}`;
  // Aggressive TTLs to stay under 20k credits/month:
  //   games: 60min (was 30) — saves 50% of game line credits
  //   props: 6hrs (was 4hrs) — saves 33% of prop credits
  //   alts: 12hrs — alts move slowly so this is safe
  const ttlMinutes = type === 'games' ? 60 : type === 'alts' ? 720 : 360;

  const cache = loadCache();
  if (isCacheValid(cache[cacheKey], ttlMinutes)) {
    // Include the original fetch timestamp so the client can show
    // 'Lines refreshed X min ago' and warn users to verify on the book
    return {
      statusCode: 200,
      headers: { ...headers, 'X-Lines-Fetched-At': String(cache[cacheKey].ts) },
      body: JSON.stringify(cache[cacheKey].data),
    };
  }

  const get = (url) => new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });

  try {
    // ── SOCCER MULTI-LEAGUE BRANCH ─────────────────────────────────────────
    // Soccer fetches games from 5 leagues and merges them. Each league call
    // is ~1 credit so the full soccer game-lines fetch costs ~5 credits per
    // refresh. Cache TTL is the same 60min as other sports.
    if (sport === 'soccer' && type === 'games') {
      const allGames = [];
      const leagueErrors = [];

      // Fan out league calls in parallel for speed
      const results = await Promise.allSettled(
        SOCCER_LEAGUES.map(({ key, league, label }) =>
          get(`https://api.the-odds-api.com/v4/sports/${key}/odds?apiKey=${ODDS_KEY}&regions=us,uk,eu&markets=h2h,totals&oddsFormat=american`)
            .then(r => ({ league, label, key, response: r }))
        )
      );

      for (const settled of results) {
        if (settled.status === 'rejected') {
          leagueErrors.push({ error: String(settled.reason) });
          continue;
        }
        const { league, label, response } = settled.value;
        if (response.status !== 200) {
          // Common case: a league might be in offseason. Don't error the whole
          // soccer fetch — just skip that league.
          leagueErrors.push({ league, status: response.status });
          continue;
        }

        const leagueGames = (Array.isArray(response.data) ? response.data : []).map(game => {
          const book = game.bookmakers?.find(b => b.key === 'draftkings')
            || game.bookmakers?.find(b => b.key === 'fanduel')
            || game.bookmakers?.find(b => b.key === 'pinnacle')
            || game.bookmakers?.[0];
          const h2h   = book?.markets?.find(m => m.key === 'h2h');
          const total = book?.markets?.find(m => m.key === 'totals');

          // Soccer h2h has THREE outcomes: home, away, and Draw
          const homeML = h2h?.outcomes?.find(o => o.name === game.home_team)?.price ?? null;
          const awayML = h2h?.outcomes?.find(o => o.name === game.away_team)?.price ?? null;
          const drawML = h2h?.outcomes?.find(o => o.name === 'Draw')?.price ?? null;

          return {
            id: game.id,
            homeTeam: game.home_team,
            awayTeam: game.away_team,
            startTime: game.commence_time,
            homeML, awayML, drawML,
            // Soccer doesn't use traditional spreads in our scope; leaving null
            homeSpread: null, homeSpreadOdds: null,
            awaySpread: null, awaySpreadOdds: null,
            total:    total?.outcomes?.find(o => o.name === 'Over')?.point ?? null,
            overOdds: total?.outcomes?.find(o => o.name === 'Over')?.price ?? null,
            underOdds:total?.outcomes?.find(o => o.name === 'Under')?.price ?? null,
            vendor: book?.key || 'draftkings',
            league,
            leagueLabel: label,
          };
        });

        allGames.push(...leagueGames);
      }

      const fetchedAt = Date.now();
      cache[cacheKey] = { data: allGames, ts: fetchedAt }; saveCache(cache);
      return {
        statusCode: 200,
        headers: { ...headers, 'X-Lines-Fetched-At': String(fetchedAt) },
        body: JSON.stringify(allGames),
      };
    }

    // Soccer player props are not implemented in this stage — return empty.
    // We'll add player props when the user upgrades to the \$99 Odds API tier.
    if (sport === 'soccer') {
      return { statusCode: 200, headers, body: JSON.stringify([]) };
    }

    // ── ALL OTHER SPORTS (unchanged from before) ──────────────────────────
    if (type === 'games') {
      // Game lines — 1 credit total
      const r = await get(`https://api.the-odds-api.com/v4/sports/${oddsSport}/odds?apiKey=${ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`);
      if (r.status !== 200) throw new Error(`Games ${r.status}: ${JSON.stringify(r.data)}`);

      const games = (Array.isArray(r.data) ? r.data : []).map(game => {
        const book = game.bookmakers?.find(b => b.key === 'draftkings') || game.bookmakers?.find(b => b.key === 'fanduel') || game.bookmakers?.[0];
        const h2h = book?.markets?.find(m => m.key === 'h2h');
        const spread = book?.markets?.find(m => m.key === 'spreads');
        const total = book?.markets?.find(m => m.key === 'totals');
        return {
          id: game.id, homeTeam: game.home_team, awayTeam: game.away_team, startTime: game.commence_time,
          homeML: h2h?.outcomes?.find(o => o.name === game.home_team)?.price || null,
          awayML: h2h?.outcomes?.find(o => o.name === game.away_team)?.price || null,
          homeSpread: spread?.outcomes?.find(o => o.name === game.home_team)?.point || null,
          homeSpreadOdds: spread?.outcomes?.find(o => o.name === game.home_team)?.price || null,
          awaySpread: spread?.outcomes?.find(o => o.name === game.away_team)?.point || null,
          awaySpreadOdds: spread?.outcomes?.find(o => o.name === game.away_team)?.price || null,
          total: total?.outcomes?.find(o => o.name === 'Over')?.point || null,
          overOdds: total?.outcomes?.find(o => o.name === 'Over')?.price || null,
          underOdds: total?.outcomes?.find(o => o.name === 'Under')?.price || null,
          vendor: book?.key || 'draftkings',
        };
      });

      const fetchedAt = Date.now();
      cache[cacheKey] = { data: games, ts: fetchedAt }; saveCache(cache);
      return {
        statusCode: 200,
        headers: { ...headers, 'X-Lines-Fetched-At': String(fetchedAt) },
        body: JSON.stringify(games),
      };
    }

    // ── Alternate lines — 1 credit per game (alts only) ─────────────────
    if (type === 'alts') {
      const eventId = event.queryStringParameters?.eventId;
      if (!eventId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'eventId required for alts' }) };

      const r = await get(`https://api.the-odds-api.com/v4/sports/${oddsSport}/events/${eventId}/odds?apiKey=${ODDS_KEY}&regions=us&markets=alternate_spreads,alternate_totals&oddsFormat=american`);
      if (r.status !== 200) {
        return { statusCode: 200, headers, body: JSON.stringify({ available: false, error: r.data?.message || `HTTP ${r.status}` }) };
      }

      const book = r.data.bookmakers?.find(b => b.key === 'draftkings') || r.data.bookmakers?.find(b => b.key === 'fanduel') || r.data.bookmakers?.[0];
      if (!book) {
        return { statusCode: 200, headers, body: JSON.stringify({ available: false }) };
      }

      const altSpreadsM = book.markets?.find(m => m.key === 'alternate_spreads');
      const altTotalsM  = book.markets?.find(m => m.key === 'alternate_totals');

      const result = {
        available: true,
        eventId,
        homeTeam: r.data.home_team,
        awayTeam: r.data.away_team,
        spreads: { home: [], away: [] },
        totals:  { over: [], under: [] },
      };

      if (altSpreadsM) {
        altSpreadsM.outcomes?.forEach(o => {
          if (o.name === r.data.home_team) result.spreads.home.push({ point: o.point, price: o.price });
          else if (o.name === r.data.away_team) result.spreads.away.push({ point: o.point, price: o.price });
        });
        result.spreads.home.sort((a, b) => a.point - b.point);
        result.spreads.away.sort((a, b) => a.point - b.point);
      }
      if (altTotalsM) {
        altTotalsM.outcomes?.forEach(o => {
          if (o.name === 'Over') result.totals.over.push({ point: o.point, price: o.price });
          else if (o.name === 'Under') result.totals.under.push({ point: o.point, price: o.price });
        });
        result.totals.over.sort((a, b) => a.point - b.point);
        result.totals.under.sort((a, b) => a.point - b.point);
      }

      cache[cacheKey + '-' + eventId] = { data: result, ts: Date.now() }; saveCache(cache);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    // Player props — 1 credit for events + 1 per game (max 6 games)
    const evR = await get(`https://api.the-odds-api.com/v4/sports/${oddsSport}/events?apiKey=${ODDS_KEY}`);
    if (evR.status !== 200) throw new Error(`Events ${evR.status}: ${JSON.stringify(evR.data)}`);

    const events = (Array.isArray(evR.data) ? evR.data : []).filter(e =>
      new Date(e.commence_time).getTime() > Date.now() - 3 * 60 * 60 * 1000
    ).slice(0, 4); // Max 4 games to limit credits — was 6, saves ~33%

    if (events.length === 0) {
      cache[cacheKey] = { data: [], ts: Date.now() }; saveCache(cache);
      return { statusCode: 200, headers, body: JSON.stringify([]) };
    }

    const allProps = [];
    await Promise.allSettled(events.map(async ev => {
      try {
        const r = await get(`https://api.the-odds-api.com/v4/sports/${oddsSport}/events/${ev.id}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${PROP_MARKETS[sport]}&oddsFormat=american`);
        if (r.status !== 200) return;
        const book = r.data.bookmakers?.find(b => b.key === 'draftkings') || r.data.bookmakers?.find(b => b.key === 'fanduel') || r.data.bookmakers?.[0];
        if (!book) return;
        book.markets?.forEach(market => {
          const playerMap = new Map();
          market.outcomes?.forEach(outcome => {
            const name = outcome.description;
            if (!name) return;
            if (!playerMap.has(name)) {
              playerMap.set(name, { id: `${ev.id}-${market.key}-${name}`, playerId: '', playerName: name, team: outcome.team || '', propType: PROP_LABELS[market.key] || market.key, line: outcome.point ?? 0, overOdds: -110, underOdds: -110, gameId: ev.id, vendor: book.key, homeTeam: ev.home_team, awayTeam: ev.away_team, startTime: ev.commence_time });
            }
            const p = playerMap.get(name);
            if (outcome.name === 'Over') { p.overOdds = outcome.price; p.line = outcome.point ?? p.line; }
            if (outcome.name === 'Under') p.underOdds = outcome.price;
          });
          playerMap.forEach(p => { if (p.playerName) allProps.push(p); });
        });
      } catch { }
    }));

    if (allProps.length > 0) { cache[cacheKey] = { data: allProps, ts: Date.now() }; saveCache(cache); }
    return { statusCode: 200, headers, body: JSON.stringify(allProps) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// Public betting percentages handler - added to existing function
// Fetches from Action Network public data

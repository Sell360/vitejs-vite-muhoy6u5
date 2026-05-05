const https = require('https');

// Daily cache — persists for the day, one fetch per sport
const memCache = {};

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
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport, type } = event.queryStringParameters || {};
  const ODDS_KEY = process.env.VITE_ODDS_API_KEY || 'eec9270deaa01691ceac36b1b6ada557';

  const SPORT_MAP = {
    ncaaf: 'americanfootball_ncaa',
    mlb:  'baseball_mlb',
    nba:  'basketball_nba',
    nfl:  'americanfootball_nfl',
    nhl:  'icehockey_nhl',
    wnba: 'basketball_wnba',
    ufc:  'mma_mixed_martial_arts',
  };

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
  if (!oddsSport) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  // Cache key includes date — auto-expires daily
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${sport}-${type || 'props'}-${today}`;
  if (memCache[cacheKey]) {
    console.log(`Cache hit: ${cacheKey}`);
    return { statusCode: 200, headers, body: JSON.stringify(memCache[cacheKey]) };
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

      memCache[cacheKey] = games;
      return { statusCode: 200, headers, body: JSON.stringify(games) };
    }

    // Player props — 1 credit for events + 1 per game (max 6 games)
    const evR = await get(`https://api.the-odds-api.com/v4/sports/${oddsSport}/events?apiKey=${ODDS_KEY}`);
    if (evR.status !== 200) throw new Error(`Events ${evR.status}: ${JSON.stringify(evR.data)}`);

    const events = (Array.isArray(evR.data) ? evR.data : []).filter(e =>
      new Date(e.commence_time).getTime() > Date.now() - 3 * 60 * 60 * 1000
    ).slice(0, 6); // Max 6 games = max 6 credits

    if (events.length === 0) {
      memCache[cacheKey] = [];
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

    if (allProps.length > 0) memCache[cacheKey] = allProps;
    return { statusCode: 200, headers, body: JSON.stringify(allProps) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

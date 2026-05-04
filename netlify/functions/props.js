const https = require('https');

const memCache = {};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport, type } = event.queryStringParameters || {};
  const ODDS_KEY = process.env.VITE_ODDS_API_KEY;
  if (!ODDS_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'No Odds API key' }) };

  const SPORT_MAP = {
    mlb:  'baseball_mlb',
    nba:  'basketball_nba',
    nfl:  'americanfootball_nfl',
    nhl:  'icehockey_nhl',
    wnba: 'basketball_wnba',
    ufc:  'mma_mixed_martial_arts',
  };

  const PROP_MARKETS = {
    mlb:  'batter_hits,batter_total_bases,pitcher_strikeouts,batter_rbis,batter_home_runs',
    nba:  'player_points,player_rebounds,player_assists,player_threes',
    nfl:  'player_pass_yds,player_rush_yds,player_reception_yds,player_receptions',
    nhl:  'player_shots_on_goal,player_saves,player_points',
    wnba: 'player_points,player_rebounds,player_assists,player_threes',
    ufc:  'player_method_of_victory,player_total_rounds',
  };

  const oddsSport = SPORT_MAP[sport];
  if (!oddsSport) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${sport}-${type || 'props'}-${today}`;
  if (memCache[cacheKey]) {
    return { statusCode: 200, headers, body: JSON.stringify(memCache[cacheKey]) };
  }

  const get = (url) => new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });

  try {
    // ── GAME LINES (moneyline, spread, total) ────────────────────────────
    if (type === 'games') {
      const result = await get(
        `https://api.the-odds-api.com/v4/sports/${oddsSport}/odds?apiKey=${ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`
      );
      if (result.status !== 200) throw new Error(`Game odds ${result.status}: ${JSON.stringify(result.data)}`);

      const games = (result.data || []).map(game => {
        const book = game.bookmakers?.find(b => b.key === 'draftkings')
          || game.bookmakers?.find(b => b.key === 'fanduel')
          || game.bookmakers?.[0];

        const h2h = book?.markets?.find(m => m.key === 'h2h');
        const spread = book?.markets?.find(m => m.key === 'spreads');
        const total = book?.markets?.find(m => m.key === 'totals');

        const homeML = h2h?.outcomes?.find(o => o.name === game.home_team)?.price;
        const awayML = h2h?.outcomes?.find(o => o.name === game.away_team)?.price;
        const homeSpread = spread?.outcomes?.find(o => o.name === game.home_team);
        const awaySpread = spread?.outcomes?.find(o => o.name === game.away_team);
        const over = total?.outcomes?.find(o => o.name === 'Over');
        const under = total?.outcomes?.find(o => o.name === 'Under');

        return {
          id: game.id,
          homeTeam: game.home_team,
          awayTeam: game.away_team,
          startTime: game.commence_time,
          homeML: homeML || null,
          awayML: awayML || null,
          homeSpread: homeSpread?.point || null,
          homeSpreadOdds: homeSpread?.price || null,
          awaySpread: awaySpread?.point || null,
          awaySpreadOdds: awaySpread?.price || null,
          total: over?.point || null,
          overOdds: over?.price || null,
          underOdds: under?.price || null,
          vendor: book?.key || 'unknown',
        };
      });

      memCache[cacheKey] = games;
      return { statusCode: 200, headers, body: JSON.stringify(games) };
    }

    // ── PLAYER PROPS ─────────────────────────────────────────────────────
    const evResult = await get(
      `https://api.the-odds-api.com/v4/sports/${oddsSport}/events?apiKey=${ODDS_KEY}`
    );
    if (evResult.status !== 200) throw new Error(`Events ${evResult.status}: ${JSON.stringify(evResult.data)}`);

    const events = Array.isArray(evResult.data) ? evResult.data : [];
    const active = events.filter(e => new Date(e.commence_time).getTime() > Date.now() - 3 * 60 * 60 * 1000);

    if (active.length === 0) {
      memCache[cacheKey] = [];
      return { statusCode: 200, headers, body: JSON.stringify([]) };
    }

    const allProps = [];
    await Promise.allSettled(
      active.slice(0, 6).map(async (ev) => {
        try {
          const result = await get(
            `https://api.the-odds-api.com/v4/sports/${oddsSport}/events/${ev.id}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${PROP_MARKETS[sport]}&oddsFormat=american`
          );
          if (result.status !== 200) return;

          const book = result.data.bookmakers?.find(b => b.key === 'draftkings')
            || result.data.bookmakers?.find(b => b.key === 'fanduel')
            || result.data.bookmakers?.[0];
          if (!book) return;

          book.markets?.forEach(market => {
            const playerMap = new Map();
            market.outcomes?.forEach(outcome => {
              const name = outcome.description;
              if (!name) return;
              if (!playerMap.has(name)) {
                playerMap.set(name, {
                  id: `${ev.id}-${market.key}-${name}`,
                  playerId: '',
                  playerName: name,
                  team: outcome.team || '',
                  propType: market.key,
                  line: outcome.point ?? 0,
                  overOdds: -110,
                  underOdds: -110,
                  gameId: ev.id,
                  vendor: book.key,
                  homeTeam: ev.home_team,
                  awayTeam: ev.away_team,
                  startTime: ev.commence_time,
                });
              }
              const p = playerMap.get(name);
              if (outcome.name === 'Over') { p.overOdds = outcome.price; p.line = outcome.point ?? p.line; }
              if (outcome.name === 'Under') p.underOdds = outcome.price;
            });
            playerMap.forEach(p => { if (p.playerName) allProps.push(p); });
          });
        } catch { }
      })
    );

    memCache[cacheKey] = allProps;
    return { statusCode: 200, headers, body: JSON.stringify(allProps) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

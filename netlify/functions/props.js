const https = require('https');
const memCache = {};

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport, type } = event.queryStringParameters || {};
  const API_KEY = process.env.VITE_ODDSPAPI_KEY || '19564ce9-b577-4188-92cc-8fb4e4294aec';

  const LEAGUE_MAP = {
    mlb: 'baseball_mlb', nba: 'basketball_nba', nfl: 'americanfootball_nfl',
    nhl: 'icehockey_nhl', wnba: 'basketball_wnba', ufc: 'mma_mixed_martial_arts',
  };

  const league = LEAGUE_MAP[sport];
  if (!league) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${sport}-${type || 'props'}-${today}`;
  if (memCache[cacheKey]) return { statusCode: 200, headers, body: JSON.stringify(memCache[cacheKey]) };

  const getRaw = (url) => new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' }
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
    if (type === 'games') {
      const result = await getRaw(
        `https://api.oddspapi.com/odds?apiKey=${API_KEY}&sport=${league}&markets=h2h,spreads,totals&oddsFormat=american`
      );
      if (result.status !== 200) throw new Error(`OddsPapi games ${result.status}: ${JSON.stringify(result.data)}`);

      const raw = Array.isArray(result.data) ? result.data : (result.data?.data || []);
      const games = raw.map(game => {
        const book = game.bookmakers?.find(b => b.key === 'draftkings')
          || game.bookmakers?.find(b => b.key === 'fanduel')
          || game.bookmakers?.[0];
        const h2h = book?.markets?.find(m => m.key === 'h2h');
        const spread = book?.markets?.find(m => m.key === 'spreads');
        const total = book?.markets?.find(m => m.key === 'totals');
        return {
          id: game.id,
          homeTeam: game.home_team,
          awayTeam: game.away_team,
          startTime: game.commence_time,
          homeML: h2h?.outcomes?.find(o => o.name === game.home_team)?.price || null,
          awayML: h2h?.outcomes?.find(o => o.name === game.away_team)?.price || null,
          homeSpread: spread?.outcomes?.find(o => o.name === game.home_team)?.point || null,
          homeSpreadOdds: spread?.outcomes?.find(o => o.name === game.home_team)?.price || null,
          awaySpread: spread?.outcomes?.find(o => o.name === game.away_team)?.point || null,
          awaySpreadOdds: spread?.outcomes?.find(o => o.name === game.away_team)?.price || null,
          total: total?.outcomes?.find(o => o.name === 'Over')?.point || null,
          overOdds: total?.outcomes?.find(o => o.name === 'Over')?.price || null,
          underOdds: total?.outcomes?.find(o => o.name === 'Under')?.price || null,
          vendor: book?.key || 'oddspapi',
        };
      });
      memCache[cacheKey] = games;
      return { statusCode: 200, headers, body: JSON.stringify(games) };
    }

    // Player props
    const eventsRes = await getRaw(`https://api.oddspapi.com/events?apiKey=${API_KEY}&sport=${league}`);
    if (eventsRes.status !== 200) throw new Error(`OddsPapi events ${eventsRes.status}: ${JSON.stringify(eventsRes.data)}`);

    const events = Array.isArray(eventsRes.data) ? eventsRes.data : (eventsRes.data?.data || []);
    const active = events.filter(e => {
      const start = new Date(e.commence_time).getTime();
      return start > Date.now() - 3 * 60 * 60 * 1000;
    });

    if (active.length === 0) return { statusCode: 200, headers, body: JSON.stringify([]) };

    const PROP_MARKETS = {
      mlb: 'batter_hits,batter_total_bases,pitcher_strikeouts,batter_rbis,batter_home_runs',
      nba: 'player_points,player_rebounds,player_assists,player_threes',
      nfl: 'player_pass_yds,player_rush_yds,player_reception_yds,player_receptions',
      nhl: 'player_shots_on_goal,player_saves,player_points',
      wnba: 'player_points,player_rebounds,player_assists,player_threes',
      ufc: 'player_method_of_victory,player_total_rounds',
    };

    const allProps = [];
    await Promise.allSettled(
      active.slice(0, 8).map(async (ev) => {
        try {
          const result = await getRaw(
            `https://api.oddspapi.com/odds?apiKey=${API_KEY}&sport=${league}&eventIds=${ev.id}&markets=${PROP_MARKETS[sport]}&oddsFormat=american`
          );
          if (result.status !== 200) return;

          const data = Array.isArray(result.data) ? result.data[0] : result.data?.data?.[0];
          if (!data) return;

          const book = data.bookmakers?.find(b => b.key === 'draftkings')
            || data.bookmakers?.find(b => b.key === 'fanduel')
            || data.bookmakers?.[0];
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
                  overOdds: -110, underOdds: -110,
                  gameId: ev.id, vendor: book.key,
                  homeTeam: ev.home_team, awayTeam: ev.away_team,
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

    if (allProps.length === 0) throw new Error('No props returned from OddsPapi');
    memCache[cacheKey] = allProps;
    return { statusCode: 200, headers, body: JSON.stringify(allProps) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

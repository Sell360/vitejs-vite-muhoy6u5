exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport } = event.queryStringParameters || {};
  const ODDS_KEY = process.env.VITE_ODDS_API_KEY;

  if (!ODDS_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'No ODDS API key configured' }) };
  }

  const SPORT_MAP = {
    mlb:  'baseball_mlb',
    nba:  'basketball_nba',
    nfl:  'americanfootball_nfl',
    nhl:  'icehockey_nhl',
    wnba: 'basketball_wnba',
    ufc:  'mma_mixed_martial_arts',
  };

  const MARKETS = {
    mlb:  'batter_hits,batter_total_bases,pitcher_strikeouts,batter_rbis,batter_home_runs,batter_walks',
    nba:  'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists,player_steals,player_blocks',
    nfl:  'player_pass_yds,player_rush_yds,player_reception_yds,player_receptions,player_pass_tds,player_rush_attempts',
    nhl:  'player_shots_on_goal,player_saves,player_points,player_goals,player_assists',
    wnba: 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists',
    ufc:  'player_method_of_victory,player_total_rounds',
  };

  const oddsSport = SPORT_MAP[sport];
  if (!oddsSport) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  try {
    // Get events
    const evRes = await fetch(`https://api.the-odds-api.com/v4/sports/${oddsSport}/events?apiKey=${ODDS_KEY}`);
    if (!evRes.ok) {
      const txt = await evRes.text();
      throw new Error(`Events ${evRes.status}: ${txt.slice(0, 200)}`);
    }
    const events = await evRes.json();
    if (!Array.isArray(events) || events.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify([]) };
    }

    // Only upcoming games (not finished)
    const active = events.filter(e => new Date(e.commence_time).getTime() > Date.now() - 3 * 60 * 60 * 1000);
    if (active.length === 0) return { statusCode: 200, headers, body: JSON.stringify([]) };

    // Fetch props for each event
    const results = await Promise.allSettled(
      active.slice(0, 10).map(e =>
        fetch(`https://api.the-odds-api.com/v4/sports/${oddsSport}/events/${e.id}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${MARKETS[sport]}&oddsFormat=american`)
          .then(r => r.ok ? r.json() : null)
      )
    );

    const allProps = [];

    results.forEach((result, i) => {
      if (result.status !== 'fulfilled' || !result.value) return;
      const data = result.value;
      const ev = active[i];

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
    });

    return { statusCode: 200, headers, body: JSON.stringify(allProps) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

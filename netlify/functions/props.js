exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { sport } = event.queryStringParameters || {};
  const ODDS_KEY = process.env.VITE_ODDS_API_KEY || 'cb3a34037735e0ceb317b24195526606';

  const sportMap = {
    mlb: 'baseball_mlb',
    wnba: 'basketball_wnba',
  };

  const marketMap = {
    mlb: 'batter_hits,batter_total_bases,pitcher_strikeouts,batter_rbis,batter_home_runs,batter_walks',
    wnba: 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists',
  };

  const oddsSport = sportMap[sport];
  if (!oddsSport) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid sport' }) };
  }

  try {
    // Step 1: get events for today
    const eventsRes = await fetch(
      `https://api.the-odds-api.com/v4/sports/${oddsSport}/events?apiKey=${ODDS_KEY}`
    );
    if (!eventsRes.ok) throw new Error(`Events API ${eventsRes.status}`);
    const events = await eventsRes.json();

    if (!Array.isArray(events) || events.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify([]) };
    }

    // Step 2: get props for each event in parallel
    const propResults = await Promise.allSettled(
      events.map(e =>
        fetch(
          `https://api.the-odds-api.com/v4/sports/${oddsSport}/events/${e.id}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${marketMap[sport]}&oddsFormat=american`
        ).then(r => r.ok ? r.json() : null)
      )
    );

    const allProps = [];

    propResults.forEach((result, i) => {
      if (result.status !== 'fulfilled' || !result.value) return;
      const data = result.value;
      const eventId = events[i]?.id;
      const homeTeam = events[i]?.home_team;
      const awayTeam = events[i]?.away_team;

      const bookmaker = data.bookmakers?.find(b => b.key === 'draftkings')
        || data.bookmakers?.find(b => b.key === 'fanduel')
        || data.bookmakers?.[0];
      if (!bookmaker) return;

      bookmaker.markets?.forEach(market => {
        const playerMap = new Map();
        market.outcomes?.forEach(outcome => {
          const name = outcome.description;
          if (!name) return;
          if (!playerMap.has(name)) {
            playerMap.set(name, {
              id: `${eventId}-${market.key}-${name}`,
              playerId: '',
              playerName: name,
              team: outcome.team || '',
              propType: market.key,
              line: outcome.point ?? 0,
              overOdds: -110,
              underOdds: -110,
              gameId: eventId,
              vendor: bookmaker.key,
              homeTeam,
              awayTeam,
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

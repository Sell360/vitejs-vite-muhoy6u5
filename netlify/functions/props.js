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
    mlb:  'baseball_mlb',
    wnba: 'basketball_wnba',
    nba:  'basketball_nba',
    nfl:  'americanfootball_nfl',
    nhl:  'icehockey_nhl',
    ufc:  'mma_mixed_martial_arts',
  };

  const marketMap = {
    mlb:  'batter_hits,batter_total_bases,pitcher_strikeouts,batter_rbis,batter_home_runs,batter_walks',
    wnba: 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists',
    nba:  'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists,player_steals,player_blocks',
    nfl:  'player_pass_yds,player_rush_yds,player_reception_yds,player_receptions,player_pass_tds,player_rush_attempts',
    nhl:  'player_shots_on_goal,player_saves,player_points,player_goals,player_assists',
    ufc:  'player_method_of_victory,player_round,player_total_rounds',
  };

  const oddsSport = sportMap[sport];
  if (!oddsSport) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };
  }

  try {
    const eventsRes = await fetch(
      `https://api.the-odds-api.com/v4/sports/${oddsSport}/events?apiKey=${ODDS_KEY}`
    );
    if (!eventsRes.ok) throw new Error(`Events API ${eventsRes.status}`);
    const events = await eventsRes.json();

    if (!Array.isArray(events) || events.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify([]) };
    }

    // Only fetch props for upcoming/live events (not completed)
    const activeEvents = events.filter(e => {
      const start = new Date(e.commence_time).getTime();
      const now = Date.now();
      const threeHoursAgo = now - 3 * 60 * 60 * 1000;
      return start > threeHoursAgo;
    });

    if (activeEvents.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify([]) };
    }

    const propResults = await Promise.allSettled(
      activeEvents.map(e =>
        fetch(
          `https://api.the-odds-api.com/v4/sports/${oddsSport}/events/${e.id}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${marketMap[sport]}&oddsFormat=american`
        ).then(r => r.ok ? r.json() : null)
      )
    );

    const allProps = [];

    propResults.forEach((result, i) => {
      if (result.status !== 'fulfilled' || !result.value) return;
      const data = result.value;
      const eventId = activeEvents[i]?.id;
      const homeTeam = activeEvents[i]?.home_team;
      const awayTeam = activeEvents[i]?.away_team;
      const startTime = activeEvents[i]?.commence_time;

      const bookmaker = data.bookmakers?.find(b => b.key === 'draftkings')
        || data.bookmakers?.find(b => b.key === 'fanduel')
        || data.bookmakers?.find(b => b.key === 'betmgm')
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
              startTime,
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

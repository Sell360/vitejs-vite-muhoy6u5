exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport } = event.queryStringParameters || {};
  const SDI_KEY  = process.env.VITE_SPORTS_API_KEY  || 'cdfbffe6f43b47c29ab8ac4f8c0e5c9a';
  const ODDS_KEY = process.env.VITE_ODDS_API_KEY     || 'cb3a34037735e0ceb317b24195526606';

  const today = new Date().toISOString().split('T')[0];

  // ── SportsDataIO endpoints by sport ──────────────────────────────────────
  const SDI_PROPS_URL = {
    mlb:  `https://api.sportsdata.io/v3/mlb/odds/json/PlayerPropsByDate/${today}?key=${SDI_KEY}`,
    nba:  `https://api.sportsdata.io/v3/nba/odds/json/PlayerPropsByDate/${today}?key=${SDI_KEY}`,
    nfl:  `https://api.sportsdata.io/v3/nfl/odds/json/PlayerPropsByDate/${today}?key=${SDI_KEY}`,
    nhl:  `https://api.sportsdata.io/v3/nhl/odds/json/PlayerPropsByDate/${today}?key=${SDI_KEY}`,
    wnba: `https://api.sportsdata.io/v3/wnba/odds/json/PlayerPropsByDate/${today}?key=${SDI_KEY}`,
  };

  // ── Odds API markets ──────────────────────────────────────────────────────
  const ODDS_SPORT = {
    mlb:  'baseball_mlb',
    nba:  'basketball_nba',
    nfl:  'americanfootball_nfl',
    nhl:  'icehockey_nhl',
    wnba: 'basketball_wnba',
    ufc:  'mma_mixed_martial_arts',
  };

  const ODDS_MARKETS = {
    mlb:  'batter_hits,batter_total_bases,pitcher_strikeouts,batter_rbis,batter_home_runs',
    nba:  'player_points,player_rebounds,player_assists,player_threes',
    nfl:  'player_pass_yds,player_rush_yds,player_reception_yds,player_receptions',
    nhl:  'player_shots_on_goal,player_saves,player_points',
    wnba: 'player_points,player_rebounds,player_assists,player_threes',
    ufc:  'player_method_of_victory,player_total_rounds',
  };

  // ── Try SportsDataIO first ────────────────────────────────────────────────
  const sdiUrl = SDI_PROPS_URL[sport];
  if (sdiUrl) {
    try {
      const res = await fetch(sdiUrl);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const props = data.map(p => ({
            id: p.PropBetID?.toString() || Math.random().toString(),
            playerId: p.PlayerID?.toString() || '',
            playerName: p.PlayerName || '',
            team: p.Team || '',
            propType: p.PropBetType || '',
            line: p.Value || 0,
            overOdds: p.OverPayout || -110,
            underOdds: p.UnderPayout || -110,
            gameId: p.GameID?.toString() || '',
            vendor: 'sportsdata',
          })).filter(p => p.playerName);
          if (props.length > 0) {
            return { statusCode: 200, headers, body: JSON.stringify(props) };
          }
        }
      }
      console.log(`SDI ${sport} returned ${res.status}`);
    } catch (e) {
      console.log(`SDI failed: ${e.message}`);
    }
  }

  // ── Fallback: Odds API ────────────────────────────────────────────────────
  const oddsSport = ODDS_SPORT[sport];
  const markets   = ODDS_MARKETS[sport];
  if (!oddsSport) return { statusCode: 400, headers, body: JSON.stringify({ error: `No source for sport: ${sport}` }) };

  try {
    const evRes = await fetch(`https://api.the-odds-api.com/v4/sports/${oddsSport}/events?apiKey=${ODDS_KEY}`);
    if (!evRes.ok) throw new Error(`Odds API events ${evRes.status}`);
    const events = await evRes.json();

    const active = (Array.isArray(events) ? events : []).filter(e =>
      new Date(e.commence_time).getTime() > Date.now() - 3 * 60 * 60 * 1000
    );
    if (active.length === 0) return { statusCode: 200, headers, body: JSON.stringify([]) };

    const results = await Promise.allSettled(
      active.slice(0, 8).map(e =>
        fetch(`https://api.the-odds-api.com/v4/sports/${oddsSport}/events/${e.id}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${markets}&oddsFormat=american`)
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
              overOdds: -110, underOdds: -110,
              gameId: ev.id, vendor: book.key,
              homeTeam: ev.home_team, awayTeam: ev.away_team,
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

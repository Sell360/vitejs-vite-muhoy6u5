// Netlify function - fetches props + injuries + line movement + Kalshi divergence
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

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
    ufc:  'player_method_of_victory,player_total_rounds',
  };

  const espnPaths = {
    mlb:  'baseball/mlb',
    wnba: 'basketball/wnba',
    nba:  'basketball/nba',
    nfl:  'football/nfl',
    nhl:  'hockey/nhl',
    ufc:  null,
  };

  const oddsSport = sportMap[sport];
  if (!oddsSport) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  try {
    // ── Fetch in parallel: events, injuries, Kalshi markets ──────────────
    const [eventsRes, injuryData, kalshiData] = await Promise.allSettled([
      fetch(`https://api.the-odds-api.com/v4/sports/${oddsSport}/events?apiKey=${ODDS_KEY}`)
        .then(r => r.ok ? r.json() : []),
      espnPaths[sport] ? fetchInjuries(espnPaths[sport]) : Promise.resolve([]),
      fetchKalshi(sport),
    ]);

    const events = eventsRes.status === 'fulfilled' ? eventsRes.value : [];
    const injuries = injuryData.status === 'fulfilled' ? injuryData.value : [];
    const kalshi = kalshiData.status === 'fulfilled' ? kalshiData.value : {};

    if (!Array.isArray(events) || events.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify([]) };
    }

    // Only upcoming/active events
    const activeEvents = events.filter(e => {
      const start = new Date(e.commence_time).getTime();
      return start > Date.now() - 3 * 60 * 60 * 1000;
    });

    if (activeEvents.length === 0) return { statusCode: 200, headers, body: JSON.stringify([]) };

    // ── Fetch props for all active events ─────────────────────────────────
    const propResults = await Promise.allSettled(
      activeEvents.map(e =>
        fetch(`https://api.the-odds-api.com/v4/sports/${oddsSport}/events/${e.id}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${marketMap[sport]}&oddsFormat=american`)
          .then(r => r.ok ? r.json() : null)
      )
    );

    // Build injury lookup set (lowercase names)
    const injuredPlayers = new Set(injuries.map(n => n.toLowerCase()));

    const allProps = [];

    propResults.forEach((result, i) => {
      if (result.status !== 'fulfilled' || !result.value) return;
      const data = result.value;
      const ev = activeEvents[i];

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
              id: `${ev.id}-${market.key}-${name}`,
              playerId: '',
              playerName: name,
              team: outcome.team || '',
              propType: market.key,
              line: outcome.point ?? 0,
              overOdds: -110,
              underOdds: -110,
              gameId: ev.id,
              vendor: bookmaker.key,
              homeTeam: ev.home_team,
              awayTeam: ev.away_team,
              startTime: ev.commence_time,
              // Edge signals
              injured: injuredPlayers.has(name.toLowerCase()),
              kalshiEdge: null,
              lineMovement: null,
              impliedProb: null,
              sharpFlag: false,
            });
          }
          const p = playerMap.get(name);
          if (outcome.name === 'Over') { p.overOdds = outcome.price; p.line = outcome.point ?? p.line; }
          if (outcome.name === 'Under') p.underOdds = outcome.price;
        });

        playerMap.forEach(p => {
          if (!p.playerName) return;

          // ── Implied probability ──────────────────────────────────────
          const overDec = p.overOdds > 0 ? p.overOdds / 100 + 1 : 100 / Math.abs(p.overOdds) + 1;
          const underDec = p.underOdds > 0 ? p.underOdds / 100 + 1 : 100 / Math.abs(p.underOdds) + 1;
          p.impliedProb = {
            over: Math.round((1 / overDec) * 100),
            under: Math.round((1 / underDec) * 100),
            vig: Math.round(((1 / overDec) + (1 / underDec) - 1) * 100),
          };

          // ── Kalshi divergence ────────────────────────────────────────
          const kalshiKey = `${p.playerName}-${p.propType}`.toLowerCase().replace(/\s+/g, '_');
          const kalshiProb = kalshi[kalshiKey];
          if (kalshiProb) {
            const bookOverProb = p.impliedProb.over;
            const divergence = Math.abs(kalshiProb - bookOverProb);
            if (divergence >= 3) {
              p.kalshiEdge = {
                kalshiProb,
                bookProb: bookOverProb,
                divergence,
                favors: kalshiProb > bookOverProb ? 'over' : 'under',
              };
              p.sharpFlag = true;
            }
          }

          allProps.push(p);
        });
      });
    });

    return { statusCode: 200, headers, body: JSON.stringify(allProps) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ── ESPN injury feed ────────────────────────────────────────────────────────
async function fetchInjuries(espnPath) {
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${espnPath}/injuries`);
    if (!res.ok) return [];
    const data = await res.json();
    const injured = [];
    (data.injuries || []).forEach(team => {
      (team.injuries || []).forEach(inj => {
        const status = inj.status?.toLowerCase() || '';
        if (status.includes('out') || status.includes('doubtful')) {
          const name = inj.athlete?.displayName || inj.athlete?.fullName || '';
          if (name) injured.push(name);
        }
      });
    });
    return injured;
  } catch { return []; }
}

// ── Kalshi public API — free, no key required ───────────────────────────────
// Returns map of "player_proptype" -> implied probability %
async function fetchKalshi(sport) {
  try {
    const sportTags = {
      mlb: 'MLB', nba: 'NBA', nfl: 'NFL', nhl: 'NHL', wnba: 'WNBA', ufc: 'MMA'
    };
    const tag = sportTags[sport];
    if (!tag) return {};

    const res = await fetch(
      `https://api.elections.kalshi.com/trade-api/v2/markets?status=open&series_ticker=${tag}&limit=200`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return {};
    const data = await res.json();

    const result = {};
    (data.markets || []).forEach(m => {
      if (!m.title) return;
      // Kalshi titles like "Aaron Judge Over 1.5 Hits" → parse player + prop
      const title = m.title.toLowerCase();
      const yesPrice = m.yes_bid || m.last_price || 0;
      if (yesPrice > 0) {
        // Use title as key, store as % probability
        const key = title.replace(/\s+(over|under)\s+[\d.]+\s+/g, '_').replace(/\s+/g, '_');
        result[key] = Math.round(yesPrice * 100);
      }
    });
    return result;
  } catch { return {}; }
}

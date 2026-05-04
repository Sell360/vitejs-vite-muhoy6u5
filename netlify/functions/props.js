const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport } = event.queryStringParameters || {};

  const SPORT_PATHS = {
    mlb:  { site: 'baseball/mlb',    core: 'baseball/leagues/mlb' },
    nba:  { site: 'basketball/nba',  core: 'basketball/leagues/nba' },
    nfl:  { site: 'football/nfl',    core: 'football/leagues/nfl' },
    nhl:  { site: 'hockey/nhl',      core: 'hockey/leagues/nhl' },
    wnba: { site: 'basketball/wnba', core: 'basketball/leagues/wnba' },
  };

  const paths = SPORT_PATHS[sport];
  if (!paths) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

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
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    
    // Get today's games
    const scoreRes = await get(`https://site.api.espn.com/apis/site/v2/sports/${paths.site}/scoreboard?dates=${today}&limit=20`);
    const events = scoreRes.data?.events || [];
    if (events.length === 0) return { statusCode: 200, headers, body: JSON.stringify([]) };

    const allProps = [];

    // For each game get ESPN odds and player stats
    await Promise.allSettled(events.map(async (ev) => {
      const eventId = ev.id;
      const comp = ev.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === 'home');
      const away = comp?.competitors?.find(c => c.homeAway === 'away');
      const homeTeam = home?.team?.abbreviation || '';
      const awayTeam = away?.team?.abbreviation || '';

      try {
        // Get player props from ESPN core API
        const propsRes = await get(
          `https://sports.core.api.espn.com/v2/sports/${paths.core.split('/')[0]}/leagues/${paths.core.split('/')[2]}/events/${eventId}/competitions/${eventId}/odds`
        );
        
        if (propsRes.status === 200 && propsRes.data?.items) {
          propsRes.data.items.forEach(item => {
            // Get player props from each bookmaker
            const playerProps = item?.playerProps || item?.prop_bets || [];
            playerProps.forEach(prop => {
              const name = prop.athlete?.displayName || prop.playerName || '';
              if (!name) return;
              allProps.push({
                id: `espn-${eventId}-${name}-${prop.stat}`,
                playerId: prop.athlete?.id || '',
                playerName: name,
                team: prop.athlete?.team?.abbreviation || '',
                propType: prop.stat || prop.type || '',
                line: parseFloat(prop.line || prop.value || 0),
                overOdds: parseInt(prop.overOdds || prop.over || -110),
                underOdds: parseInt(prop.underOdds || prop.under || -110),
                gameId: eventId,
                vendor: item.provider?.name || 'espn',
                homeTeam,
                awayTeam,
              });
            });
          });
        }
      } catch { }

      // Also pull player stats for context
      try {
        const summaryRes = await get(
          `https://site.web.api.espn.com/apis/site/v2/sports/${paths.site}/summary?event=${eventId}`
        );
        if (summaryRes.status === 200) {
          const boxscore = summaryRes.data?.boxscore;
          const players = boxscore?.players || [];
          players.forEach(teamData => {
            const team = teamData.team?.abbreviation || '';
            teamData.statistics?.forEach(statGroup => {
              statGroup.athletes?.forEach(athlete => {
                const name = athlete.athlete?.displayName || '';
                if (!name) return;
                const labels = statGroup.labels || [];
                const stats = athlete.stats || [];
                labels.forEach((label, i) => {
                  const val = parseFloat(stats[i]);
                  if (!val || val <= 0) return;
                  // Only include meaningful stat types
                  const validStats = ['H', 'HR', 'RBI', 'K', 'PTS', 'REB', 'AST', 'SOG', 'G', 'A'];
                  if (!validStats.includes(label)) return;
                  allProps.push({
                    id: `espn-live-${eventId}-${name}-${label}`,
                    playerId: athlete.athlete?.id || '',
                    playerName: name,
                    team,
                    propType: formatStatLabel(label),
                    line: val,
                    overOdds: -110,
                    underOdds: -110,
                    gameId: eventId,
                    vendor: 'espn-live',
                    homeTeam,
                    awayTeam,
                  });
                });
              });
            });
          });
        }
      } catch { }
    }));

    // Deduplicate
    const seen = new Map();
    allProps.forEach(p => {
      const k = `${p.playerName}-${p.propType}-${p.line}`;
      if (!seen.has(k)) seen.set(k, p);
    });
    const deduped = Array.from(seen.values()).filter(p => p.playerName && p.line > 0);

    return { statusCode: 200, headers, body: JSON.stringify(deduped) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function formatStatLabel(label) {
  const map = {
    'H': 'Hits', 'HR': 'Home Runs', 'RBI': 'RBIs', 'K': 'Strikeouts',
    'PTS': 'Points', 'REB': 'Rebounds', 'AST': 'Assists',
    'SOG': 'Shots on Goal', 'G': 'Goals', 'A': 'Assists',
  };
  return map[label] || label;
}

const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport } = event.queryStringParameters || {};

  const AN_SPORTS = {
    mlb: 'baseball', nba: 'basketball', nfl: 'football',
    nhl: 'hockey', wnba: 'wnba', ufc: 'mma',
  };

  const anSport = AN_SPORTS[sport];
  if (!anSport) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  const get = (url) => new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode}: ${data.slice(0,200)}`));
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });

  try {
    const today = new Date().toISOString().split('T')[0];

    // Action Network player props endpoint
    const data = await get(
      `https://api.actionnetwork.com/web/v1/player-props?sport=${anSport}&date=${today}`
    );

    const props = parseAN(data, sport);
    if (props.length > 0) return { statusCode: 200, headers, body: JSON.stringify(props) };
    throw new Error('Action Network returned 0 props');

  } catch(anErr) {
    // Fallback: try ESPN BET player props
    try {
      const espnSports = {
        mlb: 'baseball/mlb', nba: 'basketball/nba', nfl: 'football/nfl',
        nhl: 'hockey/nhl', wnba: 'basketball/wnba',
      };
      const espnPath = espnSports[sport];
      if (!espnPath) throw new Error('No ESPN path');

      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const scoreData = await get(
        `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${today}&limit=20`
      );

      const events = scoreData?.events || [];
      const props = [];

      await Promise.allSettled(events.slice(0, 5).map(async (ev) => {
        try {
          const oddsData = await get(
            `https://sports.core.api.espn.com/v2/sports/${espnPath.split('/')[0]}/leagues/${espnPath.split('/')[1]}/events/${ev.id}/competitions/${ev.id}/predictor`
          );
          // Extract any available player data
          const home = oddsData?.homeTeam;
          const away = oddsData?.awayTeam;
          if (home?.statistics) {
            home.statistics.splits?.categories?.forEach((cat) => {
              cat.stats?.forEach((stat) => {
                if (stat.value > 0) {
                  props.push({
                    id: `espn-${ev.id}-${home.id}-${stat.name}`,
                    playerId: home.id,
                    playerName: home.team?.displayName || 'Unknown',
                    team: home.team?.abbreviation || '',
                    propType: stat.displayName || stat.name,
                    line: parseFloat(stat.value) || 0,
                    overOdds: -110,
                    underOdds: -110,
                    gameId: ev.id,
                    vendor: 'espn',
                  });
                }
              });
            });
          }
        } catch { }
      }));

      if (props.length > 0) return { statusCode: 200, headers, body: JSON.stringify(props) };
      throw new Error('ESPN also returned 0 props');

    } catch(espnErr) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: `AN: ${anErr.message} | ESPN: ${espnErr.message}` })
      };
    }
  }
};

function parseAN(data, sport) {
  const props = [];
  try {
    const playerProps = data?.player_props || data?.props || data?.data || [];
    playerProps.forEach((p) => {
      const playerName = p.player?.full_name || p.player_name || p.name || '';
      if (!playerName) return;
      const line = parseFloat(p.value || p.line || p.ou_line || 0);
      if (!line) return;
      const overOdds = parseInt(p.over_odds || p.ml_over || -110);
      const underOdds = parseInt(p.under_odds || p.ml_under || -110);
      props.push({
        id: `an-${p.id || Math.random()}`,
        playerId: p.player?.id?.toString() || '',
        playerName,
        team: p.player?.team?.abbr || p.team || '',
        propType: p.type?.name || p.prop_type || p.stat_type || '',
        line,
        overOdds: isNaN(overOdds) ? -110 : overOdds,
        underOdds: isNaN(underOdds) ? -110 : underOdds,
        gameId: p.game_id?.toString() || '',
        vendor: 'actionnetwork',
      });
    });
  } catch(e) { console.error('AN parse error:', e.message); }
  return props;
}

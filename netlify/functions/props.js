const https = require('https');

const memCache = {};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport, type } = event.queryStringParameters || {};
  const SHARP_KEY = process.env.VITE_SHARP_API_KEY || 'sk_live_RNtWLQCEoQXRgRwXHovbhU';

  const LEAGUE_MAP = {
    mlb: 'mlb', nba: 'nba', nfl: 'nfl',
    nhl: 'nhl', wnba: 'wnba', ufc: 'mma',
  };

  const league = LEAGUE_MAP[sport];
  if (!league) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${sport}-${type || 'props'}-${today}`;
  if (memCache[cacheKey]) return { statusCode: 200, headers, body: JSON.stringify(memCache[cacheKey]) };

  const getRaw = (url) => new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'X-API-Key': SHARP_KEY, 'Accept': 'application/json' }
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
      // Game lines — filter for moneyline, spread, total market types
      const result = await getRaw(
        `https://api.sharpapi.io/api/v1/odds?league=${league}&market_type=moneyline,spread,total&per_page=100`
      );
      if (result.status !== 200) throw new Error(`SharpAPI ${result.status}`);

      const raw = Array.isArray(result.data) ? result.data : (result.data?.data || []);
      
      // Group by event
      const gameMap = new Map();
      raw.forEach(item => {
        const key = item.event_id;
        if (!gameMap.has(key)) {
          gameMap.set(key, {
            id: item.event_id,
            homeTeam: item.home_team,
            awayTeam: item.away_team,
            startTime: item.event_start_time,
            homeML: null, awayML: null,
            homeSpread: null, homeSpreadOdds: null,
            awaySpread: null, awaySpreadOdds: null,
            total: null, overOdds: null, underOdds: null,
            vendor: item.sportsbook,
          });
        }
        const g = gameMap.get(key);
        if (item.market_type === 'moneyline') {
          if (item.selection === item.home_team) g.homeML = item.odds_american;
          if (item.selection === item.away_team) g.awayML = item.odds_american;
        }
        if (item.market_type === 'spread') {
          if (item.selection === item.home_team) { g.homeSpread = item.line; g.homeSpreadOdds = item.odds_american; }
          if (item.selection === item.away_team) { g.awaySpread = item.line; g.awaySpreadOdds = item.odds_american; }
        }
        if (item.market_type === 'total') {
          if (item.selection_type === 'over') { g.total = item.line; g.overOdds = item.odds_american; }
          if (item.selection_type === 'under') g.underOdds = item.odds_american;
        }
      });

      const games = Array.from(gameMap.values()).filter(g => g.homeTeam && g.awayTeam && g.away_team !== '');
      memCache[cacheKey] = games;
      return { statusCode: 200, headers, body: JSON.stringify(games) };
    }

    // Player props — use player_prop market type
    const result = await getRaw(
      `https://api.sharpapi.io/api/v1/odds?league=${league}&market_type=player_prop&per_page=200`
    );
    if (result.status !== 200) throw new Error(`SharpAPI ${result.status}: ${JSON.stringify(result.data)}`);

    const raw = Array.isArray(result.data) ? result.data : (result.data?.data || []);
    if (raw.length === 0) throw new Error('No player props returned');

    // Group by player+stat to pair over/under
    const propMap = new Map();
    raw.forEach(item => {
      if (!item.selection || item.line === null) return;
      const key = `${item.event_id}-${item.selection}-${item.market_type}-${item.line}`;
      if (!propMap.has(key)) {
        propMap.set(key, {
          id: item.id,
          playerId: '',
          playerName: item.selection,
          team: '',
          propType: item.market_type?.replace('player_prop_', '').replace(/_/g, ' ') || '',
          line: parseFloat(item.line) || 0,
          overOdds: -110,
          underOdds: -110,
          gameId: item.event_id || '',
          vendor: item.sportsbook,
          homeTeam: item.home_team || '',
          awayTeam: item.away_team || '',
          startTime: item.event_start_time || '',
        });
      }
      const p = propMap.get(key);
      if (item.selection_type === 'over') p.overOdds = item.odds_american;
      if (item.selection_type === 'under') p.underOdds = item.odds_american;
    });

    const props = Array.from(propMap.values()).filter(p => p.playerName && p.line > 0);
    if (props.length === 0) throw new Error('Props mapped to 0 after filtering');

    memCache[cacheKey] = props;
    return { statusCode: 200, headers, body: JSON.stringify(props) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

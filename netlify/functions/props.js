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
    mlb:  'MLB',
    nba:  'NBA',
    nfl:  'NFL',
    nhl:  'NHL',
    wnba: 'WNBA',
    ufc:  'MMA',
  };

  const league = LEAGUE_MAP[sport];
  if (!league) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${sport}-${type || 'props'}-${today}`;
  if (memCache[cacheKey]) {
    return { statusCode: 200, headers, body: JSON.stringify(memCache[cacheKey]) };
  }

  const get = (url) => new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'X-API-Key': SHARP_KEY,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) });
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });

  try {
    if (type === 'games') {
      // Game lines — moneyline, spread, total
      const result = await get(`https://api.sharpapi.io/api/v1/odds?league=${league}&market=moneyline,spread,total`);
      if (result.status !== 200) throw new Error(`SharpAPI games ${result.status}: ${JSON.stringify(result.data)}`);

      const games = (result.data?.data || result.data || []).map((game) => ({
        id: game.id || game.game_id,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        startTime: game.start_time || game.commence_time,
        homeML: game.home_ml || game.moneyline?.home || null,
        awayML: game.away_ml || game.moneyline?.away || null,
        homeSpread: game.home_spread || game.spread?.home_line || null,
        homeSpreadOdds: game.home_spread_odds || game.spread?.home_odds || null,
        awaySpread: game.away_spread || game.spread?.away_line || null,
        awaySpreadOdds: game.away_spread_odds || game.spread?.away_odds || null,
        total: game.total || game.totals?.line || null,
        overOdds: game.over_odds || game.totals?.over_odds || null,
        underOdds: game.under_odds || game.totals?.under_odds || null,
        vendor: 'sharpapi',
      }));

      memCache[cacheKey] = games;
      return { statusCode: 200, headers, body: JSON.stringify(games) };
    }

    // Player props
    const result = await get(`https://api.sharpapi.io/api/v1/props?league=${league}`);
    if (result.status !== 200) throw new Error(`SharpAPI props ${result.status}: ${JSON.stringify(result.data)}`);

    const raw = result.data?.data || result.data || [];
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('SharpAPI returned no props');

    const props = raw.map(p => ({
      id: p.id || `sharp-${p.player_name}-${p.stat_type}`,
      playerId: p.player_id || '',
      playerName: p.player_name || p.description || '',
      team: p.team || '',
      propType: p.stat_type || p.market || '',
      line: parseFloat(p.line) || 0,
      overOdds: parseInt(p.over_odds || p.over || -110),
      underOdds: parseInt(p.under_odds || p.under || -110),
      gameId: p.game_id || '',
      vendor: 'sharpapi',
      homeTeam: p.home_team || '',
      awayTeam: p.away_team || '',
      startTime: p.start_time || '',
    })).filter(p => p.playerName && p.line > 0);

    memCache[cacheKey] = props;
    return { statusCode: 200, headers, body: JSON.stringify(props) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

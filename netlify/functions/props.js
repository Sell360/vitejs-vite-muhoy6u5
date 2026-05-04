const https = require('https');

const memCache = {};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport } = event.queryStringParameters || {};
  const SHARP_KEY = process.env.VITE_SHARP_API_KEY || 'sk_live_RNtWLQCEoQXRgRwXHovbhU';

  const LEAGUE_MAP = {
    mlb: 'MLB', nba: 'NBA', nfl: 'NFL',
    nhl: 'NHL', wnba: 'WNBA', ufc: 'MMA',
  };

  const league = LEAGUE_MAP[sport];
  if (!league) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${sport}-${today}`;
  if (memCache[cacheKey]) return { statusCode: 200, headers, body: JSON.stringify(memCache[cacheKey]) };

  // Fetch raw text so we can debug what SharpAPI actually returns
  const getRaw = (url) => new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'X-API-Key': SHARP_KEY, 'Accept': 'application/json' }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });

  try {
    // First check what endpoints are available
    const test = await getRaw(`https://api.sharpapi.io/api/v1/odds?league=${league}`);
    
    // Try to parse — if it fails return the raw body so we can see what's wrong
    let data;
    try {
      data = JSON.parse(test.body);
    } catch(e) {
      return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ error: `SharpAPI parse error. Status: ${test.status}. Raw: ${test.body.slice(0, 500)}` }) 
      };
    }

    if (test.status !== 200) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: `SharpAPI ${test.status}: ${JSON.stringify(data)}` }) };
    }

    // Build props from whatever format SharpAPI returns
    const raw = data?.data || data?.odds || data?.props || (Array.isArray(data) ? data : []);
    
    const props = raw.map((p) => ({
      id: p.id || `sharp-${Math.random()}`,
      playerId: p.player_id || '',
      playerName: p.player_name || p.name || p.description || '',
      team: p.team || p.team_abbr || '',
      propType: p.stat_type || p.market || p.type || '',
      line: parseFloat(p.line || p.value || 0),
      overOdds: parseInt(p.over_odds || p.over || p.price_over || -110),
      underOdds: parseInt(p.under_odds || p.under || p.price_under || -110),
      gameId: p.game_id || p.event_id || '',
      vendor: 'sharpapi',
      homeTeam: p.home_team || '',
      awayTeam: p.away_team || '',
      startTime: p.start_time || p.commence_time || '',
    })).filter(p => p.playerName && p.line > 0);

    if (props.length > 0) {
      memCache[cacheKey] = props;
      return { statusCode: 200, headers, body: JSON.stringify(props) };
    }

    // Return raw data structure so we can see what fields exist
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ error: `SharpAPI returned data but no props. Sample: ${JSON.stringify(raw.slice(0,2))}` }) 
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

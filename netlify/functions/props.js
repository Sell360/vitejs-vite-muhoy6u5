const https = require('https');
const memCache = {};

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport, type } = event.queryStringParameters || {};
  const SHARP_KEY = process.env.VITE_SHARP_API_KEY || 'sk_live_RNtWLQCEoQXRgRwXHovbhU';
  const LEAGUE_MAP = { mlb: 'mlb', nba: 'nba', nfl: 'nfl', nhl: 'nhl', wnba: 'wnba', ufc: 'mma' };
  const league = LEAGUE_MAP[sport];
  if (!league) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${sport}-${type || 'props'}-${today}`;
  if (memCache[cacheKey]) return { statusCode: 200, headers, body: JSON.stringify(memCache[cacheKey]) };

  const getRaw = (url) => new Promise((resolve, reject) => {
    https.get(url, { headers: { 'X-API-Key': SHARP_KEY, 'Accept': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });

  try {
    // Get all data and see what market types exist
    const result = await getRaw(`https://api.sharpapi.io/api/v1/odds?league=${league}&per_page=200`);
    if (result.status !== 200) throw new Error(`SharpAPI ${result.status}: ${JSON.stringify(result.data)}`);

    const raw = Array.isArray(result.data) ? result.data : (result.data?.data || []);
    if (raw.length === 0) throw new Error('No data returned');

    // Get unique market types to see what's available
    const marketTypes = [...new Set(raw.map(r => r.market_type))];
    
    // Filter for today's games only (not futures)
    const todayItems = raw.filter(item => {
      const start = new Date(item.event_start_time);
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return start >= now - 4 * 60 * 60 * 1000 && start <= tomorrow;
    });

    // Show what we have
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        marketTypes,
        totalCount: raw.length,
        todayCount: todayItems.length,
        todaySample: todayItems.slice(0, 2)
      })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

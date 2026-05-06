// Credit usage endpoint — checks remaining credits via cheapest call
// (the /sports list endpoint is FREE and returns usage headers)
const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300', // 5-minute cache
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const ODDS_KEY = process.env.ODDS_API_KEY;
  if (!ODDS_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ODDS_API_KEY not configured' }) };

  return new Promise((resolve) => {
    https.get(`https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_KEY}`, (res) => {
      const used = parseInt(res.headers['x-requests-used'] || '0', 10);
      const remaining = parseInt(res.headers['x-requests-remaining'] || '0', 10);
      const lastCost = parseInt(res.headers['x-requests-last'] || '0', 10);
      const total = used + remaining;

      // Drain body
      res.on('data', () => {});
      res.on('end', () => {
        resolve({
          statusCode: 200, headers,
          body: JSON.stringify({
            used,
            remaining,
            total,
            lastCallCost: lastCost,
            percentUsed: total > 0 ? Math.round((used / total) * 100) : 0,
            timestamp: new Date().toISOString(),
          }),
        });
      });
    }).on('error', (err) => {
      resolve({ statusCode: 500, headers, body: JSON.stringify({ error: String(err) }) });
    });
  });
};

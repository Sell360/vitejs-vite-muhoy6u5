// SECURITY: Server-only — the weather API key is read from a non-VITE
// env var so it never reaches the public bundle. Set in Netlify:
//   Site settings → Environment variables → WEATHER_API_KEY
const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=600', // 10-minute cache
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const WX_KEY = process.env.WEATHER_API_KEY;
  if (!WX_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'WEATHER_API_KEY not configured' }) };
  }

  const { venue } = event.queryStringParameters || {};
  if (!venue) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing venue parameter' }) };
  }

  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(venue)}&appid=${WX_KEY}&units=imperial`;

  const fetch = (u) => new Promise((resolve, reject) => {
    https.get(u, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

  try {
    const { status, data } = await fetch(url);
    if (status !== 200 || !data || data.cod !== 200) {
      return { statusCode: 200, headers, body: JSON.stringify(null) };
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        temperature: Math.round(data.main?.temp ?? 72),
        windSpeed: Math.round(data.wind?.speed ?? 5),
        conditions: data.weather?.[0]?.description ?? 'Clear',
      }),
    };
  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify(null) };
  }
};

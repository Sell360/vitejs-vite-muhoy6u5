const https = require('https');
const memCache = {};

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport, debug } = event.queryStringParameters || {};
  const API_KEY = process.env.VITE_ODDSPAPI_KEY || '19564ce9-b577-4188-92cc-8fb4e4294aec';

  const get = (path) => new Promise((resolve, reject) => {
    https.get(`https://api.oddspapi.io/v4${path}`, {
      headers: { 'Accept': 'application/json' }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });

  // First get all sports to find correct IDs
  try {
    const sportsRes = await get(`/sports?apiKey=${API_KEY}`);
    const sports = Array.isArray(sportsRes.data) ? sportsRes.data : [];
    const relevant = sports.filter(s => 
      ['baseball','basketball','football','hockey','mma','mixed martial'].some(k => 
        (s.sportName || '').toLowerCase().includes(k)
      )
    );
    return { statusCode: 200, headers, body: JSON.stringify({ total: sports.length, relevant }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

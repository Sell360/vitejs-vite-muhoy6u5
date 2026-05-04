const https = require('https');
exports.handler = async () => {
  const ODDS_KEY = process.env.VITE_ODDS_API_KEY || 'eec9270deaa01691ceac36b1b6ada557';
  return new Promise((resolve) => {
    https.get(`https://api.the-odds-api.com/v4/sports?apiKey=${ODDS_KEY}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        resolve({
          statusCode: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({
            status: res.statusCode,
            remaining: res.headers['x-requests-remaining'],
            used: res.headers['x-requests-used'],
            body: data.slice(0, 100)
          })
        });
      });
    }).on('error', e => resolve({ statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: e.message }) }));
  });
};

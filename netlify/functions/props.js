const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport } = event.queryStringParameters || {};
  const SDI_KEY = process.env.VITE_SPORTS_API_KEY || 'cdfbffe6f43b47c29ab8ac4f8c0e5c9a';

  const today = new Date().toISOString().split('T')[0];

  const SDI_URLS = {
    mlb:  `https://api.sportsdata.io/v3/mlb/odds/json/PlayerPropsByDate/${today}?key=${SDI_KEY}`,
    nba:  `https://api.sportsdata.io/v3/nba/odds/json/PlayerPropsByDate/${today}?key=${SDI_KEY}`,
    nfl:  `https://api.sportsdata.io/v3/nfl/odds/json/PlayerPropsByDate/${today}?key=${SDI_KEY}`,
    nhl:  `https://api.sportsdata.io/v3/nhl/odds/json/PlayerPropsByDate/${today}?key=${SDI_KEY}`,
    wnba: `https://api.sportsdata.io/v3/wnba/odds/json/PlayerPropsByDate/${today}?key=${SDI_KEY}`,
    ufc:  null,
  };

  const url = SDI_URLS[sport];
  if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: `No source for ${sport}` }) };

  const get = (url) => new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
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
    const result = await get(url);

    if (result.status !== 200) {
      throw new Error(`SportsDataIO returned ${result.status}`);
    }

    const raw = Array.isArray(result.data) ? result.data : [];
    if (raw.length === 0) throw new Error('SportsDataIO returned 0 props');

    const props = raw
      .filter(p => p.PlayerName)
      .map(p => ({
        id: p.PropBetID?.toString() || Math.random().toString(),
        playerId: p.PlayerID?.toString() || '',
        playerName: p.PlayerName,
        team: p.Team || '',
        propType: p.PropBetType || '',
        line: p.Value || 0,
        overOdds: p.OverPayout || -110,
        underOdds: p.UnderPayout || -110,
        gameId: p.GameID?.toString() || '',
        vendor: 'sportsdata',
      }));

    return { statusCode: 200, headers, body: JSON.stringify(props) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

const https = require('https');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport } = event.queryStringParameters || {};

  const AN_SPORT_MAP = {
    mlb: 'baseball', nba: 'basketball', nfl: 'football',
    nhl: 'hockey', ncaaf: 'football', wnba: 'basketball', ufc: 'mma',
  };

  const anSport = AN_SPORT_MAP[sport] || 'baseball';

  const get = (url) => new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
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
    // Action Network free public betting data
    const today = new Date().toISOString().split('T')[0];
    const result = await get(
      `https://api.actionnetwork.com/web/v1/games?sport=${anSport}&date=${today}&bookIds=15,76,123`
    );

    if (result.status !== 200) throw new Error(`AN ${result.status}`);

    const games = result.data?.games || [];
    const bettingData = games.map(game => {
      const homeTeam = game.teams?.find(t => t.is_home)?.full_name || '';
      const awayTeam = game.teams?.find(t => !t.is_home)?.full_name || '';

      // Get betting percentages
      const lines = game.lines || [];
      const line = lines[0] || {};

      return {
        id: game.id?.toString(),
        homeTeam,
        awayTeam,
        startTime: game.start_time,
        homeBetPct: line.home_ml_bet_pct || null,
        awayBetPct: line.away_ml_bet_pct || null,
        overBetPct: line.over_bet_pct || null,
        underBetPct: line.under_bet_pct || null,
        homeMoneyPct: line.home_ml_money_pct || null,
        awayMoneyPct: line.away_ml_money_pct || null,
        // Fade signal: public >70% on one side but sharp money opposite
        fadeSignal: (() => {
          if (line.home_ml_bet_pct > 70 && line.home_ml_money_pct < 50) return `Fade ${homeTeam} — ${line.home_ml_bet_pct}% public, sharp money on ${awayTeam}`;
          if (line.away_ml_bet_pct > 70 && line.away_ml_money_pct < 50) return `Fade ${awayTeam} — ${line.away_ml_bet_pct}% public, sharp money on ${homeTeam}`;
          if (line.over_bet_pct > 75 && line.over_money_pct < 50) return `Fade Over — ${line.over_bet_pct}% public on over, sharp money on under`;
          return null;
        })(),
      };
    });

    return { statusCode: 200, headers, body: JSON.stringify(bettingData) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

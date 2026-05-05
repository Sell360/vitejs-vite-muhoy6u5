// Closing Line Value endpoint — uses The Odds API historical endpoint
// to fetch the line snapshot closest to game start time.
// Available on paid plans only.
const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=86400', // 24hr cache — closing lines never change once locked
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const ODDS_KEY = process.env.ODDS_API_KEY;
  if (!ODDS_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ODDS_API_KEY not configured' }) };

  const { sport, eventId, gameTime, market } = event.queryStringParameters || {};
  if (!sport || !eventId || !gameTime) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Required: sport, eventId, gameTime (ISO)' }) };
  }

  const SPORT_KEYS = {
    mlb: 'baseball_mlb', nba: 'basketball_nba', nfl: 'americanfootball_nfl',
    ncaaf: 'americanfootball_ncaaf', nhl: 'icehockey_nhl', wnba: 'basketball_wnba',
    ufc: 'mma_mixed_martial_arts',
  };
  const sportKey = SPORT_KEYS[sport];
  if (!sportKey) return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown sport: ${sport}` }) };

  // Closing line = snapshot 5 minutes before game start
  const gameDate = new Date(gameTime);
  const closingTime = new Date(gameDate.getTime() - 5 * 60 * 1000).toISOString();

  // Default to all featured markets if none specified
  const markets = market || 'h2h,spreads,totals';

  const url = `https://api.the-odds-api.com/v4/historical/sports/${sportKey}/events/${eventId}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${markets}&oddsFormat=american&date=${closingTime}`;

  const fetch = (u) => new Promise((resolve, reject) => {
    https.get(u, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode, data: JSON.parse(text) });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

  try {
    const { status, data } = await fetch(url);
    if (status !== 200) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: data?.message || `HTTP ${status}`, available: false }) };
    }

    const snapshot = data?.data;
    if (!snapshot || !snapshot.bookmakers) {
      return { statusCode: 200, headers, body: JSON.stringify({ available: false }) };
    }

    // Extract consensus closing lines across all books
    const result = {
      available: true,
      timestamp: data.timestamp,
      eventId: snapshot.id,
      homeTeam: snapshot.home_team,
      awayTeam: snapshot.away_team,
      moneyline: { home: null, away: null, books: [] },
      spread: { home: null, away: null, line: null, homeOdds: null, awayOdds: null },
      total: { line: null, overOdds: null, underOdds: null },
    };

    const mlHomeOdds = [], mlAwayOdds = [];
    const spreadLines = [], spreadHomeOdds = [], spreadAwayOdds = [];
    const totalLines = [], overOdds = [], underOdds = [];

    snapshot.bookmakers.forEach(bk => {
      bk.markets.forEach(m => {
        if (m.key === 'h2h') {
          m.outcomes.forEach(o => {
            if (o.name === snapshot.home_team) mlHomeOdds.push(americanFromDec(o.price));
            if (o.name === snapshot.away_team) mlAwayOdds.push(americanFromDec(o.price));
          });
          result.moneyline.books.push(bk.key);
        }
        if (m.key === 'spreads') {
          m.outcomes.forEach(o => {
            if (o.name === snapshot.home_team) {
              spreadLines.push(o.point);
              spreadHomeOdds.push(americanFromDec(o.price));
            }
            if (o.name === snapshot.away_team) {
              spreadAwayOdds.push(americanFromDec(o.price));
            }
          });
        }
        if (m.key === 'totals') {
          m.outcomes.forEach(o => {
            if (o.name === 'Over') {
              totalLines.push(o.point);
              overOdds.push(americanFromDec(o.price));
            }
            if (o.name === 'Under') underOdds.push(americanFromDec(o.price));
          });
        }
      });
    });

    if (mlHomeOdds.length) result.moneyline.home = median(mlHomeOdds);
    if (mlAwayOdds.length) result.moneyline.away = median(mlAwayOdds);
    if (spreadLines.length) {
      result.spread.line = median(spreadLines);
      result.spread.homeOdds = median(spreadHomeOdds);
      result.spread.awayOdds = median(spreadAwayOdds);
    }
    if (totalLines.length) {
      result.total.line = median(totalLines);
      result.total.overOdds = median(overOdds);
      result.total.underOdds = median(underOdds);
    }

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(err) }) };
  }
};

function americanFromDec(d) {
  if (!d || d <= 1) return 0;
  if (d >= 2) return Math.round((d - 1) * 100);
  return Math.round(-100 / (d - 1));
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

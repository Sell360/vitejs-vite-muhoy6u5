const https = require('https');
const memCache = {};

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport, type } = event.queryStringParameters || {};
  const API_KEY = process.env.VITE_ODDSPAPI_KEY || '19564ce9-b577-4188-92cc-8fb4e4294aec';

  // Correct OddsPapi sport IDs
  const SPORT_IDS = {
    mlb:  13, // Baseball
    nba:  11, // Basketball
    nfl:  14, // American Football
    nhl:  15, // Ice Hockey
    wnba: 11, // Basketball
    ufc:  20, // MMA
  };

  const sportId = SPORT_IDS[sport];
  if (!sportId) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${sport}-${type || 'props'}-${today}`;
  if (memCache[cacheKey]) return { statusCode: 200, headers, body: JSON.stringify(memCache[cacheKey]) };

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

  try {
    const now = new Date().toISOString();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const fixturesRes = await get(`/fixtures?apiKey=${API_KEY}&sportId=${sportId}&from=${now}&to=${tomorrow}&hasOdds=true`);
    if (fixturesRes.status !== 200) throw new Error(`Fixtures ${fixturesRes.status}: ${JSON.stringify(fixturesRes.data).slice(0,200)}`);

    const fixtures = Array.isArray(fixturesRes.data) ? fixturesRes.data : [];
    if (fixtures.length === 0) return { statusCode: 200, headers, body: JSON.stringify([]) };

    if (type === 'games') {
      const games = [];
      await Promise.allSettled(fixtures.slice(0, 10).map(async (f) => {
        try {
          const r = await get(`/odds?apiKey=${API_KEY}&fixtureId=${f.fixtureId}&oddsFormat=american`);
          if (r.status !== 200) return;
          const bookmakers = r.data?.bookmakerOdds || {};
          const book = bookmakers.draftkings || bookmakers.fanduel || bookmakers.pinnacle || Object.values(bookmakers)[0];
          if (!book) return;
          const markets = book.markets || {};
          // Find moneyline and total markets
          let homeML = null, awayML = null, total = null, overOdds = null, underOdds = null;
          Object.entries(markets).forEach(([, market]) => {
            const name = (market.marketName || '').toLowerCase();
            if (name.includes('moneyline') || name.includes('winner') || name.includes('1x2')) {
              Object.entries(market.outcomes || {}).forEach(([, outcome]) => {
                Object.entries(outcome.players || {}).forEach(([, p]) => {
                  if (p.bookmakerOutcomeId === 'home' || p.bookmakerOutcomeId === '1') homeML = p.priceAmerican ? parseInt(p.priceAmerican) : p.price;
                  if (p.bookmakerOutcomeId === 'away' || p.bookmakerOutcomeId === '2') awayML = p.priceAmerican ? parseInt(p.priceAmerican) : p.price;
                });
              });
            }
            if (name.includes('total') || name.includes('over/under')) {
              Object.entries(market.outcomes || {}).forEach(([, outcome]) => {
                Object.entries(outcome.players || {}).forEach(([, p]) => {
                  if (p.bookmakerOutcomeId === 'over') { total = p.line; overOdds = p.priceAmerican ? parseInt(p.priceAmerican) : p.price; }
                  if (p.bookmakerOutcomeId === 'under') underOdds = p.priceAmerican ? parseInt(p.priceAmerican) : p.price;
                });
              });
            }
          });
          games.push({
            id: f.fixtureId, homeTeam: f.participant1Name, awayTeam: f.participant2Name,
            startTime: f.startTime, homeML, awayML, total, overOdds, underOdds,
            homeSpread: null, homeSpreadOdds: null, awaySpread: null, awaySpreadOdds: null,
            vendor: 'oddspapi',
          });
        } catch { }
      }));
      memCache[cacheKey] = games;
      return { statusCode: 200, headers, body: JSON.stringify(games) };
    }

    // Player props
    const allProps = [];
    await Promise.allSettled(fixtures.slice(0, 6).map(async (f) => {
      try {
        const r = await get(`/odds?apiKey=${API_KEY}&fixtureId=${f.fixtureId}&oddsFormat=american&verbosity=3`);
        if (r.status !== 200) return;
        const bookmakers = r.data?.bookmakerOdds || {};
        const book = bookmakers.draftkings || bookmakers.fanduel || bookmakers.pinnacle || Object.values(bookmakers)[0];
        if (!book) return;

        Object.entries(book.markets || {}).forEach(([, market]) => {
          const marketName = market.marketName || '';
          Object.entries(market.outcomes || {}).forEach(([, outcome]) => {
            Object.entries(outcome.players || {}).forEach(([, player]) => {
              if (!player.playerName) return;
              const line = player.line;
              if (line === null || line === undefined) return;
              allProps.push({
                playerName: player.playerName,
                propType: marketName,
                line: parseFloat(line),
                side: player.bookmakerOutcomeId,
                price: player.priceAmerican ? parseInt(player.priceAmerican) : player.price,
                gameId: f.fixtureId,
                homeTeam: f.participant1Name,
                awayTeam: f.participant2Name,
                startTime: f.startTime,
              });
            });
          });
        });
      } catch { }
    }));

    // Pair over/under
    const paired = new Map();
    allProps.forEach(p => {
      const key = `${p.gameId}-${p.playerName}-${p.propType}-${p.line}`;
      if (!paired.has(key)) {
        paired.set(key, {
          id: key, playerId: '', playerName: p.playerName, team: '',
          propType: p.propType, line: p.line, overOdds: -110, underOdds: -110,
          gameId: p.gameId, vendor: 'oddspapi',
          homeTeam: p.homeTeam, awayTeam: p.awayTeam, startTime: p.startTime,
        });
      }
      const entry = paired.get(key);
      const side = (p.side || '').toLowerCase();
      if (side === 'over' || side === 'yes' || side === 'more') entry.overOdds = p.price;
      if (side === 'under' || side === 'no' || side === 'less') entry.underOdds = p.price;
    });

    const props = Array.from(paired.values()).filter(p => p.playerName && p.line > 0);

    if (props.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({
        error: `0 props. Raw: ${allProps.length}. Fixtures: ${fixtures.length}. Sample: ${JSON.stringify(allProps.slice(0,2))}`
      })};
    }

    memCache[cacheKey] = props;
    return { statusCode: 200, headers, body: JSON.stringify(props) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

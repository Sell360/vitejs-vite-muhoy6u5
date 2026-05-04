const https = require('https');
const memCache = {};

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport, type, debug } = event.queryStringParameters || {};
  const API_KEY = process.env.VITE_ODDSPAPI_KEY || '19564ce9-b577-4188-92cc-8fb4e4294aec';
  const BASE = 'api.oddspapi.io';

  const SPORT_IDS = { mlb: 16, nba: 11, nfl: 14, nhl: 17, wnba: 11, ufc: 22 };
  const sportId = SPORT_IDS[sport];
  if (!sportId) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${sport}-${type || 'props'}-${today}`;
  if (memCache[cacheKey] && !debug) return { statusCode: 200, headers, body: JSON.stringify(memCache[cacheKey]) };

  const get = (path) => new Promise((resolve, reject) => {
    https.get(`https://${BASE}/v4${path}`, {
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
    if (fixturesRes.status !== 200) throw new Error(`Fixtures ${fixturesRes.status}: ${JSON.stringify(fixturesRes.data).slice(0,300)}`);

    const fixtures = Array.isArray(fixturesRes.data) ? fixturesRes.data : [];
    if (fixtures.length === 0) return { statusCode: 200, headers, body: JSON.stringify([]) };

    // Debug mode: show raw odds structure for first fixture
    if (debug === 'true') {
      const oddsRes = await get(`/odds?apiKey=${API_KEY}&fixtureId=${fixtures[0].fixtureId}&oddsFormat=american&verbosity=3`);
      return { statusCode: 200, headers, body: JSON.stringify({
        fixtureId: fixtures[0].fixtureId,
        fixture: fixtures[0],
        oddsStatus: oddsRes.status,
        bookmakers: Object.keys(oddsRes.data?.bookmakerOdds || {}),
        marketIds: Object.keys(Object.values(oddsRes.data?.bookmakerOdds || {})[0]?.markets || {}),
        sampleMarket: JSON.stringify(Object.entries(Object.values(oddsRes.data?.bookmakerOdds || {})[0]?.markets || {})[0]).slice(0, 500),
      })};
    }

    if (type === 'games') {
      const games = [];
      await Promise.allSettled(fixtures.slice(0, 10).map(async (f) => {
        try {
          const r = await get(`/odds?apiKey=${API_KEY}&fixtureId=${f.fixtureId}&oddsFormat=american`);
          if (r.status !== 200) return;
          const bookmakers = r.data?.bookmakerOdds || {};
          const book = bookmakers.draftkings || bookmakers.fanduel || bookmakers.pinnacle || Object.values(bookmakers)[0];
          if (!book) return;
          // Market 101 = moneyline, 102 = totals in most sports
          const mlMarket = book.markets?.['101'];
          const totalMarket = book.markets?.['102'] || book.markets?.['103'];
          const homeML = mlMarket?.outcomes?.['101']?.players?.['0']?.price;
          const awayML = mlMarket?.outcomes?.['103']?.players?.['0']?.price || mlMarket?.outcomes?.['102']?.players?.['0']?.price;
          const over = totalMarket?.outcomes?.['101']?.players?.['0'];
          const under = totalMarket?.outcomes?.['102']?.players?.['0'];
          games.push({
            id: f.fixtureId,
            homeTeam: f.participant1Name,
            awayTeam: f.participant2Name,
            startTime: f.startTime,
            homeML: homeML || null,
            awayML: awayML || null,
            total: over?.line || null,
            overOdds: over?.price || null,
            underOdds: under?.price || null,
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

        Object.entries(book.markets || {}).forEach(([marketId, market]) => {
          const marketName = market.marketName || '';
          // Only include markets that have player names (props)
          Object.entries(market.outcomes || {}).forEach(([, outcome]) => {
            Object.entries(outcome.players || {}).forEach(([, player]) => {
              if (!player.playerName) return;
              const line = player.line;
              if (line === null || line === undefined) return;
              allProps.push({
                id: `${f.fixtureId}-${player.playerName}-${marketId}-${player.bookmakerOutcomeId}`,
                playerName: player.playerName,
                team: '',
                propType: marketName,
                line: parseFloat(line),
                side: player.bookmakerOutcomeId,
                price: player.price,
                gameId: f.fixtureId,
                vendor: 'oddspapi',
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
          id: key, playerId: '', playerName: p.playerName, team: p.team,
          propType: p.propType, line: p.line, overOdds: -110, underOdds: -110,
          gameId: p.gameId, vendor: p.vendor,
          homeTeam: p.homeTeam, awayTeam: p.awayTeam, startTime: p.startTime,
        });
      }
      const entry = paired.get(key);
      if (p.side === 'over' || p.side === 'yes') entry.overOdds = p.price;
      if (p.side === 'under' || p.side === 'no') entry.underOdds = p.price;
    });

    const props = Array.from(paired.values()).filter(p => p.playerName && p.line > 0);

    if (props.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({
        error: `0 props after pairing. Raw prop count: ${allProps.length}. Sample raw: ${JSON.stringify(allProps.slice(0,2))}`
      })};
    }

    memCache[cacheKey] = props;
    return { statusCode: 200, headers, body: JSON.stringify(props) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

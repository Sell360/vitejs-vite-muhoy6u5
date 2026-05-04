const https = require('https');
const memCache = {};

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport, type } = event.queryStringParameters || {};
  const API_KEY = process.env.VITE_ODDSPAPI_KEY || '19564ce9-b577-4188-92cc-8fb4e4294aec';
  const BASE = 'api.oddspapi.io';

  // OddsPapi sport IDs
  const SPORT_IDS = {
    mlb: 16, nba: 11, nfl: 14,
    nhl: 17, wnba: 11, ufc: 22,
  };

  const sportId = SPORT_IDS[sport];
  if (!sportId) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${sport}-${type || 'props'}-${today}`;
  if (memCache[cacheKey]) return { statusCode: 200, headers, body: JSON.stringify(memCache[cacheKey]) };

  const get = (path) => new Promise((resolve, reject) => {
    const url = `https://${BASE}/v4${path}`;
    https.get(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
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

    // Step 1: Get today's fixtures
    const fixturesRes = await get(
      `/fixtures?apiKey=${API_KEY}&sportId=${sportId}&from=${now}&to=${tomorrow}&hasOdds=true`
    );
    if (fixturesRes.status !== 200) throw new Error(`Fixtures ${fixturesRes.status}: ${JSON.stringify(fixturesRes.data).slice(0,200)}`);

    const fixtures = Array.isArray(fixturesRes.data) ? fixturesRes.data : [];
    if (fixtures.length === 0) return { statusCode: 200, headers, body: JSON.stringify([]) };

    if (type === 'games') {
      // Get game lines for each fixture
      const games = [];
      await Promise.allSettled(fixtures.slice(0, 10).map(async (f) => {
        try {
          const oddsRes = await get(`/odds?apiKey=${API_KEY}&fixtureId=${f.fixtureId}&oddsFormat=american`);
          if (oddsRes.status !== 200) return;
          const book = oddsRes.data?.bookmakerOdds?.draftkings || oddsRes.data?.bookmakerOdds?.fanduel || Object.values(oddsRes.data?.bookmakerOdds || {})[0];
          if (!book) return;
          const ml = book.markets?.['101']; // moneyline
          const total = book.markets?.['102']; // total
          games.push({
            id: f.fixtureId,
            homeTeam: f.participant1Name,
            awayTeam: f.participant2Name,
            startTime: f.startTime,
            homeML: ml?.outcomes?.['101']?.players?.['0']?.price || null,
            awayML: ml?.outcomes?.['103']?.players?.['0']?.price || null,
            total: total?.outcomes?.['101']?.players?.['0']?.line || null,
            overOdds: total?.outcomes?.['101']?.players?.['0']?.price || null,
            underOdds: total?.outcomes?.['102']?.players?.['0']?.price || null,
            vendor: 'oddspapi',
          });
        } catch { }
      }));
      memCache[cacheKey] = games;
      return { statusCode: 200, headers, body: JSON.stringify(games) };
    }

    // Player props — get odds with player prop markets
    const allProps = [];
    await Promise.allSettled(fixtures.slice(0, 6).map(async (f) => {
      try {
        const oddsRes = await get(`/odds?apiKey=${API_KEY}&fixtureId=${f.fixtureId}&oddsFormat=american&verbosity=3`);
        if (oddsRes.status !== 200) return;
        const bookmakers = oddsRes.data?.bookmakerOdds || {};
        const book = bookmakers.draftkings || bookmakers.fanduel || Object.values(bookmakers)[0];
        if (!book) return;

        Object.entries(book.markets || {}).forEach(([marketId, market]) => {
          Object.entries(market.outcomes || {}).forEach(([, outcome]) => {
            Object.entries(outcome.players || {}).forEach(([, player]) => {
              if (!player.playerName || player.price === null) return;
              const line = player.line ?? 0;
              if (line === 0) return;
              const key = `${f.fixtureId}-${player.playerName}-${marketId}-${line}`;
              allProps.push({
                id: key,
                playerId: '',
                playerName: player.playerName,
                team: '',
                propType: market.marketName || marketId,
                line,
                overOdds: player.bookmakerOutcomeId === 'over' ? player.price : -110,
                underOdds: player.bookmakerOutcomeId === 'under' ? player.price : -110,
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

    // Pair over/under by player+market+line
    const paired = new Map();
    allProps.forEach(p => {
      const key = `${p.gameId}-${p.playerName}-${p.propType}-${p.line}`;
      if (!paired.has(key)) paired.set(key, { ...p, overOdds: -110, underOdds: -110 });
      const entry = paired.get(key);
      if (p.overOdds !== -110) entry.overOdds = p.overOdds;
      if (p.underOdds !== -110) entry.underOdds = p.underOdds;
    });

    const props = Array.from(paired.values()).filter(p => p.playerName && p.line > 0);
    if (props.length === 0) {
      // Return debug info
      return { statusCode: 200, headers, body: JSON.stringify({ 
        error: `No props found. Fixtures: ${fixtures.length}. Debug: ${JSON.stringify(fixtures[0]).slice(0,200)}` 
      })};
    }

    memCache[cacheKey] = props;
    return { statusCode: 200, headers, body: JSON.stringify(props) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

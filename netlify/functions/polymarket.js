// Polymarket proxy — routes our requests through Netlify so we can:
//   1. Cache aggressively (Polymarket prices update fast but we don't need real-time)
//   2. Avoid any potential CORS issues from the browser
//   3. Centralize keyword filtering for sports markets
//
// Note: From prior PolyBot work we know Polymarket BLOCKS some cloud IPs, but
// Netlify Functions run on AWS Lambda IPs which are typically allowed for
// READ-only public endpoints (no trading). If this fails in production, we'll
// move to a direct browser fetch.
const https = require('https');

const cache = {};
const TTL_MS = 10 * 60 * 1000; // 10 min

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Betz360/1.0)',
        'Accept': 'application/json',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=600',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const sport = (event.queryStringParameters?.sport || '').toLowerCase();
  if (!sport) return { statusCode: 400, headers, body: JSON.stringify({ error: 'sport required' }) };

  const ck = `poly-${sport}`;
  const hit = cache[ck];
  if (hit && Date.now() - hit.ts < TTL_MS) {
    return { statusCode: 200, headers, body: JSON.stringify({ markets: hit.data, cached: true }) };
  }

  // Sport-specific team keywords for filtering. We grab all active markets
  // and filter by these keywords client-side since Polymarket's tag system
  // is inconsistent for sports.
  const KEYWORDS = {
    nba: ['nba', 'lakers', 'celtics', 'warriors', 'knicks', 'heat', 'bucks', 'nets', '76ers', 'sixers', 'mavericks', 'mavs', 'suns', 'nuggets', 'thunder', 'timberwolves', 'wolves', 'pelicans', 'rockets', 'spurs', 'grizzlies', 'kings', 'clippers', 'jazz', 'trail blazers', 'blazers', 'hawks', 'hornets', 'magic', 'wizards', 'pistons', 'pacers', 'cavaliers', 'cavs', 'bulls', 'raptors'],
    mlb: ['mlb', 'baseball', 'yankees', 'red sox', 'blue jays', 'rays', 'orioles', 'guardians', 'tigers', 'royals', 'twins', 'white sox', 'astros', 'rangers', 'mariners', 'angels', 'athletics', 'braves', 'phillies', 'mets', 'marlins', 'nationals', 'cardinals', 'cubs', 'brewers', 'reds', 'pirates', 'dodgers', 'giants', 'padres', 'diamondbacks', 'rockies'],
    nfl: ['nfl', 'football', 'chiefs', '49ers', 'cowboys', 'eagles', 'bills', 'ravens', 'bengals', 'steelers', 'browns', 'titans', 'colts', 'jaguars', 'texans', 'broncos', 'raiders', 'chargers', 'patriots', 'jets', 'dolphins', 'rams', 'seahawks', 'cardinals', 'packers', 'vikings', 'lions', 'bears', 'buccaneers', 'saints', 'falcons', 'panthers', 'commanders', 'giants'],
    nhl: ['nhl', 'hockey', 'bruins', 'rangers', 'islanders', 'devils', 'flyers', 'penguins', 'capitals', 'hurricanes', 'panthers', 'lightning', 'maple leafs', 'canadiens', 'senators', 'sabres', 'red wings', 'blue jackets', 'blackhawks', 'wild', 'avalanche', 'stars', 'predators', 'jets', 'blues', 'oilers', 'flames', 'canucks', 'kraken', 'sharks', 'kings', 'ducks', 'golden knights'],
    wnba: ['wnba', 'liberty', 'aces', 'sun', 'sky', 'fever', 'mystics', 'lynx', 'wings', 'mercury', 'sparks', 'storm', 'dream', 'valkyries'],
    ncaaf: ['ncaaf', 'college football', 'cfb'],
    ufc: ['ufc', 'mma', 'fight'],
  };

  const keywords = KEYWORDS[sport] || [sport];

  try {
    // Fetch active sports markets — most volume = most likely to have today's games
    const today = new Date().toISOString();
    const url = `https://gamma-api.polymarket.com/markets?active=true&closed=false&end_date_min=${today}&limit=200&order=volume24hr&ascending=false`;
    const { status, data } = await fetchJSON(url);

    if (status !== 200 || !Array.isArray(data)) {
      return { statusCode: 200, headers, body: JSON.stringify({ markets: [], error: `HTTP ${status}` }) };
    }

    // Filter to sport-relevant markets
    const filtered = data.filter(m => {
      const haystack = `${m.question || ''} ${m.slug || ''}`.toLowerCase();
      return keywords.some(k => haystack.includes(k));
    }).map(m => {
      // Parse outcomePrices which is a JSON-stringified array like '["0.20","0.80"]'
      let yesPrice = 0, noPrice = 0;
      try {
        const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
        if (Array.isArray(prices) && prices.length >= 2) {
          yesPrice = parseFloat(prices[0]) || 0;
          noPrice = parseFloat(prices[1]) || 0;
        }
      } catch {}

      return {
        conditionId: m.conditionId || '',
        question: m.question || '',
        slug: m.slug || '',
        yesPrice,
        noPrice,
        liquidity: parseFloat(m.liquidity || '0'),
        volume24hr: parseFloat(m.volume24hr || '0'),
        endDate: m.endDate || '',
      };
    }).filter(m => m.yesPrice > 0 && m.yesPrice < 1 && m.liquidity >= 50);

    cache[ck] = { data: filtered, ts: Date.now() };
    return { statusCode: 200, headers, body: JSON.stringify({ markets: filtered, count: filtered.length }) };
  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ markets: [], error: String(err) }) };
  }
};

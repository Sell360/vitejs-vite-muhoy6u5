const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport } = event.queryStringParameters || {};

  const DK_GROUPS = {
    mlb: '84240', nba: '42648', nfl: '88808',
    nhl: '42133', wnba: '42648', ufc: '9',
  };

  const groupId = DK_GROUPS[sport];
  if (!groupId) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  // Rotate through multiple DK regional endpoints to avoid IP blocks
  const DK_HOSTS = [
    'sportsbook.draftkings.com',
    'sportsbook-us-nj.draftkings.com',
    'sportsbook-us-pa.draftkings.com',
    'sportsbook-us-co.draftkings.com',
  ];

  const fetchDK = (path) => new Promise((resolve, reject) => {
    let lastError;
    const tryHost = (i) => {
      if (i >= DK_HOSTS.length) return reject(lastError || new Error('All hosts failed'));
      const host = DK_HOSTS[i];
      const url = `https://${host}/sites/US-SB/api/v5${path}`;
      const req = https.request(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': `https://${host}/`,
          'Origin': `https://${host}`,
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          'Connection': 'keep-alive',
        }
      }, (res) => {
        if (res.statusCode === 403 || res.statusCode === 429) {
          lastError = new Error(`${host} returned ${res.statusCode}`);
          return tryHost(i + 1);
        }
        if (res.statusCode !== 200) {
          lastError = new Error(`${host} returned ${res.statusCode}`);
          return tryHost(i + 1);
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString();
            resolve(JSON.parse(body));
          } catch(e) { tryHost(i + 1); }
        });
      });
      req.on('error', (e) => { lastError = e; tryHost(i + 1); });
      req.end();
    };
    tryHost(0);
  });

  try {
    const catData = await fetchDK(`/eventgroups/${groupId}?format=json`);
    const propKeywords = ['player', 'batter', 'pitcher', 'points', 'rebounds', 'assists',
      'passing', 'rushing', 'receiving', 'shots', 'saves', 'goals', 'hits', 'strikeout', 'total bases'];
    const cats = catData?.eventGroup?.offerCategories || [];
    const propCats = cats.filter(c => propKeywords.some(k => (c.name || '').toLowerCase().includes(k)));

    if (propCats.length === 0) throw new Error('No prop categories found in DK response');

    const allProps = [];
    await Promise.allSettled(
      propCats.slice(0, 8).map(async (cat) => {
        const catId = cat.offerCategoryId;
        await Promise.allSettled(
          (cat.offerSubcategoryDescriptors || []).slice(0, 8).map(async (subcat) => {
            const subcatId = subcat.offerSubcategoryId || subcat.subcategoryId;
            if (!subcatId) return;
            try {
              const data = await fetchDK(`/eventgroups/${groupId}/categories/${catId}/subcategories/${subcatId}?format=json`);
              allProps.push(...parseDKProps(data, subcat.name || cat.name || ''));
            } catch { }
          })
        );
      })
    );

    const seen = new Map();
    allProps.forEach(p => {
      const k = `${p.playerName}-${p.propType}-${p.line}`;
      if (!seen.has(k)) seen.set(k, p);
    });
    const deduped = Array.from(seen.values());
    if (deduped.length === 0) throw new Error('DK returned 0 props');
    return { statusCode: 200, headers, body: JSON.stringify(deduped) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function parseDKProps(data, defaultPropType) {
  const props = [];
  try {
    (data?.eventGroup?.offerCategories || []).forEach(cat => {
      (cat?.offerSubcategoryDescriptors || []).forEach(subcat => {
        const propType = subcat?.name || defaultPropType;
        (subcat?.offerSubcategory?.offers || []).forEach(offerGroup => {
          if (!Array.isArray(offerGroup)) return;
          offerGroup.forEach(offer => {
            const outcomes = offer?.outcomes || [];
            if (outcomes.length < 2) return;
            const playerName = offer?.participant || offer?.label || '';
            if (!playerName || playerName.length < 2) return;
            const over = outcomes.find(o => o?.label?.toLowerCase() === 'over');
            const under = outcomes.find(o => o?.label?.toLowerCase() === 'under');
            if (!over && !under) return;
            const line = parseFloat(over?.line || under?.line || '0') || 0;
            const overOdds = parseOdds(over?.oddsAmerican);
            const underOdds = parseOdds(under?.oddsAmerican);
            if (overOdds === 0 && underOdds === 0) return;
            props.push({
              id: `dk-${offer?.providerId || Math.random()}-${playerName}`,
              playerId: '',
              playerName: cleanName(playerName),
              team: offer?.teamAbbreviation || '',
              propType, line, overOdds, underOdds,
              gameId: offer?.eventId?.toString() || '',
              vendor: 'draftkings',
            });
          });
        });
      });
    });
  } catch { }
  return props;
}

function parseOdds(raw) {
  if (!raw) return 0;
  const n = parseInt(raw.toString().replace(/[^-\d]/g, ''));
  return isNaN(n) ? 0 : n;
}

function cleanName(name) {
  if (name.includes(',')) {
    const parts = name.split(',').map(s => s.trim());
    return `${parts[1]} ${parts[0]}`;
  }
  return name.trim();
}

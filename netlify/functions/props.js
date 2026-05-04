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

  const fetchDK = (url) => new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://sportsbook.draftkings.com/',
        'Origin': 'https://sportsbook.draftkings.com',
        'x-requested-with': 'XMLHttpRequest',
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`DK ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });

  try {
    const catData = await fetchDK(
      `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${groupId}?format=json`
    );

    const propKeywords = ['player', 'batter', 'pitcher', 'points', 'rebounds', 'assists',
      'passing', 'rushing', 'receiving', 'shots', 'saves', 'goals', 'hits', 'strikeout', 'total bases'];
    const cats = catData?.eventGroup?.offerCategories || [];
    const propCats = cats.filter(c => propKeywords.some(k => (c.name || '').toLowerCase().includes(k)));

    if (propCats.length === 0) throw new Error('No prop categories found');

    const allProps = [];

    await Promise.allSettled(
      propCats.slice(0, 8).map(async (cat) => {
        const catId = cat.offerCategoryId;
        await Promise.allSettled(
          (cat.offerSubcategoryDescriptors || []).slice(0, 8).map(async (subcat) => {
            const subcatId = subcat.offerSubcategoryId || subcat.subcategoryId;
            if (!subcatId) return;
            try {
              const data = await fetchDK(
                `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${groupId}/categories/${catId}/subcategories/${subcatId}?format=json`
              );
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

    if (deduped.length === 0) throw new Error('No props found');
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
              propType,
              line,
              overOdds,
              underOdds,
              gameId: offer?.eventId?.toString() || '',
              vendor: 'draftkings',
            });
          });
        });
      });
    });
  } catch(e) {}
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

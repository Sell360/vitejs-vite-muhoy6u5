exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport } = event.queryStringParameters || {};

  const DK_GROUPS = {
    mlb:  '84240',
    nba:  '42648',
    nfl:  '88808',
    nhl:  '42133',
    wnba: '42648',
    ufc:  '9',
  };

  const groupId = DK_GROUPS[sport];
  if (!groupId) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  // Use multiple CORS proxy services as fallback chain
  const PROXIES = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => url, // direct as last resort
  ];

  const DK_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://sportsbook.draftkings.com/',
  };

  const fetchWithFallback = async (url) => {
    for (const proxy of PROXIES) {
      try {
        const res = await fetch(proxy(url), { headers: DK_HEADERS });
        if (res.ok) return res;
      } catch { continue; }
    }
    throw new Error('All proxies failed');
  };

  try {
    // Get categories
    const catRes = await fetchWithFallback(
      `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${groupId}?format=json`
    );
    const catData = await catRes.json();

    const propKeywords = ['player', 'batter', 'pitcher', 'points', 'rebounds', 'assists', 'passing', 'rushing', 'receiving', 'shots', 'saves', 'goals', 'hits', 'strikeout', 'total bases'];
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
              const res = await fetchWithFallback(
                `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${groupId}/categories/${catId}/subcategories/${subcatId}?format=json`
              );
              const data = await res.json();
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
  } catch (e) { }
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

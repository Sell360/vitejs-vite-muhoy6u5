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

  const DK_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://sportsbook.draftkings.com/',
  };

  try {
    // Step 1: get all categories for the sport
    const catRes = await fetch(
      `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${groupId}?format=json`,
      { headers: DK_HEADERS }
    );
    if (!catRes.ok) throw new Error(`DK categories ${catRes.status}`);
    const catData = await catRes.json();

    // Find player prop categories by name
    const propKeywords = ['player', 'batter', 'pitcher', 'goalscorer', 'points', 'rebounds', 'assists', 'passing', 'rushing', 'receiving', 'shots', 'saves'];
    const cats = catData?.eventGroup?.offerCategories || [];
    
    const propCats = cats.filter((c) => {
      const name = (c.name || '').toLowerCase();
      return propKeywords.some(k => name.includes(k));
    });

    if (propCats.length === 0) {
      // Just use all categories if we can't find prop-specific ones
      propCats.push(...cats.slice(0, 5));
    }

    // Step 2: fetch each prop category
    const allProps = [];
    
    await Promise.allSettled(
      propCats.map(async (cat) => {
        const catId = cat.offerCategoryId;
        const subcats = cat.offerSubcategoryDescriptors || [];
        
        await Promise.allSettled(
          subcats.slice(0, 10).map(async (subcat) => {
            const subcatId = subcat.offerSubcategoryId || subcat.subcategoryId;
            if (!subcatId) return;
            
            try {
              const res = await fetch(
                `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${groupId}/categories/${catId}/subcategories/${subcatId}?format=json`,
                { headers: DK_HEADERS }
              );
              if (!res.ok) return;
              const data = await res.json();
              const props = parseDKProps(data, subcat.name || cat.name || '');
              allProps.push(...props);
            } catch { /* skip failed subcats */ }
          })
        );
      })
    );

    // Deduplicate
    const seen = new Map();
    allProps.forEach(p => {
      const k = `${p.playerName}-${p.propType}-${p.line}`;
      if (!seen.has(k)) seen.set(k, p);
    });
    const deduped = Array.from(seen.values());

    if (deduped.length > 0) {
      return { statusCode: 200, headers, body: JSON.stringify(deduped) };
    }

    // Fallback to PrizePicks
    throw new Error('No props found from DraftKings');

  } catch (dkErr) {
    console.log('DK failed, trying PrizePicks:', dkErr.message);
    
    try {
      const ppLeagues = { mlb: 'MLB', nba: 'NBA', nfl: 'NFL', nhl: 'NHL', wnba: 'WNBA', ufc: 'UFC' };
      const res = await fetch(
        `https://api.prizepicks.com/projections?league_id=${ppLeagues[sport]}&per_page=250&single_stat=true`,
        { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
      );
      if (!res.ok) throw new Error(`PrizePicks ${res.status}`);
      const data = await res.json();
      const props = parsePPProps(data);
      
      if (props.length === 0) throw new Error('PrizePicks returned no props');
      return { statusCode: 200, headers, body: JSON.stringify(props) };

    } catch (ppErr) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: `DK: ${dkErr.message} | PP: ${ppErr.message}` })
      };
    }
  }
};

function parseDKProps(data, defaultPropType) {
  const props = [];
  try {
    const cats = data?.eventGroup?.offerCategories || [];
    cats.forEach(cat => {
      (cat?.offerSubcategoryDescriptors || []).forEach(subcat => {
        const propType = subcat?.name || defaultPropType;
        const offers = subcat?.offerSubcategory?.offers || [];
        offers.forEach(offerGroup => {
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
  } catch (e) { console.error('DK parse error:', e.message); }
  return props;
}

function parsePPProps(data) {
  const props = [];
  const players = {};
  (data.included || []).forEach(item => {
    if (item.type === 'new_player') players[item.id] = item.attributes;
  });
  (data.data || []).forEach(proj => {
    const attr = proj.attributes;
    if (!attr) return;
    const playerRel = proj.relationships?.new_player?.data;
    const player = playerRel ? players[playerRel.id] : null;
    const playerName = player?.display_name || attr.description || '';
    if (!playerName) return;
    const line = parseFloat(attr.line_score) || 0;
    if (!line) return;
    props.push({
      id: proj.id,
      playerId: playerRel?.id || '',
      playerName,
      team: player?.team || '',
      propType: attr.stat_type || '',
      line,
      overOdds: -110,
      underOdds: -110,
      gameId: attr.game_id || proj.id,
      vendor: 'prizepicks',
    });
  });
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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { sport } = event.queryStringParameters || {};

  // DraftKings event group IDs for each sport
  const DK_GROUPS = {
    mlb:  { id: '84240', cat: '1189', subcat: '3836' },
    nba:  { id: '42648', cat: '583',  subcat: '1215' },
    nfl:  { id: '88808', cat: '1102', subcat: '1103' },
    nhl:  { id: '42133', cat: '550',  subcat: '1099' },
    wnba: { id: '42648', cat: '583',  subcat: '1215' },
    ufc:  { id: '9',     cat: '1040', subcat: '1041' },
  };

  const group = DK_GROUPS[sport];
  if (!group) return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sport: ${sport}` }) };

  try {
    // Fetch DraftKings player props for the sport
    const url = `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${group.id}/categories/${group.cat}/subcategories/${group.subcat}?format=json`;
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://sportsbook.draftkings.com',
        'Referer': 'https://sportsbook.draftkings.com/',
      },
    });

    if (!res.ok) throw new Error(`DraftKings ${res.status}`);
    const data = await res.json();
    const props = parseDKProps(data, sport);

    return { statusCode: 200, headers, body: JSON.stringify(props) };
  } catch (err) {
    // Fallback: try PrizePicks
    try {
      const ppLeagues = { mlb: 'MLB', nba: 'NBA', nfl: 'NFL', nhl: 'NHL', wnba: 'WNBA', ufc: 'UFC' };
      const res = await fetch(
        `https://api.prizepicks.com/projections?league_id=${ppLeagues[sport]}&per_page=250&single_stat=true`,
        { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }
      );
      if (!res.ok) throw new Error(`PrizePicks ${res.status}`);
      const data = await res.json();
      const props = parsePPProps(data);
      return { statusCode: 200, headers, body: JSON.stringify(props) };
    } catch (ppErr) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: `DK: ${err.message} | PP: ${ppErr.message}` }) };
    }
  }
};

function parseDKProps(data, sport) {
  const props = [];
  try {
    const cats = data?.eventGroup?.offerCategories || [];
    cats.forEach(cat => {
      (cat?.offerSubcategoryDescriptors || []).forEach(subcat => {
        const offers = subcat?.offerSubcategory?.offers || [];
        offers.forEach(offerGroup => {
          if (!Array.isArray(offerGroup)) return;
          offerGroup.forEach(offer => {
            const outcomes = offer?.outcomes || [];
            if (outcomes.length < 2) return;
            const playerName = offer?.participant || offer?.label || '';
            if (!playerName) return;
            const propType = subcat?.name || 'Unknown';
            const over = outcomes.find(o => o?.label?.toLowerCase() === 'over');
            const under = outcomes.find(o => o?.label?.toLowerCase() === 'under');
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
  } catch (e) { console.error('DK parse error:', e); }
  // Deduplicate
  const seen = new Map();
  props.forEach(p => { const k = `${p.playerName}-${p.propType}-${p.line}`; if (!seen.has(k)) seen.set(k, p); });
  return Array.from(seen.values());
}

function parsePPProps(data) {
  const props = [];
  const players = {};
  (data.included || []).forEach(item => { if (item.type === 'new_player') players[item.id] = item.attributes; });
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

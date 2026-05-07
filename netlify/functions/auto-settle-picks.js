// SCHEDULED FUNCTION — runs every 2 hours.
// Auto-resolves house picks using ESPN's free public box-score endpoints.
// No API key required, no rate limits we've hit in practice.
//
// Strategy:
// 1. Pull pending/pending_review picks from Supabase
// 2. Group legs by sport
// 3. For each sport, hit ESPN's scoreboard endpoint to find the right gameId
//    (we match by team names since ESPN and Odds API use different IDs)
// 4. For each completed game, fetch the box score
// 5. For each prop in our pick, look up the player and check if their stat
//    cleared the line
// 6. If all legs of a parlay are settled, update status W/L/P
//
// IMPORTANT: ESPN's scoreboard API is unofficial. If it breaks, picks fall
// back to 'pending_review' for admin manual settle (the existing flow).
const https = require('https');

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// ─── ESPN ENDPOINT MAP ────────────────────────────────────────────────────
// Path → ESPN's public site.api.espn.com structure: /apis/site/v2/sports/{sport}/{league}
const ESPN_PATHS = {
  mlb:   { sport: 'baseball',     league: 'mlb'  },
  nba:   { sport: 'basketball',   league: 'nba'  },
  nfl:   { sport: 'football',     league: 'nfl'  },
  nhl:   { sport: 'hockey',       league: 'nhl'  },
  wnba:  { sport: 'basketball',   league: 'wnba' },
  ncaaf: { sport: 'football',     league: 'college-football' },
};

// ─── PROP TYPE → STAT EXTRACTOR MAP ───────────────────────────────────────
// For each prop type our lock function emits, define how to read it from
// ESPN's player stats array. ESPN box scores include player stats as an array
// of strings keyed by a `keys` array on the parent object.
const STAT_EXTRACTORS = {
  // MLB — batter stats: index of value in stats[]; ESPN keys: ['atBats','runs','hits','rbis','hrs','bbs','ks',...]
  mlb: {
    'hits':                 { group: 'batting', key: 'hits',                   parse: 'int' },
    'total bases':          { group: 'batting', key: 'totalBases',             parse: 'int' },
    'rbis':                 { group: 'batting', key: 'RBIs',                   parse: 'int' },
    'home runs':            { group: 'batting', key: 'homeRuns',               parse: 'int' },
    'strikeouts':           { group: 'pitching', key: 'strikeouts',            parse: 'int' },
  },
  nba: {
    'points':               { group: 'main', key: 'points',                    parse: 'int' },
    'rebounds':             { group: 'main', key: 'rebounds',                  parse: 'int' },
    'assists':              { group: 'main', key: 'assists',                   parse: 'int' },
    'threes':               { group: 'main', key: 'threePointFieldGoalsMade',  parse: 'int' },
  },
  nfl: {
    'pass yds':             { group: 'passing',   key: 'passingYards',         parse: 'int' },
    'rush yds':             { group: 'rushing',   key: 'rushingYards',         parse: 'int' },
    'reception yds':        { group: 'receiving', key: 'receivingYards',       parse: 'int' },
    'receptions':           { group: 'receiving', key: 'receptions',           parse: 'int' },
  },
  nhl: {
    'shots on goal':        { group: 'main', key: 'shots',                     parse: 'int' },
    'points':               { group: 'main', key: 'points',                    parse: 'int' },
  },
  wnba: {
    'points':               { group: 'main', key: 'points',                    parse: 'int' },
    'rebounds':             { group: 'main', key: 'rebounds',                  parse: 'int' },
    'assists':              { group: 'main', key: 'assists',                   parse: 'int' },
  },
};

function fetchJSON(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Betz360/1.0)', ...(headers || {}) },
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

function patchJSON(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

// Normalize a name for fuzzy matching: lowercase, strip punctuation, trim
function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Bets store matchups as 3-letter abbreviations (TOR @ TB) but ESPN returns
// full team names (Toronto Blue Jays). Nested by sport so shared codes
// (BOS, CHI, NY) don't collide between leagues.
const TEAM_ABBR = {
  mlb: {
    ARI: 'diamondbacks', ATH: 'athletics', ATL: 'braves', BAL: 'orioles',
    BOS: 'red sox', CHC: 'cubs', CHW: 'white sox', CIN: 'reds',
    CLE: 'guardians', COL: 'rockies', DET: 'tigers', HOU: 'astros',
    KC: 'royals', KCR: 'royals', LAA: 'angels', LAD: 'dodgers',
    MIA: 'marlins', MIL: 'brewers', MIN: 'twins', NYM: 'mets',
    NYY: 'yankees', OAK: 'athletics', PHI: 'phillies', PIT: 'pirates',
    SD: 'padres', SDP: 'padres', SEA: 'mariners', SF: 'giants',
    SFG: 'giants', STL: 'cardinals', TB: 'rays', TBR: 'rays',
    TEX: 'rangers', TOR: 'blue jays', WSH: 'nationals', WAS: 'nationals',
  },
  nba: {
    ATL: 'hawks', BOS: 'celtics', BKN: 'nets', BRK: 'nets',
    CHA: 'hornets', CHO: 'hornets', CHI: 'bulls', CLE: 'cavaliers',
    DAL: 'mavericks', DEN: 'nuggets', DET: 'pistons', GSW: 'warriors',
    GS: 'warriors', HOU: 'rockets', IND: 'pacers', LAC: 'clippers',
    LAL: 'lakers', MEM: 'grizzlies', MIA: 'heat', MIL: 'bucks',
    MIN: 'timberwolves', NOP: 'pelicans', NO: 'pelicans', NYK: 'knicks',
    NY: 'knicks', OKC: 'thunder', ORL: 'magic', PHI: '76ers',
    PHX: 'suns', POR: 'trail blazers', SAC: 'kings', SAS: 'spurs',
    SA: 'spurs', TOR: 'raptors', UTA: 'jazz', WAS: 'wizards', WSH: 'wizards',
  },
  nfl: {
    ARI: 'cardinals', ATL: 'falcons', BAL: 'ravens', BUF: 'bills',
    CAR: 'panthers', CHI: 'bears', CIN: 'bengals', CLE: 'browns',
    DAL: 'cowboys', DEN: 'broncos', DET: 'lions', GB: 'packers',
    GBP: 'packers', HOU: 'texans', IND: 'colts', JAX: 'jaguars',
    JAC: 'jaguars', KC: 'chiefs', LAC: 'chargers', LAR: 'rams',
    LV: 'raiders', LVR: 'raiders', MIA: 'dolphins', MIN: 'vikings',
    NE: 'patriots', NEP: 'patriots', NO: 'saints', NOS: 'saints',
    NYG: 'giants', NYJ: 'jets', PHI: 'eagles', PIT: 'steelers',
    SEA: 'seahawks', SF: '49ers', TB: 'buccaneers', TEN: 'titans',
    WSH: 'commanders', WAS: 'commanders',
  },
  nhl: {
    ANA: 'ducks', BOS: 'bruins', BUF: 'sabres', CGY: 'flames',
    CAR: 'hurricanes', CHI: 'blackhawks', COL: 'avalanche',
    CBJ: 'blue jackets', DAL: 'stars', DET: 'red wings',
    EDM: 'oilers', FLA: 'panthers', LAK: 'kings', LA: 'kings',
    MIN: 'wild', MTL: 'canadiens', NSH: 'predators',
    NJD: 'devils', NJ: 'devils', NYI: 'islanders', NYR: 'rangers',
    OTT: 'senators', PHI: 'flyers', PIT: 'penguins',
    SJ: 'sharks', SJS: 'sharks', SEA: 'kraken', STL: 'blues',
    TBL: 'lightning', TB: 'lightning', TOR: 'maple leafs',
    UTA: 'utah', VAN: 'canucks', VGK: 'golden knights', WSH: 'capitals',
    WPG: 'jets',
  },
  wnba: {
    ATL: 'dream', CHI: 'sky', CON: 'sun', DAL: 'wings',
    IND: 'fever', LV: 'aces', LVA: 'aces', LA: 'sparks',
    MIN: 'lynx', NY: 'liberty', NYL: 'liberty', PHX: 'mercury',
    SEA: 'storm', WAS: 'mystics', WSH: 'mystics',
  },
};

function teamMatches(odds, espn, sport) {
  const o = normalize(odds);
  const e = normalize(espn);
  if (!o || !e) return false;
  if (o === e) return true;
  if (o.length >= 3 && e.includes(o)) return true;
  if (e.length >= 3 && o.includes(e)) return true;
  const oLast = o.split(' ').slice(-2).join(' ');
  const eLast = e.split(' ').slice(-2).join(' ');
  if (oLast && eLast && (eLast.includes(oLast) || oLast.includes(eLast))) return true;
  const upperOdds = String(odds).toUpperCase().trim();
  const sportMap = TEAM_ABBR[sport?.toLowerCase?.()] || {};
  const mapped = sportMap[upperOdds];
  if (mapped && e.includes(mapped)) return true;
  return false;
}

// Find ESPN gameId by matching teams from a leg
async function findEspnGameId(sport, awayTeam, homeTeam, gameDate) {
  const path = ESPN_PATHS[sport];
  if (!path) return null;
  // ESPN scoreboard for the game's date — format YYYYMMDD
  const yyyymmdd = gameDate.replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path.sport}/${path.league}/scoreboard?dates=${yyyymmdd}`;
  const res = await fetchJSON(url);
  if (res.status !== 200 || !res.data?.events) return null;

  for (const ev of res.data.events) {
    const competitors = ev.competitions?.[0]?.competitors || [];
    const home = competitors.find(c => c.homeAway === 'home');
    const away = competitors.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    const homeName = home.team?.displayName || home.team?.name || '';
    const awayName = away.team?.displayName || away.team?.name || '';

    if (teamMatches(homeTeam, homeName, sport) && teamMatches(awayTeam, awayName, sport)) {
      return { id: ev.id, completed: ev.status?.type?.completed === true };
    }
  }
  return null;
}

// Fetch box score for an ESPN gameId
async function fetchBoxScore(sport, gameId) {
  const path = ESPN_PATHS[sport];
  if (!path) return null;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path.sport}/${path.league}/summary?event=${gameId}`;
  const res = await fetchJSON(url);
  if (res.status !== 200 || !res.data) return null;
  return res.data;
}

// Extract a player's stat from a box score
// boxscore.players[] = [ teamA: { team, statistics: [{ name, keys, athletes: [{ athlete, stats[] }] }] } ]
function getPlayerStat(boxscore, sport, propType, playerName) {
  const playersByTeam = boxscore?.boxscore?.players || [];
  const extractor = STAT_EXTRACTORS[sport]?.[propType.toLowerCase()];
  if (!extractor) return null;

  const targetName = normalize(playerName);

  for (const teamGroup of playersByTeam) {
    const statGroups = teamGroup.statistics || [];
    for (const sg of statGroups) {
      // sg.name might be 'batting', 'pitching', 'passing', 'rushing', 'receiving', or 'main' (NBA/NHL/WNBA)
      // For sports without group differentiation (NBA), use the first/only group
      const sgName = (sg.name || sg.type || 'main').toLowerCase();
      if (extractor.group !== 'main' && sgName !== extractor.group) continue;

      const keys = sg.keys || sg.labels || [];
      const keyIdx = keys.findIndex(k => k === extractor.key || normalize(k) === normalize(extractor.key));
      if (keyIdx < 0) continue;

      for (const ath of sg.athletes || []) {
        const athleteName = ath.athlete?.displayName || ath.athlete?.fullName || '';
        if (normalize(athleteName) !== targetName && !normalize(athleteName).includes(targetName) && !targetName.includes(normalize(athleteName))) continue;

        const raw = (ath.stats || [])[keyIdx];
        if (raw === undefined || raw === null) continue;
        const num = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
        if (isNaN(num)) continue;
        return num;
      }
    }
  }
  return null;
}

// Determine if a leg won, lost, or pushed given the actual stat
function gradeLeg(line, pick, actual) {
  if (actual === null) return null; // unable to grade
  if (actual === line) return 'push';
  if (pick === 'over')  return actual > line ? 'won' : 'lost';
  if (pick === 'under') return actual < line ? 'won' : 'lost';
  return null;
}

exports.handler = async () => {
  if (!SUPA_URL || !SUPA_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  // Fetch pending picks from last 7 days
  const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const picksUrl = `${SUPA_URL}/rest/v1/house_picks?status=in.(pending,pending_review)&pick_date=gte.${sinceDate}&select=*`;
  const picksRes = await fetchJSON(picksUrl, { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` });

  if (picksRes.status !== 200 || !Array.isArray(picksRes.data)) {
    return { statusCode: 500, body: JSON.stringify({ error: 'failed to fetch picks', status: picksRes.status }) };
  }

  const pending = picksRes.data;
  if (pending.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ status: 'no_pending' }) };
  }

  const results = { settled: [], stillPending: [], reviewNeeded: [], errors: [] };
  // Cache ESPN gameId lookups within this run
  const gameIdCache = {};
  const boxScoreCache = {};

  for (const pick of pending) {
    const sport = pick.sport;
    const legs = Array.isArray(pick.legs) ? pick.legs : [];
    if (legs.length === 0) {
      results.errors.push({ id: pick.id, reason: 'no legs' });
      continue;
    }

    const legResults = []; // 'won' | 'lost' | 'push' | null
    let allDataAvailable = true;

    for (const leg of legs) {
      // Parse matchup ("Yankees @ Red Sox")
      const parts = (leg.matchup || '').split(' @ ');
      if (parts.length !== 2) { allDataAvailable = false; break; }
      const awayTeam = parts[0].trim();
      const homeTeam = parts[1].trim();

      // Find/cache ESPN gameId
      const cacheKey = `${sport}-${pick.pick_date}-${awayTeam}-${homeTeam}`;
      let espnGame = gameIdCache[cacheKey];
      if (!espnGame) {
        try {
          espnGame = await findEspnGameId(sport, awayTeam, homeTeam, pick.pick_date);
        } catch { espnGame = null; }
        if (espnGame) gameIdCache[cacheKey] = espnGame;
      }

      if (!espnGame || !espnGame.completed) {
        allDataAvailable = false;
        break;
      }

      // Fetch/cache box score
      let box = boxScoreCache[espnGame.id];
      if (!box) {
        try { box = await fetchBoxScore(sport, espnGame.id); } catch { box = null; }
        if (box) boxScoreCache[espnGame.id] = box;
      }

      if (!box) {
        allDataAvailable = false;
        break;
      }

      const actual = getPlayerStat(box, sport, leg.propType, leg.player);
      if (actual === null) {
        // Player not in box score (DNP or name mismatch) → can't grade
        allDataAvailable = false;
        break;
      }

      const grade = gradeLeg(Number(leg.line), leg.pick, actual);
      if (!grade) { allDataAvailable = false; break; }
      legResults.push(grade);
    }

    if (!allDataAvailable || legResults.length !== legs.length) {
      // Mark as pending_review so admin can take over if data continues to be missing
      const gameDateOver24h = new Date(pick.pick_date).getTime() < Date.now() - 24 * 60 * 60 * 1000;
      if (gameDateOver24h && pick.status !== 'pending_review') {
        await patchJSON(
          `${SUPA_URL}/rest/v1/house_picks?id=eq.${pick.id}`,
          { status: 'pending_review' },
          { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: 'return=minimal' }
        );
        results.reviewNeeded.push({ id: pick.id, sport });
      } else {
        results.stillPending.push({ id: pick.id, sport });
      }
      continue;
    }

    // All legs graded — compute parlay outcome
    const wonCount = legResults.filter(r => r === 'won').length;
    const lostCount = legResults.filter(r => r === 'lost').length;
    const pushCount = legResults.filter(r => r === 'push').length;

    // Parlay rule: any leg lost = parlay lost. All won (pushes don't lose) = parlay won.
    let finalStatus;
    if (lostCount > 0) finalStatus = 'lost';
    else if (wonCount === legResults.length) finalStatus = 'won';
    else if (wonCount + pushCount === legResults.length) finalStatus = 'won'; // pushes drop out, remaining all won
    else finalStatus = 'push';

    const updateRes = await patchJSON(
      `${SUPA_URL}/rest/v1/house_picks?id=eq.${pick.id}`,
      {
        status: finalStatus,
        legs_won: wonCount,
        legs_lost: lostCount,
        legs_pushed: pushCount,
        settled_at: new Date().toISOString(),
      },
      { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: 'return=minimal' }
    );

    if (updateRes.status >= 200 && updateRes.status < 300) {
      results.settled.push({ id: pick.id, sport, status: finalStatus, legResults });
    } else {
      results.errors.push({ id: pick.id, supabaseStatus: updateRes.status });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...results, ts: new Date().toISOString() }),
  };
};

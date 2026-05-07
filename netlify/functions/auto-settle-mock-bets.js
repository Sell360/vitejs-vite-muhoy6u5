// SCHEDULED FUNCTION — runs every 2 hours.
// Auto-resolves user mock bets using ESPN's free public box-score endpoints.
// Companion to auto-settle-picks.js (which only handles house picks).
//
// Handles:
//   - ML (moneyline): looks up final score, determines winner
//   - SPREAD: applies handicap to scores, determines cover
//   - TOTAL: sums final scores, compares to line
//   - PROP: looks up player stat in box score, compares to line
//   - PARLAY: grades each leg using above logic, parlay rule applies
const https = require('https');

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.supabase_url || process.env.vite_supabase_url;
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.supabase_service_role_key;

const ESPN_PATHS = {
  mlb:   { sport: 'baseball',     league: 'mlb'  },
  nba:   { sport: 'basketball',   league: 'nba'  },
  nfl:   { sport: 'football',     league: 'nfl'  },
  nhl:   { sport: 'hockey',       league: 'nhl'  },
  wnba:  { sport: 'basketball',   league: 'wnba' },
  ncaaf: { sport: 'football',     league: 'college-football' },
};

const STAT_EXTRACTORS = {
  mlb: {
    'hits':                 { group: 'batting',  key: 'hits' },
    'total bases':          { group: 'batting',  key: 'totalBases' },
    'rbis':                 { group: 'batting',  key: 'RBIs' },
    'home runs':            { group: 'batting',  key: 'homeRuns' },
    'strikeouts':           { group: 'pitching', key: 'strikeouts' },
  },
  nba: {
    'points':               { group: 'main', key: 'points' },
    'rebounds':             { group: 'main', key: 'rebounds' },
    'assists':              { group: 'main', key: 'assists' },
    'threes':               { group: 'main', key: 'threePointFieldGoalsMade' },
  },
  nfl: {
    'pass yds':             { group: 'passing',   key: 'passingYards' },
    'rush yds':             { group: 'rushing',   key: 'rushingYards' },
    'reception yds':        { group: 'receiving', key: 'receivingYards' },
    'receptions':           { group: 'receiving', key: 'receptions' },
  },
  nhl: {
    'shots on goal':        { group: 'main', key: 'shots' },
    'points':               { group: 'main', key: 'points' },
  },
  wnba: {
    'points':               { group: 'main', key: 'points' },
    'rebounds':             { group: 'main', key: 'rebounds' },
    'assists':              { group: 'main', key: 'assists' },
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

function rpcCall(fnName, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${SUPA_URL}/rest/v1/rpc/${fnName}`);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'apikey': SUPA_SERVICE_KEY,
        'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function patchBet(betId, fields) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${SUPA_URL}/rest/v1/mock_bets?id=eq.${betId}`);
    const data = JSON.stringify(fields);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
      headers: {
        'apikey': SUPA_SERVICE_KEY,
        'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Prefer': 'return=minimal',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function americanToDecimal(o) {
  if (!o) return 1;
  return o > 0 ? o / 100 + 1 : 100 / Math.abs(o) + 1;
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Most bets store matchup as 3-letter abbreviations (TOR @ TB). ESPN returns
// full team names (Toronto Blue Jays). This map converts our abbreviations
// to the canonical name fragments we expect to find in ESPN's response.
// Nested by sport so shared abbreviations (BOS, CHI, NY) don't collide.
const TEAM_ABBR = {
  mlb: {
    ARI: 'diamondbacks', ATH: 'athletics', ATL: 'braves',  BAL: 'orioles',
    BOS: 'red sox',     CHC: 'cubs',      CHW: 'white sox', CIN: 'reds',
    CLE: 'guardians',   COL: 'rockies',   DET: 'tigers',   HOU: 'astros',
    KC:  'royals',      KCR: 'royals',    LAA: 'angels',   LAD: 'dodgers',
    MIA: 'marlins',     MIL: 'brewers',   MIN: 'twins',    NYM: 'mets',
    NYY: 'yankees',     OAK: 'athletics', PHI: 'phillies', PIT: 'pirates',
    SD:  'padres',      SDP: 'padres',    SEA: 'mariners', SF:  'giants',
    SFG: 'giants',      STL: 'cardinals', TB:  'rays',     TBR: 'rays',
    TEX: 'rangers',     TOR: 'blue jays', WSH: 'nationals', WAS: 'nationals',
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
    SA: 'spurs', TOR: 'raptors', UTA: 'jazz', WAS: 'wizards',
    WSH: 'wizards',
  },
  nfl: {
    ARI: 'cardinals', ATL: 'falcons', BAL: 'ravens', BUF: 'bills',
    CAR: 'panthers',  CHI: 'bears',   CIN: 'bengals', CLE: 'browns',
    DAL: 'cowboys',   DEN: 'broncos', DET: 'lions',   GB: 'packers',
    GBP: 'packers',   HOU: 'texans',  IND: 'colts',   JAX: 'jaguars',
    JAC: 'jaguars',   KC: 'chiefs',   LAC: 'chargers', LAR: 'rams',
    LV: 'raiders',    LVR: 'raiders', MIA: 'dolphins', MIN: 'vikings',
    NE: 'patriots',   NEP: 'patriots', NO: 'saints', NOS: 'saints',
    NYG: 'giants',    NYJ: 'jets',    PHI: 'eagles',  PIT: 'steelers',
    SEA: 'seahawks',  SF: '49ers',    TB: 'buccaneers', TEN: 'titans',
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
  // 1. Exact match
  if (o === e) return true;
  // 2. Substring either direction (e.g. 'rays' inside 'tampa bay rays')
  if (o.length >= 3 && e.includes(o)) return true;
  if (e.length >= 3 && o.includes(e)) return true;
  // 3. Last 1-2 words overlap (e.g. '49ers' vs 'san francisco 49ers')
  const oLast = o.split(' ').slice(-2).join(' ');
  const eLast = e.split(' ').slice(-2).join(' ');
  if (oLast && eLast && (eLast.includes(oLast) || oLast.includes(eLast))) return true;
  // 4. Abbreviation lookup — 'TOR' → 'blue jays' → check inside ESPN name
  const upperOdds = String(odds).toUpperCase().trim();
  const sportMap = TEAM_ABBR[sport?.toLowerCase?.()] || {};
  const mapped = sportMap[upperOdds];
  if (mapped && e.includes(mapped)) return true;
  return false;
}

// Find ESPN game by parsing matchup string ("Yankees @ Red Sox")
async function findEspnGame(sport, matchup, gameTimeISO) {
  const path = ESPN_PATHS[sport];
  if (!path || !matchup) return null;

  const parts = matchup.split(' @ ');
  if (parts.length !== 2) return null;
  const awayTeam = parts[0].trim();
  const homeTeam = parts[1].trim();

  const date = new Date(gameTimeISO);
  const yyyymmdd = date.toISOString().slice(0, 10).replace(/-/g, '');

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
      const homeScore = parseInt(home.score || '0', 10);
      const awayScore = parseInt(away.score || '0', 10);
      return {
        id: ev.id,
        completed: ev.status?.type?.completed === true,
        homeName, awayName, homeScore, awayScore,
        homeTeamMatch: homeTeam,
        awayTeamMatch: awayTeam,
      };
    }
  }
  return null;
}

async function fetchBoxScore(sport, gameId) {
  const path = ESPN_PATHS[sport];
  if (!path) return null;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path.sport}/${path.league}/summary?event=${gameId}`;
  const res = await fetchJSON(url);
  if (res.status !== 200 || !res.data) return null;
  return res.data;
}

function getPlayerStat(boxscore, sport, propType, playerName) {
  const playersByTeam = boxscore?.boxscore?.players || [];
  const extractor = STAT_EXTRACTORS[sport]?.[propType.toLowerCase()];
  if (!extractor) return null;

  const targetName = normalize(playerName);

  for (const teamGroup of playersByTeam) {
    for (const sg of teamGroup.statistics || []) {
      const sgName = (sg.name || sg.type || 'main').toLowerCase();
      if (extractor.group !== 'main' && sgName !== extractor.group) continue;

      const keys = sg.keys || sg.labels || [];
      const keyIdx = keys.findIndex(k => k === extractor.key || normalize(k) === normalize(extractor.key));
      if (keyIdx < 0) continue;

      for (const ath of sg.athletes || []) {
        const athleteName = ath.athlete?.displayName || ath.athlete?.fullName || '';
        if (
          normalize(athleteName) !== targetName &&
          !normalize(athleteName).includes(targetName) &&
          !targetName.includes(normalize(athleteName))
        ) continue;

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

// Grade a single bet/leg given the resolved game data
function gradeBet(betType, pickSide, line, game, boxscore, propType, playerName, sport) {
  if (!game || !game.completed) return null;

  if (betType === 'ML') {
    if (game.homeScore === game.awayScore) return 'push';
    const homeWon = game.homeScore > game.awayScore;
    if (pickSide === 'home') return homeWon ? 'won' : 'lost';
    if (pickSide === 'away') return !homeWon ? 'won' : 'lost';
    return null;
  }

  if (betType === 'SPREAD') {
    if (line === null || line === undefined) return null;
    // line is the home spread. e.g. -3.5 = home favored by 3.5
    const homeAdjusted = game.homeScore + Number(line);
    const diff = homeAdjusted - game.awayScore;
    if (diff === 0) return 'push';
    if (pickSide === 'home') return diff > 0 ? 'won' : 'lost';
    if (pickSide === 'away') return diff < 0 ? 'won' : 'lost';
    return null;
  }

  if (betType === 'TOTAL') {
    if (line === null || line === undefined) return null;
    const total = game.homeScore + game.awayScore;
    if (total === Number(line)) return 'push';
    if (pickSide === 'over')  return total > Number(line) ? 'won' : 'lost';
    if (pickSide === 'under') return total < Number(line) ? 'won' : 'lost';
    return null;
  }

  if (betType === 'PROP') {
    if (!boxscore || !propType || !playerName || line === null) return null;
    const actual = getPlayerStat(boxscore, sport, propType, playerName);
    if (actual === null) return null;
    if (actual === Number(line)) return 'push';
    if (pickSide === 'over')  return actual > Number(line) ? 'won' : 'lost';
    if (pickSide === 'under') return actual < Number(line) ? 'won' : 'lost';
    return null;
  }

  return null;
}

// Settle a single bet and update bankroll atomically via the existing RPC
async function settleAndUpdateBankroll(bet, status) {
  // Compute payout: stake × decimal_odds for win, full stake back for push, 0 for loss
  let payout = 0;
  if (status === 'won') {
    payout = Math.round(bet.stake * americanToDecimal(bet.odds) * 100) / 100;
  } else if (status === 'push' || status === 'cashed') {
    payout = bet.stake;
  }

  // Mark the bet settled first
  await patchBet(bet.id, {
    status,
    payout,
    settled_at: new Date().toISOString(),
  });

  // Adjust user bankroll. We use the service role key which bypasses RLS,
  // letting us update any user's bankroll row directly. Read-then-write is
  // safe here because each bet is processed serially in the for-loop above
  // (no concurrent settlements per user within a single function run).
  const profit = payout - bet.stake;
  if (profit === 0) return; // push or 0 stake — nothing to adjust

  const profUrl = new URL(`${SUPA_URL}/rest/v1/profiles?id=eq.${bet.user_id}&select=bankroll`);
  const profRes = await new Promise((resolve) => {
    https.get({
      hostname: profUrl.hostname, path: profUrl.pathname + profUrl.search,
      headers: { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}` },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
  if (!Array.isArray(profRes) || !profRes[0]) return;

  const newBankroll = Number(profRes[0].bankroll) + profit;
  const patchUrl = new URL(`${SUPA_URL}/rest/v1/profiles?id=eq.${bet.user_id}`);
  const patchData = JSON.stringify({ bankroll: newBankroll });
  await new Promise((resolve) => {
    const req = https.request({
      hostname: patchUrl.hostname, path: patchUrl.pathname + patchUrl.search, method: 'PATCH',
      headers: {
        'apikey': SUPA_SERVICE_KEY,
        'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(patchData),
        'Prefer': 'return=minimal',
      },
    }, (res) => { res.on('data', () => {}); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', () => resolve(500));
    req.write(patchData); req.end();
  });
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (!SUPA_URL || !SUPA_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({
      error: 'Missing env vars',
      hasSupaUrl: !!SUPA_URL,
      hasSupaServiceKey: !!SUPA_SERVICE_KEY,
    }) };
  }

  // Allow GET for manual triggering and debug
  // Browser users can hit https://betz360.com/api/auto-settle-mock-bets
  // to manually run the settler and see exactly what happened to each bet.
  const isManualRun = event && (event.httpMethod === 'GET' || event.httpMethod === 'POST');

  // Pull pending mock bets where game has had time to finish (started 2+ hours ago)
  // Limit lookback to 14 days to avoid touching stale rows forever
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const url = `${SUPA_URL}/rest/v1/mock_bets?status=eq.pending&game_time=gte.${since}&game_time=lte.${cutoff}&select=*`;
  const res = await fetchJSON(url, { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}` });

  if (res.status !== 200 || !Array.isArray(res.data)) {
    return { statusCode: 500, body: JSON.stringify({ error: 'failed to fetch pending bets', status: res.status }) };
  }

  const pending = res.data;
  if (pending.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ status: 'no_pending', ts: new Date().toISOString() }) };
  }

  const results = { settled: [], stillPending: [], errors: [] };

  // Cache ESPN lookups within this run to avoid duplicate API calls
  const gameCache = {};
  const boxCache = {};

  async function getGameData(sport, matchup, gameTime) {
    const ck = `${sport}-${matchup}-${gameTime?.slice(0, 10)}`;
    if (gameCache[ck] !== undefined) return gameCache[ck];
    const data = await findEspnGame(sport, matchup, gameTime);
    gameCache[ck] = data;
    return data;
  }

  async function getBoxData(sport, gameId) {
    if (!gameId) return null;
    if (boxCache[gameId] !== undefined) return boxCache[gameId];
    const data = await fetchBoxScore(sport, gameId);
    boxCache[gameId] = data;
    return data;
  }

  for (const bet of pending) {
    try {
      let finalStatus = null;

      if (bet.bet_type === 'PARLAY') {
        // Grade each leg
        const legs = Array.isArray(bet.legs) ? bet.legs : [];
        if (legs.length === 0) {
          results.errors.push({ id: bet.id, reason: 'parlay has no legs' });
          continue;
        }
        const legResults = [];
        let allGraded = true;
        for (const leg of legs) {
          const legSport = leg.sport || bet.sport;
          const legMatchup = leg.matchup || bet.matchup;
          const legGameTime = leg.gameTime || leg.game_time || bet.game_time;
          const game = await getGameData(legSport, legMatchup, legGameTime);
          if (!game || !game.completed) { allGraded = false; break; }

          let box = null;
          if (leg.betType === 'PROP' || leg.bet_type === 'PROP') {
            box = await getBoxData(legSport, game.id);
            if (!box) { allGraded = false; break; }
          }
          const grade = gradeBet(
            leg.betType || leg.bet_type,
            leg.side || leg.pick_side,
            leg.line ?? null,
            game, box,
            leg.propType || leg.prop_type || null,
            leg.player || null,
            legSport
          );
          if (!grade) { allGraded = false; break; }
          legResults.push(grade);
        }
        if (!allGraded) {
          results.stillPending.push({ id: bet.id, reason: 'one or more legs not yet resolvable' });
          continue;
        }
        const wonCount = legResults.filter(r => r === 'won').length;
        const lostCount = legResults.filter(r => r === 'lost').length;
        const pushCount = legResults.filter(r => r === 'push').length;
        if (lostCount > 0) finalStatus = 'lost';
        else if (wonCount + pushCount === legResults.length && wonCount > 0) finalStatus = 'won';
        else finalStatus = 'push';
      } else {
        // Single-leg bet (ML / SPREAD / TOTAL / PROP)
        const game = await getGameData(bet.sport, bet.matchup, bet.game_time);
        if (!game) {
          results.stillPending.push({
            id: bet.id, matchup: bet.matchup, sport: bet.sport, gameTime: bet.game_time,
            reason: 'no ESPN game found matching this matchup',
          });
          continue;
        }
        if (!game.completed) {
          results.stillPending.push({
            id: bet.id, matchup: bet.matchup, sport: bet.sport,
            espnGameId: game.id, espnHome: game.homeName, espnAway: game.awayName,
            espnHomeScore: game.homeScore, espnAwayScore: game.awayScore,
            reason: 'game not yet complete per ESPN',
          });
          continue;
        }
        let box = null;
        if (bet.bet_type === 'PROP') {
          box = await getBoxData(bet.sport, game.id);
        }
        // Player name + prop type for props are stored in pick_label
        // pick_label format e.g. "Aaron Judge Over 1.5 Hits" — parse for player + propType
        let playerName = null, propType = null;
        if (bet.bet_type === 'PROP') {
          const m = String(bet.pick_label || '').match(/^(.+?)\s+(?:Over|Under)\s+[\d.]+\s+(.+)$/i);
          if (m) { playerName = m[1].trim(); propType = m[2].trim(); }
        }
        finalStatus = gradeBet(
          bet.bet_type, bet.pick_side, bet.line,
          game, box, propType, playerName, bet.sport,
        );
        if (!finalStatus) {
          results.stillPending.push({
            id: bet.id, betType: bet.bet_type, matchup: bet.matchup,
            pickLabel: bet.pick_label, line: bet.line, side: bet.pick_side,
            playerName, propType,
            espnHomeScore: game.homeScore, espnAwayScore: game.awayScore,
            reason: bet.bet_type === 'PROP'
              ? `couldn't find player stat (player='${playerName}' propType='${propType}')`
              : `gradeBet returned null — check side/line`,
          });
          continue;
        }
      }

      await settleAndUpdateBankroll(bet, finalStatus);
      results.settled.push({
        id: bet.id, betType: bet.bet_type, pickLabel: bet.pick_label, status: finalStatus,
      });
    } catch (e) {
      results.errors.push({ id: bet.id, error: String(e) });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...results, ts: new Date().toISOString() }),
  };
};

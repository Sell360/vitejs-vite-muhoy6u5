// ─── EDGE SIGNALS — TIMEZONE & WORKLOAD ─────────────────────────────────────
// Two edge signals for parlay scoring:
// 1. Timezone Disadvantage — visiting teams crossing 2+ tz especially east-bound
// 2. Workload Decay — fatigue from heavy recent minutes/pitches/usage

import type { GameData, WNBAGameData } from './api';

// ─── TEAM HOME CITY → TIMEZONE OFFSET (UTC) ──────────────────────────────
// Standard time offsets; daylight saving handled by adding 1 to all in-season
// All US-based teams. International (UFC) handled separately.
const TEAM_TZ: Record<string, number> = {
  // ── MLB ──
  'New York Yankees': -5, 'Boston Red Sox': -5, 'Toronto Blue Jays': -5,
  'Tampa Bay Rays': -5, 'Baltimore Orioles': -5, 'Philadelphia Phillies': -5,
  'New York Mets': -5, 'Washington Nationals': -5, 'Atlanta Braves': -5,
  'Miami Marlins': -5, 'Pittsburgh Pirates': -5, 'Cincinnati Reds': -5,
  'Detroit Tigers': -5, 'Cleveland Guardians': -5, 'Cleveland Indians': -5,
  'Chicago Cubs': -6, 'Chicago White Sox': -6, 'Milwaukee Brewers': -6,
  'St. Louis Cardinals': -6, 'Kansas City Royals': -6, 'Minnesota Twins': -6,
  'Houston Astros': -6, 'Texas Rangers': -6, 'Colorado Rockies': -7,
  'Arizona Diamondbacks': -7, 'San Francisco Giants': -8, 'Oakland Athletics': -8,
  'Los Angeles Dodgers': -8, 'Los Angeles Angels': -8, 'San Diego Padres': -8,
  'Seattle Mariners': -8,

  // ── NBA ──
  'Boston Celtics': -5, 'Brooklyn Nets': -5, 'New York Knicks': -5,
  'Philadelphia 76ers': -5, 'Toronto Raptors': -5, 'Atlanta Hawks': -5,
  'Charlotte Hornets': -5, 'Miami Heat': -5, 'Orlando Magic': -5,
  'Washington Wizards': -5, 'Detroit Pistons': -5, 'Indiana Pacers': -5,
  'Cleveland Cavaliers': -5, 'Chicago Bulls': -6, 'Milwaukee Bucks': -6,
  'Memphis Grizzlies': -6, 'New Orleans Pelicans': -6, 'San Antonio Spurs': -6,
  'Houston Rockets': -6, 'Dallas Mavericks': -6, 'Oklahoma City Thunder': -6,
  'Minnesota Timberwolves': -6, 'Denver Nuggets': -7, 'Utah Jazz': -7,
  'Phoenix Suns': -7, 'Portland Trail Blazers': -8, 'Sacramento Kings': -8,
  'Golden State Warriors': -8, 'Los Angeles Lakers': -8, 'Los Angeles Clippers': -8,

  // ── NFL ──
  'Buffalo Bills': -5, 'Miami Dolphins': -5, 'New England Patriots': -5,
  'New York Jets': -5, 'Baltimore Ravens': -5, 'Cincinnati Bengals': -5,
  'Pittsburgh Steelers': -5, 'Houston Texans': -6, 'Indianapolis Colts': -5,
  'Jacksonville Jaguars': -5, 'Tennessee Titans': -6, 'Denver Broncos': -7,
  'Kansas City Chiefs': -6, 'Las Vegas Raiders': -8, 'Los Angeles Chargers': -8,
  'Dallas Cowboys': -6, 'New York Giants': -5, 'Philadelphia Eagles': -5,
  'Washington Commanders': -5, 'Chicago Bears': -6, 'Detroit Lions': -5,
  'Green Bay Packers': -6, 'Minnesota Vikings': -6, 'Atlanta Falcons': -5,
  'Carolina Panthers': -5, 'New Orleans Saints': -6, 'Tampa Bay Buccaneers': -5,
  'Arizona Cardinals': -7, 'Los Angeles Rams': -8, 'San Francisco 49ers': -8,
  'Seattle Seahawks': -8, 'Cleveland Browns': -5,

  // ── NHL ──
  'Boston Bruins': -5, 'Buffalo Sabres': -5, 'Montreal Canadiens': -5,
  'Ottawa Senators': -5, 'Florida Panthers': -5, 'Tampa Bay Lightning': -5,
  'Toronto Maple Leafs': -5, 'Detroit Red Wings': -5, 'New Jersey Devils': -5,
  'New York Islanders': -5, 'New York Rangers': -5, 'Philadelphia Flyers': -5,
  'Pittsburgh Penguins': -5, 'Carolina Hurricanes': -5, 'Columbus Blue Jackets': -5,
  'Washington Capitals': -5, 'Chicago Blackhawks': -6, 'Nashville Predators': -6,
  'St. Louis Blues': -6, 'Dallas Stars': -6, 'Minnesota Wild': -6,
  'Winnipeg Jets': -6, 'Colorado Avalanche': -7, 'Utah Hockey Club': -7,
  'Calgary Flames': -7, 'Edmonton Oilers': -7, 'Vancouver Canucks': -8,
  'Vegas Golden Knights': -8, 'Anaheim Ducks': -8, 'Los Angeles Kings': -8,
  'San Jose Sharks': -8, 'Seattle Kraken': -8,

  // ── WNBA ──
  'New York Liberty': -5, 'Connecticut Sun': -5, 'Atlanta Dream': -5,
  'Washington Mystics': -5, 'Indiana Fever': -5, 'Chicago Sky': -6,
  'Minnesota Lynx': -6, 'Dallas Wings': -6, 'Las Vegas Aces': -8,
  'Phoenix Mercury': -7, 'Los Angeles Sparks': -8, 'Seattle Storm': -8,
  'Golden State Valkyries': -8,
};

export interface TimezoneEdge {
  hasEdge: boolean;
  awayDelta: number;       // hours visiting team has shifted (negative = west, positive = east)
  direction: 'east' | 'west' | 'none';
  severity: 'mild' | 'moderate' | 'severe';
  homeFavored: boolean;    // true if home team has the timezone advantage
  flag: string;            // short flag e.g. "✈️ EAST 3hr"
  reason: string;          // e.g. "Lakers traveling east 3 hours, ~58% loss rate"
}

// ─── 1. TIMEZONE DISADVANTAGE DETECTOR ──────────────────────────────────────
// Studies show:
//   2hr east travel: ~3% extra home win edge
//   3hr east travel: ~5% extra home win edge (especially night games)
//   Westbound travel is much milder (~1-2%)
//   Direction matters: jet lag is harder going east (body must speed up clock)

export function getTimezoneEdge(
  awayTeam: string,
  homeTeam: string,
  startTime: string
): TimezoneEdge {
  const awayTz = TEAM_TZ[awayTeam];
  const homeTz = TEAM_TZ[homeTeam];

  if (awayTz === undefined || homeTz === undefined) {
    return { hasEdge: false, awayDelta: 0, direction: 'none', severity: 'mild', homeFavored: false, flag: '', reason: '' };
  }

  // delta = hours the visiting team's body clock differs from local game time
  // Negative = west of home (their body thinks it's earlier — easier)
  // Positive = east of home (their body thinks it's later — harder)
  const delta = awayTz - homeTz;
  const absDelta = Math.abs(delta);

  if (absDelta < 2) {
    return { hasEdge: false, awayDelta: delta, direction: 'none', severity: 'mild', homeFavored: false, flag: '', reason: '' };
  }

  // Eastbound travel for visitor (their home tz is EAST of host's tz, so delta > 0)
  // Means host is WEST of visitor → visitor is traveling WEST to play
  // Westbound travel = delta > 0 (visitor home east, traveling west)
  // Eastbound travel = delta < 0 (visitor home west, traveling east — HARDEST)
  const direction: 'east' | 'west' = delta < 0 ? 'east' : 'west';

  // Eastbound is harder — body has to compress its clock
  // Severity scale:
  //   East 2hr: moderate edge, ~3%
  //   East 3hr: severe edge, ~5-6%
  //   West 2hr: mild
  //   West 3hr: moderate, ~3%
  let severity: 'mild' | 'moderate' | 'severe' = 'mild';
  if (direction === 'east') {
    severity = absDelta >= 3 ? 'severe' : 'moderate';
  } else {
    severity = absDelta >= 3 ? 'moderate' : 'mild';
  }

  if (severity === 'mild') {
    return { hasEdge: false, awayDelta: delta, direction, severity, homeFavored: false, flag: '', reason: '' };
  }

  // Night game (after 7pm local) is worse for jet lag — circadian impact peaks evening
  const gameDate = new Date(startTime);
  const localHour = gameDate.getHours();
  const isNight = localHour >= 19 || localHour < 6;

  let flag = '';
  let reason = '';
  if (direction === 'east') {
    flag = `✈️ EAST ${absDelta}hr${isNight ? ' NIGHT' : ''}`;
    reason = `${awayTeam.split(' ').pop()} traveling east ${absDelta} hours${isNight ? ' for night game' : ''} — body clock disadvantage`;
  } else {
    flag = `✈️ WEST ${absDelta}hr`;
    reason = `${awayTeam.split(' ').pop()} traveling west ${absDelta} hours — mild circadian edge for home`;
  }

  return {
    hasEdge: true,
    awayDelta: delta,
    direction,
    severity,
    homeFavored: true,
    flag,
    reason,
  };
}

// ─── 2. WORKLOAD DECAY INDEX ─────────────────────────────────────────────────
// We don't have player game logs in our current API. What we DO have:
//  - Game schedule (we can detect back-to-backs from games array)
//  - Sport context
// For a real workload index we'd need player-level minutes/pitches data.
// For now we can detect:
//  - B2B for NBA/NHL teams (easy — check if either team played yesterday)
//  - 3-in-4 nights stretches (NBA)
//  - Short-rest pitchers (would need MLB game logs API)

export interface WorkloadEdge {
  hasEdge: boolean;
  type: 'b2b' | '3in4' | 'rest_advantage' | 'none';
  affectedTeam: 'home' | 'away' | 'both' | 'none';
  severity: 'mild' | 'moderate' | 'severe';
  flag: string;
  reason: string;
}

// Build a team→last_played map from a games array (current-day games)
// Note: ideally we'd query previous day games but for now we work with what we have.
// Returns {} when no historical context available.
export function buildScheduleContext(
  _games: (GameData | WNBAGameData)[]
): Record<string, Date> {
  // Placeholder — would need yesterday's schedule API call
  // Returns empty so detectWorkloadEdge falls back to safer "none" signals
  return {};
}

export function detectWorkloadEdge(
  awayTeam: string,
  homeTeam: string,
  sport: string,
  scheduleContext: Record<string, Date>,
  startTime: string
): WorkloadEdge {
  // Only meaningful for sports with frequent games
  if (!['nba', 'nhl', 'wnba'].includes(sport)) {
    return { hasEdge: false, type: 'none', affectedTeam: 'none', severity: 'mild', flag: '', reason: '' };
  }

  const gameTime = new Date(startTime).getTime();
  const HOURS = 60 * 60 * 1000;

  const awayLast = scheduleContext[awayTeam]?.getTime();
  const homeLast = scheduleContext[homeTeam]?.getTime();

  const awayB2B = awayLast && (gameTime - awayLast) < 30 * HOURS;
  const homeB2B = homeLast && (gameTime - homeLast) < 30 * HOURS;

  if (awayB2B && !homeB2B) {
    return {
      hasEdge: true, type: 'b2b', affectedTeam: 'away', severity: 'moderate',
      flag: '😴 B2B AWAY',
      reason: `${awayTeam.split(' ').pop()} on back-to-back, home rested — fade road team props`,
    };
  }
  if (homeB2B && !awayB2B) {
    return {
      hasEdge: true, type: 'b2b', affectedTeam: 'home', severity: 'moderate',
      flag: '😴 B2B HOME',
      reason: `${homeTeam.split(' ').pop()} on back-to-back, away rested — fade home team props`,
    };
  }
  if (awayB2B && homeB2B) {
    return {
      hasEdge: true, type: 'b2b', affectedTeam: 'both', severity: 'mild',
      flag: '😴 B2B BOTH',
      reason: 'Both teams on B2B — fade scoring totals',
    };
  }

  // Rest advantage (3+ days off vs 1 day off)
  if (awayLast && homeLast) {
    const awayRest = (gameTime - awayLast) / (24 * HOURS);
    const homeRest = (gameTime - homeLast) / (24 * HOURS);
    const restGap = Math.abs(awayRest - homeRest);
    if (restGap >= 2) {
      const rested = awayRest > homeRest ? 'away' : 'home';
      const team = rested === 'away' ? awayTeam : homeTeam;
      return {
        hasEdge: true, type: 'rest_advantage', affectedTeam: rested, severity: 'mild',
        flag: `💪 ${rested === 'away' ? 'AWAY' : 'HOME'} RESTED`,
        reason: `${team.split(' ').pop()} has ${restGap.toFixed(0)}+ day rest advantage`,
      };
    }
  }

  return { hasEdge: false, type: 'none', affectedTeam: 'none', severity: 'mild', flag: '', reason: '' };
}

// ─── COMBINED EDGE SCORE ADJUSTMENT ──────────────────────────────────────────
// Returns confidence delta + flags for use in scoreLeg
export interface EdgeContext {
  timezone: TimezoneEdge;
  workload: WorkloadEdge;
}

export function getEdgeContext(
  awayTeam: string,
  homeTeam: string,
  sport: string,
  startTime: string,
  scheduleContext: Record<string, Date> = {}
): EdgeContext {
  return {
    timezone: getTimezoneEdge(awayTeam, homeTeam, startTime),
    workload: detectWorkloadEdge(awayTeam, homeTeam, sport, scheduleContext, startTime),
  };
}

// Apply edge context to a prop pick's confidence
// pickTeam: the team whose props are being scored (or null for game lines)
// pickSide: 'home' | 'away' for moneyline/spread, null for player props
export function applyEdgeContext(
  ctx: EdgeContext,
  propTeam: string,
  homeTeam: string,
  pick: 'over' | 'under',
  propType: string
): { delta: number; flags: string[] } {
  const flags: string[] = [];
  let delta = 0;

  const isHome = propTeam === homeTeam;
  const isAway = !isHome && propTeam.length > 0;

  // ── Timezone effect ──
  if (ctx.timezone.hasEdge) {
    const sevMult = ctx.timezone.severity === 'severe' ? 8 : ctx.timezone.severity === 'moderate' ? 5 : 2;

    // For player props: away player props go DOWN if away team is jet-lagged
    if (isAway) {
      if (pick === 'over') {
        delta -= sevMult;
        flags.push(ctx.timezone.flag);
      } else {
        delta += Math.round(sevMult * 0.6);
      }
    }
    if (isHome && pick === 'over') {
      delta += Math.round(sevMult * 0.4);
      flags.push(ctx.timezone.flag);
    }

    // For game totals: away team disadvantage suggests UNDER
    if (propType === 'Game Total' && pick === 'under') {
      delta += Math.round(sevMult * 0.5);
      if (!flags.includes(ctx.timezone.flag)) flags.push(ctx.timezone.flag);
    }
  }

  // ── Workload effect ──
  if (ctx.workload.hasEdge && ctx.workload.type === 'b2b') {
    const tired = ctx.workload.affectedTeam;
    const sevMult = ctx.workload.severity === 'severe' ? 7 : ctx.workload.severity === 'moderate' ? 5 : 3;

    if (tired === 'away' && isAway && pick === 'over') {
      delta -= sevMult;
      flags.push(ctx.workload.flag);
    }
    if (tired === 'home' && isHome && pick === 'over') {
      delta -= sevMult;
      flags.push(ctx.workload.flag);
    }
    if (tired === 'both' && propType === 'Game Total' && pick === 'under') {
      delta += sevMult;
      flags.push(ctx.workload.flag);
    }
  }

  return { delta, flags };
}

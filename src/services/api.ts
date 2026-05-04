// All API calls made directly from browser — no proxy needed
// ESPN: free, no key | The Odds API: CORS-enabled, uses your key | Kalshi: free public API

export type Sport = 'mlb' | 'wnba' | 'nba' | 'nfl' | 'nhl' | 'ufc';

export interface GameData {
  id: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  weather?: { temperature: number; windSpeed: number; conditions: string; };
  umpire?: { name: string; strikeZoneTendency: 'tight' | 'wide' | 'normal'; };
  venue: string;
  status: 'scheduled' | 'live' | 'final';
  homeScore?: number;
  awayScore?: number;
  inning?: string;
}

export interface PlayerProp {
  id: string;
  playerId: string;
  playerName: string;
  team: string;
  propType: string;
  line: number;
  overOdds: number;
  underOdds: number;
  gameId: string;
  vendor?: string;
  homeTeam?: string;
  awayTeam?: string;
  startTime?: string;
  injured?: boolean;
  kalshiEdge?: { kalshiProb: number; bookProb: number; divergence: number; favors: string; } | null;
  impliedProb?: { over: number; under: number; vig: number; } | null;
  sharpFlag?: boolean;
}

export interface WNBAGameData {
  id: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  referee?: { name: string; foulTendency: 'strict' | 'lenient' | 'normal'; };
  venue: string;
  status: 'scheduled' | 'live' | 'final';
  pace?: number;
  homeScore?: number;
  awayScore?: number;
}

const ESPN    = 'https://site.api.espn.com/apis/site/v2/sports';
const ODDS    = 'https://api.the-odds-api.com/v4';
const KALSHI  = 'https://api.elections.kalshi.com/trade-api/v2';
const ODDS_KEY = import.meta.env.VITE_ODDS_API_KEY || 'cb3a34037735e0ceb317b24195526606';
const WX_KEY   = import.meta.env.VITE_WEATHER_API_KEY || '';

const ESPN_PATHS: Record<Sport, string> = {
  mlb:  'baseball/mlb',
  wnba: 'basketball/wnba',
  nba:  'basketball/nba',
  nfl:  'football/nfl',
  nhl:  'hockey/nhl',
  ufc:  'mma/ufc',
};

const ODDS_SPORTS: Record<Sport, string> = {
  mlb:  'baseball_mlb',
  wnba: 'basketball_wnba',
  nba:  'basketball_nba',
  nfl:  'americanfootball_nfl',
  nhl:  'icehockey_nhl',
  ufc:  'mma_mixed_martial_arts',
};

const PROP_MARKETS: Record<Sport, string> = {
  mlb:  'batter_hits,batter_total_bases,pitcher_strikeouts,batter_rbis,batter_home_runs,batter_walks',
  wnba: 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists',
  nba:  'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists,player_steals,player_blocks',
  nfl:  'player_pass_yds,player_rush_yds,player_reception_yds,player_receptions,player_pass_tds,player_rush_attempts',
  nhl:  'player_shots_on_goal,player_saves,player_points,player_goals,player_assists',
  ufc:  'player_method_of_victory,player_total_rounds',
};

const PROP_LABELS: Record<string, string> = {
  batter_hits: 'Hits', batter_total_bases: 'Total Bases', pitcher_strikeouts: 'Strikeouts',
  batter_rbis: 'RBIs', batter_home_runs: 'Home Runs', batter_walks: 'Walks',
  player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
  player_threes: '3-Pointers', player_points_rebounds_assists: 'Pts+Reb+Ast',
  player_steals: 'Steals', player_blocks: 'Blocks',
  player_pass_yds: 'Pass Yards', player_rush_yds: 'Rush Yards',
  player_reception_yds: 'Rec Yards', player_receptions: 'Receptions',
  player_pass_tds: 'Pass TDs', player_rush_attempts: 'Rush Attempts',
  player_shots_on_goal: 'Shots on Goal', player_saves: 'Saves',
  player_goals: 'Goals', player_method_of_victory: 'Method of Victory',
  player_total_rounds: 'Total Rounds',
};

// Session cache
const cache: Record<string, { data: PlayerProp[]; ts: number }> = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 min

class ApiService {

  // ─── GAMES ──────────────────────────────────────────────────────────────

  async getGames(sport: Sport, date: string): Promise<(GameData | WNBAGameData)[]> {
    const path = ESPN_PATHS[sport];
    if (!path) return [];
    try {
      const d = date.replace(/-/g, '');
      const res = await fetch(`${ESPN}/${path}/scoreboard?dates=${d}&limit=20`);
      if (!res.ok) throw new Error(`ESPN ${res.status}`);
      const data = await res.json();
      const games = this.transformESPN(data.events || []);
      if (sport === 'mlb') {
        return Promise.all(games.map(async g => {
          const wx = await this.getWeather(g.venue);
          return wx ? { ...g, weather: wx } : g;
        }));
      }
      return games;
    } catch (err) {
      console.warn(`${sport} games failed:`, err);
      return [];
    }
  }

  async getMLBGames(date: string) { return this.getGames('mlb', date) as Promise<GameData[]>; }
  async getWNBAGames(date: string) { return this.getGames('wnba', date) as Promise<WNBAGameData[]>; }

  // ─── ALL PROPS (called at startup for all scheduled games) ───────────────

  async getAllProps(sport: Sport): Promise<PlayerProp[]> {
    const cacheKey = `props-${sport}`;
    const cached = cache[cacheKey];
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

    try {
      const oddsSport = ODDS_SPORTS[sport];

      // Step 1: get today's events from Odds API
      const evRes = await fetch(`${ODDS}/${oddsSport}/events?apiKey=${ODDS_KEY}`);
      if (!evRes.ok) throw new Error(`Odds API events ${evRes.status}`);
      const events: any[] = await evRes.json();

      const active = events.filter(e => {
        const start = new Date(e.commence_time).getTime();
        return start > Date.now() - 3 * 60 * 60 * 1000;
      });

      if (active.length === 0) return [];

      // Step 2: fetch injuries + Kalshi in parallel
      const [injuries, kalshi] = await Promise.all([
        this.fetchInjuries(sport),
        this.fetchKalshi(sport),
      ]);
      const injuredSet = new Set(injuries.map((n: string) => n.toLowerCase()));

      // Step 3: fetch props for each event
      const propResults = await Promise.allSettled(
        active.map(e =>
          fetch(`${ODDS}/${oddsSport}/events/${e.id}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${PROP_MARKETS[sport]}&oddsFormat=american`)
            .then(r => r.ok ? r.json() : null)
        )
      );

      const allProps: PlayerProp[] = [];

      propResults.forEach((result, i) => {
        if (result.status !== 'fulfilled' || !result.value) return;
        const data = result.value;
        const ev = active[i];

        const bookmaker = data.bookmakers?.find((b: any) => b.key === 'draftkings')
          || data.bookmakers?.find((b: any) => b.key === 'fanduel')
          || data.bookmakers?.find((b: any) => b.key === 'betmgm')
          || data.bookmakers?.[0];
        if (!bookmaker) return;

        bookmaker.markets?.forEach((market: any) => {
          const propLabel = PROP_LABELS[market.key] || market.key.replace(/_/g, ' ');
          const playerMap = new Map<string, PlayerProp>();

          market.outcomes?.forEach((outcome: any) => {
            const name = outcome.description;
            if (!name) return;

            if (!playerMap.has(name)) {
              playerMap.set(name, {
                id: `${ev.id}-${market.key}-${name}`,
                playerId: '',
                playerName: name,
                team: outcome.team || '',
                propType: propLabel,
                line: outcome.point ?? 0,
                overOdds: -110,
                underOdds: -110,
                gameId: ev.id,
                vendor: bookmaker.key,
                homeTeam: ev.home_team,
                awayTeam: ev.away_team,
                startTime: ev.commence_time,
                injured: injuredSet.has(name.toLowerCase()),
                kalshiEdge: null,
                impliedProb: null,
                sharpFlag: false,
              });
            }

            const p = playerMap.get(name)!;
            if (outcome.name === 'Over') { p.overOdds = outcome.price; p.line = outcome.point ?? p.line; }
            if (outcome.name === 'Under') p.underOdds = outcome.price;
          });

          playerMap.forEach(p => {
            if (!p.playerName) return;

            // Implied probability
            const ovDec = p.overOdds > 0 ? p.overOdds / 100 + 1 : 100 / Math.abs(p.overOdds) + 1;
            const unDec = p.underOdds > 0 ? p.underOdds / 100 + 1 : 100 / Math.abs(p.underOdds) + 1;
            p.impliedProb = {
              over: Math.round((1 / ovDec) * 100),
              under: Math.round((1 / unDec) * 100),
              vig: Math.round(((1 / ovDec) + (1 / unDec) - 1) * 100),
            };

            // Kalshi divergence
            const kKey = `${p.playerName} ${p.propType}`.toLowerCase().replace(/\s+/g, ' ');
            const kProb = kalshi[kKey];
            if (kProb && p.impliedProb) {
              const div = Math.abs(kProb - p.impliedProb.over);
              if (div >= 3) {
                p.kalshiEdge = { kalshiProb: kProb, bookProb: p.impliedProb.over, divergence: div, favors: kProb > p.impliedProb.over ? 'over' : 'under' };
                p.sharpFlag = true;
              }
            }

            allProps.push(p);
          });
        });
      });

      cache[cacheKey] = { data: allProps, ts: Date.now() };
      return allProps;

    } catch (err) {
      console.warn(`Props failed for ${sport}:`, err);
      return [];
    }
  }

  async getAllMLBProps(_games: GameData[]) { return this.getAllProps('mlb'); }
  async getAllWNBAProps(_games: WNBAGameData[]) { return this.getAllProps('wnba'); }
  async getMLBPlayerProps(_id: string) { return this.getAllProps('mlb'); }
  async getWNBAPlayerProps(_id: string) { return this.getAllProps('wnba'); }

  // ─── INJURIES from ESPN ─────────────────────────────────────────────────

  private async fetchInjuries(sport: Sport): Promise<string[]> {
    const path = ESPN_PATHS[sport];
    if (!path) return [];
    try {
      const res = await fetch(`${ESPN}/${path}/injuries`);
      if (!res.ok) return [];
      const data = await res.json();
      const injured: string[] = [];
      (data.injuries || []).forEach((team: any) => {
        (team.injuries || []).forEach((inj: any) => {
          const status = (inj.status || '').toLowerCase();
          if (status.includes('out') || status.includes('doubtful')) {
            const name = inj.athlete?.displayName || inj.athlete?.fullName || '';
            if (name) injured.push(name);
          }
        });
      });
      return injured;
    } catch { return []; }
  }

  // ─── KALSHI public API — free, no key ───────────────────────────────────

  private async fetchKalshi(sport: Sport): Promise<Record<string, number>> {
    const tags: Record<Sport, string> = {
      mlb: 'MLB', nba: 'NBA', nfl: 'NFL', nhl: 'NHL', wnba: 'WNBA', ufc: 'MMA'
    };
    const tag = tags[sport];
    try {
      const res = await fetch(`${KALSHI}/markets?status=open&series_ticker=${tag}&limit=200`);
      if (!res.ok) return {};
      const data = await res.json();
      const result: Record<string, number> = {};
      (data.markets || []).forEach((m: any) => {
        if (!m.title) return;
        const yesPrice = m.yes_bid || m.last_price || 0;
        if (yesPrice > 0) result[m.title.toLowerCase()] = Math.round(yesPrice * 100);
      });
      return result;
    } catch { return {}; }
  }

  // ─── ESPN TRANSFORMS ─────────────────────────────────────────────────────

  private transformESPN(events: any[]): GameData[] {
    return events.map(event => {
      const comp = event.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');
      return {
        id: event.id,
        homeTeam: home?.team?.abbreviation || home?.team?.shortDisplayName || 'TBD',
        awayTeam: away?.team?.abbreviation || away?.team?.shortDisplayName || 'TBD',
        startTime: event.date || new Date().toISOString(),
        venue: comp?.venue?.fullName || '',
        status: this.mapStatus(event.status?.type?.name || ''),
        homeScore: home?.score ? parseInt(home.score) : undefined,
        awayScore: away?.score ? parseInt(away.score) : undefined,
        inning: event.status?.type?.shortDetail || undefined,
      };
    });
  }

  private mapStatus(s: string): 'scheduled' | 'live' | 'final' {
    if (s.includes('FINAL') || s.includes('COMPLETE')) return 'final';
    if (s.includes('IN_PROGRESS') || s.includes('HALFTIME') || s.includes('PROGRESS')) return 'live';
    return 'scheduled';
  }

  async getWeather(venue: string): Promise<GameData['weather'] | null> {
    if (!WX_KEY || !venue) return null;
    try {
      const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(venue)}&appid=${WX_KEY}&units=imperial`);
      if (!res.ok) return null;
      const d = await res.json();
      return { temperature: Math.round(d.main?.temp ?? 72), windSpeed: Math.round(d.wind?.speed ?? 5), conditions: d.weather?.[0]?.description ?? 'Clear' };
    } catch { return null; }
  }
}

export const apiService = new ApiService();

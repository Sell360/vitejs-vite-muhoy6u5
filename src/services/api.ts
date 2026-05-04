// 100% free, no API keys needed
// Games + Odds: ESPN hidden API (sports.core.api.espn.com) — free, no key
// Player Props: PrizePicks public API — free, no key  
// Injuries: ESPN — free, no key
// Weather: OpenWeatherMap — free key already in env

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
  espnOdds?: { homeML: number; awayML: number; total: number; provider: string; };
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
  impliedProb?: { over: number; under: number; vig: number; } | null;
  sharpFlag?: boolean;
  kalshiEdge?: { kalshiProb: number; bookProb: number; divergence: number; favors: string; } | null;
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

const ESPN_SITE  = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_CORE  = 'https://sports.core.api.espn.com/v2/sports';
const PRIZEPICKS = 'https://api.prizepicks.com';
const WX_KEY     = import.meta.env.VITE_WEATHER_API_KEY || '';

const ESPN_SPORT_PATHS: Record<Sport, { site: string; core: string }> = {
  mlb:  { site: 'baseball/mlb',        core: 'baseball/leagues/mlb' },
  wnba: { site: 'basketball/wnba',      core: 'basketball/leagues/wnba' },
  nba:  { site: 'basketball/nba',       core: 'basketball/leagues/nba' },
  nfl:  { site: 'football/nfl',         core: 'football/leagues/nfl' },
  nhl:  { site: 'hockey/nhl',           core: 'hockey/leagues/nhl' },
  ufc:  { site: 'mma/ufc',              core: 'mma/leagues/ufc' },
};

// PrizePicks league IDs
const PP_LEAGUES: Record<Sport, string> = {
  mlb:  'MLB',
  wnba: 'WNBA',
  nba:  'NBA',
  nfl:  'NFL',
  nhl:  'NHL',
  ufc:  'UFC',
};

const cache: Record<string, { data: any; ts: number }> = {};
const CACHE_TTL = 8 * 60 * 1000;

class ApiService {

  // ─── GAMES ──────────────────────────────────────────────────────────────

  async getGames(sport: Sport, date: string): Promise<(GameData | WNBAGameData)[]> {
    const path = ESPN_SPORT_PATHS[sport];
    if (!path) return [];
    try {
      const d = date.replace(/-/g, '');
      const res = await fetch(`${ESPN_SITE}/${path.site}/scoreboard?dates=${d}&limit=20`);
      if (!res.ok) throw new Error(`ESPN scoreboard ${res.status}`);
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

  async getMLBGames(date: string)  { return this.getGames('mlb', date) as Promise<GameData[]>; }
  async getWNBAGames(date: string) { return this.getGames('wnba', date) as Promise<WNBAGameData[]>; }

  // ─── PROPS via PrizePicks (free, no key) ────────────────────────────────

  async getAllProps(sport: Sport): Promise<PlayerProp[]> {
    const ck = `props-${sport}`;
    const cached = cache[ck];
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

    try {
      const league = PP_LEAGUES[sport];
      
      // PrizePicks public projections endpoint
      const res = await fetch(
        `${PRIZEPICKS}/projections?league_id=${league}&per_page=250&single_stat=true`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (!res.ok) throw new Error(`PrizePicks ${res.status}`);
      const data = await res.json();

      // Fetch injuries in parallel
      const injuries = await this.fetchInjuries(sport);
      const injuredSet = new Set(injuries.map((n: string) => n.toLowerCase()));

      const props = this.transformPrizePicks(data, sport, injuredSet);
      cache[ck] = { data: props, ts: Date.now() };
      return props;

    } catch (err) {
      console.warn(`PrizePicks props failed for ${sport}:`, err);
      return [];
    }
  }

  async getAllMLBProps(_games: GameData[])    { return this.getAllProps('mlb'); }
  async getAllWNBAProps(_games: WNBAGameData[]) { return this.getAllProps('wnba'); }
  async getMLBPlayerProps(_id: string)        { return this.getAllProps('mlb'); }
  async getWNBAPlayerProps(_id: string)       { return this.getAllProps('wnba'); }

  // ─── PRIZEPICKS TRANSFORM ───────────────────────────────────────────────

  private transformPrizePicks(data: any, _sport: Sport, injuredSet: Set<string>): PlayerProp[] {
    const props: PlayerProp[] = [];
    const projections = data.data || [];
    const included = data.included || [];

    // Build player lookup from included
    const players: Record<string, any> = {};
    const teams: Record<string, any> = {};
    included.forEach((item: any) => {
      if (item.type === 'new_player') players[item.id] = item.attributes;
      if (item.type === 'league') teams[item.id] = item.attributes;
    });

    projections.forEach((proj: any) => {
      const attr = proj.attributes;
      if (!attr) return;

      const playerRel = proj.relationships?.new_player?.data;
      const player = playerRel ? players[playerRel.id] : null;
      const playerName = player?.display_name || attr.description || '';
      if (!playerName) return;

      const propType = attr.stat_type || '';
      const line = parseFloat(attr.line_score) || 0;
      if (!propType || line === 0) return;

      // PrizePicks doesn't have odds — use standard -110/-110 as base
      // We enrich with implied prob from the line itself
      const overOdds = -110;
      const underOdds = -110;

      props.push({
        id: proj.id || `pp-${playerName}-${propType}`,
        playerId: playerRel?.id || '',
        playerName,
        team: player?.team || attr.team || '',
        propType,
        line,
        overOdds,
        underOdds,
        gameId: attr.game_id || proj.id,
        vendor: 'prizepicks',
        homeTeam: attr.home_team || '',
        awayTeam: attr.away_team || '',
        startTime: attr.start_time || '',
        injured: injuredSet.has(playerName.toLowerCase()),
        impliedProb: { over: 50, under: 50, vig: 10 },
        sharpFlag: false,
        kalshiEdge: null,
      });
    });

    return props;
  }

  // ─── ESPN GAME ODDS (free hidden API) ───────────────────────────────────

  async getESPNOddsForGame(sport: Sport, eventId: string): Promise<GameData['espnOdds'] | null> {
    try {
      const path = ESPN_SPORT_PATHS[sport].core;
      const res = await fetch(`${ESPN_CORE}/${path}/events/${eventId}/competitions/${eventId}/odds`);
      if (!res.ok) return null;
      const data = await res.json();
      const items = data.items || [];
      const dk = items.find((i: any) => i.provider?.name?.toLowerCase().includes('draftkings')) || items[0];
      if (!dk) return null;
      return {
        homeML: dk.homeTeamOdds?.moneyLine || 0,
        awayML: dk.awayTeamOdds?.moneyLine || 0,
        total: dk.overUnder || 0,
        provider: dk.provider?.name || 'ESPN',
      };
    } catch { return null; }
  }

  // ─── INJURIES ───────────────────────────────────────────────────────────

  private async fetchInjuries(sport: Sport): Promise<string[]> {
    const path = ESPN_SPORT_PATHS[sport]?.site;
    if (!path) return [];
    try {
      const res = await fetch(`${ESPN_SITE}/${path}/injuries`);
      if (!res.ok) return [];
      const data = await res.json();
      const injured: string[] = [];
      (data.injuries || []).forEach((team: any) => {
        (team.injuries || []).forEach((inj: any) => {
          const status = (inj.status || '').toLowerCase();
          if (status.includes('out') || status.includes('doubtful')) {
            const name = inj.athlete?.displayName || '';
            if (name) injured.push(name);
          }
        });
      });
      return injured;
    } catch { return []; }
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

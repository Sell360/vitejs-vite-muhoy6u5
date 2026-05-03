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

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const WX_KEY = import.meta.env.VITE_WEATHER_API_KEY || '';
const PROP_LABEL_MAP: Record<string, string> = {
  batter_hits: 'Hits',
  batter_total_bases: 'Total Bases',
  pitcher_strikeouts: 'Strikeouts',
  batter_rbis: 'RBIs',
  batter_home_runs: 'Home Runs',
  batter_walks: 'Walks',
  player_points: 'Points',
  player_rebounds: 'Rebounds',
  player_assists: 'Assists',
  player_threes: '3-Pointers',
  player_points_rebounds_assists: 'Pts+Reb+Ast',
};

class ApiService {

  async getMLBGames(date: string): Promise<GameData[]> {
    const d = date.replace(/-/g, '');
    const res = await fetch(`${ESPN}/baseball/mlb/scoreboard?dates=${d}&limit=20`);
    if (!res.ok) throw new Error(`ESPN MLB ${res.status}`);
    const data = await res.json();
    const games = this.transformESPNMLB(data.events || []);
    if (games.length === 0) throw new Error('No MLB games today');
    const enriched = await Promise.all(games.map(async g => {
      if (!g.venue) return g;
      const wx = await this.getWeather(g.venue);
      return wx ? { ...g, weather: wx } : g;
    }));
    return enriched;
  }

  async getWNBAGames(date: string): Promise<WNBAGameData[]> {
    const d = date.replace(/-/g, '');
    const res = await fetch(`${ESPN}/basketball/wnba/scoreboard?dates=${d}&limit=20`);
    if (!res.ok) throw new Error(`ESPN WNBA ${res.status}`);
    const data = await res.json();
    const games = this.transformESPNWNBA(data.events || []);
    if (games.length === 0) throw new Error('No WNBA games today');
    return games;
  }

  async getAllMLBProps(_games: GameData[]): Promise<PlayerProp[]> {
    return this.fetchPropsFromFunction('mlb');
  }

  async getAllWNBAProps(_games: WNBAGameData[]): Promise<PlayerProp[]> {
    return this.fetchPropsFromFunction('wnba');
  }

  async getMLBPlayerProps(_gameId: string): Promise<PlayerProp[]> {
    return this.fetchPropsFromFunction('mlb');
  }

  async getWNBAPlayerProps(_gameId: string): Promise<PlayerProp[]> {
    return this.fetchPropsFromFunction('wnba');
  }

  private async fetchPropsFromFunction(sport: 'mlb' | 'wnba'): Promise<PlayerProp[]> {
    const res = await fetch(`/api/props?sport=${sport}`);
    if (!res.ok) throw new Error(`Props function error ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid props response');
    return data.map((p: any) => ({
      ...p,
      propType: PROP_LABEL_MAP[p.propType] || p.propType,
    }));
  }

  private transformESPNMLB(events: any[]): GameData[] {
    return events.map(event => {
      const comp = event.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');
      return {
        id: event.id,
        homeTeam: home?.team?.abbreviation || 'TBD',
        awayTeam: away?.team?.abbreviation || 'TBD',
        startTime: event.date || new Date().toISOString(),
        venue: comp?.venue?.fullName || '',
        status: this.mapESPNStatus(event.status?.type?.name || ''),
        homeScore: home?.score ? parseInt(home.score) : undefined,
        awayScore: away?.score ? parseInt(away.score) : undefined,
        inning: event.status?.type?.shortDetail || undefined,
      };
    });
  }

  private transformESPNWNBA(events: any[]): WNBAGameData[] {
    return events.map(event => {
      const comp = event.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');
      return {
        id: event.id,
        homeTeam: home?.team?.shortDisplayName || home?.team?.abbreviation || 'TBD',
        awayTeam: away?.team?.shortDisplayName || away?.team?.abbreviation || 'TBD',
        startTime: event.date || new Date().toISOString(),
        venue: comp?.venue?.fullName || '',
        status: this.mapESPNStatus(event.status?.type?.name || ''),
        homeScore: home?.score ? parseInt(home.score) : undefined,
        awayScore: away?.score ? parseInt(away.score) : undefined,
      };
    });
  }

  private mapESPNStatus(s: string): 'scheduled' | 'live' | 'final' {
    if (s.includes('FINAL') || s.includes('COMPLETE')) return 'final';
    if (s.includes('IN_PROGRESS') || s.includes('HALFTIME')) return 'live';
    return 'scheduled';
  }

  async getWeather(venue: string): Promise<GameData['weather'] | null> {
    if (!WX_KEY || !venue) return null;
    try {
      const res = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(venue)}&appid=${WX_KEY}&units=imperial`
      );
      if (!res.ok) return null;
      const d = await res.json();
      return {
        temperature: Math.round(d.main?.temp ?? 72),
        windSpeed: Math.round(d.wind?.speed ?? 5),
        conditions: d.weather?.[0]?.description ?? 'Clear',
      };
    } catch { return null; }
  }
}

export const apiService = new ApiService();

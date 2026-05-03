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

const ESPN_PATHS: Record<Sport, string> = {
  mlb:  'baseball/mlb',
  wnba: 'basketball/wnba',
  nba:  'basketball/nba',
  nfl:  'football/nfl',
  nhl:  'hockey/nhl',
  ufc:  'mma/ufc',
};

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
  player_steals: 'Steals',
  player_blocks: 'Blocks',
  player_pass_yds: 'Pass Yards',
  player_rush_yds: 'Rush Yards',
  player_reception_yds: 'Rec Yards',
  player_receptions: 'Receptions',
  player_pass_tds: 'Pass TDs',
  player_rush_attempts: 'Rush Attempts',
  player_shots_on_goal: 'Shots on Goal',
  player_saves: 'Saves',
  player_goals: 'Goals',
  player_method_of_victory: 'Method of Victory',
  player_round: 'Round',
  player_total_rounds: 'Total Rounds',
};

class ApiService {

  async getGames(sport: Sport, date: string): Promise<(GameData | WNBAGameData)[]> {
    const path = ESPN_PATHS[sport];
    if (!path) return [];
    try {
      const d = date.replace(/-/g, '');
      const res = await fetch(`${ESPN}/${path}/scoreboard?dates=${d}&limit=20`);
      if (!res.ok) throw new Error(`ESPN ${sport} ${res.status}`);
      const data = await res.json();
      const events = data.events || [];
      if (events.length === 0) throw new Error(`No ${sport} games today`);
      const games = this.transformESPNEvents(events);
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

  // Keep old methods for compatibility
  async getMLBGames(date: string) { return this.getGames('mlb', date) as Promise<GameData[]>; }
  async getWNBAGames(date: string) { return this.getGames('wnba', date) as Promise<WNBAGameData[]>; }

  async getAllProps(sport: Sport): Promise<PlayerProp[]> {
    try {
      const res = await fetch(`/api/props?sport=${sport}`);
      if (!res.ok) throw new Error(`Props function ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      return data.map((p: any) => ({
        ...p,
        propType: PROP_LABEL_MAP[p.propType] || p.propType,
      }));
    } catch (err) {
      console.warn(`Props failed for ${sport}:`, err);
      return [];
    }
  }

  async getAllMLBProps(_games: GameData[]) { return this.getAllProps('mlb'); }
  async getAllWNBAProps(_games: WNBAGameData[]) { return this.getAllProps('wnba'); }
  async getMLBPlayerProps(_id: string) { return this.getAllProps('mlb'); }
  async getWNBAPlayerProps(_id: string) { return this.getAllProps('wnba'); }

  private transformESPNEvents(events: any[]): GameData[] {
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
        status: this.mapESPNStatus(event.status?.type?.name || ''),
        homeScore: home?.score ? parseInt(home.score) : undefined,
        awayScore: away?.score ? parseInt(away.score) : undefined,
        inning: event.status?.type?.shortDetail || undefined,
      };
    });
  }

  private mapESPNStatus(s: string): 'scheduled' | 'live' | 'final' {
    if (s.includes('FINAL') || s.includes('COMPLETE')) return 'final';
    if (s.includes('IN_PROGRESS') || s.includes('HALFTIME') || s.includes('PROGRESS')) return 'live';
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

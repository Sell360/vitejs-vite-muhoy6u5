export type Sport = 'mlb' | 'wnba' | 'nba' | 'nfl' | 'nhl' | 'ufc' | 'ncaaf';

export interface GameData {
  id: string; homeTeam: string; awayTeam: string; startTime: string;
  weather?: { temperature: number; windSpeed: number; conditions: string; };
  umpire?: { name: string; strikeZoneTendency: 'tight' | 'wide' | 'normal'; };
  venue: string; status: 'scheduled' | 'live' | 'final';
  homeScore?: number; awayScore?: number; inning?: string;
}

export interface PlayerProp {
  id: string; playerId: string; playerName: string; team: string;
  propType: string; line: number; overOdds: number; underOdds: number;
  gameId: string; vendor?: string; homeTeam?: string; awayTeam?: string;
  startTime?: string; injured?: boolean;
  impliedProb?: { over: number; under: number; vig: number; } | null;
  sharpFlag?: boolean; kalshiEdge?: null; isGameLine?: boolean;
}

export interface GameLine {
  id: string; homeTeam: string; awayTeam: string; startTime: string;
  homeML: number | null; awayML: number | null;
  homeSpread: number | null; homeSpreadOdds: number | null;
  awaySpread: number | null; awaySpreadOdds: number | null;
  total: number | null; overOdds: number | null; underOdds: number | null;
  vendor: string;
}

export interface WNBAGameData {
  id: string; homeTeam: string; awayTeam: string; startTime: string;
  referee?: { name: string; foulTendency: 'strict' | 'lenient' | 'normal'; };
  venue: string; status: 'scheduled' | 'live' | 'final';
  pace?: number; homeScore?: number; awayScore?: number;
}

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const WX_KEY = import.meta.env.VITE_WEATHER_API_KEY || '';

const ESPN_PATHS: Record<Sport, string> = {
  mlb: 'baseball/mlb', wnba: 'basketball/wnba', nba: 'basketball/nba',
  nfl: 'football/nfl', ncaaf: 'football/college-football', nhl: 'hockey/nhl', ufc: 'mma/ufc',
};

const cache: Record<string, { data: any; ts: number }> = {};
const TTL = 8 * 60 * 1000;

class ApiService {

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
    } catch (err) { console.warn(`${sport} games failed:`, err); return []; }
  }

  async getMLBGames(date: string)  { return this.getGames('mlb', date) as Promise<GameData[]>; }
  async getWNBAGames(date: string) { return this.getGames('wnba', date) as Promise<WNBAGameData[]>; }

  async getAllProps(sport: Sport): Promise<PlayerProp[]> {
    const ck = `props-${sport}`;
    const hit = cache[ck];
    if (hit && hit.data.length > 0 && Date.now() - hit.ts < TTL) return hit.data;

    try {
      const res = await fetch(`/api/props?sport=${sport}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error(data.error || 'Invalid response');
      const enriched = data.map((p: any) => this.enrichProp(p));
      if (enriched.length > 0) cache[ck] = { data: enriched, ts: Date.now() };
      return enriched;
    } catch (err) {
      throw new Error(`Props unavailable: ${err instanceof Error ? err.message : err}`);
    }
  }

  async getGameLines(sport: Sport): Promise<GameLine[]> {
    const ck = `gamelines-${sport}`;
    const hit = cache[ck];
    if (hit && Date.now() - hit.ts < TTL) return hit.data;
    try {
      const res = await fetch(`/api/props?sport=${sport}&type=games`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const lines = Array.isArray(data) ? data : [];
      cache[ck] = { data: lines, ts: Date.now() };
      return lines;
    } catch (err) { console.warn('Game lines failed:', err); return []; }
  }

  gameLinesToProps(lines: GameLine[]): PlayerProp[] {
    const props: PlayerProp[] = [];
    lines.forEach(line => {
      const base = { playerId: '' as const, gameId: line.id, vendor: line.vendor, homeTeam: line.homeTeam, awayTeam: line.awayTeam, startTime: line.startTime, isGameLine: true as const };
      // Each ML is its own pick — store odds in overOdds so addLeg('over') works
      if (line.homeML) props.push({ ...base, id: `gl-${line.id}-homeML`, playerName: line.homeTeam, team: line.homeTeam, propType: 'Moneyline', line: 0, overOdds: line.homeML, underOdds: line.homeML });
      if (line.awayML) props.push({ ...base, id: `gl-${line.id}-awayML`, playerName: line.awayTeam, team: line.awayTeam, propType: 'Moneyline', line: 0, overOdds: line.awayML, underOdds: line.awayML });
      // Game total — over/under on same prop
      if (line.total && line.overOdds) props.push({ ...base, id: `gl-${line.id}-total`, playerName: `${line.awayTeam} @ ${line.homeTeam}`, team: '', propType: 'Game Total', line: line.total, overOdds: line.overOdds, underOdds: line.underOdds || -110 });
      // Each spread is its own prop — pick 'over' to take that side
      if (line.homeSpread !== null && line.homeSpreadOdds) props.push({ ...base, id: `gl-${line.id}-homeSpread`, playerName: `${line.homeTeam} ${(line.homeSpread ?? 0) >= 0 ? '+' : ''}${line.homeSpread}`, team: line.homeTeam, propType: 'Spread', line: line.homeSpread ?? 0, overOdds: line.homeSpreadOdds, underOdds: line.homeSpreadOdds });
      if (line.awaySpread !== null && line.awaySpreadOdds) props.push({ ...base, id: `gl-${line.id}-awaySpread`, playerName: `${line.awayTeam} ${(line.awaySpread ?? 0) >= 0 ? '+' : ''}${line.awaySpread}`, team: line.awayTeam, propType: 'Spread', line: line.awaySpread ?? 0, overOdds: line.awaySpreadOdds, underOdds: line.awaySpreadOdds });
    });
    return props;
  }

  async getAllMLBProps(_g: GameData[])      { return this.getAllProps('mlb'); }
  async getAllWNBAProps(_g: WNBAGameData[]) { return this.getAllProps('wnba'); }
  async getMLBPlayerProps(_id: string)     { return this.getAllProps('mlb'); }
  async getWNBAPlayerProps(_id: string)    { return this.getAllProps('wnba'); }

  private enrichProp(p: any): PlayerProp {
    const ovDec = p.overOdds > 0 ? p.overOdds / 100 + 1 : 100 / Math.abs(p.overOdds || 110) + 1;
    const unDec = p.underOdds > 0 ? p.underOdds / 100 + 1 : 100 / Math.abs(p.underOdds || 110) + 1;
    return { ...p, impliedProb: { over: Math.round((1/ovDec)*100), under: Math.round((1/unDec)*100), vig: Math.round(((1/ovDec)+(1/unDec)-1)*100) }, injured: false, sharpFlag: false, kalshiEdge: null };
  }

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

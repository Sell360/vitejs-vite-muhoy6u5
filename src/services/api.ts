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
  impliedProb?: { over: number; under: number; vig: number; } | null;
  sharpFlag?: boolean;
  kalshiEdge?: null;
  isGameLine?: boolean;
}

export interface GameLine {
  id: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  homeML: number | null;
  awayML: number | null;
  homeSpread: number | null;
  homeSpreadOdds: number | null;
  awaySpread: number | null;
  awaySpreadOdds: number | null;
  total: number | null;
  overOdds: number | null;
  underOdds: number | null;
  vendor: string;
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
    } catch (err) {
      console.warn(`${sport} games failed:`, err);
      return [];
    }
  }

  async getMLBGames(date: string)  { return this.getGames('mlb', date) as Promise<GameData[]>; }
  async getWNBAGames(date: string) { return this.getGames('wnba', date) as Promise<WNBAGameData[]>; }

  // Props via Netlify function
  async getAllProps(sport: Sport): Promise<PlayerProp[]> {
    const ck = `props-${sport}`;
    const hit = cache[ck];
    // Only use cache if it has actual data
    if (hit && hit.data.length > 0 && Date.now() - hit.ts < TTL) return hit.data;

    const res = await fetch(`/api/props?sport=${sport}`);
    if (!res.ok) throw new Error(`Props function returned ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (!Array.isArray(data) || data.length === 0) throw new Error('No props returned');

    const enriched = data.map((p: any) => this.enrichProp(p));
    cache[ck] = { data: enriched, ts: Date.now() };
    return enriched;
  }

  async getGameLines(sport: Sport): Promise<GameLine[]> {
    const ck = `gamelines-${sport}`;
    const hit = cache[ck];
    if (hit && Date.now() - hit.ts < TTL) return hit.data;
    try {
      const res = await fetch(`/api/props?sport=${sport}&type=games`);
      if (!res.ok) throw new Error(`Game lines ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const lines = Array.isArray(data) ? data : [];
      cache[ck] = { data: lines, ts: Date.now() };
      return lines;
    } catch (err) {
      console.warn('Game lines failed:', err);
      return [];
    }
  }

  gameLinesToProps(lines: GameLine[]): PlayerProp[] {
    const props: PlayerProp[] = [];
    lines.forEach(line => {
      if (line.homeML) props.push({ id: `gl-${line.id}-homeML`, playerId: '', playerName: line.homeTeam, team: line.homeTeam, propType: 'Moneyline', line: 0, overOdds: line.homeML, underOdds: 0, gameId: line.id, vendor: line.vendor, homeTeam: line.homeTeam, awayTeam: line.awayTeam, startTime: line.startTime, isGameLine: true });
      if (line.awayML) props.push({ id: `gl-${line.id}-awayML`, playerId: '', playerName: line.awayTeam, team: line.awayTeam, propType: 'Moneyline', line: 0, overOdds: line.awayML, underOdds: 0, gameId: line.id, vendor: line.vendor, homeTeam: line.homeTeam, awayTeam: line.awayTeam, startTime: line.startTime, isGameLine: true });
      if (line.total && line.overOdds) props.push({ id: `gl-${line.id}-total`, playerId: '', playerName: `${line.awayTeam} @ ${line.homeTeam}`, team: '', propType: 'Game Total', line: line.total, overOdds: line.overOdds, underOdds: line.underOdds || -110, gameId: line.id, vendor: line.vendor, homeTeam: line.homeTeam, awayTeam: line.awayTeam, startTime: line.startTime, isGameLine: true });
      if (line.homeSpread && line.homeSpreadOdds) props.push({ id: `gl-${line.id}-spread`, playerId: '', playerName: `${line.homeTeam} ${line.homeSpread > 0 ? '+' : ''}${line.homeSpread}`, team: line.homeTeam, propType: 'Spread', line: line.homeSpread, overOdds: line.homeSpreadOdds, underOdds: line.awaySpreadOdds || -110, gameId: line.id, vendor: line.vendor, homeTeam: line.homeTeam, awayTeam: line.awayTeam, startTime: line.startTime, isGameLine: true });
    });
    return props;
  }

  async getAllMLBProps(_g: GameData[])      { return this.getAllProps('mlb'); }
  async getAllWNBAProps(_g: WNBAGameData[]) { return this.getAllProps('wnba'); }
  async getMLBPlayerProps(_id: string)     { return this.getAllProps('mlb'); }
  async getWNBAPlayerProps(_id: string)    { return this.getAllProps('wnba'); }

  private parseDKProps(data: any, defaultPropType: string): PlayerProp[] {
    const props: PlayerProp[] = [];
    try {
      (data?.eventGroup?.offerCategories || []).forEach((cat: any) => {
        (cat?.offerSubcategoryDescriptors || []).forEach((subcat: any) => {
          const propType = subcat?.name || defaultPropType;
          (subcat?.offerSubcategory?.offers || []).forEach((offerGroup: any) => {
            if (!Array.isArray(offerGroup)) return;
            offerGroup.forEach((offer: any) => {
              const outcomes = offer?.outcomes || [];
              if (outcomes.length < 2) return;
              const playerName = offer?.participant || offer?.label || '';
              if (!playerName || playerName.length < 2) return;
              const over = outcomes.find((o: any) => o?.label?.toLowerCase() === 'over');
              const under = outcomes.find((o: any) => o?.label?.toLowerCase() === 'under');
              if (!over && !under) return;
              const line = parseFloat(over?.line || under?.line || '0') || 0;
              const overOdds = this.parseOdds(over?.oddsAmerican);
              const underOdds = this.parseOdds(under?.oddsAmerican);
              if (overOdds === 0 && underOdds === 0) return;
              props.push({
                id: `dk-${offer?.providerId || Math.random()}-${playerName}`,
                playerId: '',
                playerName: this.cleanName(playerName),
                team: offer?.teamAbbreviation || '',
                propType, line, overOdds, underOdds,
                gameId: offer?.eventId?.toString() || '',
                vendor: 'draftkings',
              });
            });
          });
        });
      });
    } catch { }
    return props;
  }

  private parseOdds(raw: any): number {
    if (!raw) return 0;
    const n = parseInt(raw.toString().replace(/[^-\d]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  private cleanName(name: string): string {
    if (name.includes(',')) {
      const parts = name.split(',').map((s: string) => s.trim());
      return `${parts[1]} ${parts[0]}`;
    }
    return name.trim();
  }

  private enrichProp(p: any): PlayerProp {
    const ovDec = p.overOdds > 0 ? p.overOdds / 100 + 1 : 100 / Math.abs(p.overOdds || 110) + 1;
    const unDec = p.underOdds > 0 ? p.underOdds / 100 + 1 : 100 / Math.abs(p.underOdds || 110) + 1;
    return { ...p, impliedProb: { over: Math.round((1 / ovDec) * 100), under: Math.round((1 / unDec) * 100), vig: Math.round(((1 / ovDec) + (1 / unDec) - 1) * 100) }, injured: false, sharpFlag: false, kalshiEdge: null };
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

// API service
// Games: ESPN free hidden API (no key)
// Props: DraftKings via Netlify function proxy (no key, no payment)

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

// Use relative URL so it works on both Netlify and local dev
const PROXY = '/api/props';

const propsCache: Record<string, PlayerProp[]> = {};

class ApiService {

  // ─── MLB GAMES ─────────────────────────────────────────────────────────

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

  // ─── WNBA GAMES ────────────────────────────────────────────────────────

  async getWNBAGames(date: string): Promise<WNBAGameData[]> {
    const d = date.replace(/-/g, '');
    const res = await fetch(`${ESPN}/basketball/wnba/scoreboard?dates=${d}&limit=20`);
    if (!res.ok) throw new Error(`ESPN WNBA ${res.status}`);
    const data = await res.json();
    const games = this.transformESPNWNBA(data.events || []);
    if (games.length === 0) throw new Error('No WNBA games today');
    return games;
  }

  // ─── ALL PROPS FOR ALL SCHEDULED GAMES ─────────────────────────────────

  async getAllMLBProps(games: GameData[]): Promise<PlayerProp[]> {
    const scheduled = games.filter(g => g.status === 'scheduled');
    if (scheduled.length === 0) return [];
    return this.getDKProps('mlb', scheduled.map(g => g.id));
  }

  async getAllWNBAProps(games: WNBAGameData[]): Promise<PlayerProp[]> {
    const scheduled = games.filter(g => g.status === 'scheduled');
    if (scheduled.length === 0) return [];
    return this.getDKProps('wnba', scheduled.map(g => g.id));
  }

  async getMLBPlayerProps(gameId: string): Promise<PlayerProp[]> {
    if (propsCache[gameId]) return propsCache[gameId];
    const all = await this.getDKProps('mlb', [gameId]);
    if (all.length > 0) propsCache[gameId] = all;
    return all;
  }

  async getWNBAPlayerProps(gameId: string): Promise<PlayerProp[]> {
    if (propsCache[gameId]) return propsCache[gameId];
    const all = await this.getDKProps('wnba', [gameId]);
    if (all.length > 0) propsCache[gameId] = all;
    return all;
  }

  // ─── DRAFTKINGS PROXY ──────────────────────────────────────────────────

  private async getDKProps(sport: 'mlb' | 'wnba', gameIds: string[]): Promise<PlayerProp[]> {
    try {
      const res = await fetch(`${PROXY}?sport=${sport}&type=props`);
      if (!res.ok) throw new Error(`Proxy error ${res.status}`);
      const data = await res.json();
      return this.transformDKProps(data, sport);
    } catch (err) {
      console.warn(`DraftKings props failed for ${sport}:`, err);
      return [];
    }
  }

  // Transform DraftKings sportsbook API response into PlayerProp[]
  // DK structure: eventGroup -> offerCategories -> offerSubcategoryDescriptors -> offerSubcategory -> offers -> outcomes
  private transformDKProps(data: any, sport: 'mlb' | 'wnba'): PlayerProp[] {
    const props: PlayerProp[] = [];

    try {
      const categories = data?.eventGroup?.offerCategories || [];

      categories.forEach((cat: any) => {
        const subcats = cat?.offerSubcategoryDescriptors || [];

        subcats.forEach((subcat: any) => {
          const offers = subcat?.offerSubcategory?.offers || [];

          offers.forEach((offerGroup: any) => {
            if (!Array.isArray(offerGroup)) return;

            offerGroup.forEach((offer: any) => {
              const outcomes = offer?.outcomes || [];
              if (outcomes.length < 2) return;

              // Player name is usually in the offer label or participant
              const playerName = offer?.label || offer?.participant || '';
              if (!playerName || playerName.length < 2) return;

              const propType = this.formatDKMarket(subcat?.name || '');
              const gameId = offer?.eventId?.toString() || 'unknown';

              // Find over and under outcomes
              const over = outcomes.find((o: any) =>
                o?.label?.toLowerCase() === 'over' || o?.criteriaId === 1
              );
              const under = outcomes.find((o: any) =>
                o?.label?.toLowerCase() === 'under' || o?.criteriaId === 2
              );

              if (!over && !under) return;

              const line = parseFloat(over?.line || under?.line || '0') || 0;
              const overOdds = over ? this.parseOdds(over.oddsAmerican || over.odds) : 0;
              const underOdds = under ? this.parseOdds(under.oddsAmerican || under.odds) : 0;

              if (overOdds === 0 && underOdds === 0) return;

              props.push({
                id: `dk-${offer?.providerId || Math.random()}-${playerName}-${propType}`,
                playerId: offer?.providerId?.toString() || '',
                playerName: this.cleanPlayerName(playerName),
                team: offer?.teamAbbreviation || '',
                propType,
                line,
                overOdds,
                underOdds,
                gameId,
                vendor: 'draftkings',
              });
            });
          });
        });
      });
    } catch (err) {
      console.error('DK transform error:', err);
    }

    // Deduplicate
    const seen = new Map<string, PlayerProp>();
    props.forEach(p => {
      const key = `${p.playerName}-${p.propType}-${p.line}`;
      if (!seen.has(key)) seen.set(key, p);
    });

    return Array.from(seen.values());
  }

  private parseOdds(raw: any): number {
    if (!raw) return 0;
    const n = parseInt(raw.toString().replace(/[^-\d]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  private cleanPlayerName(name: string): string {
    // DK sometimes has "Last, First" format
    if (name.includes(',')) {
      const parts = name.split(',').map(s => s.trim());
      return `${parts[1]} ${parts[0]}`;
    }
    return name.trim();
  }

  private formatDKMarket(name: string): string {
    const map: Record<string, string> = {
      'Hits': 'Hits',
      'Total Bases': 'Total Bases',
      'Home Runs': 'Home Runs',
      'RBIs': 'RBIs',
      'Strikeouts': 'Strikeouts',
      'Walks': 'Walks',
      'Stolen Bases': 'Stolen Bases',
      'Hits + Runs + RBIs': 'H+R+RBI',
      'Points': 'Points',
      'Rebounds': 'Rebounds',
      'Assists': 'Assists',
      'Threes Made': '3-Pointers',
      'Pts + Reb + Ast': 'Pts+Reb+Ast',
      'Pts + Reb': 'Pts+Reb',
      'Pts + Ast': 'Pts+Ast',
      'Steals': 'Steals',
      'Blocks': 'Blocks',
    };
    return map[name] || name;
  }

  // ─── ESPN TRANSFORMS ───────────────────────────────────────────────────

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
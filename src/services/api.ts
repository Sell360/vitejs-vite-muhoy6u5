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
  injured?: boolean;
  impliedProb?: { over: number; under: number; vig: number; } | null;
  sharpFlag?: boolean;
  kalshiEdge?: null;
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

const DK_GROUPS: Record<Sport, string> = {
  mlb:  '84240',
  nba:  '42648',
  nfl:  '88808',
  nhl:  '42133',
  wnba: '42648',
  ufc:  '9',
};

const cache: Record<string, { data: PlayerProp[]; ts: number }> = {};
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

  async getAllProps(sport: Sport): Promise<PlayerProp[]> {
    const ck = `props-${sport}`;
    const hit = cache[ck];
    if (hit && Date.now() - hit.ts < TTL) return hit.data;

    const groupId = DK_GROUPS[sport];
    if (!groupId) throw new Error(`No DK group for ${sport}`);

    // Step 1: get top level categories
    const catRes = await fetch(
      `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${groupId}?format=json`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
    );
    if (!catRes.ok) throw new Error(`DK returned ${catRes.status} — may be geo-blocked`);
    const catData = await catRes.json();

    const propKeywords = ['player', 'batter', 'pitcher', 'points', 'rebounds', 'assists',
      'passing', 'rushing', 'receiving', 'shots', 'saves', 'goals', 'hits', 'strikeout', 'total bases'];
    const cats = catData?.eventGroup?.offerCategories || [];
    const propCats = cats.filter((c: any) =>
      propKeywords.some(k => (c.name || '').toLowerCase().includes(k))
    );

    if (propCats.length === 0) throw new Error('DraftKings returned no player prop categories');

    // Step 2: fetch each subcategory
    const allProps: PlayerProp[] = [];

    await Promise.allSettled(
      propCats.slice(0, 8).map(async (cat: any) => {
        const catId = cat.offerCategoryId;
        await Promise.allSettled(
          (cat.offerSubcategoryDescriptors || []).slice(0, 8).map(async (subcat: any) => {
            const subcatId = subcat.offerSubcategoryId || subcat.subcategoryId;
            if (!subcatId) return;
            try {
              const res = await fetch(
                `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${groupId}/categories/${catId}/subcategories/${subcatId}?format=json`,
                { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
              );
              if (!res.ok) return;
              const data = await res.json();
              allProps.push(...this.parseDKProps(data, subcat.name || cat.name || ''));
            } catch { }
          })
        );
      })
    );

    // Deduplicate
    const seen = new Map<string, PlayerProp>();
    allProps.forEach(p => {
      const k = `${p.playerName}-${p.propType}-${p.line}`;
      if (!seen.has(k)) seen.set(k, this.enrichProp(p));
    });
    const deduped = Array.from(seen.values());

    if (deduped.length === 0) throw new Error('DraftKings returned 0 props for this sport today');

    cache[ck] = { data: deduped, ts: Date.now() };
    return deduped;
  }

  async getAllMLBProps(_g: GameData[])      { return this.getAllProps('mlb'); }
  async getAllWNBAProps(_g: WNBAGameData[]) { return this.getAllProps('wnba'); }
  async getMLBPlayerProps(_id: string)     { return this.getAllProps('mlb'); }
  async getWNBAPlayerProps(_id: string)    { return this.getAllProps('wnba'); }

  private enrichProp(p: PlayerProp): PlayerProp {
    const ovDec = p.overOdds > 0 ? p.overOdds / 100 + 1 : 100 / Math.abs(p.overOdds || 110) + 1;
    const unDec = p.underOdds > 0 ? p.underOdds / 100 + 1 : 100 / Math.abs(p.underOdds || 110) + 1;
    return {
      ...p,
      impliedProb: {
        over: Math.round((1 / ovDec) * 100),
        under: Math.round((1 / unDec) * 100),
        vig: Math.round(((1 / ovDec) + (1 / unDec) - 1) * 100),
      },
      injured: false,
      sharpFlag: false,
      kalshiEdge: null,
    };
  }

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
                propType,
                line,
                overOdds,
                underOdds,
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

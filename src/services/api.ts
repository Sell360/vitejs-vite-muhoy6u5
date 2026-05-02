// API service for real-time sports data
export interface GameData {
  id: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  weather?: {
    temperature: number;
    windSpeed: number;
    conditions: string;
  };
  umpire?: {
    name: string;
    strikeZoneTendency: 'tight' | 'wide' | 'normal';
  };
  venue: string;
  status: 'scheduled' | 'live' | 'final';
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
}

export interface WNBAGameData {
  id: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  referee?: {
    name: string;
    foulTendency: 'strict' | 'lenient' | 'normal';
  };
  venue: string;
  status: 'scheduled' | 'live' | 'final';
  pace?: number;
}

class ApiService {
  private baseUrl = 'https://api.sportsdata.io/v3'; // Example API
  private apiKey = import.meta.env.VITE_SPORTS_API_KEY || '';

  // MLB Data
  async getMLBGames(date: string): Promise<GameData[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/mlb/scores/json/GamesByDate/${date}?key=${this.apiKey}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return this.transformMLBData(data);
    } catch (error) {
      console.error('Error fetching MLB games:', error);
      return this.getMockMLBData(); // Fallback to mock data
    }
  }

  async getMLBPlayerProps(gameId: string): Promise<PlayerProp[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/mlb/odds/json/PlayerProps/${gameId}?key=${this.apiKey}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return this.transformMLBProps(data);
    } catch (error) {
      console.error('Error fetching MLB props:', error);
      return this.getMockMLBProps();
    }
  }

  // WNBA Data
  async getWNBAGames(date: string): Promise<WNBAGameData[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/wnba/scores/json/GamesByDate/${date}?key=${this.apiKey}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return this.transformWNBAData(data);
    } catch (error) {
      console.error('Error fetching WNBA games:', error);
      return this.getMockWNBAData();
    }
  }

  // Weather data for MLB
  async getWeatherData(venue: string): Promise<any> {
    try {
      const response = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${venue}&appid=${import.meta.env.VITE_WEATHER_API_KEY}&units=imperial`
      );
      
      if (!response.ok) {
        throw new Error(`Weather API error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching weather:', error);
      return null;
    }
  }

  // Transform and mock data methods
  private transformMLBData(data: any[]): GameData[] {
    return data.map(game => ({
      id: game.GameID?.toString() || Math.random().toString(),
      homeTeam: game.HomeTeam || 'Unknown',
      awayTeam: game.AwayTeam || 'Unknown',
      startTime: game.DateTime || new Date().toISOString(),
      venue: game.StadiumDetails?.Name || 'Unknown Venue',
      status: this.mapGameStatus(game.Status),
      weather: game.Weather ? {
        temperature: game.Weather.Temperature || 72,
        windSpeed: game.Weather.WindSpeed || 5,
        conditions: game.Weather.Condition || 'Clear'
      } : undefined,
      umpire: game.Umpires?.[0] ? {
        name: game.Umpires[0].Name || 'Unknown',
        strikeZoneTendency: 'normal'
      } : undefined
    }));
  }

  private transformWNBAData(data: any[]): WNBAGameData[] {
    return data.map(game => ({
      id: game.GameID?.toString() || Math.random().toString(),
      homeTeam: game.HomeTeam || 'Unknown',
      awayTeam: game.AwayTeam || 'Unknown',
      startTime: game.DateTime || new Date().toISOString(),
      venue: game.StadiumDetails?.Name || 'Unknown Venue',
      status: this.mapGameStatus(game.Status),
      pace: game.Pace || 85
    }));
  }

  private transformMLBProps(data: any[]): PlayerProp[] {
    return data.map(prop => ({
      id: prop.PropBetID?.toString() || Math.random().toString(),
      playerId: prop.PlayerID?.toString() || '',
      playerName: prop.PlayerName || 'Unknown Player',
      team: prop.Team || 'Unknown',
      propType: prop.PropBetType || 'Unknown',
      line: prop.Value || 0,
      overOdds: prop.OverPayout || 100,
      underOdds: prop.UnderPayout || 100,
      gameId: prop.GameID?.toString() || ''
    }));
  }

  private mapGameStatus(status: string): 'scheduled' | 'live' | 'final' {
    if (!status) return 'scheduled';
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('final') || lowerStatus.includes('completed')) return 'final';
    if (lowerStatus.includes('live') || lowerStatus.includes('progress')) return 'live';
    return 'scheduled';
  }

  // Mock data for development/fallback
  private getMockMLBData(): GameData[] {
    return [
      {
        id: '1',
        homeTeam: 'Yankees',
        awayTeam: 'Red Sox',
        startTime: new Date().toISOString(),
        venue: 'Yankee Stadium',
        status: 'scheduled',
        weather: {
          temperature: 75,
          windSpeed: 8,
          conditions: 'Partly Cloudy'
        },
        umpire: {
          name: 'Angel Hernandez',
          strikeZoneTendency: 'tight'
        }
      },
      {
        id: '2',
        homeTeam: 'Dodgers',
        awayTeam: 'Giants',
        startTime: new Date(Date.now() + 3600000).toISOString(),
        venue: 'Dodger Stadium',
        status: 'scheduled',
        weather: {
          temperature: 82,
          windSpeed: 3,
          conditions: 'Clear'
        }
      }
    ];
  }

  private getMockWNBAData(): WNBAGameData[] {
    return [
      {
        id: '1',
        homeTeam: 'Las Vegas Aces',
        awayTeam: 'New York Liberty',
        startTime: new Date().toISOString(),
        venue: 'Michelob ULTRA Arena',
        status: 'scheduled',
        pace: 88,
        referee: {
          name: 'Maj Forsberg',
          foulTendency: 'strict'
        }
      }
    ];
  }

  private getMockMLBProps(): PlayerProp[] {
    return [
      {
        id: '1',
        playerId: '123',
        playerName: 'Aaron Judge',
        team: 'Yankees',
        propType: 'Total Bases',
        line: 1.5,
        overOdds: -110,
        underOdds: -110,
        gameId: '1'
      }
    ];
  }
}

export const apiService = new ApiService();
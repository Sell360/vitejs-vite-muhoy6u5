import { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/api';
import type { GameData, WNBAGameData, PlayerProp } from '../services/api';

export interface UseRealTimeDataReturn {
  games: (GameData | WNBAGameData)[];
  props: PlayerProp[];
  loading: boolean;
  error: string | null;
  refreshData: () => void;
  lastUpdated: Date | null;
}

export function useRealTimeData(sport: 'mlb' | 'wnba'): UseRealTimeDataReturn {
  const [games, setGames] = useState<(GameData | WNBAGameData)[]>([]);
  const [props, setProps] = useState<PlayerProp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const today = new Date().toISOString().split('T')[0];
      
      if (sport === 'mlb') {
        const gamesData = await apiService.getMLBGames(today);
        setGames(gamesData);
        
        // Fetch props for first game as example
        if (gamesData.length > 0) {
          const propsData = await apiService.getMLBPlayerProps(gamesData[0].id);
          setProps(propsData);
        }
      } else {
        const gamesData = await apiService.getWNBAGames(today);
        setGames(gamesData);
        setProps([]); // WNBA props would be implemented similarly
      }
      
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [sport]);

  const refreshData = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return {
    games,
    props,
    loading,
    error,
    refreshData,
    lastUpdated
  };
}
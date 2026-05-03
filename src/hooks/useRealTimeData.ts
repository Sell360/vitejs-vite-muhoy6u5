import { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/api';
import type { Sport, GameData, WNBAGameData, PlayerProp } from '../services/api';

export interface UseRealTimeDataReturn {
  games: (GameData | WNBAGameData)[];
  props: PlayerProp[];
  allProps: PlayerProp[];
  loading: boolean;
  propsLoading: boolean;
  error: string | null;
  refreshData: () => void;
  fetchPropsForGame: (gameId: string) => Promise<void>;
  lastUpdated: Date | null;
}

export function useRealTimeData(sport: Sport): UseRealTimeDataReturn {
  const [games, setGames] = useState<(GameData | WNBAGameData)[]>([]);
  const [props, setProps] = useState<PlayerProp[]>([]);
  const [allProps, setAllProps] = useState<PlayerProp[]>([]);
  const [loading, setLoading] = useState(false);
  const [propsLoading, setPropsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProps([]);
    setAllProps([]);

    try {
      const today = new Date().toISOString().split('T')[0];
      const gamesData = await apiService.getGames(sport, today);
      setGames(gamesData);
      setLastUpdated(new Date());

      // Load all props in background
      setPropsLoading(true);
      apiService.getAllProps(sport)
        .then(p => { setAllProps(p); setPropsLoading(false); })
        .catch(() => setPropsLoading(false));

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [sport]);

  const fetchPropsForGame = useCallback(async (gameId: string) => {
    try {
      const all = await apiService.getAllProps(sport);
      const gameProps = all.filter(p => p.gameId === gameId);
      setProps(gameProps.length > 0 ? gameProps : all);
      setAllProps(prev => {
        const existing = new Set(prev.map(x => x.id));
        const newOnes = all.filter(x => !existing.has(x.id));
        return [...prev, ...newOnes];
      });
    } catch (err) {
      console.error('Failed to fetch props:', err);
    }
  }, [sport]);

  const refreshData = useCallback(() => { fetchData(); }, [fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { games, props, allProps, loading, propsLoading, error, refreshData, fetchPropsForGame, lastUpdated };
}

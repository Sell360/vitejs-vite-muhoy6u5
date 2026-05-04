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
  propsError: string | null;
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
  const [propsError, setPropsError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPropsError(null);
    setProps([]);

    try {
      const today = new Date().toISOString().split('T')[0];
      const gamesData = await apiService.getGames(sport, today);
      setGames(gamesData);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch games');
    } finally {
      setLoading(false);
    }

    // Load player props + game lines in parallel
    setPropsLoading(true);
    try {
      const [playerProps, gameLines] = await Promise.allSettled([
        apiService.getAllProps(sport),
        apiService.getGameLines(sport),
      ]);

      const pp = playerProps.status === 'fulfilled' ? playerProps.value : [];
      const gl = gameLines.status === 'fulfilled'
        ? apiService.gameLinesToProps(gameLines.value)
        : [];

      const combined = [...pp, ...gl];

      if (combined.length === 0) {
        setPropsError('No props or lines available right now. Try refreshing.');
      }
      setAllProps(combined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPropsError(`Props unavailable: ${msg}`);
    } finally {
      setPropsLoading(false);
    }
  }, [sport]);

  const fetchPropsForGame = useCallback(async (gameId: string) => {
    try {
      const all = await apiService.getAllProps(sport);
      const gameProps = all.filter(p => p.gameId === gameId);
      setProps(gameProps.length > 0 ? gameProps : all);
    } catch { }
  }, [sport]);

  const refreshData = useCallback(() => { fetchData(); }, [fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { games, props, allProps, loading, propsLoading, error, propsError, refreshData, fetchPropsForGame, lastUpdated };
}

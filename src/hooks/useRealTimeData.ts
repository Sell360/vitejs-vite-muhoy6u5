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
    setAllProps([]);

    try {
      const today = new Date().toISOString().split('T')[0];
      const gamesData = await apiService.getGames(sport, today);
      setGames(gamesData);
      setLastUpdated(new Date());

      // Load props in background
      setPropsLoading(true);
      try {
        const p = await apiService.getAllProps(sport);
        if (p.length === 0) {
          setPropsError(`PrizePicks returned 0 props for ${sport.toUpperCase()}. They may not have lines posted yet today.`);
        }
        setAllProps(p);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setPropsError(`Props failed: ${msg}`);
        console.error('Props error:', err);
      } finally {
        setPropsLoading(false);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Games failed: ${msg}`);
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
        return [...prev, ...all.filter(x => !existing.has(x.id))];
      });
    } catch (err) {
      console.error('fetchPropsForGame error:', err);
    }
  }, [sport]);

  const refreshData = useCallback(() => { fetchData(); }, [fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { games, props, allProps, loading, propsLoading, error, propsError, refreshData, fetchPropsForGame, lastUpdated };
}

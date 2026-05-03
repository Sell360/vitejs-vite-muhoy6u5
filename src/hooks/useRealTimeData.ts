import { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/api';
import type { GameData, WNBAGameData, PlayerProp } from '../services/api';

export interface UseRealTimeDataReturn {
  games: (GameData | WNBAGameData)[];
  props: PlayerProp[];
  allProps: PlayerProp[]; // all props across all today's scheduled games
  loading: boolean;
  propsLoading: boolean;
  error: string | null;
  refreshData: () => void;
  fetchPropsForGame: (gameId: string) => Promise<void>;
  lastUpdated: Date | null;
}

export function useRealTimeData(sport: 'mlb' | 'wnba'): UseRealTimeDataReturn {
  const [games, setGames] = useState<(GameData | WNBAGameData)[]>([]);
  const [props, setProps] = useState<PlayerProp[]>([]); // selected game props
  const [allProps, setAllProps] = useState<PlayerProp[]>([]); // all today's props
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

      if (sport === 'mlb') {
        const gamesData = await apiService.getMLBGames(today);
        setGames(gamesData);

        // Load all props for all scheduled games in background
        setPropsLoading(true);
        apiService.getAllMLBProps(gamesData as GameData[])
          .then(p => { setAllProps(p); setPropsLoading(false); })
          .catch(() => { setPropsLoading(false); });

      } else {
        const gamesData = await apiService.getWNBAGames(today);
        setGames(gamesData);

        setPropsLoading(true);
        apiService.getAllWNBAProps(gamesData as WNBAGameData[])
          .then(p => { setAllProps(p); setPropsLoading(false); })
          .catch(() => { setPropsLoading(false); });
      }

      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [sport]);

  // Fetch props for a specific clicked game
  const fetchPropsForGame = useCallback(async (gameId: string) => {
    try {
      let p: PlayerProp[];
      if (sport === 'mlb') {
        p = await apiService.getMLBPlayerProps(gameId);
      } else {
        p = await apiService.getWNBAPlayerProps(gameId);
      }
      setProps(p);

      // Also merge into allProps if not already there
      setAllProps(prev => {
        const existing = new Set(prev.map(x => x.id));
        const newOnes = p.filter(x => !existing.has(x.id));
        return [...prev, ...newOnes];
      });
    } catch (err) {
      console.error('Failed to fetch props for game:', gameId, err);
      setProps([]);
    }
  }, [sport]);

  const refreshData = useCallback(() => { fetchData(); }, [fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { games, props, allProps, loading, propsLoading, error, refreshData, fetchPropsForGame, lastUpdated };
}
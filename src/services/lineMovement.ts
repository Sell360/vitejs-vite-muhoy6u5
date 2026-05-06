import { supabase, isSupabaseConfigured } from './supabase';

export interface LineSnapshot {
  id: number;
  sport: string;
  event_id: string;
  home_team: string;
  away_team: string;
  game_time: string;
  home_ml: number | null;
  away_ml: number | null;
  home_spread: number | null;
  home_spread_odds: number | null;
  total: number | null;
  taken_at: string;
}

export interface ReversalSignal {
  eventId: string;
  market: 'spread' | 'total' | 'ml';
  side: 'home' | 'away' | 'over' | 'under';
  openValue: number;
  midValue: number;
  currentValue: number;
  direction: 'reversal' | 'steam' | 'none';
  strength: number; // 1-10
  description: string;
}

// Fetch all snapshots for an event in the last 24 hours, oldest first
export async function getEventSnapshots(eventId: string): Promise<LineSnapshot[]> {
  if (!isSupabaseConfigured()) return [];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('line_snapshots')
    .select('*')
    .eq('event_id', eventId)
    .gte('taken_at', since)
    .order('taken_at', { ascending: true });
  return (data as LineSnapshot[]) ?? [];
}

// Detect reversal pattern: line drifts in one direction then snaps back
// Returns null if no significant pattern. Otherwise returns the strongest signal.
export function detectReversal(snapshots: LineSnapshot[]): ReversalSignal | null {
  if (snapshots.length < 4) return null; // need at least 4 data points to detect a reversal pattern

  const open = snapshots[0];
  const current = snapshots[snapshots.length - 1];

  // Find the extreme point between open and current (the peak/trough)
  let extremeIdx = 0;
  let extremeDelta = 0;

  // Spread reversal — track home_spread movement
  if (open.home_spread !== null && current.home_spread !== null) {
    for (let i = 1; i < snapshots.length - 1; i++) {
      const s = snapshots[i];
      if (s.home_spread === null) continue;
      const delta = Math.abs(s.home_spread - open.home_spread);
      if (delta > extremeDelta) {
        extremeDelta = delta;
        extremeIdx = i;
      }
    }

    if (extremeIdx > 0) {
      const ext = snapshots[extremeIdx];
      const drift = ext.home_spread! - open.home_spread;
      const reverse = current.home_spread! - ext.home_spread!;
      // Reversal: drift and reverse in opposite directions, both meaningful
      if (Math.abs(drift) >= 0.5 && Math.abs(reverse) >= 0.5 && Math.sign(drift) !== Math.sign(reverse)) {
        const reverseStrength = Math.min(10, Math.round(Math.abs(reverse) * 4));
        return {
          eventId: open.event_id,
          market: 'spread',
          side: drift > 0 ? 'home' : 'away',
          openValue: open.home_spread,
          midValue: ext.home_spread!,
          currentValue: current.home_spread!,
          direction: 'reversal',
          strength: reverseStrength,
          description: `Home spread drifted from ${open.home_spread > 0 ? '+' : ''}${open.home_spread} to ${ext.home_spread! > 0 ? '+' : ''}${ext.home_spread} then reversed to ${current.home_spread! > 0 ? '+' : ''}${current.home_spread}. Sharp money fading the public.`,
        };
      }
      // Steam: line moved one direction continuously and significantly (1+ point)
      if (Math.abs(current.home_spread! - open.home_spread) >= 1) {
        const dir = current.home_spread! - open.home_spread;
        return {
          eventId: open.event_id,
          market: 'spread',
          side: dir > 0 ? 'home' : 'away',
          openValue: open.home_spread,
          midValue: open.home_spread,
          currentValue: current.home_spread!,
          direction: 'steam',
          strength: Math.min(10, Math.round(Math.abs(dir) * 3)),
          description: `Spread steamed ${Math.abs(dir).toFixed(1)} pts ${dir > 0 ? 'toward home' : 'toward away'}. Heavy one-sided action.`,
        };
      }
    }
  }

  // Total reversal — same logic
  if (open.total !== null && current.total !== null) {
    let extIdx = 0;
    let extDelta = 0;
    for (let i = 1; i < snapshots.length - 1; i++) {
      const s = snapshots[i];
      if (s.total === null) continue;
      const delta = Math.abs(s.total - open.total);
      if (delta > extDelta) {
        extDelta = delta;
        extIdx = i;
      }
    }

    if (extIdx > 0) {
      const ext = snapshots[extIdx];
      const drift = ext.total! - open.total;
      const reverse = current.total! - ext.total!;
      if (Math.abs(drift) >= 0.5 && Math.abs(reverse) >= 0.5 && Math.sign(drift) !== Math.sign(reverse)) {
        return {
          eventId: open.event_id,
          market: 'total',
          side: drift > 0 ? 'over' : 'under',
          openValue: open.total,
          midValue: ext.total!,
          currentValue: current.total!,
          direction: 'reversal',
          strength: Math.min(10, Math.round(Math.abs(reverse) * 4)),
          description: `Total drifted from ${open.total} to ${ext.total} then reversed to ${current.total}. Sharp side: ${drift > 0 ? 'UNDER' : 'OVER'}.`,
        };
      }
    }
  }

  return null;
}

// Get reversal signals for multiple events at once (for OddsBoard performance)
export async function getReversalsForSport(sport: string): Promise<Map<string, ReversalSignal>> {
  const map = new Map<string, ReversalSignal>();
  if (!isSupabaseConfigured()) return map;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('line_snapshots')
    .select('*')
    .eq('sport', sport)
    .gte('taken_at', since)
    .order('taken_at', { ascending: true });

  if (!data || data.length === 0) return map;

  // Group by event_id
  const grouped: Record<string, LineSnapshot[]> = {};
  for (const row of data as LineSnapshot[]) {
    if (!grouped[row.event_id]) grouped[row.event_id] = [];
    grouped[row.event_id].push(row);
  }

  for (const [eventId, snapshots] of Object.entries(grouped)) {
    const signal = detectReversal(snapshots);
    if (signal) map.set(eventId, signal);
  }

  return map;
}

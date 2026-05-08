// PublicTrap — "fade the public" card section on the Games tab.
// Calls /api/public-trap?sport=X to find games where heavy public action
// meets reverse line movement, presents them as fade candidates.
//
// CONFIRMED tier (red): heavy public + line moving opposite = sharp fade
// WATCH tier (yellow): heavy public but line hasn't moved yet
//
// Default collapsed so users who don't care don't get a tall section
// pushing the OddsBoard below the fold.

import { useState, useEffect } from 'react';
import type { Sport } from '../services/api';

interface Trap {
  gameId: string;
  matchup: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  publicPercent: { home: number; away: number };
  publicSide: 'home' | 'away';
  fadeSide: 'home' | 'away';
  fadeTeam: string;
  trapLevel: 'confirmed' | 'watch';
  rlmTicks: number;
  reason: string;
  homeML: number;
  awayML: number;
}

interface TrapResponse {
  sport: string;
  ts: string;
  traps: Trap[];
  totalCandidates: number;
}

interface PublicTrapProps {
  sport: Sport;
}

export function PublicTrap({ sport }: PublicTrapProps) {
  const [data, setData] = useState<TrapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Soccer + UFC don't have public-trap endpoints (different data shape);
    // hide the section entirely for those sports
    if (sport === 'soccer' || sport === 'ufc') {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/public-trap?sport=${sport}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then(json => { if (!cancelled) setData(json); })
      .catch(err => { if (!cancelled) setError(String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sport]);

  // Hide section entirely for unsupported sports
  if (sport === 'soccer' || sport === 'ufc') return null;

  const traps = data?.traps || [];
  const confirmedCount = traps.filter(t => t.trapLevel === 'confirmed').length;
  const watchCount = traps.filter(t => t.trapLevel === 'watch').length;

  // Don't render section if there's nothing to show and not currently loading
  if (!loading && traps.length === 0 && !error) return null;

  return (
    <div style={{
      marginBottom: 14,
      background: 'linear-gradient(135deg, rgba(248,113,113,.04), rgba(168,85,247,.04))',
      border: '1px solid rgba(248,113,113,.15)',
      borderRadius: 10,
      overflow: 'hidden',
      fontFamily: "'Barlow', sans-serif",
    }}>
      {/* Header bar — always visible, click to expand */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10, flexWrap: 'wrap',
          cursor: 'pointer',
          color: '#c8ddf0',
          fontFamily: "'Barlow', sans-serif",
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🎯</span>
          <span style={{
            fontWeight: 900, fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase',
            color: '#f87171',
          }}>Public Trap</span>
          {!loading && traps.length > 0 && (
            <>
              {confirmedCount > 0 && (
                <span style={{
                  padding: '2px 8px', borderRadius: 5,
                  background: 'rgba(248,113,113,.15)', color: '#f87171',
                  border: '1px solid rgba(248,113,113,.3)',
                  fontSize: 10, fontWeight: 800, letterSpacing: .5,
                }}>{confirmedCount} CONFIRMED</span>
              )}
              {watchCount > 0 && (
                <span style={{
                  padding: '2px 8px', borderRadius: 5,
                  background: 'rgba(251,191,36,.12)', color: '#fbbf24',
                  border: '1px solid rgba(251,191,36,.3)',
                  fontSize: 10, fontWeight: 800, letterSpacing: .5,
                }}>{watchCount} WATCH</span>
              )}
            </>
          )}
          {loading && <span style={{ fontSize: 11, color: '#fbbf24' }}>Scanning…</span>}
        </span>
        <span style={{
          fontSize: 11, color: '#8ab0cc', fontWeight: 700,
        }}>{expanded ? '▲ HIDE' : '▼ SHOW'}</span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: '0 14px 12px' }}>
          {error && (
            <div style={{ fontSize: 11, color: '#f87171', padding: '8px 0' }}>
              Couldn&apos;t load Public Trap data: {error}
            </div>
          )}

          {!error && traps.length === 0 && !loading && (
            <div style={{ fontSize: 11, color: '#8ab0cc', padding: '8px 0' }}>
              No public trap candidates detected for {sport.toUpperCase()} today.
            </div>
          )}

          {traps.map(trap => (
            <TrapCard key={trap.gameId} trap={trap} />
          ))}

          {/* Honest caveat — surface the soft-vs-hard signal distinction */}
          {traps.length > 0 && (
            <div style={{
              marginTop: 10, padding: '8px 10px',
              background: 'rgba(56,189,248,.04)',
              borderLeft: '2px solid rgba(56,189,248,.3)',
              fontSize: 10, color: '#8ab0cc', lineHeight: 1.55,
            }}>
              <span style={{ color: '#38bdf8', fontWeight: 800 }}>How to read this:</span>{' '}
              Public % is estimated from sportsbook line skew. Line movement
              ticks are verified from our 2-hour line snapshots. CONFIRMED
              traps have hard evidence of sharp counter-action; WATCH traps
              are heavy public action without (yet) a sharp reaction.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TrapCard({ trap }: { trap: Trap }) {
  const isConfirmed = trap.trapLevel === 'confirmed';
  const accent = isConfirmed ? '#f87171' : '#fbbf24';
  const badge = isConfirmed ? 'CONFIRMED' : 'WATCH';
  const fadePct = trap.publicSide === 'home' ? trap.publicPercent.home : trap.publicPercent.away;
  const publicTeam = trap.publicSide === 'home' ? trap.homeTeam : trap.awayTeam;

  return (
    <div style={{
      marginTop: 8,
      padding: '10px 12px',
      background: `linear-gradient(135deg, ${accent}0d, ${accent}05)`,
      border: `1px solid ${accent}33`,
      borderRadius: 8,
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) auto',
      gap: 10, alignItems: 'center',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          flexWrap: 'wrap', marginBottom: 4,
        }}>
          <span style={{
            padding: '1px 7px', borderRadius: 4,
            background: `${accent}26`, color: accent,
            border: `1px solid ${accent}55`,
            fontSize: 9, fontWeight: 900, letterSpacing: .8,
          }}>{badge}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#c8ddf0' }}>
            {trap.matchup}
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#8ab0cc', lineHeight: 1.45 }}>
          <span style={{ color: accent, fontWeight: 800 }}>Fade {publicTeam}</span>
          {' · '}
          {fadePct}% public · {trap.reason.split(' · ').slice(1).join(' · ')}
        </div>
      </div>

      {/* Right side: fade target + odds */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>
          Fade Side
        </div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 900, color: '#4ade80' }}>
          {trap.fadeTeam}
        </div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 700, color: '#8ab0cc' }}>
          {trap.fadeSide === 'home' ? trap.homeML : trap.awayML}
        </div>
      </div>
    </div>
  );
}

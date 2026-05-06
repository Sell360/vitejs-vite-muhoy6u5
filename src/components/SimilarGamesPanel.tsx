import { useState } from 'react';
import { getSimilarGames, type SimilarGame } from '../services/polymarket';
import { useAuth } from '../contexts/AuthContext';
import { UpgradeModal } from './ProGate';

interface Props {
  sport: string;
  spread: number | null;
  total: number | null;
}

export function SimilarGamesPanel({ sport, spread, total }: Props) {
  const { isPro } = useAuth();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SimilarGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const load = async () => {
    if (data.length > 0 || loading) return;
    setLoading(true);
    const result = await getSimilarGames(sport, spread, total, 8);
    setData(result);
    setLoading(false);
  };

  if (!spread && !total) return null;

  const handleClick = () => {
    if (!isPro) { setUpgradeOpen(true); return; }
    setOpen(o => !o);
    if (!open) load();
  };

  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={handleClick}
        style={{
          width: '100%', padding: '6px 0',
          background: open ? 'rgba(168,85,247,.08)' : 'transparent',
          color: isPro ? '#94a3b8' : '#c084fc', border: 'none',
          borderTop: '1px dashed rgba(255,255,255,.06)',
          cursor: 'pointer', fontSize: 9, fontWeight: 700,
          fontFamily: "'Barlow Condensed', sans-serif",
          letterSpacing: 1, textTransform: 'uppercase',
          transition: 'all .15s',
        }}
      >
        {!isPro ? '🔒 Similar past games — Pro' : open ? '▲ Hide similar games' : '🧭 Similar past games'}
      </button>
      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />

      {open && (
        <div style={{
          background: 'rgba(168,85,247,.04)',
          border: '1px solid rgba(168,85,247,.15)',
          borderRadius: 7, padding: 8, marginTop: 4,
        }}>
          {loading && (
            <div style={{ fontSize: 11, color: '#4a6080', textAlign: 'center', padding: 8 }}>
              Loading…
            </div>
          )}
          {!loading && data.length === 0 && (
            <div style={{ fontSize: 10, color: '#1a3060', textAlign: 'center', padding: 4 }}>
              Not enough historical data yet — needs more line snapshots over time.
            </div>
          )}
          {!loading && data.length > 0 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 800, color: '#a855f7', letterSpacing: 1, marginBottom: 4 }}>
                CLOSEST MATCHES (last 30 days)
              </div>
              {data.map((g, i) => (
                <div key={i} style={{
                  fontSize: 10, color: '#8ab0cc',
                  padding: '3px 0', borderBottom: i < data.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                  display: 'flex', justifyContent: 'space-between', gap: 6,
                  fontFamily: "'Barlow', sans-serif", fontWeight: 600,
                }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {g.awayTeam.split(' ').slice(-1)[0]} @ {g.homeTeam.split(' ').slice(-1)[0]}
                  </span>
                  <span style={{ color: '#1a3060', fontSize: 9 }}>
                    {g.openSpread !== null && `${g.openSpread > 0 ? '+' : ''}${g.openSpread.toFixed(1)}`}
                    {g.openSpread !== null && g.openTotal !== null && ' · '}
                    {g.openTotal !== null && `O/U ${g.openTotal}`}
                  </span>
                  <span style={{
                    color: g.similarity >= 0.85 ? '#4ade80' : g.similarity >= 0.7 ? '#fbbf24' : '#64748b',
                    fontWeight: 800, minWidth: 40, textAlign: 'right',
                    fontFamily: "'Barlow Condensed', sans-serif",
                  }}>
                    {(g.similarity * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

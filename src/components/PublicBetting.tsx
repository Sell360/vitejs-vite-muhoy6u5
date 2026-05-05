import { useState, useEffect } from 'react';

const C = {
  card: '#111827', border: '#1f2937', accent: '#3b82f6',
  green: '#10b981', red: '#ef4444', yellow: '#f59e0b',
  text: '#f1f5f9', muted: '#64748b',
};

interface GameBetting {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeBetPct: number | null;
  awayBetPct: number | null;
  overBetPct: number | null;
  underBetPct: number | null;
  fadeSignal: string | null;
}

export function PublicBetting({ sport }: { sport: string }) {
  const [data, setData] = useState<GameBetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/public-betting?sport=${sport}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setData(Array.isArray(d) ? d : []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sport]);

  const PctBar = ({ pct, color }: { pct: number; color: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ flex: 1, background: '#1f2937', borderRadius: '3px', height: '6px' }}>
        <div style={{ width: `${pct}%`, background: color, height: '6px', borderRadius: '3px' }} />
      </div>
      <div style={{ fontSize: '11px', color, fontWeight: '700', minWidth: '32px' }}>{pct}%</div>
    </div>
  );

  if (loading) return <div style={{ padding: '16px', color: C.muted, fontSize: '13px', textAlign: 'center' }}>Loading public betting data...</div>;
  if (error) return <div style={{ padding: '12px', color: C.red, fontSize: '12px' }}>⚠️ {error}</div>;
  if (data.length === 0) return <div style={{ padding: '16px', color: C.muted, fontSize: '13px', textAlign: 'center' }}>No public betting data available</div>;

  const fadeGames = data.filter(g => g.fadeSignal);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Fade signals first */}
      {fadeGames.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.yellow}40`, borderRadius: '10px', padding: '12px 14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: C.yellow, marginBottom: '8px', letterSpacing: '1px' }}>🎯 FADE THE PUBLIC — UNIQUE EDGE</div>
          {fadeGames.map((g, i) => (
            <div key={i} style={{ fontSize: '12px', color: C.text, padding: '4px 0', borderBottom: i < fadeGames.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              ⚡ {g.fadeSignal}
            </div>
          ))}
        </div>
      )}

      {/* All games */}
      {data.map((game, i) => (
        <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: C.text, marginBottom: '10px' }}>
            {game.awayTeam} @ {game.homeTeam}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {game.homeBetPct !== null && (
              <div>
                <div style={{ fontSize: '11px', color: C.muted, marginBottom: '3px' }}>{game.homeTeam} ML</div>
                <PctBar pct={game.homeBetPct} color={game.homeBetPct > 70 ? C.red : C.accent} />
              </div>
            )}
            {game.awayBetPct !== null && (
              <div>
                <div style={{ fontSize: '11px', color: C.muted, marginBottom: '3px' }}>{game.awayTeam} ML</div>
                <PctBar pct={game.awayBetPct} color={game.awayBetPct > 70 ? C.red : C.accent} />
              </div>
            )}
            {game.overBetPct !== null && (
              <div>
                <div style={{ fontSize: '11px', color: C.muted, marginBottom: '3px' }}>Over</div>
                <PctBar pct={game.overBetPct} color={game.overBetPct > 70 ? C.red : C.green} />
              </div>
            )}
            {game.underBetPct !== null && (
              <div>
                <div style={{ fontSize: '11px', color: C.muted, marginBottom: '3px' }}>Under</div>
                <PctBar pct={game.underBetPct} color={game.underBetPct > 70 ? C.red : C.green} />
              </div>
            )}
          </div>
          {game.fadeSignal && (
            <div style={{ marginTop: '8px', fontSize: '11px', color: C.yellow, background: `${C.yellow}15`, padding: '4px 8px', borderRadius: '4px' }}>
              🎯 {game.fadeSignal}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

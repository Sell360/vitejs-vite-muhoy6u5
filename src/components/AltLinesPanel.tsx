import { useState, useCallback } from 'react';
import { apiService } from '../services/api';
import type { Sport, AltLines } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { UpgradeModal } from './ProGate';

interface Props {
  sport: Sport;
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  onAddLeg?: (label: string, odds: number, betType: 'SPREAD' | 'TOTAL', side: string) => void;
}

function fmt(odds: number) {
  if (!odds || odds === 0) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function AltLinesPanel({ sport, eventId, homeTeam, awayTeam, onAddLeg }: Props) {
  const { isPro } = useAuth();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AltLines | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const load = useCallback(async () => {
    if (data || loading) return;
    setLoading(true); setErr('');
    const result = await apiService.getAltLines(sport, eventId);
    if (result) setData(result);
    else setErr('No alt lines available for this game');
    setLoading(false);
  }, [sport, eventId, data, loading]);

  const toggle = () => {
    if (!isPro) { setUpgradeOpen(true); return; }
    setOpen(o => !o);
    if (!open) load();
  };

  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={toggle}
        style={{
          width: '100%', padding: '6px 0',
          background: open ? 'rgba(99,102,241,.1)' : 'transparent',
          color: isPro ? '#4a6080' : '#c084fc', border: 'none',
          borderTop: '1px dashed rgba(255,255,255,.06)',
          cursor: 'pointer', fontSize: 9, fontWeight: 700,
          fontFamily: "'Barlow Condensed', sans-serif",
          letterSpacing: 1, textTransform: 'uppercase',
          transition: 'all .15s',
        }}
      >
        {!isPro ? '🔒 Alt spreads & totals — Pro' : open ? '▲ Hide alt lines' : '▼ Alt spreads & totals'}
      </button>
      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />

      {open && (
        <div style={{ background: 'rgba(99,102,241,.04)', border: '1px solid rgba(99,102,241,.15)', borderRadius: 7, padding: '8px 10px', marginTop: 4 }}>
          {loading && <div style={{ fontSize: 11, color: '#4a6080', textAlign: 'center', padding: 8 }}>Loading…</div>}
          {err && <div style={{ fontSize: 11, color: '#f87171', textAlign: 'center', padding: 4 }}>{err}</div>}
          {data && (
            <>
              {/* Spreads */}
              {(data.spreads.home.length > 0 || data.spreads.away.length > 0) && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: '#1a3060', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Spreads</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    <div>
                      <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 2 }}>{awayTeam.split(' ').pop()}</div>
                      {data.spreads.away.slice(0, 8).map((s, i) => (
                        <button
                          key={i}
                          onClick={() => onAddLeg?.(`${awayTeam} ${s.point >= 0 ? '+' : ''}${s.point}`, s.price, 'SPREAD', 'away')}
                          style={altBtn(s.price)}
                        >
                          <span>{s.point >= 0 ? '+' : ''}{s.point}</span>
                          <span style={{ color: s.price > 0 ? '#4ade80' : '#dce6f0' }}>{fmt(s.price)}</span>
                        </button>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 2 }}>{homeTeam.split(' ').pop()}</div>
                      {data.spreads.home.slice(0, 8).map((s, i) => (
                        <button
                          key={i}
                          onClick={() => onAddLeg?.(`${homeTeam} ${s.point >= 0 ? '+' : ''}${s.point}`, s.price, 'SPREAD', 'home')}
                          style={altBtn(s.price)}
                        >
                          <span>{s.point >= 0 ? '+' : ''}{s.point}</span>
                          <span style={{ color: s.price > 0 ? '#4ade80' : '#dce6f0' }}>{fmt(s.price)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Totals */}
              {(data.totals.over.length > 0 || data.totals.under.length > 0) && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 800, color: '#1a3060', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Totals</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    <div>
                      <div style={{ fontSize: 9, color: '#4ade80', fontWeight: 700, marginBottom: 2 }}>Over</div>
                      {data.totals.over.slice(0, 8).map((t, i) => (
                        <button
                          key={i}
                          onClick={() => onAddLeg?.(`Over ${t.point}`, t.price, 'TOTAL', 'over')}
                          style={altBtn(t.price)}
                        >
                          <span>O {t.point}</span>
                          <span style={{ color: t.price > 0 ? '#4ade80' : '#dce6f0' }}>{fmt(t.price)}</span>
                        </button>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: '#f87171', fontWeight: 700, marginBottom: 2 }}>Under</div>
                      {data.totals.under.slice(0, 8).map((t, i) => (
                        <button
                          key={i}
                          onClick={() => onAddLeg?.(`Under ${t.point}`, t.price, 'TOTAL', 'under')}
                          style={altBtn(t.price)}
                        >
                          <span>U {t.point}</span>
                          <span style={{ color: t.price > 0 ? '#4ade80' : '#dce6f0' }}>{fmt(t.price)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function altBtn(_price: number): React.CSSProperties {
  return {
    display: 'flex', justifyContent: 'space-between', width: '100%',
    padding: '4px 7px', marginBottom: 2,
    background: 'rgba(255,255,255,.025)',
    border: '1px solid rgba(255,255,255,.06)',
    borderRadius: 4,
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: 11, fontWeight: 700, color: '#c8ddf0',
    cursor: 'pointer', transition: 'all .12s',
  };
}

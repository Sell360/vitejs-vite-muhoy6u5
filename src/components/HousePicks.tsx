import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getHousePicks, computeTrackRecord, settleHousePick, manualGradeLegs, type HousePick, type TrackRecord } from '../services/housePicks';

const SPORT_LABELS: Record<string, string> = {
  mlb: 'MLB', nba: 'NBA', nfl: 'NFL', nhl: 'NHL', wnba: 'WNBA', ncaaf: 'CFB',
};

function fmt(odds: number) {
  if (!odds) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function HousePicks() {
  const { isAdmin } = useAuth();
  const [picks, setPicks] = useState<HousePick[]>([]);
  const [stats, setStats] = useState<TrackRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'settled'>('all');

  const load = async () => {
    setLoading(true);
    const data = await getHousePicks(30, 100);
    setPicks(data);
    setStats(computeTrackRecord(data));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSettle = async (id: string, status: 'won' | 'lost' | 'push') => {
    if (!confirm(`Mark this pick as ${status.toUpperCase()}?`)) return;
    await settleHousePick(id, status);
    await load();
  };

  const filtered = picks.filter(p => {
    if (filterStatus === 'pending') return p.status === 'pending' || p.status === 'pending_review';
    if (filterStatus === 'settled') return p.status === 'won' || p.status === 'lost' || p.status === 'push';
    return true;
  });

  return (
    <div style={{ fontFamily: "'Barlow', sans-serif" }}>
      {/* Hero stats */}
      {stats && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(14,165,233,.08), rgba(99,102,241,.06))',
          border: '1px solid rgba(14,165,233,.2)',
          borderRadius: 12, padding: '14px 16px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
            <div>
              <div style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 22, fontWeight: 900, color: '#c8ddf0', letterSpacing: .5, lineHeight: 1,
              }}>📊 Public Track Record</div>
              <div style={{ fontSize: 11, color: '#4a6080', fontWeight: 600, marginTop: 4, lineHeight: 1.4 }}>
                Daily auto-generated parlays from our system. <strong style={{ color: '#38bdf8' }}>Real picks, real results.</strong> No cherry-picking — every pick is logged at lock-time.
              </div>
            </div>

            {/* Recent form streak */}
            {stats.recentForm.length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Last 10</div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {stats.recentForm.map((r, i) => (
                    <div key={i} style={{
                      width: 22, height: 22, borderRadius: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontSize: 12, fontWeight: 900,
                      background: r === 'W' ? 'rgba(74,222,128,.18)' : r === 'L' ? 'rgba(248,113,113,.18)' : 'rgba(251,191,36,.15)',
                      color: r === 'W' ? '#4ade80' : r === 'L' ? '#f87171' : '#fbbf24',
                      border: `1px solid ${r === 'W' ? 'rgba(74,222,128,.35)' : r === 'L' ? 'rgba(248,113,113,.35)' : 'rgba(251,191,36,.3)'}`,
                    }}>{r}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Stat grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginTop: 14 }}>
            <Stat label="Win Rate" value={`${stats.winRate}%`} color={stats.winRate >= 55 ? '#4ade80' : stats.winRate >= 50 ? '#fbbf24' : '#f87171'} />
            <Stat label="Record" value={`${stats.wins}–${stats.losses}${stats.pushes ? `–${stats.pushes}` : ''}`} color="#c8ddf0" />
            <Stat label="Units P/L" value={`${stats.unitsPL >= 0 ? '+' : ''}${stats.unitsPL.toFixed(2)}u`} color={stats.unitsPL >= 0 ? '#4ade80' : '#f87171'} />
            <Stat label="ROI" value={`${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%`} color={stats.roi >= 5 ? '#4ade80' : stats.roi >= 0 ? '#fbbf24' : '#f87171'} />
            <Stat label="Total Picks" value={String(stats.totalPicks)} color="#8ab0cc" />
            <Stat label="Pending" value={String(stats.pending)} color="#fbbf24" />
          </div>

          {/* Tier breakdown */}
          <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(stats.byTier).filter(([, t]) => t.picks > 0).map(([tier, t]) => (
              <span key={tier} style={{
                fontSize: 10, fontWeight: 700, color: '#94a3b8',
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)',
                padding: '3px 9px', borderRadius: 5,
              }}>
                <strong style={{ color: tier === 'S' ? '#4ade80' : tier === 'A' ? '#fbbf24' : '#94a3b8' }}>{tier}-Tier</strong>
                <span style={{ marginLeft: 5, color: '#1a3060' }}>{t.wins}/{t.picks} · {t.winRate.toFixed(0)}%</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['all', 'pending', 'settled'] as const).map(f => (
          <button key={f} onClick={() => setFilterStatus(f)} style={{
            padding: '5px 12px', borderRadius: 6,
            background: filterStatus === f ? 'rgba(14,165,233,.15)' : 'rgba(255,255,255,.03)',
            color: filterStatus === f ? '#38bdf8' : '#4a6080',
            border: `1px solid ${filterStatus === f ? 'rgba(14,165,233,.3)' : 'rgba(255,255,255,.06)'}`,
            cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: "'Barlow', sans-serif",
            textTransform: 'capitalize',
          }}>{f}</button>
        ))}
      </div>

      {/* Picks list */}
      {loading && (
        <div style={{ padding: 32, textAlign: 'center', color: '#1a3060', fontSize: 12 }}>Loading picks...</div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{
          padding: 40, textAlign: 'center',
          background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)',
          borderRadius: 10,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
          <div style={{ fontSize: 13, color: '#1e3560', fontWeight: 700 }}>No picks yet</div>
          <div style={{ fontSize: 11, color: '#1a3060', marginTop: 4, lineHeight: 1.5, maxWidth: 360, margin: '4px auto 0' }}>
            The system locks in fresh picks daily at 9am ET. Check back after games are scheduled.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(p => <PickCard key={p.id} pick={p} isAdmin={isAdmin} onSettle={handleSettle} />)}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.05)',
      borderRadius: 8, padding: '8px 10px',
    }}>
      <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function PickCard({ pick, isAdmin, onSettle }: { pick: HousePick; isAdmin: boolean; onSettle: (id: string, status: 'won' | 'lost' | 'push') => void; }) {
  const [open, setOpen] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [actuals, setActuals] = useState<string[]>(pick.legs.map(() => ''));
  const [gradeBusy, setGradeBusy] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const statusColor = pick.status === 'won' ? '#4ade80' : pick.status === 'lost' ? '#f87171' : pick.status === 'push' ? '#fbbf24' : pick.status === 'pending_review' ? '#a855f7' : '#64748b';
  const tierColor = pick.tier === 'S' ? '#4ade80' : pick.tier === 'A' ? '#fbbf24' : '#94a3b8';
  const dateLabel = new Date(pick.pick_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const handleManualGrade = async () => {
    setGradeError(null);
    const nums = actuals.map(a => parseFloat(a));
    if (nums.some(n => isNaN(n))) {
      setGradeError('Enter a number for every leg');
      return;
    }
    setGradeBusy(true);
    const { error } = await manualGradeLegs(pick, nums);
    setGradeBusy(false);
    if (error) {
      setGradeError(error);
      return;
    }
    setGradeOpen(false);
    // Force a page-level refresh by triggering the parent's settle hook
    // (any non-null status works; the page reloads picks after settle)
    onSettle(pick.id, 'won');
  };

  const isV2 = pick.signal_count != null && pick.signal_count > 0;
  const v2Leg = isV2 ? pick.legs[0] : null;
  const v2Signals = (v2Leg && v2Leg.signals) || pick.signals || [];

  return (
    <div style={{
      background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 10, overflow: 'hidden',
    }}>
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '10px 14px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          fontFamily: "'Barlow', sans-serif", textAlign: 'left',
        }}
      >
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 11, fontWeight: 800, color: tierColor, letterSpacing: .5,
          background: `${tierColor}15`, border: `1px solid ${tierColor}30`,
          padding: '2px 8px', borderRadius: 4,
        }}>{pick.tier}-TIER</span>
        <span style={{ fontSize: 11, color: '#1e3a60', fontWeight: 700 }}>
          {SPORT_LABELS[pick.sport]} · {dateLabel} · #{pick.rank}
        </span>
        <span style={{ flex: 1, fontSize: 12, color: '#c8ddf0', fontWeight: 700 }}>
          {isV2 ? (pick.pick_label || (v2Leg && v2Leg.label) || 'Pick') : `${pick.legs.length}-Leg Parlay`}
          {isV2 && pick.signal_count && (
            <span style={{
              marginLeft: 8, padding: '1px 6px',
              background: 'rgba(56,189,248,.15)', color: '#38bdf8',
              border: '1px solid rgba(56,189,248,.3)', borderRadius: 4,
              fontSize: 10, fontWeight: 800, letterSpacing: .5,
            }}>{pick.signal_count} SIGNALS</span>
          )}
        </span>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 900, color: '#c8ddf0' }}>
          {fmt(pick.combined_odds)}
        </span>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 800,
          color: statusColor, background: `${statusColor}15`,
          border: `1px solid ${statusColor}30`,
          padding: '2px 8px', borderRadius: 4, letterSpacing: .5,
        }}>{pick.status === 'pending_review' ? 'REVIEW' : pick.status.toUpperCase()}</span>
      </button>

      {/* Body */}
      {open && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid rgba(255,255,255,.04)' }}>
          {isV2 ? (
            <>
              {/* V2 single-leg pick: show matchup + bet detail + signals */}
              <div style={{ padding: '10px 0' }}>
                <div style={{ fontSize: 11, color: '#1a3060', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
                  Matchup
                </div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 800, color: '#c8ddf0' }}>
                  {(v2Leg && v2Leg.matchup) || '—'}
                </div>
              </div>
              {v2Signals.length > 0 && (
                <div style={{
                  padding: '10px 12px', marginTop: 6,
                  background: 'rgba(56,189,248,.04)',
                  border: '1px solid rgba(56,189,248,.15)',
                  borderRadius: 8,
                }}>
                  <div style={{ fontSize: 10, color: '#38bdf8', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>
                    Why This Pick — {v2Signals.length} Edge Signals
                  </div>
                  {v2Signals.map((s, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: 8, alignItems: 'center',
                      padding: '4px 0', fontSize: 11, color: '#c8ddf0',
                    }}>
                      <span style={{
                        padding: '1px 6px', borderRadius: 4,
                        background: 'rgba(56,189,248,.15)',
                        color: '#38bdf8', fontWeight: 800,
                        fontSize: 9, letterSpacing: .5, textTransform: 'uppercase',
                        minWidth: 70, textAlign: 'center',
                      }}>
                        {s.type === 'polymarket' ? 'POLYMARKET'
                          : s.type === 'rlm' ? 'RLM'
                          : s.type === 'steam' ? 'STEAM'
                          : s.type === 'public_fade' ? 'FADE PUBLIC'
                          : s.type === 'ai_proj' ? 'AI PROJ'
                          : s.type === 'consensus_chalk' ? 'CHALK ✓'
                          : (s.type || '').toUpperCase()}
                      </span>
                      <span style={{ flex: 1, color: '#8ab0cc' }}>{s.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Legacy parlay: show each leg */}
              {pick.legs.map((l, i) => (
                <div key={i} style={{
                  padding: '8px 0',
                  borderBottom: i < pick.legs.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 10, color: '#1e3a60', fontWeight: 700, minWidth: 18 }}>#{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, color: '#c8ddf0' }}>
                      {l.player || l.label}
                    </div>
                    <div style={{ fontSize: 11, color: '#8ab0cc' }}>
                      {l.pick && <span style={{ color: l.pick === 'over' ? '#4ade80' : '#f87171', fontWeight: 700, textTransform: 'uppercase' }}>{l.pick}</span>}
                      {' '}{l.line} {l.propType}
                      <span style={{ color: '#1a3060' }}> · {l.matchup}</span>
                    </div>
                  </div>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 800, color: l.odds > 0 ? '#4ade80' : '#c8ddf0' }}>{fmt(l.odds)}</span>
                </div>
              ))}
            </>
          )}

          {/* Admin settlement controls */}
          {isAdmin && (pick.status === 'pending' || pick.status === 'pending_review') && !gradeOpen && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.05)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1, alignSelf: 'center' }}>ADMIN:</span>
              {!isV2 && <button onClick={() => setGradeOpen(true)} style={settleBtn('#a855f7')}>📝 Grade Manually</button>}
              <button onClick={() => onSettle(pick.id, 'won')} style={settleBtn('#4ade80')}>✓ Won</button>
              <button onClick={() => onSettle(pick.id, 'lost')} style={settleBtn('#f87171')}>✗ Lost</button>
              <button onClick={() => onSettle(pick.id, 'push')} style={settleBtn('#fbbf24')}>= Push</button>
            </div>
          )}

          {/* Manual-grade dialog: enter actual stat for each leg */}
          {isAdmin && gradeOpen && (
            <div style={{
              marginTop: 10, paddingTop: 10,
              borderTop: '1px solid rgba(168,85,247,.2)',
              background: 'rgba(168,85,247,.04)',
              borderRadius: 6, padding: '10px 12px',
            }}>
              <div style={{ fontSize: 10, color: '#a855f7', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
                Enter Actual Stat For Each Leg
              </div>
              {pick.legs.map((l, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 8, alignItems: 'center',
                  padding: '6px 0',
                  borderBottom: i < pick.legs.length - 1 ? '1px solid rgba(168,85,247,.1)' : 'none',
                }}>
                  <span style={{ fontSize: 10, color: '#1e3a60', fontWeight: 700, minWidth: 18 }}>#{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 11, color: '#c8ddf0', fontWeight: 600, minWidth: 0 }}>
                    {l.player} {(l.pick || '').toUpperCase()} {l.line} {l.propType}
                  </span>
                  <input
                    type="number" step="0.5"
                    value={actuals[i]}
                    onChange={e => setActuals(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                    placeholder="actual"
                    style={{
                      width: 70, padding: '4px 8px',
                      background: 'rgba(0,0,0,.3)', color: '#c8ddf0',
                      border: '1px solid rgba(168,85,247,.3)', borderRadius: 5,
                      fontSize: 12, fontWeight: 700,
                      fontFamily: "'Barlow Condensed', sans-serif",
                      textAlign: 'center',
                    }}
                  />
                </div>
              ))}
              {gradeError && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#f87171', fontWeight: 700 }}>
                  {gradeError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button onClick={handleManualGrade} disabled={gradeBusy} style={{
                  ...settleBtn('#a855f7'),
                  background: 'rgba(168,85,247,.15)',
                  cursor: gradeBusy ? 'wait' : 'pointer',
                }}>{gradeBusy ? '…grading' : 'Apply Grades'}</button>
                <button onClick={() => { setGradeOpen(false); setGradeError(null); }} style={settleBtn('#64748b')}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const settleBtn = (c: string): React.CSSProperties => ({
  padding: '5px 11px', borderRadius: 5,
  background: `${c}10`, color: c,
  border: `1px solid ${c}30`,
  fontSize: 11, fontWeight: 700,
  fontFamily: "'Barlow', sans-serif",
  cursor: 'pointer',
});

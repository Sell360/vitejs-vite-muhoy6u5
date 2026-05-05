import { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import type { Sport, PlayerProp } from '../services/api';

const C = {
  bg: '#050810', surface: '#0d1117', card: '#111827',
  border: '#1f2937', accent: '#3b82f6', accentGlow: 'rgba(59,130,246,0.15)',
  green: '#10b981', red: '#ef4444', yellow: '#f59e0b',
  text: '#f1f5f9', muted: '#64748b', dim: '#374151',
};

const SPORTS: Sport[] = ['mlb', 'nba', 'nfl', 'ncaaf', 'nhl', 'wnba', 'ufc'];
const SPORT_LABELS: Record<Sport, string> = {
  mlb: 'MLB', nba: 'NBA', nfl: 'NFL', ncaaf: 'COLLEGE',
  nhl: 'NHL', wnba: 'WNBA', ufc: 'UFC',
};

interface ParlayLeg {
  prop: PlayerProp;
  pick: 'over' | 'under';
  odds: number;
  sport: Sport;
}

function americanToDecimal(odds: number) {
  if (odds > 0) return odds / 100 + 1;
  return 100 / Math.abs(odds) + 1;
}
function decimalToAmerican(d: number) {
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function fmt(odds: number) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// Confidence score for a leg
function scoreLeg(prop: PlayerProp, pick: 'over' | 'under'): number {
  let conf = 52;
  const odds = pick === 'over' ? prop.overOdds : prop.underOdds;
  if (odds > 0) conf += 6;
  if (Math.abs(odds) <= 115) conf += 5;
  if (odds < -160) conf -= 8;
  if (prop.propType === 'Hits' && pick === 'over' && prop.line <= 1.5) conf += 8;
  if (prop.propType === 'Total Bases' && pick === 'over') conf += 5;
  if (prop.propType === 'Points' && pick === 'over') conf += 4;
  if (prop.propType === 'Strikeouts' && pick === 'over') conf += 5;
  if (prop.isGameLine) conf += 3;
  return Math.min(Math.max(conf, 30), 88);
}

// Overall parlay confidence
function parlayConfidence(legs: ParlayLeg[]): { score: number; rating: string; color: string } {
  if (legs.length === 0) return { score: 0, rating: '-', color: C.muted };
  const avg = legs.reduce((a, l) => a + scoreLeg(l.prop, l.pick), 0) / legs.length;
  // Penalize for more legs
  const penalty = (legs.length - 1) * 4;
  const score = Math.round(Math.max(avg - penalty, 20));
  const rating = score >= 70 ? 'S-TIER 🔥' : score >= 60 ? 'A-TIER ⚡' : score >= 50 ? 'B-TIER 📊' : 'C-TIER 💭';
  const color = score >= 70 ? C.green : score >= 60 ? '#fbbf24' : score >= 50 ? C.accent : C.muted;
  return { score, rating, color };
}

export function CrossSportParlay() {
  const [activeSport, setActiveSport] = useState<Sport>('mlb');
  const [allSportProps, setAllSportProps] = useState<Partial<Record<Sport, PlayerProp[]>>>({});
  const [loading, setLoading] = useState<Partial<Record<Sport, boolean>>>({});
  const [legs, setLegs] = useState<ParlayLeg[]>([]);
  const [mode, setMode] = useState<'builder' | 'pick6'>('builder');
  const [stake, setStake] = useState('10');

  // Load props for a sport when selected
  useEffect(() => {
    if (allSportProps[activeSport]) return;
    setLoading(prev => ({ ...prev, [activeSport]: true }));
    apiService.getAllProps(activeSport).then(props => {
      setAllSportProps(prev => ({ ...prev, [activeSport]: props }));
    }).catch(() => {
      setAllSportProps(prev => ({ ...prev, [activeSport]: [] }));
    }).finally(() => {
      setLoading(prev => ({ ...prev, [activeSport]: false }));
    });
  }, [activeSport]);

  const addLeg = (prop: PlayerProp, pick: 'over' | 'under') => {
    const odds = pick === 'over' ? prop.overOdds : prop.underOdds;
    if (!odds) return;
    // Remove if already in parlay
    const exists = legs.findIndex(l => l.prop.id === prop.id && l.pick === pick);
    if (exists >= 0) {
      setLegs(prev => prev.filter((_, i) => i !== exists));
      return;
    }
    if (mode === 'pick6' && legs.length >= 6) return;
    setLegs(prev => [...prev, { prop, pick, odds, sport: activeSport }]);
  };

  const removeLeg = (idx: number) => setLegs(prev => prev.filter((_, i) => i !== idx));

  const combinedOdds = legs.length > 0
    ? decimalToAmerican(legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1))
    : 0;

  const stakeNum = parseFloat(stake) || 0;
  const payout = legs.length > 0 ? (stakeNum * americanToDecimal(combinedOdds)).toFixed(2) : '0.00';
  const profit = (parseFloat(payout) - stakeNum).toFixed(2);

  const { score, rating, color } = parlayConfidence(legs);
  const currentProps = allSportProps[activeSport] || [];
  const isLoading = loading[activeSport];

  const isLegAdded = (propId: string, pick: string) =>
    legs.some(l => l.prop.id === propId && l.pick === pick);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px' }}>

      {/* LEFT — Sport selector + props */}
      <div>
        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {(['builder', 'pick6'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setLegs([]); }} style={{
              padding: '8px 20px',
              background: mode === m ? C.accent : C.card,
              color: mode === m ? 'white' : C.muted,
              border: `1px solid ${mode === m ? C.accent : C.border}`,
              borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
            }}>
              {m === 'builder' ? '⚡ Parlay Builder' : '🎯 Pick 6'}
            </button>
          ))}
          {mode === 'pick6' && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: C.muted }}>
              Pick 6 legs: <span style={{ color: legs.length === 6 ? C.green : C.accent, fontWeight: '600' }}>{legs.length}/6</span>
            </div>
          )}
        </div>

        {/* Sport tabs */}
        <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', marginBottom: '16px', background: C.surface, borderRadius: '8px', padding: '4px', border: `1px solid ${C.border}` }}>
          {SPORTS.map(s => (
            <button key={s} onClick={() => setActiveSport(s)} style={{
              padding: '6px 14px', whiteSpace: 'nowrap',
              background: activeSport === s ? C.card : 'transparent',
              color: activeSport === s ? C.text : C.muted,
              border: activeSport === s ? `1px solid ${C.border}` : '1px solid transparent',
              borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: activeSport === s ? '600' : '400',
            }}>{SPORT_LABELS[s]}</button>
          ))}
        </div>

        {/* Props list */}
        {isLoading && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '24px', textAlign: 'center', color: C.muted }}>
            Loading {SPORT_LABELS[activeSport]} props...
          </div>
        )}
        {!isLoading && currentProps.length === 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '24px', textAlign: 'center', color: C.muted }}>
            No {SPORT_LABELS[activeSport]} props available right now
          </div>
        )}
        {!isLoading && currentProps.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '500px', overflowY: 'auto' }}>
            {currentProps.slice(0, 60).map(prop => {
              const overAdded = isLegAdded(prop.id, 'over');
              const underAdded = isLegAdded(prop.id, 'under');
              const conf = scoreLeg(prop, 'over');
              return (
                <div key={prop.id} style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: '10px', padding: '12px 14px',
                  display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: '160px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: C.text }}>{prop.playerName}</div>
                    <div style={{ fontSize: '12px', color: C.muted }}>{prop.propType} {prop.line} · {prop.homeTeam} vs {prop.awayTeam}</div>
                  </div>
                  <div style={{ fontSize: '11px', color: color, fontWeight: '600' }}>{conf}%</div>
                  <button onClick={() => addLeg(prop, 'over')} style={{
                    padding: '5px 12px', fontSize: '12px', fontWeight: '600',
                    background: overAdded ? C.green + '30' : C.surface,
                    color: overAdded ? C.green : C.text,
                    border: `1px solid ${overAdded ? C.green : C.border}`,
                    borderRadius: '6px', cursor: 'pointer',
                  }}>O {prop.line} {fmt(prop.overOdds)}</button>
                  <button onClick={() => addLeg(prop, 'under')} style={{
                    padding: '5px 12px', fontSize: '12px', fontWeight: '600',
                    background: underAdded ? C.red + '30' : C.surface,
                    color: underAdded ? C.red : C.text,
                    border: `1px solid ${underAdded ? C.red : C.border}`,
                    borderRadius: '6px', cursor: 'pointer',
                  }}>U {prop.line} {fmt(prop.underOdds)}</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* RIGHT — Parlay slip */}
      <div style={{ position: 'sticky', top: '16px' }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>
              {mode === 'pick6' ? '🎯 Pick 6 Slip' : '⚡ Parlay Slip'}
            </div>
            {legs.length > 0 && (
              <button onClick={() => setLegs([])} style={{ fontSize: '11px', color: C.muted, background: 'transparent', border: 'none', cursor: 'pointer' }}>Clear all</button>
            )}
          </div>

          {/* Confidence score */}
          {legs.length > 0 && (
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: C.surface }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '11px', color: C.muted, textTransform: 'uppercase', letterSpacing: '1px' }}>Confidence</div>
                  <div style={{ fontSize: '24px', fontWeight: '800', color }}>{score}%</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '16px', fontWeight: '700', color }}>{rating}</div>
                  <div style={{ fontSize: '11px', color: C.muted }}>{legs.length} leg{legs.length !== 1 ? 's' : ''}</div>
                </div>
              </div>
              {/* Confidence bar */}
              <div style={{ marginTop: '8px', background: C.dim, borderRadius: '4px', height: '4px' }}>
                <div style={{ width: `${score}%`, background: color, height: '4px', borderRadius: '4px', transition: 'width 0.3s' }} />
              </div>
            </div>
          )}

          {/* Legs */}
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {legs.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: C.muted, fontSize: '13px' }}>
                {mode === 'pick6' ? 'Pick 6 props to build your slip' : 'Click Over/Under on any prop to add legs'}
              </div>
            ) : legs.map((leg, i) => {
              const legConf = scoreLeg(leg.prop, leg.pick);
              const legColor = legConf >= 65 ? C.green : legConf >= 52 ? '#fbbf24' : C.muted;
              return (
                <div key={i} style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', color: C.muted }}>{SPORT_LABELS[leg.sport]} · {leg.prop.propType}</div>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: C.text }}>{leg.prop.playerName}</div>
                    <div style={{ fontSize: '12px' }}>
                      <span style={{ color: leg.pick === 'over' ? C.green : C.red, fontWeight: '600' }}>{leg.pick.toUpperCase()}</span>
                      <span style={{ color: C.muted }}> {leg.prop.line} · {fmt(leg.odds)}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: legColor }}>{legConf}%</div>
                  <button onClick={() => removeLeg(i)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}>×</button>
                </div>
              );
            })}
          </div>

          {/* Payout */}
          {legs.length > 0 && (
            <div style={{ padding: '14px 16px', borderTop: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>Combined Odds</div>
                <div style={{ fontSize: '16px', fontWeight: '800', color: C.green }}>{fmt(combinedOdds)}</div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input
                  value={stake}
                  onChange={e => setStake(e.target.value)}
                  placeholder="Stake $"
                  style={{ flex: 1, background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '7px 10px', fontSize: '13px', outline: 'none' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <div style={{ fontSize: '11px', color: C.muted }}>Payout</div>
                  <div style={{ fontSize: '16px', fontWeight: '700', color: C.green }}>${payout}</div>
                </div>
              </div>
              <div style={{ fontSize: '12px', color: C.muted, textAlign: 'right' }}>
                Profit: <span style={{ color: parseFloat(profit) > 0 ? C.green : C.red }}>${profit}</span>
              </div>
              <div style={{ marginTop: '8px', fontSize: '11px', color: C.dim, textAlign: 'center' }}>⚠️ Bet responsibly</div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <a href="https://sportsbook.draftkings.com" target="_blank" rel="noopener noreferrer" style={{
                  flex: 1, padding: '8px', background: '#1a3a1a', color: '#4ade80',
                  border: '1px solid #4ade80', borderRadius: '6px',
                  fontSize: '11px', fontWeight: '700', textDecoration: 'none',
                  textAlign: 'center', whiteSpace: 'nowrap',
                }}>🏈 Bet on DraftKings</a>
                <a href="https://app.prizepicks.com" target="_blank" rel="noopener noreferrer" style={{
                  flex: 1, padding: '8px', background: '#1a1a3a', color: '#818cf8',
                  border: '1px solid #818cf8', borderRadius: '6px',
                  fontSize: '11px', fontWeight: '700', textDecoration: 'none',
                  textAlign: 'center', whiteSpace: 'nowrap',
                }}>🎯 Play on PrizePicks</a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import type { Sport, PlayerProp } from '../services/api';
import { AIScanner } from './AIScanner';
import { PublicBetting } from './PublicBetting';

const SPORTS: Sport[] = ['mlb', 'nba', 'nfl', 'ncaaf', 'nhl', 'wnba', 'ufc'];
const SPORT_LABELS: Record<Sport, string> = {
  mlb: 'MLB', nba: 'NBA', nfl: 'NFL', ncaaf: 'CFB',
  nhl: 'NHL', wnba: 'WNBA', ufc: 'UFC',
};

// Prop type categories for filtering
const GAME_BET_TYPES = ['Moneyline', 'Spread', 'Game Total'];

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
  if (!odds || odds === 0) return 'N/A';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function scoreLeg(prop: PlayerProp, pick: 'over' | 'under'): number {
  let conf = 52;
  const odds = pick === 'over' ? prop.overOdds : prop.underOdds;
  if (!odds) return 30;
  if (odds > 0) conf += 6;
  if (Math.abs(odds) <= 115) conf += 5;
  if (odds < -160) conf -= 8;
  // Game bet bonuses
  if (prop.propType === 'Moneyline') conf += 4;
  if (prop.propType === 'Spread') conf += 6; // spreads are slightly more predictable
  if (prop.propType === 'Game Total') conf += 5;
  // Player prop bonuses
  if (prop.propType === 'Hits' && pick === 'over' && prop.line <= 1.5) conf += 8;
  if (prop.propType === 'Total Bases' && pick === 'over') conf += 5;
  if (prop.propType === 'Points' && pick === 'over') conf += 4;
  if (prop.propType === 'Strikeouts' && pick === 'over') conf += 5;
  return Math.min(Math.max(conf, 30), 88);
}

function parlayConfidence(legs: ParlayLeg[]): { score: number; tier: string; color: string } {
  if (legs.length === 0) return { score: 0, tier: '—', color: '#2a4060' };
  const avg = legs.reduce((a, l) => a + scoreLeg(l.prop, l.pick), 0) / legs.length;
  const penalty = (legs.length - 1) * 4;
  const score = Math.round(Math.max(avg - penalty, 20));
  const tier = score >= 70 ? 'S' : score >= 60 ? 'A' : score >= 50 ? 'B' : 'C';
  const color = score >= 70 ? '#4ade80' : score >= 60 ? '#fbbf24' : score >= 50 ? '#38bdf8' : '#64748b';
  return { score, tier, color };
}

// Group props by game for display
function groupByGame(props: PlayerProp[]): Record<string, PlayerProp[]> {
  const groups: Record<string, PlayerProp[]> = {};
  props.forEach(p => {
    const key = p.gameId || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });
  return groups;
}

export function CrossSportParlay() {
  const [activeSport, setActiveSport] = useState<Sport>('mlb');
  const [viewFilter, setViewFilter] = useState<'all' | 'games' | 'props'>('all');
  const [showPublic, setShowPublic] = useState(false);
  const [allSportProps, setAllSportProps] = useState<Partial<Record<Sport, PlayerProp[]>>>({});
  const [loading, setLoading] = useState<Partial<Record<Sport, boolean>>>({});
  const [legs, setLegs] = useState<ParlayLeg[]>([]);
  const [mode, setMode] = useState<'builder' | 'pick6'>('builder');
  const [stake, setStake] = useState('25');

  // Load props + game lines for a sport when selected
  useEffect(() => {
    setViewFilter('all'); // reset filter on sport change
    if (allSportProps[activeSport]) return;
    setLoading(prev => ({ ...prev, [activeSport]: true }));

    Promise.all([
      apiService.getAllProps(activeSport).catch(() => [] as PlayerProp[]),
      apiService.getGameLines(activeSport)
        .then(lines => apiService.gameLinesToProps(lines))
        .catch(() => [] as PlayerProp[]),
    ]).then(([playerProps, gameLineProps]) => {
      const merged = [...gameLineProps, ...playerProps];
      setAllSportProps(prev => ({ ...prev, [activeSport]: merged }));
      // Auto-switch to props view if no game lines came back
      if (gameLineProps.length === 0 && playerProps.length > 0) {
        setViewFilter('props');
      }
    }).catch(() => {
      setAllSportProps(prev => ({ ...prev, [activeSport]: [] }));
    }).finally(() => {
      setLoading(prev => ({ ...prev, [activeSport]: false }));
    });
  }, [activeSport]);

  const addLeg = (prop: PlayerProp, pick: 'over' | 'under') => {
    const odds = pick === 'over' ? prop.overOdds : prop.underOdds;
    if (!odds || odds === 0) return;
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
  const { score, tier, color } = parlayConfidence(legs);

  const allProps = allSportProps[activeSport] || [];
  const isLegAdded = (id: string, pick: string) => legs.some(l => l.prop.id === id && l.pick === pick);

  // Filter props based on view
  const filteredProps = allProps.filter(p => {
    if (viewFilter === 'games') return GAME_BET_TYPES.includes(p.propType);
    if (viewFilter === 'props') return !GAME_BET_TYPES.includes(p.propType);
    return true;
  });

  // Group game bets by matchup
  const gameLines = filteredProps.filter(p => GAME_BET_TYPES.includes(p.propType));
  const playerProps = filteredProps.filter(p => !GAME_BET_TYPES.includes(p.propType));

  // Group game lines by gameId for clean display
  const gameGroups = groupByGame(gameLines);

  const tierColors: Record<string, { bg: string; border: string; text: string }> = {
    S: { bg: 'rgba(74,222,128,.12)', border: 'rgba(74,222,128,.25)', text: '#4ade80' },
    A: { bg: 'rgba(251,191,36,.1)', border: 'rgba(251,191,36,.2)', text: '#fbbf24' },
    B: { bg: 'rgba(56,189,248,.1)', border: 'rgba(56,189,248,.2)', text: '#38bdf8' },
    C: { bg: 'rgba(100,116,139,.08)', border: 'rgba(100,116,139,.15)', text: '#64748b' },
  };
  const tc = tierColors[tier] || tierColors.C;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, fontFamily: "'Barlow', system-ui, sans-serif" }}>

      {/* ── LEFT: Browse & add legs ── */}
      <div>

        {/* Mode + view controls */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {(['builder', 'pick6'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setLegs([]); }} style={{
              padding: '6px 16px', borderRadius: 7, cursor: 'pointer',
              fontFamily: "'Barlow', sans-serif", fontSize: 12, fontWeight: 700,
              background: mode === m ? 'rgba(14,165,233,.12)' : 'rgba(255,255,255,.03)',
              color: mode === m ? '#38bdf8' : '#2a4060',
              border: `1px solid ${mode === m ? 'rgba(14,165,233,.3)' : 'rgba(255,255,255,.06)'}`,
              transition: 'all .15s',
            }}>
              {m === 'builder' ? '⚡ Parlay Builder' : '🎯 Pick 6'}
            </button>
          ))}
          <button onClick={() => setShowPublic(v => !v)} style={{
            padding: '6px 16px', borderRadius: 7, cursor: 'pointer',
            fontFamily: "'Barlow', sans-serif", fontSize: 12, fontWeight: 700,
            background: showPublic ? 'rgba(251,191,36,.1)' : 'rgba(255,255,255,.03)',
            color: showPublic ? '#fbbf24' : '#2a4060',
            border: `1px solid ${showPublic ? 'rgba(251,191,36,.25)' : 'rgba(255,255,255,.06)'}`,
          }}>📊 Public Betting %</button>
          {mode === 'pick6' && (
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: legs.length === 6 ? '#4ade80' : '#1a3060' }}>
              {legs.length}/6 picked
            </span>
          )}
        </div>

        {/* Sport tabs */}
        <div style={{ display: 'flex', gap: 3, marginBottom: 12, overflowX: 'auto', padding: '3px 0' }}>
          {SPORTS.map(s => (
            <button key={s} onClick={() => setActiveSport(s)} style={{
              padding: '6px 13px', whiteSpace: 'nowrap', borderRadius: 7,
              fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: .3,
              background: activeSport === s ? 'rgba(14,165,233,.1)' : 'rgba(255,255,255,.025)',
              color: activeSport === s ? '#38bdf8' : '#2a4060',
              border: `1px solid ${activeSport === s ? 'rgba(14,165,233,.25)' : 'rgba(255,255,255,.06)'}`,
              cursor: 'pointer', transition: 'all .15s',
            }}>{SPORT_LABELS[s]}</button>
          ))}
        </div>

        {/* View filter: All / Game Bets / Player Props */}
        {!showPublic && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {(['all', 'games', 'props'] as const).map(f => {
              const labels = { all: '📋 All', games: '🏟 Game Bets', props: '👤 Player Props' };
              const counts = {
                all: allProps.length,
                games: allProps.filter(p => GAME_BET_TYPES.includes(p.propType)).length,
                props: allProps.filter(p => !GAME_BET_TYPES.includes(p.propType)).length,
              };
              return (
                <button key={f} onClick={() => setViewFilter(f)} style={{
                  padding: '5px 13px', borderRadius: 6, cursor: 'pointer',
                  fontFamily: "'Barlow', sans-serif", fontSize: 11, fontWeight: 700,
                  background: viewFilter === f ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.02)',
                  color: viewFilter === f ? '#c8ddf0' : '#1e3a60',
                  border: `1px solid ${viewFilter === f ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.05)'}`,
                }}>
                  {labels[f]} {counts[f] > 0 && <span style={{ fontSize: 9, opacity: .7 }}>({counts[f]})</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Public betting view */}
        {showPublic && <PublicBetting sport={activeSport} />}

        {/* Loading */}
        {!showPublic && loading[activeSport] && (
          <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 10, padding: '28px 20px', textAlign: 'center', color: '#1e3560' }}>
            Loading {SPORT_LABELS[activeSport]} lines &amp; props…
          </div>
        )}

        {/* Empty */}
        {!showPublic && !loading[activeSport] && filteredProps.length === 0 && (() => {
          const hasAny = allProps.length > 0;
          const hasGameLines = allProps.some(p => GAME_BET_TYPES.includes(p.propType));
          const hasPlayerProps = allProps.some(p => !GAME_BET_TYPES.includes(p.propType));
          return (
            <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 10, padding: '32px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>
                {!hasAny ? '📅' : viewFilter === 'games' ? '🏟' : '👤'}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3560', marginBottom: 6 }}>
                {!hasAny
                  ? `No ${SPORT_LABELS[activeSport]} games scheduled today`
                  : viewFilter === 'games' && !hasGameLines
                  ? `No ${SPORT_LABELS[activeSport]} game lines available`
                  : viewFilter === 'props' && !hasPlayerProps
                  ? `No ${SPORT_LABELS[activeSport]} player props available`
                  : `No ${SPORT_LABELS[activeSport]} bets available`}
              </div>
              {viewFilter === 'games' && hasPlayerProps && (
                <button onClick={() => setViewFilter('props')} style={{
                  marginTop: 8, padding: '6px 16px', borderRadius: 7, cursor: 'pointer',
                  background: 'rgba(14,165,233,.1)', color: '#38bdf8',
                  border: '1px solid rgba(14,165,233,.25)',
                  fontSize: 12, fontWeight: 700, fontFamily: "'Barlow', sans-serif",
                }}>👤 Switch to Player Props</button>
              )}
              {viewFilter === 'props' && hasGameLines && (
                <button onClick={() => setViewFilter('games')} style={{
                  marginTop: 8, padding: '6px 16px', borderRadius: 7, cursor: 'pointer',
                  background: 'rgba(14,165,233,.1)', color: '#38bdf8',
                  border: '1px solid rgba(14,165,233,.25)',
                  fontSize: 12, fontWeight: 700, fontFamily: "'Barlow', sans-serif",
                }}>🏟 Switch to Game Bets</button>
              )}
            </div>
          );
        })()}

        {/* ── GAME BETS section ── */}
        {!showPublic && !loading[activeSport] && (viewFilter === 'all' || viewFilter === 'games') && Object.keys(gameGroups).length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 700, color: '#1a3060', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
              🏟 Game Bets — Moneyline · Spread · Total
            </div>
            {Object.values(gameGroups).map((gameBets, gi) => {
              const ml    = gameBets.filter(p => p.propType === 'Moneyline');
              const spread = gameBets.filter(p => p.propType === 'Spread');
              const total  = gameBets.filter(p => p.propType === 'Game Total');
              const matchup = `${gameBets[0].awayTeam} @ ${gameBets[0].homeTeam}`;

              // Each ML/spread prop is its own pick — always use 'over' (odds stored in overOdds)
              const BetBtn = ({ prop, label, color = '#c8ddf0' }: { prop: PlayerProp; label: string; color?: string }) => {
                const added = isLegAdded(prop.id, 'over');
                const odds = prop.overOdds || 0;
                return (
                  <button onClick={() => addLeg(prop, 'over')} style={{
                    flex: 1, padding: '9px 10px', borderRadius: 7, cursor: 'pointer', textAlign: 'left',
                    background: added ? 'rgba(14,165,233,.18)' : 'rgba(255,255,255,.03)',
                    border: `1px solid ${added ? 'rgba(14,165,233,.4)' : 'rgba(255,255,255,.08)'}`,
                    fontFamily: "'Barlow', sans-serif", transition: 'all .15s', minWidth: 0,
                  }}>
                    <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: .8, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 800, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prop.playerName}</div>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 17, fontWeight: 900, color: odds > 0 ? '#4ade80' : '#dce6f0', marginTop: 1 }}>{fmt(odds)}</div>
                  </button>
                );
              };

              return (
                <div key={gi} style={{ background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 800, color: '#c8ddf0', letterSpacing: .3, marginBottom: 10 }}>
                    {matchup}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {/* Moneylines — one button per team */}
                    {ml.map(prop => <BetBtn key={prop.id} prop={prop} label="ML" />)}

                    {/* Spreads — one button per team */}
                    {spread.map(prop => <BetBtn key={prop.id} prop={prop} label="SPREAD" />)}

                    {/* Game Total — over and under as separate bets */}
                    {total.map(prop => {
                      const overAdded  = isLegAdded(prop.id, 'over');
                      const underAdded = isLegAdded(prop.id, 'under');
                      return (
                        <div key={prop.id} style={{ display: 'flex', gap: 6, flex: '1 1 200px' }}>
                          <button onClick={() => addLeg(prop, 'over')} style={{
                            flex: 1, padding: '9px 10px', borderRadius: 7, cursor: 'pointer', textAlign: 'left',
                            background: overAdded ? 'rgba(74,222,128,.15)' : 'rgba(255,255,255,.03)',
                            border: `1px solid ${overAdded ? 'rgba(74,222,128,.35)' : 'rgba(255,255,255,.08)'}`,
                            fontFamily: "'Barlow', sans-serif", transition: 'all .15s',
                          }}>
                            <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: .8, textTransform: 'uppercase', marginBottom: 3 }}>OVER {prop.line}</div>
                            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, color: '#4ade80' }}>Over</div>
                            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 17, fontWeight: 900, color: '#4ade80' }}>{fmt(prop.overOdds || 0)}</div>
                          </button>
                          <button onClick={() => addLeg(prop, 'under')} style={{
                            flex: 1, padding: '9px 10px', borderRadius: 7, cursor: 'pointer', textAlign: 'left',
                            background: underAdded ? 'rgba(248,113,113,.15)' : 'rgba(255,255,255,.03)',
                            border: `1px solid ${underAdded ? 'rgba(248,113,113,.35)' : 'rgba(255,255,255,.08)'}`,
                            fontFamily: "'Barlow', sans-serif", transition: 'all .15s',
                          }}>
                            <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: .8, textTransform: 'uppercase', marginBottom: 3 }}>UNDER {prop.line}</div>
                            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, color: '#f87171' }}>Under</div>
                            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 17, fontWeight: 900, color: '#f87171' }}>{fmt(prop.underOdds || -110)}</div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── PLAYER PROPS section ── */}
        {!showPublic && !loading[activeSport] && (viewFilter === 'all' || viewFilter === 'props') && playerProps.length > 0 && (
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 700, color: '#1a3060', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
              👤 Player Props
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 420, overflowY: 'auto' }}>
              {playerProps.slice(0, 60).map(prop => {
                const overAdded = isLegAdded(prop.id, 'over');
                const underAdded = isLegAdded(prop.id, 'under');
                const conf = scoreLeg(prop, 'over');
                const confColor = conf >= 70 ? '#4ade80' : conf >= 58 ? '#fbbf24' : '#1e3a60';
                return (
                  <div key={prop.id} style={{
                    background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)',
                    borderRadius: 9, padding: '10px 13px',
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 800, color: '#c8ddf0', letterSpacing: .2 }}>{prop.playerName}</div>
                      <div style={{ fontSize: 11, color: '#1e3a60', fontWeight: 600, marginTop: 1 }}>
                        {prop.propType} {prop.line} · {prop.homeTeam} vs {prop.awayTeam}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: confColor, fontFamily: "'Barlow Condensed', sans-serif" }}>{conf}%</span>
                    <button onClick={() => addLeg(prop, 'over')} style={{
                      padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                      fontFamily: "'Barlow', sans-serif", fontSize: 12, fontWeight: 700,
                      background: overAdded ? 'rgba(74,222,128,.15)' : 'rgba(255,255,255,.03)',
                      color: overAdded ? '#4ade80' : '#c8ddf0',
                      border: `1px solid ${overAdded ? 'rgba(74,222,128,.3)' : 'rgba(255,255,255,.07)'}`,
                    }}>O {prop.line} <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 900 }}>{fmt(prop.overOdds)}</span></button>
                    <button onClick={() => addLeg(prop, 'under')} style={{
                      padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                      fontFamily: "'Barlow', sans-serif", fontSize: 12, fontWeight: 700,
                      background: underAdded ? 'rgba(248,113,113,.15)' : 'rgba(255,255,255,.03)',
                      color: underAdded ? '#f87171' : '#c8ddf0',
                      border: `1px solid ${underAdded ? 'rgba(248,113,113,.3)' : 'rgba(255,255,255,.07)'}`,
                    }}>U {prop.line} <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 900 }}>{fmt(prop.underOdds)}</span></button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT: Parlay slip ── */}
      <div style={{ position: 'sticky', top: 70 }}>
        <div style={{ background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, overflow: 'hidden' }}>
          {/* Slip header */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 800, color: '#c8ddf0', letterSpacing: .3 }}>
              {mode === 'pick6' ? '🎯 Pick 6 Slip' : '⚡ Parlay Slip'}
            </div>
            {legs.length > 0 && (
              <button onClick={() => setLegs([])} style={{ fontSize: 11, color: '#2a4060', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 700, fontFamily: "'Barlow', sans-serif" }}>Clear all</button>
            )}
          </div>

          {/* Confidence bar */}
          {legs.length > 0 && (
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.05)', background: 'rgba(0,0,0,.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Confidence</div>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 900, color, lineHeight: 1 }}>{score}%</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ ...tc, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 900, padding: '3px 10px', borderRadius: 6, display: 'inline-block', background: tc.bg, border: `1px solid ${tc.border}`, color: tc.text }}>
                    {tier}-TIER
                  </div>
                  <div style={{ fontSize: 10, color: '#1a3060', marginTop: 4, fontWeight: 600 }}>{legs.length} leg{legs.length !== 1 ? 's' : ''}</div>
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,.05)', borderRadius: 3, height: 3 }}>
                <div style={{ width: `${score}%`, background: color, height: 3, borderRadius: 3, transition: 'width .3s' }} />
              </div>
            </div>
          )}

          {/* Legs list */}
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {legs.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: '#1a3060', fontSize: 12, fontWeight: 600 }}>
                {mode === 'pick6' ? 'Pick 6 bets to build your slip' : 'Click any Game Bet or Player Prop to add legs'}
              </div>
            ) : legs.map((leg, i) => {
              const conf = scoreLeg(leg.prop, leg.pick);
              const confColor = conf >= 70 ? '#4ade80' : conf >= 58 ? '#fbbf24' : '#64748b';
              const isGameBet = GAME_BET_TYPES.includes(leg.prop.propType);
              return (
                <div key={i} style={{ padding: '9px 13px', borderBottom: '1px solid rgba(255,255,255,.04)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: '#1a3060', fontWeight: 700, letterSpacing: .5 }}>{SPORT_LABELS[leg.sport]} · {isGameBet ? '🏟' : '👤'} {leg.prop.propType}</div>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, color: '#c8ddf0', letterSpacing: .2 }}>{leg.prop.playerName}</div>
                    <div style={{ fontSize: 11 }}>
                      <span style={{ color: leg.pick === 'over' ? '#4ade80' : '#f87171', fontWeight: 800 }}>{leg.pick.toUpperCase()}</span>
                      {leg.prop.propType !== 'Moneyline' && <span style={{ color: '#1e3a60' }}> {leg.prop.line}</span>}
                      <span style={{ color: '#1e3a60' }}> · </span>
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, color: leg.odds > 0 ? '#4ade80' : '#c8ddf0' }}>{fmt(leg.odds)}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, color: confColor, fontFamily: "'Barlow Condensed', sans-serif" }}>{conf}%</span>
                  <button onClick={() => removeLeg(i)} style={{ background: 'transparent', border: 'none', color: '#1a3060', cursor: 'pointer', fontSize: 17, padding: '0 4px', lineHeight: 1 }}>×</button>
                </div>
              );
            })}
          </div>

          {/* Payout section */}
          {legs.length > 0 && (
            <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#c8ddf0' }}>Combined Odds</span>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, fontWeight: 900, color: '#4ade80' }}>{fmt(combinedOdds)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  value={stake}
                  onChange={e => setStake(e.target.value)}
                  placeholder="Stake $"
                  style={{ flex: 1, background: 'rgba(255,255,255,.04)', color: '#dce6f0', border: '1px solid rgba(255,255,255,.09)', borderRadius: 7, padding: '7px 10px', fontSize: 13, outline: 'none', fontFamily: "'Barlow', sans-serif" }}
                />
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Payout</div>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 900, color: '#4ade80', lineHeight: 1 }}>${payout}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#1a3060', fontWeight: 600, textAlign: 'right', marginBottom: 10 }}>
                Profit: <span style={{ color: parseFloat(profit) > 0 ? '#4ade80' : '#f87171', fontWeight: 800 }}>${profit}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <a href="https://sportsbook.draftkings.com" target="_blank" rel="noopener noreferrer" style={{ flex: 1, padding: '7px', background: 'rgba(74,222,128,.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,.25)', borderRadius: 7, fontSize: 11, fontWeight: 800, textDecoration: 'none', textAlign: 'center', fontFamily: "'Barlow', sans-serif" }}>🏈 DraftKings</a>
                <a href="https://app.prizepicks.com" target="_blank" rel="noopener noreferrer" style={{ flex: 1, padding: '7px', background: 'rgba(129,140,248,.1)', color: '#818cf8', border: '1px solid rgba(129,140,248,.25)', borderRadius: 7, fontSize: 11, fontWeight: 800, textDecoration: 'none', textAlign: 'center', fontFamily: "'Barlow', sans-serif" }}>🎯 PrizePicks</a>
              </div>
              <AIScanner legs={legs.map(l => ({ playerName: l.prop.playerName, propType: l.prop.propType, line: l.prop.line, pick: l.pick, odds: l.odds, homeTeam: l.prop.homeTeam, awayTeam: l.prop.awayTeam }))} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import type { PlayerProp, GameData, WNBAGameData, Sport } from '../services/api';

interface ParlayLeg {
  prop: PlayerProp;
  pick: 'over' | 'under';
  odds: number;
  confidence: number;
  reason: string;
  edgeFlags: string[];
}

interface Parlay {
  id: string;
  legs: ParlayLeg[];
  combinedOdds: number;
  confidence: number;
  label: string;
  edgeSummary: string;
  sport: Sport;
  tier: 'S' | 'A' | 'B';
}

interface ParlayBuilderProps {
  props: PlayerProp[];
  games: (GameData | WNBAGameData)[];
  sport: Sport;
}

// ─── PARK FACTORS ────────────────────────────────────────────────────────────
// Source: Baseball Savant / FTA 2026. Values relative to 1.00 neutral.
const PARK_FACTORS: Record<string, { runs: number; hr: number; hits: number; label: string }> = {
  'Great American Ball Park': { runs: 1.12, hr: 1.18, hits: 1.08, label: '🔴 Extreme hitter' },
  'Coors Field':              { runs: 1.38, hr: 1.22, hits: 1.18, label: '🔴 Extreme hitter' },
  'Yankee Stadium':           { runs: 1.09, hr: 1.16, hits: 1.05, label: '🟠 Hitter-friendly' },
  'Globe Life Field':         { runs: 1.08, hr: 1.12, hits: 1.04, label: '🟠 Hitter-friendly' },
  'Truist Park':              { runs: 1.06, hr: 1.09, hits: 1.03, label: '🟠 Hitter-friendly' },
  'Wrigley Field':            { runs: 1.05, hr: 1.07, hits: 1.04, label: '🟡 Slight hitter' },
  'Minute Maid Park':         { runs: 1.04, hr: 1.06, hits: 1.02, label: '🟡 Slight hitter' },
  'Dodger Stadium':           { runs: 0.96, hr: 0.94, hits: 0.97, label: '🟡 Slight pitcher' },
  'Petco Park':               { runs: 0.91, hr: 0.86, hits: 0.94, label: '🟠 Pitcher-friendly' },
  'Oracle Park':              { runs: 0.88, hr: 0.82, hits: 0.93, label: '🔴 Extreme pitcher' },
  'T-Mobile Park':            { runs: 0.89, hr: 0.85, hits: 0.92, label: '🔴 Extreme pitcher' },
  'Comerica Park':            { runs: 0.90, hr: 0.87, hits: 0.93, label: '🟠 Pitcher-friendly' },
};

// ─── UMPIRE ZONE TENDENCIES ───────────────────────────────────────────────────
const UMPIRE_ZONES: Record<string, { zone: 'tight' | 'wide' | 'normal'; kAdj: number }> = {
  'Angel Hernandez': { zone: 'tight', kAdj: -8 },
  'Tom Hallion':     { zone: 'tight', kAdj: -7 },
  'CB Bucknor':      { zone: 'normal', kAdj: 0 },
  'Dan Bellino':     { zone: 'normal', kAdj: 0 },
  'Joe West':        { zone: 'wide', kAdj: +9 },
  'Ángel Hernández': { zone: 'tight', kAdj: -8 },
};

// ─── WNBA TEAM PACE ──────────────────────────────────────────────────────────
const WNBA_PACE: Record<string, number> = {
  'Indiana Fever': 95,
  'Las Vegas Aces': 90,
  'New York Liberty': 88,
  'Seattle Storm': 84,
  'Chicago Sky': 86,
  'Connecticut Sun': 83,
  'Dallas Wings': 87,
  'Minnesota Lynx': 85,
  'Los Angeles Sparks': 82,
  'Atlanta Dream': 86,
  'Washington Mystics': 84,
  'Phoenix Mercury': 88,
};

// ─── MATH HELPERS ────────────────────────────────────────────────────────────
function americanToDecimal(odds: number): number {
  if (odds === 0) return 1;
  if (odds > 0) return odds / 100 + 1;
  return 100 / Math.abs(odds) + 1;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function getConfidenceColor(c: number): string {
  if (c >= 78) return '#4ade80';
  if (c >= 68) return '#fbbf24';
  return '#f87171';
}

function getTierColor(tier: string): string {
  if (tier === 'S') return '#4ade80';
  if (tier === 'A') return '#fbbf24';
  return '#9ca3af';
}

function formatOdds(odds: number): string {
  if (odds === 0) return 'N/A';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// ─── CORE SCORING ENGINE ─────────────────────────────────────────────────────
function scoreLeg(
  prop: PlayerProp,
  pick: 'over' | 'under',
  games: (GameData | WNBAGameData)[],
  sport: Sport
): { confidence: number; reason: string; edgeFlags: string[] } {
  const odds = pick === 'over' ? prop.overOdds : prop.underOdds;
  if (odds === 0) return { confidence: 0, reason: 'no odds', edgeFlags: [] };

  let confidence = 52;
  const flags: string[] = [];
  const reasons: string[] = [];

  // Find the game this prop belongs to
  const game = games.find(g => g.id === prop.gameId);

  if (sport === 'mlb') {
    const mlbGame = game as GameData | undefined;

    // ── Park factor adjustment ──
    const venue = mlbGame?.venue || '';
    const pf = PARK_FACTORS[venue];
    if (pf) {
      if (pick === 'over') {
        if (prop.propType === 'Home Runs' || prop.propType === 'Total Bases') {
          const boost = Math.round((pf.hr - 1) * 60);
          confidence += boost;
          if (boost > 5) flags.push(`${pf.label} park +HR`);
          if (boost < -5) flags.push(`${pf.label} park -HR`);
        }
        if (prop.propType === 'Hits') {
          const boost = Math.round((pf.hits - 1) * 50);
          confidence += boost;
          if (Math.abs(boost) > 3) flags.push(`${pf.label} park`);
        }
      }
      if (pick === 'under') {
        if (prop.propType === 'Home Runs' || prop.propType === 'Total Bases') {
          const boost = Math.round((1 - pf.hr) * 60);
          confidence += boost;
          if (boost > 5) flags.push(`${pf.label} park favors under`);
        }
      }
    }

    // ── Umpire adjustment for K props ──
    const umpName = mlbGame?.umpire?.name || '';
    const ump = UMPIRE_ZONES[umpName];
    if (ump && prop.propType === 'Strikeouts') {
      if (pick === 'over') {
        confidence += ump.kAdj;
        if (ump.kAdj > 0) flags.push(`Wide zone ump (+K)`);
        if (ump.kAdj < 0) flags.push(`Tight zone ump (-K)`);
      } else {
        confidence -= ump.kAdj;
        if (ump.kAdj < 0) flags.push(`Tight zone favors K under`);
      }
    }

    // ── Wind direction adjustment ──
    const weather = mlbGame?.weather;
    if (weather) {
      const windSpeed = weather.windSpeed || 0;
      const conditions = weather.conditions?.toLowerCase() || '';
      const blowingOut = conditions.includes('out') || conditions.includes('sw') || conditions.includes('south');
      const blowingIn = conditions.includes('in') || conditions.includes('nw') || conditions.includes('north');

      if (windSpeed >= 10) {
        if (blowingOut && pick === 'over' && (prop.propType === 'Home Runs' || prop.propType === 'Total Bases')) {
          confidence += 10;
          flags.push(`💨 Wind blowing out ${windSpeed}mph`);
        }
        if (blowingIn && pick === 'under' && (prop.propType === 'Home Runs' || prop.propType === 'Total Bases')) {
          confidence += 10;
          flags.push(`💨 Wind blowing in ${windSpeed}mph`);
        }
        if (blowingIn && pick === 'over' && prop.propType === 'Home Runs') {
          confidence -= 8;
          flags.push(`⚠️ Wind in hurts HR`);
        }
      }

      // Temperature - cold suppresses offense
      if (weather.temperature < 50 && pick === 'under') {
        confidence += 6;
        flags.push(`🥶 Cold weather (${weather.temperature}°F)`);
      }
      if (weather.temperature > 85 && pick === 'over') {
        confidence += 4;
        flags.push(`🌡️ Hot weather boost`);
      }
    }

    // ── Prop type base edges ──
    if (prop.propType === 'Hits' && pick === 'over' && prop.line <= 1.5) {
      confidence += 8;
      reasons.push('low hits threshold');
    }
    if (prop.propType === 'Strikeouts' && pick === 'over' && prop.line >= 6.0) {
      confidence += 5;
      reasons.push('elite K line');
    }
    if (prop.propType === 'Total Bases' && pick === 'over' && prop.line <= 1.5) {
      confidence += 7;
      reasons.push('easy TB threshold');
    }
    if (prop.propType === 'Stolen Bases' && pick === 'over') {
      confidence += 6;
      reasons.push('SB props undervalued');
    }

  } else {
    // ── WNBA scoring ──

    // Market inefficiency bonus — WNBA lines are softer than any other sport
    confidence += 7;
    flags.push('WNBA market inefficiency');

    // Pace boost for points props
    const homePace = WNBA_PACE[game ? (game as WNBAGameData).homeTeam : ''] || 86;
    const awayPace = WNBA_PACE[game ? (game as WNBAGameData).awayTeam : ''] || 86;
    const avgPace = (homePace + awayPace) / 2;

    if (avgPace >= 90 && pick === 'over' && prop.propType === 'Points') {
      confidence += 9;
      flags.push(`⚡ High pace (${avgPace.toFixed(0)} poss)`);
    }
    if (avgPace <= 83 && pick === 'under' && prop.propType === 'Points') {
      confidence += 8;
      flags.push(`🐢 Slow pace (${avgPace.toFixed(0)} poss)`);
    }

    // Rebounds and assists are softer markets
    if (prop.propType === 'Rebounds' || prop.propType === 'Assists') {
      confidence += 8;
      reasons.push('soft WNBA line');
    }

    // 3-pointers — target perimeter shooters vs poor 3pt defense
    if (prop.propType === '3-Pointers' && pick === 'over') {
      confidence += 6;
      reasons.push('3pt props underpriced');
    }

    // Pts+Reb+Ast combo props — great value for versatile players
    if (prop.propType === 'Pts+Reb+Ast' && pick === 'over') {
      confidence += 7;
      reasons.push('combo prop value');
    }

    // Back-to-back detection (if game is within 1 day of another game)
    const gameTime = game ? new Date(game.startTime).getTime() : 0;
    const recentGame = games.find(g => {
      if (g.id === game?.id) return false;
      const diff = Math.abs(new Date(g.startTime).getTime() - gameTime);
      return diff < 30 * 3600 * 1000; // within 30 hours
    });
    if (recentGame && pick === 'under') {
      confidence += 8;
      flags.push('😴 Back-to-back fatigue');
    }
  }

  // ── Odds-based adjustments ──
  if (odds > 0) {
    confidence += 6;
    reasons.push('+EV odds');
  }
  if (Math.abs(odds) <= 110) {
    confidence += 5;
    reasons.push('near-even line');
  }
  if (odds < -160) {
    confidence -= 5; // heavy juice = less value
  }

  // Cap
  confidence = Math.min(Math.max(confidence, 30), 90);

  return {
    confidence,
    reason: reasons.slice(0, 2).join(', ') || 'edge identified',
    edgeFlags: flags.slice(0, 3)
  };
}

// ─── PARLAY BUILDER ENGINE ────────────────────────────────────────────────────
function buildAllParlays(
  props: PlayerProp[],
  games: (GameData | WNBAGameData)[],
  sport: Sport
): Parlay[] {
  if (props.length === 0) return [];

  // Only use props from scheduled games — no live/final games in parlays
  const scheduledGameIds = new Set(
    games.filter(g => g.status === 'scheduled').map(g => g.id)
  );
  const activeProps = props.filter(p => scheduledGameIds.has(p.gameId));

  // Score every leg
  const allLegs: ParlayLeg[] = [];
  activeProps.forEach(prop => {
    ['over', 'under'].forEach(side => {
      const pick = side as 'over' | 'under';
      const odds = pick === 'over' ? prop.overOdds : prop.underOdds;
      if (!odds || odds === 0) return;
      const { confidence, reason, edgeFlags } = scoreLeg(prop, pick, games, sport);
      if (confidence >= 50) {
        allLegs.push({ prop, pick, odds, confidence, reason, edgeFlags });
      }
    });
  });

  // Sort by confidence
  allLegs.sort((a, b) => b.confidence - a.confidence);

  const parlays: Parlay[] = [];

  // Generate 10 parlays across 2/3/4/5 legs with different strategies
  const strategies = [
    { size: 3, label: 'Top Confidence', name: 'top', count: 3 },
    { size: 4, label: 'Best Value', name: 'value', count: 2 },
    { size: 5, label: 'Max Payout', name: 'max', count: 2 },
    { size: 2, label: 'Safe Double', name: 'safe', count: 2 },
    { size: 3, label: 'Balanced Pick', name: 'balanced', count: 1 },
  ];

  strategies.forEach(({ size, label, name, count }) => {
    for (let attempt = 0; attempt < count; attempt++) {
      const usedPlayers = new Set<string>();
      const legs: ParlayLeg[] = [];

      // For "value" strategy, sort by odds value. For "max", take riskier legs.
      let pool = [...allLegs];
      if (name === 'value') {
        pool.sort((a, b) => {
          const aScore = a.confidence * 0.6 + (a.odds > 0 ? a.odds / 10 : 0) * 0.4;
          const bScore = b.confidence * 0.6 + (b.odds > 0 ? b.odds / 10 : 0) * 0.4;
          return bScore - aScore;
        });
      } else if (name === 'max') {
        pool.sort((a, b) => {
          const aOdds = americanToDecimal(a.odds);
          const bOdds = americanToDecimal(b.odds);
          return bOdds - aOdds;
        });
      } else if (name === 'balanced') {
        // Interleave high and mid confidence
        const high = allLegs.filter(l => l.confidence >= 70);
        const mid = allLegs.filter(l => l.confidence >= 58 && l.confidence < 70);
        pool = [];
        const maxLen = Math.max(high.length, mid.length);
        for (let i = 0; i < maxLen; i++) {
          if (high[i]) pool.push(high[i]);
          if (mid[i]) pool.push(mid[i]);
        }
      } else if (name === 'safe') {
        pool = allLegs.filter(l => Math.abs(l.odds) <= 130);
      }

      // Offset pool for second attempt to get variety
      if (attempt === 1) pool = pool.slice(Math.floor(pool.length * 0.3));

      for (const leg of pool) {
        const playerKey = `${leg.prop.playerName}-${leg.prop.propType}`;
        if (!usedPlayers.has(playerKey) && legs.length < size) {
          usedPlayers.add(playerKey);
          legs.push(leg);
        }
      }

      if (legs.length < size) continue;

      const decOdds = legs.map(l => americanToDecimal(l.odds));
      const combined = decOdds.reduce((a, b) => a * b, 1);
      const combinedOdds = decimalToAmerican(combined);
      const avgConf = Math.round(legs.reduce((a, b) => a + b.confidence, 0) / legs.length);
      const allFlags = [...new Set(legs.flatMap(l => l.edgeFlags))].slice(0, 4);
      const tier: 'S' | 'A' | 'B' = avgConf >= 75 ? 'S' : avgConf >= 65 ? 'A' : 'B';

      parlays.push({
        id: `${name}-${size}-${attempt}-${Date.now()}`,
        legs,
        combinedOdds,
        confidence: avgConf,
        label: `${size}-Leg ${label}`,
        edgeSummary: allFlags.join(' • ') || 'Statistical edge',
        sport,
        tier
      });
    }
  });

  // Sort by confidence desc, return top 10
  parlays.sort((a, b) => b.confidence - a.confidence);
  return parlays.slice(0, 10);
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────
export function ParlayBuilder({ props, games, sport }: ParlayBuilderProps) {
  const [parlays, setParlays] = useState<Parlay[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filterSize, setFilterSize] = useState<number | 'all'>('all');
  const [filterTier, setFilterTier] = useState<string>('all');

  useEffect(() => {
    const built = buildAllParlays(props, games, sport);
    setParlays(built);
    setExpanded(built[0]?.id || null);
  }, [props, games, sport]);

  const filtered = parlays.filter(p => {
    const sizeMatch = filterSize === 'all' || p.legs.length === filterSize;
    const tierMatch = filterTier === 'all' || p.tier === filterTier;
    return sizeMatch && tierMatch;
  });

  if (props.length === 0) {
    return (
      <div style={{ background: '#1e2a44', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#9ca3af', marginTop: '20px' }}>
        <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏳</div>
        <div>Waiting for real props to load from today's scheduled games.</div>
        <div style={{ fontSize: '12px', marginTop: '8px', color: '#6b7280' }}>Props load automatically at startup. Live and final games are excluded.</div>
      </div>
    );
  }

  const btnStyle = (active: boolean) => ({
    padding: '5px 12px',
    background: active ? '#4fc3f7' : '#1e2a44',
    color: active ? 'black' : '#9ca3af',
    border: `1px solid ${active ? '#4fc3f7' : '#374151'}`,
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 'bold' as const,
  });

  return (
    <div style={{ marginTop: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h3 style={{ color: '#4fc3f7', margin: 0 }}>⚡ Today's Top 10 Parlays</h3>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
            Park factors • Umpire zones • Wind • Pace • Market inefficiency
          </div>
        </div>
        <div style={{ fontSize: '12px', color: '#4ade80', fontWeight: 'bold' }}>
          {parlays.length} generated
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <span style={{ color: '#9ca3af', fontSize: '12px', alignSelf: 'center' }}>Legs:</span>
        {['all', 2, 3, 4, 5].map(s => (
          <button key={s} style={btnStyle(filterSize === s)} onClick={() => setFilterSize(s as any)}>
            {s === 'all' ? 'All' : `${s}-Leg`}
          </button>
        ))}
        <span style={{ color: '#9ca3af', fontSize: '12px', alignSelf: 'center', marginLeft: '8px' }}>Tier:</span>
        {['all', 'S', 'A', 'B'].map(t => (
          <button key={t} style={btnStyle(filterTier === t)} onClick={() => setFilterTier(t)}>
            {t === 'all' ? 'All' : `${t}-Tier`}
          </button>
        ))}
      </div>

      {/* Parlay cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filtered.map((parlay, idx) => (
          <div key={parlay.id} style={{ background: '#1e2a44', border: `1px solid ${expanded === parlay.id ? '#4fc3f7' : '#374151'}`, borderRadius: '8px', overflow: 'hidden' }}>

            {/* Card header */}
            <div
              onClick={() => setExpanded(expanded === parlay.id ? null : parlay.id)}
              style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
            >
              {/* Rank */}
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#6b7280', minWidth: '24px' }}>
                #{idx + 1}
              </div>

              {/* Tier badge */}
              <div style={{ background: getTierColor(parlay.tier), color: 'black', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', minWidth: '28px', textAlign: 'center' }}>
                {parlay.tier}
              </div>

              {/* Label + edge */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#e0f0ff' }}>{parlay.label}</div>
                <div style={{ fontSize: '11px', color: '#6b8aad', marginTop: '2px' }}>{parlay.edgeSummary}</div>
              </div>

              {/* Odds */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#9ca3af' }}>PAYOUT</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#4ade80' }}>{formatOdds(parlay.combinedOdds)}</div>
              </div>

              {/* Confidence */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#9ca3af' }}>CONF</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: getConfidenceColor(parlay.confidence) }}>
                  {parlay.confidence}%
                </div>
              </div>

              <div style={{ color: '#9ca3af' }}>{expanded === parlay.id ? '▲' : '▼'}</div>
            </div>

            {/* Expanded legs */}
            {expanded === parlay.id && (
              <div style={{ borderTop: '1px solid #374151' }}>
                {parlay.legs.map((leg, li) => (
                  <div key={li} style={{ padding: '12px 16px', borderBottom: li < parlay.legs.length - 1 ? '1px solid #2d3748' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#e0f0ff' }}>
                        {leg.prop.playerName}
                        {leg.prop.team ? <span style={{ color: '#9ca3af', fontWeight: 'normal', fontSize: '13px' }}> ({leg.prop.team})</span> : ''}
                      </div>
                      <div style={{ fontSize: '13px', marginTop: '3px' }}>
                        <span style={{ color: leg.pick === 'over' ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>
                          {leg.pick.toUpperCase()}
                        </span>
                        <span style={{ color: '#9ca3af' }}> {leg.prop.line} {leg.prop.propType}</span>
                      </div>
                      {leg.edgeFlags.length > 0 && (
                        <div style={{ marginTop: '4px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {leg.edgeFlags.map((flag, fi) => (
                            <span key={fi} style={{ fontSize: '11px', background: '#0f2a1a', color: '#4ade80', padding: '2px 6px', borderRadius: '3px' }}>
                              {flag}
                            </span>
                          ))}
                        </div>
                      )}
                      {leg.reason && (
                        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>{leg.reason}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '11px', color: '#9ca3af' }}>ODDS</div>
                        <div style={{ fontSize: '15px', fontWeight: 'bold', color: leg.odds > 0 ? '#4ade80' : '#e0f0ff' }}>
                          {formatOdds(leg.odds)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '11px', color: '#9ca3af' }}>CONF</div>
                        <div style={{ fontSize: '15px', fontWeight: 'bold', color: getConfidenceColor(leg.confidence) }}>
                          {leg.confidence}%
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Payout table */}
                <div style={{ padding: '12px 16px', background: '#0f1c2e', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 'bold' }}>Payout:</div>
                  {[10, 25, 50, 100].map(bet => {
                    const dec = americanToDecimal(parlay.combinedOdds);
                    const payout = (bet * dec).toFixed(2);
                    return (
                      <div key={bet} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '11px', color: '#9ca3af' }}>${bet}</div>
                        <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#4ade80' }}>${payout}</div>
                      </div>
                    );
                  })}
                  <div style={{ marginLeft: 'auto', fontSize: '11px', color: '#6b7280' }}>
                    ⚠️ Bet responsibly
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ background: '#1e2a44', padding: '20px', borderRadius: '8px', textAlign: 'center', color: '#9ca3af' }}>
            No parlays match current filters. Try "All" legs and tiers.
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ marginTop: '16px', padding: '12px', background: '#0f1c2e', borderRadius: '8px', fontSize: '12px', color: '#6b7280' }}>
        <div style={{ marginBottom: '6px', color: '#9ca3af', fontWeight: 'bold' }}>Edge Signals Used:</div>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <span>🔴 Park factors (MLB)</span>
          <span>👨‍⚖️ Umpire K-zone adj</span>
          <span>💨 Wind direction</span>
          <span>🥶 Temperature</span>
          <span>⚡ WNBA pace</span>
          <span>😴 Back-to-back fatigue</span>
          <span>📊 Market inefficiency</span>
        </div>
      </div>
    </div>
  );
}

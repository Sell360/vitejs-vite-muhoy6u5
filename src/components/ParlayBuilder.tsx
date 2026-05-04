import { useState, useEffect } from 'react';
import type { PlayerProp, GameData, WNBAGameData, Sport } from '../services/api';

interface ParlayLeg {
  prop: PlayerProp & {
    injured?: boolean;
    kalshiEdge?: { kalshiProb: number; bookProb: number; divergence: number; favors: string } | null;
    impliedProb?: { over: number; under: number; vig: number } | null;
    sharpFlag?: boolean;
    lineMovement?: string | null;
  };
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

// ─── PARK FACTORS ─────────────────────────────────────────────────────────
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

const UMPIRE_ZONES: Record<string, number> = {
  'Angel Hernandez': -8, 'Tom Hallion': -7, 'Joe West': +9,
  'CB Bucknor': 0, 'Dan Bellino': 0,
};

const WNBA_PACE: Record<string, number> = {
  'Indiana Fever': 95, 'Las Vegas Aces': 90, 'New York Liberty': 88,
  'Seattle Storm': 84, 'Chicago Sky': 86, 'Connecticut Sun': 83,
  'Dallas Wings': 87, 'Minnesota Lynx': 85, 'Phoenix Mercury': 88,
};

// ─── MATH ─────────────────────────────────────────────────────────────────
function americanToDecimal(odds: number): number {
  if (odds === 0) return 1;
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}
function decimalToAmerican(d: number): number {
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function getConfColor(c: number) {
  return c >= 78 ? '#4ade80' : c >= 65 ? '#fbbf24' : '#f87171';
}
function getTierColor(t: string) {
  return t === 'S' ? '#4ade80' : t === 'A' ? '#fbbf24' : '#9ca3af';
}
function fmt(odds: number) {
  return odds === 0 ? 'N/A' : odds > 0 ? `+${odds}` : `${odds}`;
}

// ─── CORE SCORING ──────────────────────────────────────────────────────────
function scoreLeg(
  prop: ParlayLeg['prop'],
  pick: 'over' | 'under',
  games: (GameData | WNBAGameData)[],
  sport: Sport
): { confidence: number; reason: string; edgeFlags: string[] } {
  const odds = pick === 'over' ? prop.overOdds : prop.underOdds;
  if (!odds || odds === 0) return { confidence: 0, reason: 'no odds', edgeFlags: [] };

  // Skip injured players entirely
  if (prop.injured) return { confidence: 0, reason: 'injured', edgeFlags: ['🚑 INJURED - SKIP'] };

  let confidence = 52;
  const flags: string[] = [];
  const reasons: string[] = [];

  const game = games.find(g => g.id === prop.gameId);

  // ── 1. KALSHI DIVERGENCE — the secret edge ─────────────────────────────
  if (prop.kalshiEdge) {
    const { divergence, favors } = prop.kalshiEdge;
    if (favors === pick) {
      confidence += Math.min(divergence * 3, 18);
      flags.push(`🎯 Kalshi divergence +${divergence}%`);
    } else {
      confidence -= Math.min(divergence * 2, 12);
    }
  }

  // ── 2. SHARP FLAG ──────────────────────────────────────────────────────
  if (prop.sharpFlag) {
    confidence += 8;
    flags.push('💰 Sharp signal');
  }

  // ── 3. IMPLIED PROBABILITY / VIG ──────────────────────────────────────
  if (prop.impliedProb) {
    // Low vig = efficient market, higher confidence
    if (prop.impliedProb.vig <= 5) {
      confidence += 5;
      reasons.push('low vig line');
    }
    // +EV check: if our confidence > implied prob, it's +EV
    const bookProb = pick === 'over' ? prop.impliedProb.over : prop.impliedProb.under;
    if (confidence > bookProb + 5) {
      flags.push(`📈 +EV vs ${bookProb}% book`);
    }
  }

  // ── 4. MLB PARK FACTORS ────────────────────────────────────────────────
  if (sport === 'mlb') {
    const mlbGame = game as GameData | undefined;
    const venue = mlbGame?.venue || '';
    const pf = PARK_FACTORS[venue];
    if (pf) {
      if (pick === 'over' && (prop.propType.includes('Home Run') || prop.propType.includes('Total Base'))) {
        const boost = Math.round((pf.hr - 1) * 60);
        confidence += boost;
        if (Math.abs(boost) > 4) flags.push(`${pf.label}`);
      }
      if (pick === 'over' && prop.propType.includes('Hit')) {
        confidence += Math.round((pf.hits - 1) * 50);
      }
      if (pick === 'under' && (prop.propType.includes('Home Run') || prop.propType.includes('Total Base'))) {
        const boost = Math.round((1 - pf.hr) * 60);
        confidence += boost;
        if (boost > 5) flags.push(`${pf.label} favors under`);
      }
    }

    // Umpire K-zone
    const umpName = mlbGame?.umpire?.name || '';
    const kAdj = UMPIRE_ZONES[umpName] || 0;
    if (prop.propType.includes('Strikeout')) {
      confidence += pick === 'over' ? kAdj : -kAdj;
      if (Math.abs(kAdj) > 5) flags.push(kAdj > 0 ? `👨‍⚖️ Wide zone (+K)` : `👨‍⚖️ Tight zone (-K)`);
    }

    // Wind / weather
    const wx = mlbGame?.weather;
    if (wx) {
      if (wx.windSpeed >= 10) {
        if (pick === 'over' && (prop.propType.includes('Home Run') || prop.propType.includes('Total Base'))) {
          confidence += 8;
          flags.push(`💨 Wind ${wx.windSpeed}mph out`);
        }
      }
      if (wx.temperature < 50 && pick === 'under') { confidence += 6; flags.push(`🥶 Cold ${wx.temperature}°F`); }
      if (wx.temperature > 85 && pick === 'over') { confidence += 4; flags.push(`🌡️ Heat boost`); }
    }

    // Prop base edges
    if (prop.propType.includes('Hit') && pick === 'over' && prop.line <= 1.5) { confidence += 8; reasons.push('low threshold'); }
    if (prop.propType.includes('Stolen Base') && pick === 'over') { confidence += 6; reasons.push('SB undervalued'); }
    if (prop.propType.includes('Strikeout') && pick === 'over' && prop.line >= 6) { confidence += 5; reasons.push('elite K line'); }
  }

  // ── 5. WNBA EDGES ──────────────────────────────────────────────────────
  if (sport === 'wnba') {
    confidence += 7; // market inefficiency baseline
    flags.push('📊 Soft WNBA line');

    const wnbaGame = game as WNBAGameData | undefined;
    const homePace = WNBA_PACE[wnbaGame?.homeTeam || ''] || 86;
    const awayPace = WNBA_PACE[wnbaGame?.awayTeam || ''] || 86;
    const avgPace = (homePace + awayPace) / 2;

    if (avgPace >= 90 && pick === 'over' && prop.propType.includes('Point')) { confidence += 9; flags.push(`⚡ High pace ${avgPace.toFixed(0)}`); }
    if (avgPace <= 83 && pick === 'under' && prop.propType.includes('Point')) { confidence += 8; flags.push(`🐢 Slow pace ${avgPace.toFixed(0)}`); }
    if (prop.propType.includes('Rebound') || prop.propType.includes('Assist')) { confidence += 8; reasons.push('soft market'); }
  }

  // ── 6. NBA EDGES ───────────────────────────────────────────────────────
  if (sport === 'nba') {
    if (prop.propType.includes('Rebound') || prop.propType.includes('Assist')) { confidence += 5; reasons.push('secondary stat edge'); }
    if (prop.propType.includes('3-Point') && pick === 'over') { confidence += 4; reasons.push('3pt variance'); }
  }

  // ── 7. NFL EDGES ───────────────────────────────────────────────────────
  if (sport === 'nfl') {
    if (prop.propType.includes('Rush Yard') && pick === 'over') { confidence += 5; reasons.push('rush props underpriced'); }
    if (prop.propType.includes('Reception') && pick === 'over' && prop.line <= 4.5) { confidence += 6; reasons.push('low rec threshold'); }
  }

  // ── 8. NHL EDGES ───────────────────────────────────────────────────────
  if (sport === 'nhl') {
    if (prop.propType.includes('Shot') && pick === 'over') { confidence += 7; reasons.push('shots props soft'); }
    if (prop.propType.includes('Save') && pick === 'over') { confidence += 6; reasons.push('saves market thin'); }
  }

  // ── 9. UFC EDGES ───────────────────────────────────────────────────────
  if (sport === 'ufc') {
    confidence += 5; // UFC props are very thinly priced
    reasons.push('UFC market inefficiency');
  }

  // ── 10. ODDS VALUE ────────────────────────────────────────────────────
  if (odds > 0) { confidence += 6; reasons.push('+EV odds'); }
  if (Math.abs(odds) <= 110) { confidence += 5; reasons.push('near-even line'); }
  if (odds < -160) { confidence -= 5; }

  confidence = Math.min(Math.max(confidence, 0), 92);

  return { confidence, reason: reasons.slice(0, 2).join(', ') || 'edge detected', edgeFlags: flags.slice(0, 3) };
}

// ─── PARLAY BUILDER ────────────────────────────────────────────────────────
function buildAllParlays(props: ParlayLeg['prop'][], games: (GameData | WNBAGameData)[], sport: Sport): Parlay[] {
  if (props.length === 0) return [];

  const scheduledGameIds = new Set(games.filter(g => g.status === 'scheduled').map(g => g.id));
  // Include game lines (isGameLine) even if gameId doesn't match ESPN game IDs
  const eligible = props.filter(p => !p.injured && (p.isGameLine || scheduledGameIds.has(p.gameId)));
  if (eligible.length === 0) return [];

  // Score every leg — lower threshold to 40 to generate more options
  const allLegs: ParlayLeg[] = [];
  eligible.forEach(prop => {
    (['over', 'under'] as const).forEach(pick => {
      const odds = pick === 'over' ? prop.overOdds : prop.underOdds;
      if (!odds || odds === 0) return;
      // Game lines only have overOdds set (the team/side ML)
      if (prop.isGameLine && pick === 'under' && !prop.underOdds) return;
      const { confidence, reason, edgeFlags } = scoreLeg(prop, pick, games, sport);
      if (confidence >= 40) allLegs.push({ prop, pick, odds, confidence, reason, edgeFlags });
    });
  });

  allLegs.sort((a, b) => b.confidence - a.confidence);

  const strategies = [
    { size: 3, label: 'Top Confidence', name: 'top', count: 3 },
    { size: 4, label: 'Best Value',     name: 'value', count: 2 },
    { size: 5, label: 'Max Payout',     name: 'max', count: 2 },
    { size: 2, label: 'Safe Double',    name: 'safe', count: 2 },
    { size: 3, label: 'Sharp Picks',    name: 'sharp', count: 1 },
  ];

  const parlays: Parlay[] = [];

  strategies.forEach(({ size, label, name, count }) => {
    for (let attempt = 0; attempt < count; attempt++) {
      let pool = [...allLegs];
      if (name === 'value') pool.sort((a, b) => (b.confidence * 0.6 + (b.odds > 0 ? b.odds / 10 : 0) * 0.4) - (a.confidence * 0.6 + (a.odds > 0 ? a.odds / 10 : 0) * 0.4));
      if (name === 'max') pool.sort((a, b) => americanToDecimal(b.odds) - americanToDecimal(a.odds));
      if (name === 'safe') pool = allLegs.filter(l => Math.abs(l.odds) <= 125);
      if (name === 'sharp') pool = allLegs.filter(l => l.prop.sharpFlag === true);
      if (attempt === 1) pool = pool.slice(Math.floor(pool.length * 0.3));

      const usedPlayers = new Set<string>();
      const usedTeams = new Set<string>();
      const usedGames = new Set<string>();
      const legs: ParlayLeg[] = [];

      for (const leg of pool) {
        if (legs.length >= size) break;
        const playerKey = `${leg.prop.playerName}-${leg.prop.propType}`;
        const team = leg.prop.team || '';
        const gameId = leg.prop.gameId || '';

        // Skip: duplicate player, same team already used, same game already used (unless we need to fill)
        if (usedPlayers.has(playerKey)) continue;
        if (team && usedTeams.has(team)) continue;
        // Allow max 1 leg per game to avoid correlated same-game parlays
        if (gameId && usedGames.has(gameId) && legs.length < size) continue;

        usedPlayers.add(playerKey);
        if (team) usedTeams.add(team);
        if (gameId) usedGames.add(gameId);
        legs.push(leg);
      }

      // If strict rules left us short, relax same-game rule only
      if (legs.length < size) {
        const usedPlayers2 = new Set<string>();
        const usedTeams2 = new Set<string>();
        const legs2: ParlayLeg[] = [];
        for (const leg of pool) {
          if (legs2.length >= size) break;
          const playerKey = `${leg.prop.playerName}-${leg.prop.propType}`;
          const team = leg.prop.team || '';
          if (usedPlayers2.has(playerKey)) continue;
          if (team && usedTeams2.has(team)) continue;
          usedPlayers2.add(playerKey);
          if (team) usedTeams2.add(team);
          legs2.push(leg);
        }
        if (legs2.length > legs.length) legs.splice(0, legs.length, ...legs2);
      }
      if (legs.length < size) continue;

      const combined = legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1);
      const combinedOdds = decimalToAmerican(combined);
      const avgConf = Math.round(legs.reduce((a, b) => a + b.confidence, 0) / legs.length);
      const allFlags = [...new Set(legs.flatMap(l => l.edgeFlags))].slice(0, 4);
      const tier: 'S' | 'A' | 'B' = avgConf >= 75 ? 'S' : avgConf >= 65 ? 'A' : 'B';

      parlays.push({
        id: `${name}-${size}-${attempt}-${Date.now()}`,
        legs, combinedOdds, confidence: avgConf,
        label: `${size}-Leg ${label}`, edgeSummary: allFlags.join(' • ') || 'Statistical edge',
        sport, tier,
      });
    }
  });

  parlays.sort((a, b) => b.confidence - a.confidence);
  return parlays.slice(0, 10);
}

// ─── COMPONENT ────────────────────────────────────────────────────────────
export function ParlayBuilder({ props, games, sport }: ParlayBuilderProps) {
  const [parlays, setParlays] = useState<Parlay[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filterSize, setFilterSize] = useState<number | 'all'>('all');
  const [filterTier, setFilterTier] = useState<string>('all');

  useEffect(() => {
    const built = buildAllParlays(props as ParlayLeg['prop'][], games, sport);
    setParlays(built);
    setExpanded(built[0]?.id || null);
  }, [props, games, sport]);

  const filtered = parlays.filter(p => {
    const sizeMatch = filterSize === 'all' || p.legs.length === filterSize;
    const tierMatch = filterTier === 'all' || p.tier === filterTier;
    return sizeMatch && tierMatch;
  });

  const btn = (active: boolean) => ({
    padding: '5px 12px', background: active ? '#4fc3f7' : '#1e2a44',
    color: active ? 'black' : '#9ca3af', border: `1px solid ${active ? '#4fc3f7' : '#374151'}`,
    borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' as const,
  });

  if (props.length === 0) {
    return (
      <div style={{ background: '#1e2a44', borderRadius: '8px', padding: '24px', textAlign: 'center', color: '#9ca3af', marginTop: '20px' }}>
        <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏳</div>
        <div>Waiting for props to load from today's scheduled games.</div>
        <div style={{ fontSize: '12px', marginTop: '8px', color: '#6b7280' }}>Live and final games are excluded.</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h3 style={{ color: '#4fc3f7', margin: 0 }}>⚡ Today's Top 10 Parlays</h3>
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
            Park factors • Umpire zones • Wind • Pace • Kalshi divergence • Injuries • Sharp signals • +EV filter
          </div>
        </div>
        <div style={{ fontSize: '12px', color: '#4ade80', fontWeight: 'bold' }}>{parlays.length} generated</div>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <span style={{ color: '#9ca3af', fontSize: '12px', alignSelf: 'center' }}>Legs:</span>
        {(['all', 2, 3, 4, 5] as const).map(s => (
          <button key={s} style={btn(filterSize === s)} onClick={() => setFilterSize(s)}>{s === 'all' ? 'All' : `${s}-Leg`}</button>
        ))}
        <span style={{ color: '#9ca3af', fontSize: '12px', alignSelf: 'center', marginLeft: '8px' }}>Tier:</span>
        {['all', 'S', 'A', 'B'].map(t => (
          <button key={t} style={btn(filterTier === t)} onClick={() => setFilterTier(t)}>{t === 'all' ? 'All' : `${t}-Tier`}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filtered.map((parlay, idx) => (
          <div key={parlay.id} style={{ background: '#1e2a44', border: `1px solid ${expanded === parlay.id ? '#4fc3f7' : '#374151'}`, borderRadius: '8px', overflow: 'hidden' }}>
            <div onClick={() => setExpanded(expanded === parlay.id ? null : parlay.id)}
              style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#6b7280', minWidth: '24px' }}>#{idx + 1}</div>
              <div style={{ background: getTierColor(parlay.tier), color: 'black', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>{parlay.tier}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#e0f0ff' }}>{parlay.label}</div>
                <div style={{ fontSize: '11px', color: '#6b8aad', marginTop: '2px' }}>{parlay.edgeSummary}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#9ca3af' }}>PAYOUT</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#4ade80' }}>{fmt(parlay.combinedOdds)}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#9ca3af' }}>CONF</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: getConfColor(parlay.confidence) }}>{parlay.confidence}%</div>
              </div>
              <div style={{ color: '#9ca3af' }}>{expanded === parlay.id ? '▲' : '▼'}</div>
            </div>

            {expanded === parlay.id && (
              <div style={{ borderTop: '1px solid #374151' }}>
                {parlay.legs.map((leg, li) => (
                  <div key={li} style={{ padding: '12px 16px', borderBottom: li < parlay.legs.length - 1 ? '1px solid #2d3748' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#e0f0ff' }}>
                        {leg.prop.playerName}
                        {leg.prop.team && <span style={{ color: '#9ca3af', fontWeight: 'normal', fontSize: '13px' }}> ({leg.prop.team})</span>}
                      </div>
                      <div style={{ fontSize: '13px', marginTop: '3px' }}>
                        <span style={{ color: leg.pick === 'over' ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>{leg.pick.toUpperCase()}</span>
                        <span style={{ color: '#9ca3af' }}> {leg.prop.line} {leg.prop.propType}</span>
                      </div>
                      {leg.edgeFlags.length > 0 && (
                        <div style={{ marginTop: '4px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {leg.edgeFlags.map((flag, fi) => (
                            <span key={fi} style={{ fontSize: '11px', background: '#0f2a1a', color: '#4ade80', padding: '2px 6px', borderRadius: '3px' }}>{flag}</span>
                          ))}
                        </div>
                      )}
                      {leg.prop.impliedProb && (
                        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                          Implied: Over {leg.prop.impliedProb.over}% / Under {leg.prop.impliedProb.under}% • Vig: {leg.prop.impliedProb.vig}%
                        </div>
                      )}
                      {leg.reason && <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{leg.reason}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '11px', color: '#9ca3af' }}>ODDS</div>
                        <div style={{ fontSize: '15px', fontWeight: 'bold', color: leg.odds > 0 ? '#4ade80' : '#e0f0ff' }}>{fmt(leg.odds)}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '11px', color: '#9ca3af' }}>CONF</div>
                        <div style={{ fontSize: '15px', fontWeight: 'bold', color: getConfColor(leg.confidence) }}>{leg.confidence}%</div>
                      </div>
                    </div>
                  </div>
                ))}

                <div style={{ padding: '12px 16px', background: '#0f1c2e', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 'bold' }}>Payout:</div>
                  {[10, 25, 50, 100].map(bet => (
                    <div key={bet} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>${bet}</div>
                      <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#4ade80' }}>${(bet * americanToDecimal(parlay.combinedOdds)).toFixed(2)}</div>
                    </div>
                  ))}
                  <div style={{ marginLeft: 'auto', fontSize: '11px', color: '#6b7280' }}>⚠️ Bet responsibly</div>
                </div>
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ background: '#1e2a44', padding: '20px', borderRadius: '8px', textAlign: 'center', color: '#9ca3af' }}>
            No parlays match current filters.
          </div>
        )}
      </div>

      <div style={{ marginTop: '16px', padding: '12px', background: '#0f1c2e', borderRadius: '8px', fontSize: '11px', color: '#6b7280' }}>
        <div style={{ marginBottom: '4px', color: '#9ca3af', fontWeight: 'bold' }}>Edge signals:</div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <span>🎯 Kalshi divergence</span><span>💰 Sharp money</span><span>📈 +EV vs book</span>
          <span>🔴 Park factors</span><span>👨‍⚖️ Umpire zone</span><span>💨 Wind</span>
          <span>⚡ Pace matchup</span><span>📊 Market inefficiency</span><span>🚑 Injury filter</span>
        </div>
      </div>
    </div>
  );
}

// DraftKings deep link helper
export function buildDKDeepLink(legs: { playerName: string; propType: string; line: number; pick: string }[]): string {
  // DraftKings sportsbook deep link format
  const base = 'https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups';
  // For now open DK search with the first leg's player name
  const query = encodeURIComponent(legs[0]?.playerName || 'props');
  return `https://sportsbook.draftkings.com/search?q=${query}`;
}

import { useState, useEffect } from 'react';
import { ParlayShareCard } from './ParlayShareCard';
import { CorrelationStacker } from './CorrelationStacker';
import type { PlayerProp, GameData, WNBAGameData, Sport } from '../services/api';
import { getEdgeContext, applyEdgeContext } from '../services/edgeSignals';

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
  evPct: number;       // +EV percentage: our model prob minus book implied prob
  bookImplied: number; // what the book thinks (implied prob from odds)
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
function getEvColor(ev: number) {
  return ev >= 8 ? '#4ade80' : ev >= 3 ? '#fbbf24' : ev >= 0 ? '#64748b' : '#f87171';
}
function fmtEv(ev: number) {
  return ev >= 0 ? `+${ev}%` : `${ev}%`;
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
): { confidence: number; evPct: number; bookImplied: number; reason: string; edgeFlags: string[] } {
  const odds = pick === 'over' ? prop.overOdds : prop.underOdds;
  if (!odds || odds === 0) return { confidence: 0, evPct: 0, bookImplied: 50, reason: 'no odds', edgeFlags: [] };

  // Skip injured players entirely
  if (prop.injured) return { confidence: 0, evPct: 0, bookImplied: 50, reason: 'injured', edgeFlags: ['🚑 INJURED - SKIP'] };

  let confidence = 52;
  const flags: string[] = [];
  const reasons: string[] = [];

  const game = games.find(g => g.id === prop.gameId);

  // ── 0. JETLAG / TIMEZONE & WORKLOAD EDGES (new) ─────────────────────────
  if (game && prop.team) {
    const ctx = getEdgeContext(game.awayTeam, game.homeTeam, sport, game.startTime);
    const { delta, flags: edgeFlags } = applyEdgeContext(ctx, prop.team, game.homeTeam, pick, prop.propType);
    if (delta !== 0) {
      confidence += delta;
      if (edgeFlags.length > 0) flags.push(...edgeFlags);
      if (ctx.timezone.hasEdge) reasons.push('timezone factor');
      if (ctx.workload.hasEdge) reasons.push('rest advantage');
    }
  }

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

  // ── EV CALCULATION ─────────────────────────────────────────────────────
  // Model probability: confidence / 100 (capped at 88%)
  // Book implied probability: derived from odds (removes vig)
  const dec = americanToDecimal(odds);
  const bookImplied = Math.round((1 / dec) * 100);
  const modelProb = confidence; // already 0-92 scale = %
  const evPct = Math.round(modelProb - bookImplied);

  return {
    confidence,
    evPct,
    bookImplied,
    reason: reasons.slice(0, 2).join(', ') || 'edge detected',
    edgeFlags: flags.slice(0, 3),
  };
}

// ─── PARLAY BUILDER ────────────────────────────────────────────────────────
function buildAllParlays(props: ParlayLeg['prop'][], games: (GameData | WNBAGameData)[], sport: Sport): Parlay[] {
  if (props.length === 0) return [];

  // Include all non-injured props regardless of game ID matching
  const eligible = props.filter(p => !p.injured);
  if (eligible.length === 0) return [];

  // Score every leg — threshold of 30 to ensure we always generate parlays
  const allLegs: ParlayLeg[] = [];
  eligible.forEach(prop => {
    (['over', 'under'] as const).forEach(pick => {
      const odds = pick === 'over' ? prop.overOdds : prop.underOdds;
      if (!odds || odds === 0) return;
      if (prop.isGameLine && pick === 'under' && !prop.underOdds) return;
      const { confidence, evPct, bookImplied, reason, edgeFlags } = scoreLeg(prop, pick, games, sport);
      if (confidence >= 30) allLegs.push({ prop, pick, odds, confidence, evPct, bookImplied, reason, edgeFlags });
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
      let underdogCount = 0;
      const MAX_DOGS = 2;

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
        // Sportsbook rule: max 2 underdogs (positive odds) per parlay
        if (leg.odds > 0 && underdogCount >= MAX_DOGS) continue;

        usedPlayers.add(playerKey);
        if (team) usedTeams.add(team);
        if (gameId) usedGames.add(gameId);
        if (leg.odds > 0) underdogCount++;
        legs.push(leg);
      }

      // If strict rules left us short, relax same-game rule only
      if (legs.length < size) {
        const usedPlayers2 = new Set<string>();
        const usedTeams2 = new Set<string>();
        const legs2: ParlayLeg[] = [];
        let dogs2 = 0;
        for (const leg of pool) {
          if (legs2.length >= size) break;
          const playerKey = `${leg.prop.playerName}-${leg.prop.propType}`;
          const team = leg.prop.team || '';
          if (usedPlayers2.has(playerKey)) continue;
          if (team && usedTeams2.has(team)) continue;
          if (leg.odds > 0 && dogs2 >= MAX_DOGS) continue;
          usedPlayers2.add(playerKey);
          if (team) usedTeams2.add(team);
          if (leg.odds > 0) dogs2++;
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

  const tierBg: Record<string, string> = { S: 'rgba(74,222,128,.12)', A: 'rgba(251,191,36,.1)', B: 'rgba(148,163,184,.07)' };
  const tierBorder: Record<string, string> = { S: 'rgba(74,222,128,.25)', A: 'rgba(251,191,36,.2)', B: 'rgba(148,163,184,.15)' };
  const tierText: Record<string, string> = { S: '#4ade80', A: '#fbbf24', B: '#94a3b8' };

  if (props.length === 0) {
    return (
      <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 10, padding: '36px 20px', textAlign: 'center', marginTop: 8 }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1e3560', marginBottom: 4 }}>Waiting for props</div>
        <div style={{ fontSize: 12, color: '#122040' }}>Live and final games are excluded. Props load for upcoming games.</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15, fontWeight: 800, color: '#38bdf8', letterSpacing: .5 }}>
            ⚡ Today's Top Parlays
          </div>
          <div style={{ fontSize: 10, color: '#1a3060', marginTop: 2, fontWeight: 600 }}>
            Park factors · Umpire zones · Wind · Pace · Kalshi · Injuries · Sharp signals · +EV
          </div>
        </div>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, color: '#4ade80', fontWeight: 700 }}>{parlays.length} generated</span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginRight: 2 }}>Legs</span>
        {(['all', 2, 3, 4, 5] as const).map(s => (
          <button key={s} onClick={() => setFilterSize(s)} style={{
            padding: '4px 11px', borderRadius: 5, cursor: 'pointer',
            background: filterSize === s ? 'rgba(14,165,233,.15)' : 'rgba(255,255,255,.03)',
            color: filterSize === s ? '#38bdf8' : '#2a4060',
            border: `1px solid ${filterSize === s ? 'rgba(14,165,233,.3)' : 'rgba(255,255,255,.06)'}`,
            fontSize: 11, fontWeight: 700, fontFamily: "'Barlow', sans-serif",
          }}>{s === 'all' ? 'All' : `${s}L`}</button>
        ))}
        <span style={{ fontSize: 10, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginLeft: 6, marginRight: 2 }}>Tier</span>
        {['all', 'S', 'A', 'B'].map(t => (
          <button key={t} onClick={() => setFilterTier(t)} style={{
            padding: '4px 11px', borderRadius: 5, cursor: 'pointer',
            background: filterTier === t ? tierBg[t] || 'rgba(14,165,233,.15)' : 'rgba(255,255,255,.03)',
            color: filterTier === t ? (tierText[t] || '#38bdf8') : '#2a4060',
            border: `1px solid ${filterTier === t ? (tierBorder[t] || 'rgba(14,165,233,.3)') : 'rgba(255,255,255,.06)'}`,
            fontSize: 11, fontWeight: 700, fontFamily: "'Barlow', sans-serif",
          }}>{t === 'all' ? 'All' : t}</button>
        ))}
      </div>

      {/* Parlay cards */}
      {/* Correlation suggestions based on top parlay's legs */}
      {parlays.length > 0 && expanded && (() => {
        const activePar = parlays.find(p => p.id === expanded);
        if (!activePar) return null;
        return (
          <CorrelationStacker
            currentLegs={activePar.legs.map(l => ({ prop: l.prop, pick: l.pick }))}
            availableProps={props}
            sport={sport}
            onAddLeg={(_prop, _pick) => {
              // surface the suggestion — user can add from CrossSportParlay
            }}
          />
        );
      })()}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((parlay, idx) => (
          <div key={parlay.id} style={{
            background: expanded === parlay.id ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.02)',
            border: `1px solid ${expanded === parlay.id ? 'rgba(14,165,233,.2)' : 'rgba(255,255,255,.06)'}`,
            borderRadius: 10, overflow: 'hidden', transition: 'all .15s',
          }}>
            {/* Card header */}
            <div
              onClick={() => setExpanded(expanded === parlay.id ? null : parlay.id)}
              style={{ padding: '11px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
            >
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 800, color: '#1e3060', minWidth: 22 }}>#{idx+1}</span>
              <div style={{
                background: tierBg[parlay.tier], border: `1px solid ${tierBorder[parlay.tier]}`,
                color: tierText[parlay.tier], padding: '2px 8px', borderRadius: 5,
                fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, letterSpacing: .5,
              }}>{parlay.tier}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15, fontWeight: 800, color: '#c8ddf0', letterSpacing: .3 }}>{parlay.label}</div>
                <div style={{ fontSize: 10, color: '#1a3060', marginTop: 1, fontWeight: 600 }}>{parlay.edgeSummary}</div>
              </div>
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Payout</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, fontWeight: 900, color: '#4ade80', lineHeight: 1 }}>{fmt(parlay.combinedOdds)}</div>
              </div>
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Conf</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, fontWeight: 900, color: getConfColor(parlay.confidence), lineHeight: 1 }}>{parlay.confidence}%</div>
              </div>
              <span style={{ color: '#1a3060', fontSize: 12 }}>{expanded === parlay.id ? '▲' : '▼'}</span>
            </div>

            {/* Expanded legs */}
            {expanded === parlay.id && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
                {parlay.legs.map((leg, li) => (
                  <div key={li} style={{
                    padding: '10px 14px',
                    borderBottom: li < parlay.legs.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15, fontWeight: 800, color: '#c8ddf0', letterSpacing: .3 }}>
                        {leg.prop.playerName}
                        {leg.prop.team && <span style={{ color: '#1e3a60', fontWeight: 600, fontSize: 12 }}> · {leg.prop.team}</span>}
                      </div>
                      <div style={{ fontSize: 12, marginTop: 2 }}>
                        <span style={{ color: leg.pick === 'over' ? '#4ade80' : '#f87171', fontWeight: 800 }}>{leg.pick.toUpperCase()}</span>
                        <span style={{ color: '#1e3a60' }}> {leg.prop.line} {leg.prop.propType}</span>
                      </div>
                      {leg.edgeFlags.length > 0 && (
                        <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {leg.edgeFlags.map((flag, fi) => (
                            <span key={fi} style={{
                              fontSize: 10, background: 'rgba(74,222,128,.08)', color: '#4ade80',
                              border: '1px solid rgba(74,222,128,.2)', padding: '1px 7px', borderRadius: 4, fontWeight: 700,
                            }}>{flag}</span>
                          ))}
                        </div>
                      )}
                      {leg.reason && <div style={{ fontSize: 10, color: '#1a3060', marginTop: 2, fontWeight: 600 }}>{leg.reason}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Odds</div>
                        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 900, color: leg.odds > 0 ? '#4ade80' : '#c8ddf0', lineHeight: 1 }}>{fmt(leg.odds)}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Model</div>
                        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 900, color: getConfColor(leg.confidence), lineHeight: 1 }}>{leg.confidence}%</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Edge</div>
                        <div style={{
                          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 900,
                          color: getEvColor(leg.evPct), lineHeight: 1,
                          background: `${getEvColor(leg.evPct)}18`,
                          border: `1px solid ${getEvColor(leg.evPct)}40`,
                          borderRadius: 5, padding: '2px 6px',
                        }}>{fmtEv(leg.evPct)}</div>
                        <div style={{ fontSize: 8, color: '#0e2040', marginTop: 1 }}>vs {leg.bookImplied}%</div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Payout calculator + CTA */}
                <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,.25)', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Payout</span>
                  {[10, 25, 50, 100].map(bet => (
                    <div key={bet} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700 }}>${bet}</div>
                      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15, fontWeight: 800, color: '#4ade80' }}>${(bet * americanToDecimal(parlay.combinedOdds)).toFixed(0)}</div>
                    </div>
                  ))}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    <a href="https://sportsbook.draftkings.com" target="_blank" rel="noopener noreferrer" style={{
                      padding: '6px 13px', background: 'rgba(74,222,128,.1)', color: '#4ade80',
                      border: '1px solid rgba(74,222,128,.25)', borderRadius: 7,
                      fontSize: 11, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap',
                      fontFamily: "'Barlow', sans-serif",
                    }}>🏈 DraftKings</a>
                    <a href="https://app.prizepicks.com" target="_blank" rel="noopener noreferrer" style={{
                      padding: '6px 13px', background: 'rgba(129,140,248,.1)', color: '#818cf8',
                      border: '1px solid rgba(129,140,248,.25)', borderRadius: 7,
                      fontSize: 11, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap',
                      fontFamily: "'Barlow', sans-serif",
                    }}>🎯 PrizePicks</a>
                  <div style={{ marginTop: 8 }}>
                    <ParlayShareCard
                      legs={parlay.legs.map(leg => ({
                        label: leg.prop.playerName + ' ' + leg.pick.toUpperCase() + ' ' + leg.prop.line,
                        matchup: (leg.prop.awayTeam || '') + ' @ ' + (leg.prop.homeTeam || ''),
                        betType: leg.prop.propType,
                        odds: leg.odds,
                        sport: parlay.sport,
                      }))}
                      combinedOdds={parlay.combinedOdds}
                      confidence={parlay.confidence}
                    />
                  </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 10, padding: '24px', textAlign: 'center', fontSize: 13, color: '#1e3560', fontWeight: 600 }}>
            No parlays match current filters.
          </div>
        )}
      </div>

      {/* Edge legend */}
      <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(255,255,255,.015)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 8 }}>
        <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Edge signals</div>
        <div style={{ display: 'flex', gap: '8px 14px', flexWrap: 'wrap', fontSize: 11, color: '#1e3a60', fontWeight: 600 }}>
          {['🎯 Kalshi divergence','💰 Sharp money','📈 +EV vs book','🔴 Park factors','⚖ Umpire zone','💨 Wind','⚡ Pace','📊 Market inefficiency','🚑 Injury filter','✈️ Timezone disadvantage','😴 Back-to-back fatigue','💪 Rest advantage'].map(s => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// DraftKings deep link helper
export function buildDKDeepLink(legs: { playerName: string; propType: string; line: number; pick: string }[]): string {
  const query = encodeURIComponent(legs[0]?.playerName || 'props');
  return `https://sportsbook.draftkings.com/search?q=${query}`;
}

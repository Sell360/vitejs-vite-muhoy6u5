import { useMemo } from 'react';
import type { PlayerProp, Sport } from '../services/api';

// ─── CORRELATION RULES ────────────────────────────────────────────────────
// Each rule: if leg A matches pattern, suggest leg B from same game
// Correlation strength: 1-10 (10 = almost always moves together)

interface CorrRule {
  sport: Sport | 'all';
  triggerPropType: string;   // partial match
  triggerPick: 'over' | 'under' | 'both';
  suggestPropType: string;   // partial match on suggestion
  suggestPick: 'over' | 'under' | 'same';
  strength: number;          // 1-10
  reason: string;
}

const CORR_RULES: CorrRule[] = [
  // ── NFL ──────────────────────────────────────────────────────────────
  { sport: 'nfl', triggerPropType: 'Pass Yard', triggerPick: 'over',
    suggestPropType: 'Rec Yard', suggestPick: 'over', strength: 9,
    reason: 'QB yards up → WR/TE yards up' },
  { sport: 'nfl', triggerPropType: 'Pass Yard', triggerPick: 'over',
    suggestPropType: 'Reception', suggestPick: 'over', strength: 8,
    reason: 'More passing volume → more receptions' },
  { sport: 'nfl', triggerPropType: 'Pass TD', triggerPick: 'over',
    suggestPropType: 'Reception', suggestPick: 'over', strength: 8,
    reason: 'TD passes require catches in end zone' },
  { sport: 'nfl', triggerPropType: 'Rush Yard', triggerPick: 'over',
    suggestPropType: 'Rush Attempt', suggestPick: 'over', strength: 9,
    reason: 'Rush yards tied to carry volume' },
  { sport: 'nfl', triggerPropType: 'Pass Yard', triggerPick: 'under',
    suggestPropType: 'Rush Yard', suggestPick: 'over', strength: 7,
    reason: 'Game script: run-heavy if passing struggles' },

  // ── NBA ──────────────────────────────────────────────────────────────
  { sport: 'nba', triggerPropType: 'Point', triggerPick: 'over',
    suggestPropType: 'Assist', suggestPick: 'over', strength: 7,
    reason: 'High-usage scorers often have assist bumps' },
  { sport: 'nba', triggerPropType: 'Pts+Reb+Ast', triggerPick: 'over',
    suggestPropType: 'Point', suggestPick: 'over', strength: 8,
    reason: 'Combo over needs big scoring game' },
  { sport: 'nba', triggerPropType: 'Rebound', triggerPick: 'over',
    suggestPropType: 'Rebound', suggestPick: 'over', strength: 7,
    reason: 'High-paced game → more board opportunities for both bigs' },
  { sport: 'nba', triggerPropType: '3-Point', triggerPick: 'over',
    suggestPropType: 'Point', suggestPick: 'over', strength: 8,
    reason: '3s are high-value scoring events' },

  // ── MLB ──────────────────────────────────────────────────────────────
  { sport: 'mlb', triggerPropType: 'Total Base', triggerPick: 'over',
    suggestPropType: 'Hit', suggestPick: 'over', strength: 9,
    reason: 'Total bases require hits — naturally correlated' },
  { sport: 'mlb', triggerPropType: 'Home Run', triggerPick: 'over',
    suggestPropType: 'Total Base', suggestPick: 'over', strength: 10,
    reason: 'HR = at minimum 4 total bases — extreme correlation' },
  { sport: 'mlb', triggerPropType: 'RBI', triggerPick: 'over',
    suggestPropType: 'Hit', suggestPick: 'over', strength: 7,
    reason: 'RBIs require runners on base — same offense rolling' },
  { sport: 'mlb', triggerPropType: 'Strikeout', triggerPick: 'over',
    suggestPropType: 'Strikeout', suggestPick: 'over', strength: 8,
    reason: 'Dominant SP in hitter park → both pitchers rack Ks' },

  // ── NHL ──────────────────────────────────────────────────────────────
  { sport: 'nhl', triggerPropType: 'Shot', triggerPick: 'over',
    suggestPropType: 'Shot', suggestPick: 'over', strength: 7,
    reason: 'High-event game → both teams get more shots' },
  { sport: 'nhl', triggerPropType: 'Goal', triggerPick: 'over',
    suggestPropType: 'Shot', suggestPick: 'over', strength: 8,
    reason: 'Goals come from quality shot attempts' },

  // ── WNBA ─────────────────────────────────────────────────────────────
  { sport: 'wnba', triggerPropType: 'Point', triggerPick: 'over',
    suggestPropType: 'Assist', suggestPick: 'over', strength: 7,
    reason: 'Star player dominating → ball movement' },
];

interface CorrelatedSuggestion {
  prop: PlayerProp;
  pick: 'over' | 'under';
  strength: number;
  reason: string;
  odds: number;
}

interface Props {
  currentLegs: Array<{ prop: PlayerProp; pick: 'over' | 'under' }>;
  availableProps: PlayerProp[];
  sport: Sport;
  onAddLeg: (prop: PlayerProp, pick: 'over' | 'under') => void;
}

function fmt(odds: number) {
  if (!odds || odds === 0) return 'N/A';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function americanToDecimal(odds: number) {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}

export function CorrelationStacker({ currentLegs, availableProps, sport, onAddLeg }: Props) {
  const suggestions = useMemo((): CorrelatedSuggestion[] => {
    if (currentLegs.length === 0) return [];

    const results: CorrelatedSuggestion[] = [];
    const addedIds = new Set(currentLegs.map(l => l.prop.id));

    for (const leg of currentLegs) {
      const { prop, pick } = leg;

      for (const rule of CORR_RULES) {
        // Check sport match
        if (rule.sport !== 'all' && rule.sport !== sport) continue;

        // Check trigger prop type match
        if (!prop.propType.toLowerCase().includes(rule.triggerPropType.toLowerCase())) continue;

        // Check trigger pick match
        if (rule.triggerPick !== 'both' && rule.triggerPick !== pick) continue;

        // Find candidate props from same game
        const candidates = availableProps.filter(p => {
          if (addedIds.has(p.id)) return false;
          if (p.gameId !== prop.gameId) return false; // must be same game
          if (p.team === prop.team && p.playerName === prop.playerName) return false; // not same player
          return p.propType.toLowerCase().includes(rule.suggestPropType.toLowerCase());
        });

        for (const candidate of candidates.slice(0, 2)) {
          const suggestPick = rule.suggestPick === 'same' ? pick :
                              rule.suggestPick === 'over' ? 'over' : 'under';
          const odds = suggestPick === 'over' ? candidate.overOdds : candidate.underOdds;
          if (!odds || odds === 0) continue;

          // Avoid duplicate suggestions

          if (results.some(r => r.prop.id === candidate.id && r.pick === suggestPick)) continue;

          results.push({
            prop: candidate,
            pick: suggestPick,
            strength: rule.strength,
            reason: rule.reason,
            odds,
          });
        }
      }
    }

    // Sort by correlation strength desc, dedupe by prop+pick
    return results
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 5);
  }, [currentLegs, availableProps, sport]);

  if (suggestions.length === 0 || currentLegs.length === 0) return null;

  const strengthBar = (s: number) => {
    const color = s >= 8 ? '#4ade80' : s >= 6 ? '#fbbf24' : '#38bdf8';
    return (
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {[...Array(5)].map((_val, i) => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: 1,
            background: i < Math.round(s / 2) ? color : 'rgba(255,255,255,.06)',
          }} />
        ))}
      </div>
    );
  };

  return (
    <div style={{
      marginTop: 12,
      background: 'rgba(99,102,241,.05)',
      border: '1px solid rgba(99,102,241,.2)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 13px',
        background: 'rgba(99,102,241,.08)',
        borderBottom: '1px solid rgba(99,102,241,.15)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 13 }}>🔗</span>
        <div>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: 12, fontWeight: 800, color: '#818cf8', letterSpacing: .5,
          }}>CORRELATION STACK</div>
          <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 600 }}>
            Props that move together with your current legs
          </div>
        </div>
      </div>

      {/* Suggestions */}
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {suggestions.map((s, i) => {
          const evDec = americanToDecimal(s.odds);
          const bookImplied = Math.round((1 / evDec) * 100);

          return (
            <button
              key={i}
              onClick={() => onAddLeg(s.prop, s.pick)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                background: 'rgba(255,255,255,.025)',
                border: '1px solid rgba(255,255,255,.07)',
                fontFamily: "'Barlow', sans-serif",
                transition: 'all .12s',
                width: '100%',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.025)')}
            >
              {/* Pick info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontSize: 13, fontWeight: 800, color: '#c8ddf0',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {s.prop.playerName}
                  <span style={{ color: '#1e3a60', fontWeight: 600, fontSize: 11 }}> · {s.prop.team}</span>
                </div>
                <div style={{ fontSize: 11, marginTop: 1 }}>
                  <span style={{ color: s.pick === 'over' ? '#4ade80' : '#f87171', fontWeight: 800 }}>
                    {s.pick.toUpperCase()}
                  </span>
                  <span style={{ color: '#1e3a60' }}> {s.prop.line} {s.prop.propType}</span>
                </div>
                <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 600, marginTop: 1 }}>
                  {s.reason}
                </div>
              </div>

              {/* Strength + odds */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                {strengthBar(s.strength)}
                <div style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontSize: 16, fontWeight: 900,
                  color: s.odds > 0 ? '#4ade80' : '#dce6f0',
                  lineHeight: 1,
                }}>{fmt(s.odds)}</div>
                <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 600 }}>{bookImplied}% implied</div>
              </div>

              {/* Add button */}
              <div style={{
                flexShrink: 0, width: 26, height: 26,
                background: 'rgba(99,102,241,.15)',
                border: '1px solid rgba(99,102,241,.3)',
                borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 16, fontWeight: 900, color: '#818cf8',
              }}>+</div>
            </button>
          );
        })}
      </div>

      <div style={{ padding: '6px 13px 8px', fontSize: 9, color: '#0e2040', fontWeight: 600 }}>
        Bars show correlation strength. Higher = more reliable historical linkage.
      </div>
    </div>
  );
}

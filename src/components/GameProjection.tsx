import { useState, useCallback } from 'react';
import type { GameData, WNBAGameData, GameLine, Sport } from '../services/api';

interface GameProjectionProps {
  game: GameData | WNBAGameData;
  line: GameLine | null;
  sport: Sport;
  onAddToBet?: (label: string, odds: number) => void;
}

interface Projection {
  homeScore: number;
  awayScore: number;
  winner: string;
  winnerOdds: string;
  confidence: number;
  keyAngle: string;
  spreadPick: string;
  spreadPickOdds: number;
  totalPick: 'over' | 'under';
  totalLine: number;
  totalOdds: number;
  riskFactors: string[];
  edgeRating: 'SHARP' | 'LEAN' | 'PASS';
  summary: string;
}

function fmt(odds: number) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

const SPORT_CONTEXTS: Record<string, string> = {
  mlb: 'Consider: starting pitchers, bullpen depth, park factors, recent form, umpire tendencies, weather/wind, lineup construction, day/night splits.',
  nba: 'Consider: pace of play, offensive/defensive ratings, rest days, back-to-backs, injury impact on rotations, home court advantage, recent ATS trend.',
  nfl: 'Consider: line movement, sharp action, weather, divisional knowledge, playoff implications, QB matchups, offensive line vs pass rush.',
  ncaaf: 'Consider: home field advantage is massive in college, recruiting talent gap, coaching matchups, travel fatigue, rivalry factors.',
  nhl: 'Consider: goaltender matchup, special teams (PP/PK%), fatigue, back-to-backs, recent form, home ice.',
  wnba: 'Consider: team pace, fatigue from schedule, player matchups, home court in small arenas.',
  ufc: 'Consider: style matchups, reach/size, recent performance, camp quality, weight cut impact, fight IQ.',
};

export function GameProjection({ game, line, sport, onAddToBet }: GameProjectionProps) {
  const [proj, setProj] = useState<Projection | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const generate = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setOpen(true);

    const mlb = sport === 'mlb' ? game as GameData : null;
    const contextLines = [
      `Matchup: ${game.awayTeam} @ ${game.homeTeam}`,
      `Sport: ${sport.toUpperCase()}`,
      line?.homeML ? `Moneyline: ${game.awayTeam} ${fmt(line.awayML || 0)} / ${game.homeTeam} ${fmt(line.homeML || 0)}` : '',
      line?.homeSpread ? `Spread: ${game.homeTeam} ${line.homeSpread > 0 ? '+' : ''}${line.homeSpread} (${fmt(line.homeSpreadOdds || -110)})` : '',
      line?.total ? `Total: ${line.total} (O ${fmt(line.overOdds || -110)} / U ${fmt(line.underOdds || -110)})` : '',
      mlb?.weather ? `Weather: ${mlb.weather.temperature}°F, ${mlb.weather.windSpeed}mph wind, ${mlb.weather.conditions}` : '',
      mlb?.umpire ? `Umpire: ${mlb.umpire.name} (${mlb.umpire.strikeZoneTendency} zone)` : '',
      mlb?.venue ? `Venue: ${mlb.venue}` : '',
      SPORT_CONTEXTS[sport] || '',
    ].filter(Boolean).join('\n');

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          system: `You are a sharp sports betting analyst. Generate score projections and betting picks. Return ONLY valid JSON, no markdown, no backticks.`,
          messages: [{
            role: 'user',
            content: `Generate a betting projection for this game. Return ONLY a JSON object with this exact structure:
{
  "homeScore": <projected home score as number>,
  "awayScore": <projected away score as number>,
  "winner": "<winning team name>",
  "winnerOdds": "<e.g. -145>",
  "confidence": <number 50-88>,
  "keyAngle": "<the single most important betting angle in one punchy sentence>",
  "spreadPick": "<team name + spread e.g. Yankees -1.5>",
  "spreadPickOdds": <number e.g. -110>,
  "totalPick": "over" | "under",
  "totalLine": <total line as number>,
  "totalOdds": <number e.g. -110>,
  "riskFactors": ["<risk 1>", "<risk 2>"],
  "edgeRating": "SHARP" | "LEAN" | "PASS",
  "summary": "<one sharp sentence why you like or dislike this game for betting>"
}

Game data:
${contextLines}`
          }]
        })
      });

      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      setProj(JSON.parse(clean));
    } catch {
      setProj(null);
    } finally {
      setLoading(false);
    }
  }, [game, line, sport, loading]);

  const edgeColors = {
    SHARP: { bg: 'rgba(74,222,128,.12)', border: 'rgba(74,222,128,.3)', text: '#4ade80' },
    LEAN:  { bg: 'rgba(251,191,36,.1)',  border: 'rgba(251,191,36,.25)', text: '#fbbf24' },
    PASS:  { bg: 'rgba(100,116,139,.1)', border: 'rgba(100,116,139,.2)', text: '#64748b' },
  };

  return (
    <div>
      {/* Trigger button */}
      <button
        onClick={open && proj ? () => setOpen(v => !v) : generate}
        style={{
          width: '100%', padding: '7px 0',
          background: loading ? 'rgba(255,255,255,.03)' : 'rgba(99,102,241,.1)',
          color: loading ? '#2a4060' : '#818cf8',
          border: `1px solid ${loading ? 'rgba(255,255,255,.06)' : 'rgba(99,102,241,.25)'}`,
          borderRadius: 7, cursor: loading ? 'wait' : 'pointer',
          fontSize: 11, fontWeight: 800,
          fontFamily: "'Barlow Condensed', sans-serif",
          letterSpacing: .5, transition: 'all .15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        {loading ? (
          <>
            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: 12 }}>⟳</span>
            Generating projection…
          </>
        ) : proj && open ? (
          '▲ Hide Projection'
        ) : proj ? (
          '▼ Show Projection'
        ) : (
          '🔮 AI Game Projection'
        )}
      </button>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Projection card */}
      {open && proj && (
        <div style={{
          marginTop: 8,
          background: 'rgba(99,102,241,.05)',
          border: '1px solid rgba(99,102,241,.2)',
          borderRadius: 10, overflow: 'hidden',
          animation: 'fadeIn .2s ease',
        }}>
          <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>

          {/* Score projection banner */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,.15), rgba(14,165,233,.1))',
            borderBottom: '1px solid rgba(99,102,241,.15)',
            padding: '12px 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}>
            {/* Score display */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>AWAY</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 700, color: '#8ab0cc' }}>{game.awayTeam.split(' ').slice(-1)[0]}</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 32, fontWeight: 900, color: proj.awayScore > proj.homeScore ? '#c8ddf0' : '#2a4060', lineHeight: 1 }}>
                  {proj.awayScore}
                </div>
              </div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 700, color: '#1a3060' }}>–</div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>HOME</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 700, color: '#c8ddf0' }}>{game.homeTeam.split(' ').slice(-1)[0]}</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 32, fontWeight: 900, color: proj.homeScore >= proj.awayScore ? '#c8ddf0' : '#2a4060', lineHeight: 1 }}>
                  {proj.homeScore}
                </div>
              </div>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3 }}>WINNER</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 900, color: '#c8ddf0' }}>{proj.winner.split(' ').slice(-1)[0]}</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 900, color: '#4ade80' }}>{proj.winnerOdds}</div>
              </div>
            </div>

            {/* Edge rating + confidence */}
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <div style={{
                ...edgeColors[proj.edgeRating],
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 15, fontWeight: 900, padding: '4px 12px',
                borderRadius: 6, display: 'inline-block',
                background: edgeColors[proj.edgeRating].bg,
                border: `1px solid ${edgeColors[proj.edgeRating].border}`,
                color: edgeColors[proj.edgeRating].text,
                letterSpacing: .5,
              }}>
                {proj.edgeRating === 'SHARP' ? '⚡ SHARP' : proj.edgeRating === 'LEAN' ? '📊 LEAN' : '⚠ PASS'}
              </div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, fontWeight: 900, color: proj.confidence >= 70 ? '#4ade80' : proj.confidence >= 58 ? '#fbbf24' : '#64748b', marginTop: 4 }}>
                {proj.confidence}%
              </div>
            </div>
          </div>

          {/* Key angle */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
            <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>Key Angle</div>
            <div style={{ fontSize: 12, color: '#c8ddf0', fontWeight: 600, lineHeight: 1.5 }}>🎯 {proj.keyAngle}</div>
          </div>

          {/* Derived picks */}
          <div style={{ padding: '10px 14px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
            {/* Spread pick */}
            {proj.spreadPick && (
              <button
                onClick={() => onAddToBet?.(proj.spreadPick, proj.spreadPickOdds)}
                style={{
                  flex: 1, minWidth: 120, padding: '8px 10px', borderRadius: 7, cursor: 'pointer',
                  background: 'rgba(56,189,248,.08)', border: '1px solid rgba(56,189,248,.2)',
                  fontFamily: "'Barlow', sans-serif", transition: 'all .15s', textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: .8, textTransform: 'uppercase', marginBottom: 2 }}>Spread Pick</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 800, color: '#38bdf8' }}>{proj.spreadPick}</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 900, color: proj.spreadPickOdds > 0 ? '#4ade80' : '#dce6f0' }}>{fmt(proj.spreadPickOdds)}</div>
              </button>
            )}
            {/* Total pick */}
            {proj.totalLine > 0 && (
              <button
                onClick={() => onAddToBet?.(`${proj.totalPick === 'over' ? 'Over' : 'Under'} ${proj.totalLine}`, proj.totalOdds)}
                style={{
                  flex: 1, minWidth: 120, padding: '8px 10px', borderRadius: 7, cursor: 'pointer',
                  background: proj.totalPick === 'over' ? 'rgba(74,222,128,.08)' : 'rgba(248,113,113,.08)',
                  border: `1px solid ${proj.totalPick === 'over' ? 'rgba(74,222,128,.2)' : 'rgba(248,113,113,.2)'}`,
                  fontFamily: "'Barlow', sans-serif", transition: 'all .15s', textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: .8, textTransform: 'uppercase', marginBottom: 2 }}>Total Pick</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 800, color: proj.totalPick === 'over' ? '#4ade80' : '#f87171' }}>
                  {proj.totalPick === 'over' ? '▲ OVER' : '▼ UNDER'} {proj.totalLine}
                </div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 900, color: proj.totalOdds > 0 ? '#4ade80' : '#dce6f0' }}>{fmt(proj.totalOdds)}</div>
              </button>
            )}
          </div>

          {/* Risk factors + summary */}
          <div style={{ padding: '10px 14px' }}>
            {proj.riskFactors?.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>Risk Factors</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {proj.riskFactors.map((r, i) => (
                    <span key={i} style={{ fontSize: 10, color: '#fbbf24', background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.18)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                      ⚠ {r}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, color: '#4a6080', fontWeight: 600, lineHeight: 1.5, fontStyle: 'italic' }}>
              {proj.summary}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

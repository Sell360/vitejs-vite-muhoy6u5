import { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/api';
import type { Sport, GameData, WNBAGameData, GameLine } from '../services/api';
import { GameProjection } from './GameProjection';
import { getTimezoneEdge } from '../services/edgeSignals';
import { ParlayShareCard } from './ParlayShareCard';
import { useAuth } from '../contexts/AuthContext';
import { logBet } from '../services/mockBets';

interface OddsBoardProps {
  sport: Sport;
  games: (GameData | WNBAGameData)[];
  onNavigateParlays?: () => void;
}

interface BetSlipLeg {
  gameId: string;
  matchup: string;
  betType: 'ML' | 'SPREAD' | 'TOTAL';
  side: 'home' | 'away' | 'over' | 'under';
  label: string;
  odds: number;
  sport: Sport;
}

function fmt(odds: number | null | undefined) {
  if (!odds || odds === 0) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
function americanToDecimal(odds: number) {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}
function decimalToAmerican(d: number) {
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function oddsColor(odds: number | null | undefined) {
  if (!odds) return '#2a4060';
  return odds > 0 ? '#4ade80' : '#dce6f0';
}

// Merge ESPN games with Odds API lines by fuzzy team name match
function mergeGamesWithLines(
  games: (GameData | WNBAGameData)[],
  lines: GameLine[]
): Array<{ game: GameData | WNBAGameData; line: GameLine | null }> {
  return games.map(game => {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
    const homeN = normalize(game.homeTeam);
    const awayN = normalize(game.awayTeam);
    const line = lines.find(l => {
      const lh = normalize(l.homeTeam);
      const la = normalize(l.awayTeam);
      // Match if any word in the ESPN name appears in the Odds API name
      const homeMatch = homeN.length > 3 && lh.includes(homeN.slice(0, Math.max(4, homeN.length - 2)));
      const awayMatch = awayN.length > 3 && la.includes(awayN.slice(0, Math.max(4, awayN.length - 2)));
      return homeMatch || awayMatch;
    }) || lines.find(l => {
      // Fallback: check if startTime is within 2 hours
      const diff = Math.abs(new Date(l.startTime).getTime() - new Date(game.startTime).getTime());
      return diff < 2 * 60 * 60 * 1000;
    }) || null;
    return { game, line };
  });
}

// ── Odds Cell — stable component outside render ──
interface OddsCellProps {
  label: string;
  sublabel?: string;
  odds: number | null | undefined;
  isAdded: boolean;
  onClick: () => void;
  disabled?: boolean;
}
function OddsCell({ label, sublabel, odds, isAdded, onClick, disabled }: OddsCellProps) {
  const hasOdds = odds && odds !== 0;
  return (
    <button
      onClick={onClick}
      disabled={disabled || !hasOdds}
      style={{
        flex: 1, minWidth: 0, padding: '7px 6px',
        background: isAdded ? 'rgba(14,165,233,.18)' : hasOdds ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.01)',
        border: `1px solid ${isAdded ? 'rgba(14,165,233,.5)' : hasOdds ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.04)'}`,
        borderRadius: 7, cursor: hasOdds ? 'pointer' : 'default',
        textAlign: 'center', transition: 'all .12s',
        fontFamily: "'Barlow', sans-serif",
      }}
    >
      {sublabel && (
        <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', lineHeight: 1, marginBottom: 2 }}>
          {sublabel}
        </div>
      )}
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 700, color: '#2a4060', lineHeight: 1, marginBottom: 1 }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 900, color: isAdded ? '#38bdf8' : oddsColor(odds), lineHeight: 1 }}>
        {hasOdds ? fmt(odds) : '—'}
      </div>
    </button>
  );
}

export function OddsBoard({ sport, games }: OddsBoardProps) {
  const { user } = useAuth();
  const [logged, setLogged] = useState(false);
  const [lines, setLines] = useState<GameLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [slip, setSlip] = useState<BetSlipLeg[]>([]);
  const [stake, setStake] = useState('25');
  const [slipOpen, setSlipOpen] = useState(false);

  useEffect(() => {
    if (games.length === 0) return;
    setLinesLoading(true);
    apiService.getGameLines(sport)
      .then(setLines)
      .catch(() => setLines([]))
      .finally(() => setLinesLoading(false));
  }, [sport]);

  const isAdded = useCallback((gameId: string, betType: string, side: string) =>
    slip.some(l => l.gameId === gameId && l.betType === betType && l.side === side),
    [slip]
  );

  const toggleLeg = useCallback((leg: BetSlipLeg) => {
    setSlip(prev => {
      const exists = prev.findIndex(l => l.gameId === leg.gameId && l.betType === leg.betType && l.side === leg.side);
      if (exists >= 0) return prev.filter((_, i) => i !== exists);
      setSlipOpen(true);
      return [...prev, leg];
    });
  }, []);

  const merged = mergeGamesWithLines(games, lines);

  const combinedOdds = slip.length > 1
    ? decimalToAmerican(slip.reduce((acc, l) => acc * americanToDecimal(l.odds), 1))
    : slip.length === 1 ? slip[0].odds : 0;
  const stakeNum = parseFloat(stake) || 0;
  const payout = slip.length > 0 ? (stakeNum * americanToDecimal(combinedOdds)).toFixed(2) : '0.00';
  const profit = (parseFloat(payout) - stakeNum).toFixed(2);

  const statusDot = (status: string) => {
    if (status === 'live') return <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', display: 'inline-block', marginRight: 4, boxShadow: '0 0 5px #4ade80' }} />;
    if (status === 'final') return <span style={{ fontSize: 9, color: '#334155', fontWeight: 700, marginRight: 4 }}>FINAL</span>;
    return null;
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0 }}>

      {/* ── COLUMN HEADERS ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr 1fr 1fr',
        gap: 6, padding: '6px 0 8px',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        marginBottom: 4,
      }}>
        <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', paddingLeft: 4 }}>
          {sport.toUpperCase()} — {games.length} Games
          {linesLoading && <span style={{ color: '#fbbf24', marginLeft: 6 }}>⏳ Loading lines…</span>}
        </div>
        {['MONEYLINE', 'SPREAD', 'TOTAL O/U'].map(h => (
          <div key={h} style={{ fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', textAlign: 'center' }}>{h}</div>
        ))}
      </div>

      {/* ── GAME ROWS ── */}
      {merged.map(({ game, line }) => {
        const mlb = sport === 'mlb' ? game as GameData : null;
        const isLive = game.status === 'live';
        const isFinal = game.status === 'final';

        return (
          <div key={game.id} style={{
            display: 'grid',
            gridTemplateColumns: '200px 1fr 1fr 1fr',
            gap: 6,
            padding: '6px 0',
            borderBottom: '1px solid rgba(255,255,255,.04)',
            alignItems: 'center',
          }}>
            {/* Matchup info */}
            <div style={{ paddingLeft: 2, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                {statusDot(game.status)}
                <span style={{ fontSize: 9, color: '#1a3060', fontWeight: 600 }}>{fmtTime(game.startTime)}</span>
              </div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 700, color: '#8ab0cc', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {game.awayTeam}
              </div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 700, color: '#c8ddf0', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {game.homeTeam}
              </div>
              {(isLive || isFinal) && game.homeScore !== undefined && (
                <div style={{ fontSize: 10, color: '#38bdf8', fontWeight: 800, fontFamily: "'Barlow Condensed', sans-serif", marginTop: 1 }}>
                  {game.awayScore} – {game.homeScore}
                  {mlb?.inning && <span style={{ color: '#1a3060', marginLeft: 4 }}>{mlb.inning}</span>}
                </div>
              )}
              {mlb?.weather && (
                <div style={{ fontSize: 9, color: '#1a3060', marginTop: 1 }}>💨 {mlb.weather.windSpeed}mph · {mlb.weather.temperature}°F</div>
              )}
              {(() => {
                const tz = getTimezoneEdge(game.awayTeam, game.homeTeam, game.startTime);
                if (!tz.hasEdge) return null;
                const tzColor = tz.severity === 'severe' ? '#f87171' : tz.severity === 'moderate' ? '#fbbf24' : '#64748b';
                return (
                  <div title={tz.reason} style={{
                    fontSize: 9, color: tzColor, marginTop: 2, fontWeight: 700,
                    fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: .3,
                    background: `${tzColor}15`, border: `1px solid ${tzColor}30`,
                    padding: '1px 5px', borderRadius: 3, display: 'inline-block',
                  }}>{tz.flag}</div>
                );
              })()}
              <div style={{ marginTop: 5 }}>
                <GameProjection
                  game={game}
                  line={line}
                  sport={sport}
                  onAddToBet={(label, odds) => toggleLeg({ gameId: game.id, matchup: `${game.awayTeam} @ ${game.homeTeam}`, betType: 'TOTAL', side: odds > 0 ? 'over' : 'under', label, odds, sport })}
                />
              </div>
            </div>

            {/* Moneyline */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <OddsCell
                label={game.awayTeam.split(' ').pop() || game.awayTeam}
                sublabel="AWAY"
                odds={line?.awayML}
                isAdded={isAdded(game.id, 'ML', 'away')}
                onClick={() => line?.awayML && toggleLeg({ gameId: game.id, matchup: `${game.awayTeam} @ ${game.homeTeam}`, betType: 'ML', side: 'away', label: `${game.awayTeam} ML`, odds: line.awayML, sport })}
              />
              <OddsCell
                label={game.homeTeam.split(' ').pop() || game.homeTeam}
                sublabel="HOME"
                odds={line?.homeML}
                isAdded={isAdded(game.id, 'ML', 'home')}
                onClick={() => line?.homeML && toggleLeg({ gameId: game.id, matchup: `${game.awayTeam} @ ${game.homeTeam}`, betType: 'ML', side: 'home', label: `${game.homeTeam} ML`, odds: line.homeML, sport })}
              />
            </div>

            {/* Spread */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <OddsCell
                label={line?.awaySpread != null ? `${(line.awaySpread ?? 0) > 0 ? '+' : ''}${line.awaySpread}` : '—'}
                sublabel="AWAY"
                odds={line?.awaySpreadOdds}
                isAdded={isAdded(game.id, 'SPREAD', 'away')}
                onClick={() => line?.awaySpreadOdds && toggleLeg({ gameId: game.id, matchup: `${game.awayTeam} @ ${game.homeTeam}`, betType: 'SPREAD', side: 'away', label: `${game.awayTeam} ${line.awaySpread}`, odds: line.awaySpreadOdds, sport })}
              />
              <OddsCell
                label={line?.homeSpread != null ? `${(line.homeSpread ?? 0) > 0 ? '+' : ''}${line.homeSpread}` : '—'}
                sublabel="HOME"
                odds={line?.homeSpreadOdds}
                isAdded={isAdded(game.id, 'SPREAD', 'home')}
                onClick={() => line?.homeSpreadOdds && toggleLeg({ gameId: game.id, matchup: `${game.awayTeam} @ ${game.homeTeam}`, betType: 'SPREAD', side: 'home', label: `${game.homeTeam} ${line.homeSpread}`, odds: line.homeSpreadOdds, sport })}
              />
            </div>

            {/* Total */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <OddsCell
                label="OVER"
                sublabel={line?.total ? `O ${line.total}` : 'OVER'}
                odds={line?.overOdds}
                isAdded={isAdded(game.id, 'TOTAL', 'over')}
                onClick={() => line?.overOdds && toggleLeg({ gameId: game.id, matchup: `${game.awayTeam} @ ${game.homeTeam}`, betType: 'TOTAL', side: 'over', label: `Over ${line.total}`, odds: line.overOdds, sport })}
              />
              <OddsCell
                label="UNDER"
                sublabel={line?.total ? `U ${line.total}` : 'UNDER'}
                odds={line?.underOdds}
                isAdded={isAdded(game.id, 'TOTAL', 'under')}
                onClick={() => line?.underOdds && toggleLeg({ gameId: game.id, matchup: `${game.awayTeam} @ ${game.homeTeam}`, betType: 'TOTAL', side: 'under', label: `Under ${line.total}`, odds: line.underOdds, sport })}
              />
            </div>
          </div>
        );
      })}

      {games.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#1e3560', fontSize: 13, fontWeight: 600 }}>
          No {sport.toUpperCase()} games today
        </div>
      )}

      {/* ── BET SLIP ── */}
      {slip.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300,
          background: '#070c18', borderTop: '1px solid rgba(14,165,233,.3)',
          boxShadow: '0 -8px 32px rgba(0,0,0,.6)',
          transition: 'max-height .25s',
        }}>
          {/* Slip toggle bar */}
          <div
            onClick={() => setSlipOpen(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 20px', cursor: 'pointer',
              background: 'rgba(14,165,233,.07)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15, fontWeight: 900, color: '#38bdf8', letterSpacing: .5 }}>
                ⚡ BET SLIP
              </span>
              <span style={{
                background: '#0ea5e9', color: '#fff', borderRadius: 4,
                fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 900,
                padding: '1px 7px',
              }}>{slip.length}</span>
              {slip.length > 1 && (
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 900, color: '#4ade80' }}>
                  {fmt(combinedOdds)}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {slip.length > 0 && (
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 700, color: '#4ade80' }}>
                  ${payout} payout
                </span>
              )}
              <span style={{ color: '#2a4060', fontSize: 16 }}>{slipOpen ? '▼' : '▲'}</span>
            </div>
          </div>

          {/* Slip body */}
          {slipOpen && (
            <div style={{ padding: '0 20px 16px', maxHeight: '50vh', overflowY: 'auto' }}>
              {/* Legs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                {slip.map((leg, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
                    borderRadius: 8, padding: '8px 12px',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: .8, textTransform: 'uppercase' }}>
                        {leg.sport.toUpperCase()} · {leg.betType}
                      </div>
                      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, color: '#c8ddf0' }}>
                        {leg.matchup}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: leg.side === 'over' ? '#4ade80' : leg.side === 'under' ? '#f87171' : '#c8ddf0' }}>
                        {leg.label}
                      </div>
                    </div>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 900, color: leg.odds > 0 ? '#4ade80' : '#dce6f0', flexShrink: 0 }}>
                      {fmt(leg.odds)}
                    </div>
                    <button
                      onClick={() => setSlip(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'transparent', border: 'none', color: '#1a3060', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1 }}
                    >×</button>
                  </div>
                ))}
              </div>

              {/* Stake + payout */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Stake</div>
                  <input
                    value={stake}
                    onChange={e => setStake(e.target.value)}
                    style={{ width: '100%', background: 'rgba(255,255,255,.05)', color: '#dce6f0', border: '1px solid rgba(255,255,255,.1)', borderRadius: 7, padding: '7px 10px', fontSize: 14, fontWeight: 700, outline: 'none', fontFamily: "'Barlow', sans-serif" }}
                  />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Combined Odds</div>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 900, color: '#38bdf8', lineHeight: 1.2 }}>{fmt(combinedOdds)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Payout</div>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 900, color: '#4ade80', lineHeight: 1.2 }}>${payout}</div>
                  <div style={{ fontSize: 10, color: parseFloat(profit) > 0 ? '#4ade80' : '#f87171', fontWeight: 700 }}>+${profit} profit</div>
                </div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <ParlayShareCard
                  legs={slip.map(l => ({ label: l.label, matchup: l.matchup, betType: l.betType, odds: l.odds, sport: l.sport }))}
                  combinedOdds={combinedOdds}
                  stake={stakeNum}
                  payout={parseFloat(payout)}
                />
              </div>
              {user && (
                <button
                  onClick={async () => {
                    setLogged(false);
                    for (const leg of slip) {
                      const game = games.find(g => g.id === leg.gameId);
                      await logBet({
                        user_id: user.id,
                        sport: leg.sport,
                        event_id: leg.gameId,
                        game_time: game?.startTime || new Date().toISOString(),
                        matchup: leg.matchup,
                        bet_type: leg.betType,
                        pick_label: leg.label,
                        pick_side: leg.side,
                        line: null,
                        odds: leg.odds,
                        stake: stakeNum / slip.length,
                        legs: null,
                        status: 'pending',
                      });
                    }
                    setLogged(true);
                    setTimeout(() => { setSlip([]); setSlipOpen(false); setLogged(false); }, 1500);
                  }}
                  style={{ width: '100%', padding: '10px', marginBottom: 8, background: logged ? 'rgba(74,222,128,.2)' : 'linear-gradient(135deg, rgba(99,102,241,.18), rgba(99,102,241,.08))', color: logged ? '#4ade80' : '#818cf8', border: `1px solid ${logged ? 'rgba(74,222,128,.4)' : 'rgba(99,102,241,.3)'}`, borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" }}
                >
                  {logged ? '✓ Bet logged to tracker!' : `📊 Log as mock bet ($${stakeNum.toFixed(0)} stake)`}
                </button>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <a href="https://sportsbook.draftkings.com" target="_blank" rel="noopener noreferrer" style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg, rgba(74,222,128,.15), rgba(74,222,128,.08))', color: '#4ade80', border: '1px solid rgba(74,222,128,.3)', borderRadius: 8, fontSize: 13, fontWeight: 800, textDecoration: 'none', textAlign: 'center', fontFamily: "'Barlow', sans-serif" }}>
                  🏈 Bet DraftKings
                </a>
                <a href="https://sportsbook.fanduel.com" target="_blank" rel="noopener noreferrer" style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg, rgba(56,189,248,.15), rgba(56,189,248,.08))', color: '#38bdf8', border: '1px solid rgba(56,189,248,.3)', borderRadius: 8, fontSize: 13, fontWeight: 800, textDecoration: 'none', textAlign: 'center', fontFamily: "'Barlow', sans-serif" }}>
                  🎯 Bet FanDuel
                </a>
                <button
                  onClick={() => { setSlip([]); setSlipOpen(false); }}
                  style={{ padding: '10px 14px', background: 'transparent', color: '#2a4060', border: '1px solid rgba(255,255,255,.07)', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" }}
                >Clear</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Spacer so content isn't hidden behind fixed slip */}
      {slip.length > 0 && <div style={{ height: slipOpen ? 280 : 52 }} />}
    </div>
  );
}

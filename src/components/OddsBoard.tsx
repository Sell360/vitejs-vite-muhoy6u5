import { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/api';
import type { Sport, GameData, WNBAGameData, GameLine } from '../services/api';
import { GameProjection } from './GameProjection';
import { AltLinesPanel } from './AltLinesPanel';
import { SharpLineBadge } from './SharpLineBadge';
import { SimilarGamesPanel } from './SimilarGamesPanel';
import { getTimezoneEdge } from '../services/edgeSignals';
import { getReversalsForSport, type ReversalSignal } from '../services/lineMovement';
import { ParlayShareCard } from './ParlayShareCard';
import { useAuth } from '../contexts/AuthContext';
import { logBet, wouldExceedUnderdogCap, MAX_UNDERDOGS_PER_PARLAY } from '../services/mockBets';
import { notifications } from '../services/notifications';

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
  const [linesFetchedAt, setLinesFetchedAt] = useState<number | undefined>(undefined);
  const [reversals, setReversals] = useState<Map<string, ReversalSignal>>(new Map());
  const [slip, setSlip] = useState<BetSlipLeg[]>([]);
  const [stake, setStake] = useState('25');
  const [slipOpen, setSlipOpen] = useState(false);

  useEffect(() => {
    if (games.length === 0) return;
    setLinesLoading(true);
    apiService.getGameLines(sport)
      .then(l => { setLines(l); setLinesFetchedAt(apiService.getLinesFetchedAt(sport)); })
      .catch(() => setLines([]))
      .finally(() => setLinesLoading(false));
    // Background load reversal signals
    getReversalsForSport(sport).then(map => {
      setReversals(map);
      // Notify on each reversal/steam signal (deduped per event)
      map.forEach((sig, eventId) => {
        const game = games.find(g => g.id === eventId);
        if (!game) return;
        notifications.push({
          type: sig.direction === 'reversal' ? 'reversal' : 'line_move',
          title: `${sig.direction === 'reversal' ? 'SHARP REVERSE' : 'STEAM MOVE'} · ${sig.market.toUpperCase()}`,
          body: `${game.awayTeam} @ ${game.homeTeam} — ${sig.description}`,
        }, `${sig.direction}-${eventId}-${sig.market}`);
      });
    }).catch(() => setReversals(new Map()));
  }, [sport]);

  const [underdogWarning, setUnderdogWarning] = useState('');

  const isAdded = useCallback((gameId: string, betType: string, side: string) =>
    slip.some(l => l.gameId === gameId && l.betType === betType && l.side === side),
    [slip]
  );

  const toggleLeg = useCallback((leg: BetSlipLeg) => {
    setSlip(prev => {
      const exists = prev.findIndex(l => l.gameId === leg.gameId && l.betType === leg.betType && l.side === leg.side);
      if (exists >= 0) return prev.filter((_, i) => i !== exists); // removing always allowed
      // Enforce sportsbook-style underdog cap on adds
      if (wouldExceedUnderdogCap(prev, leg.odds)) {
        setUnderdogWarning(`Maximum ${MAX_UNDERDOGS_PER_PARLAY} underdogs (positive odds) per parlay`);
        setTimeout(() => setUnderdogWarning(''), 3500);
        return prev;
      }
      setSlipOpen(true);
      return [...prev, leg];
    });
  }, []);

  // Filter out final/completed games — they're not actionable for betting
  // and the Odds API often serves stale post-game lines like -10000 / +1460
  // which indicate the line is functionally closed (game already decided).
  // A line wider than +/-2500 usually means the book has already settled this
  // game internally and the API is just echoing the closed-out price.
  const isClosedLine = (line: GameLine | null | undefined) => {
    if (!line) return false;
    const homeAbs = Math.abs(line.homeML ?? 0);
    const awayAbs = Math.abs(line.awayML ?? 0);
    return homeAbs > 2500 || awayAbs > 2500;
  };

  const merged = mergeGamesWithLines(games, lines).filter(({ game, line }) => {
    // Hide final games entirely — you can't bet them
    if (game.status === 'final') return false;
    // For scheduled/live games, hide if lines have already closed out
    // (sportsbook stopped accepting bets and is showing settlement prices)
    if (game.status === 'live' && isClosedLine(line)) return false;
    return true;
  });

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
      <style>{`
        .b360-odds-row { display: grid; grid-template-columns: 200px 1fr 1fr 1fr; gap: 6px; }
        @media (max-width: 700px) {
          .b360-odds-row { grid-template-columns: 130px 1fr 1fr 1fr; gap: 3px; font-size: 11px; }
          .b360-odds-row .b360-stack { gap: 2px !important; }
        }
        @media (max-width: 420px) {
          .b360-odds-row { grid-template-columns: 110px 1fr 1fr 1fr; }
        }
      `}</style>

      {/* ── LINE FRESHNESS BANNER ──
          Shows users when our lines were last refreshed from the underlying
          sportsbook feed. Lines are cached up to 60 minutes to manage API
          costs, so a line shown here may be a few minutes to an hour old.
          We always link out to the actual book (DraftKings) so users can
          confirm the live price before placing a real bet. */}
      {linesFetchedAt && (() => {
        const ageMin = Math.floor((Date.now() - linesFetchedAt) / 60000);
        const ageLabel = ageMin < 1 ? 'just now'
          : ageMin === 1 ? '1 min ago'
          : ageMin < 60 ? `${ageMin} min ago`
          : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m ago`;
        const stale = ageMin >= 30;
        return (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 8, flexWrap: 'wrap',
            padding: '8px 12px', marginBottom: 10,
            background: stale ? 'rgba(251,191,36,.08)' : 'rgba(56,189,248,.06)',
            border: `1px solid ${stale ? 'rgba(251,191,36,.25)' : 'rgba(56,189,248,.18)'}`,
            borderRadius: 8,
            fontSize: 11, color: '#8ab0cc',
            fontFamily: "'Barlow', sans-serif",
          }}>
            <span>
              <span style={{ color: stale ? '#fbbf24' : '#38bdf8', fontWeight: 800 }}>
                {stale ? '⚠️' : '⏱'} Lines refreshed {ageLabel}
              </span>
              <span style={{ marginLeft: 6, color: '#4a6080' }}>
                · Sourced from DraftKings via The Odds API · Verify before placing real bets
              </span>
            </span>
            <a
              href="https://sportsbook.draftkings.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '4px 10px',
                background: 'rgba(74,222,128,.12)', color: '#4ade80',
                border: '1px solid rgba(74,222,128,.3)', borderRadius: 6,
                fontSize: 11, fontWeight: 800, textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >🔗 Verify on DraftKings</a>
          </div>
        );
      })()}

      {/* ── COLUMN HEADERS ── */}
      <div className="b360-odds-row" style={{
        padding: '6px 0 8px',
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
          <div key={game.id} className="b360-odds-row" style={{
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
              {(() => {
                const rev = reversals.get(game.id);
                if (!rev) return null;
                const c = rev.direction === 'reversal' ? '#a855f7' : '#fb923c';
                const label = rev.direction === 'reversal' ? `🔄 SHARP REVERSE` : `🔥 STEAM`;
                return (
                  <div title={rev.description} style={{
                    fontSize: 9, color: c, marginTop: 2, marginLeft: 4, fontWeight: 700,
                    fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: .3,
                    background: `${c}15`, border: `1px solid ${c}40`,
                    padding: '1px 5px', borderRadius: 3, display: 'inline-block',
                  }}>{label} {rev.strength}/10</div>
                );
              })()}
              <SharpLineBadge
                sport={sport}
                homeTeam={game.homeTeam}
                awayTeam={game.awayTeam}
                homeML={line?.homeML ?? null}
                awayML={line?.awayML ?? null}
              />
              <div style={{ marginTop: 5 }}>
                <GameProjection
                  game={game}
                  line={line}
                  sport={sport}
                  onAddToBet={(label, odds) => toggleLeg({ gameId: game.id, matchup: `${game.awayTeam} @ ${game.homeTeam}`, betType: 'TOTAL', side: odds > 0 ? 'over' : 'under', label, odds, sport })}
                />
                <AltLinesPanel
                  sport={sport}
                  eventId={game.id}
                  homeTeam={game.homeTeam}
                  awayTeam={game.awayTeam}
                  onAddLeg={(label, odds, betType, side) => toggleLeg({
                    gameId: game.id,
                    matchup: `${game.awayTeam} @ ${game.homeTeam}`,
                    betType,
                    side: side as 'home' | 'away' | 'over' | 'under',
                    label,
                    odds,
                    sport,
                  })}
                />
                <SimilarGamesPanel
                  sport={sport}
                  spread={line?.homeSpread ?? null}
                  total={line?.total ?? null}
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
              {(() => {
                const dogs = slip.filter(l => l.odds > 0).length;
                if (dogs === 0) return null;
                return (
                  <span title="Underdog count (max 2 per parlay)" style={{
                    background: dogs >= MAX_UNDERDOGS_PER_PARLAY ? 'rgba(248,113,113,.15)' : 'rgba(251,191,36,.12)',
                    color: dogs >= MAX_UNDERDOGS_PER_PARLAY ? '#f87171' : '#fbbf24',
                    border: `1px solid ${dogs >= MAX_UNDERDOGS_PER_PARLAY ? 'rgba(248,113,113,.3)' : 'rgba(251,191,36,.3)'}`,
                    fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 800,
                    padding: '1px 7px', borderRadius: 4, letterSpacing: .3,
                  }}>🐕 {dogs}/{MAX_UNDERDOGS_PER_PARLAY} dogs</span>
                );
              })()}
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
              {underdogWarning && (
                <div style={{
                  margin: '8px 0', padding: '8px 12px',
                  background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.25)',
                  borderRadius: 7, color: '#f87171', fontSize: 12, fontWeight: 700,
                  fontFamily: "'Barlow', sans-serif",
                }}>
                  ⚠ {underdogWarning}
                </div>
              )}
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
                    if (slip.length === 1) {
                      // Single-leg: log as the original bet type
                      const leg = slip[0];
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
                        stake: stakeNum,
                        legs: null,
                        status: 'pending',
                      });
                    } else {
                      // Multi-leg: log as a SINGLE parlay bet with combined odds
                      // and per-leg detail in the legs JSONB column. The
                      // auto-settler reads legs[] to grade each one separately.
                      const decimalOdds = slip.reduce((acc, l) => {
                        const dec = l.odds > 0 ? l.odds / 100 + 1 : 100 / Math.abs(l.odds) + 1;
                        return acc * dec;
                      }, 1);
                      // Convert combined decimal odds back to American
                      const combinedAmerican = decimalOdds >= 2
                        ? Math.round((decimalOdds - 1) * 100)
                        : Math.round(-100 / (decimalOdds - 1));

                      // Use the earliest start time across all legs as the game_time
                      // so the auto-settler has something sensible for the "game has
                      // ended" lookback window. The legs[] array carries each leg's
                      // own gameTime so settlement uses each leg's own time.
                      const earliestStart = slip.reduce((earliest, l) => {
                        const g = games.find(gm => gm.id === l.gameId);
                        const t = g?.startTime || new Date().toISOString();
                        return (!earliest || t < earliest) ? t : earliest;
                      }, '' as string);

                      const matchupSummary = slip.map(l => l.label).join(' + ');

                      await logBet({
                        user_id: user.id,
                        sport: slip[0].sport, // representative; legs may span sports
                        event_id: null,
                        game_time: earliestStart || new Date().toISOString(),
                        matchup: `${slip.length}-leg parlay`,
                        bet_type: 'PARLAY',
                        pick_label: matchupSummary,
                        pick_side: null,
                        line: null,
                        odds: combinedAmerican,
                        stake: stakeNum,
                        legs: slip.map(l => {
                          const g = games.find(gm => gm.id === l.gameId);
                          return {
                            sport: l.sport,
                            gameId: l.gameId,
                            matchup: l.matchup,
                            gameTime: g?.startTime || null,
                            betType: l.betType,
                            side: l.side,
                            line: null,
                            label: l.label,
                            odds: l.odds,
                          };
                        }),
                        status: 'pending',
                      });
                    }
                    setLogged(true);
                    setTimeout(() => { setSlip([]); setSlipOpen(false); setLogged(false); }, 1500);
                  }}
                  style={{ width: '100%', padding: '10px', marginBottom: 8, background: logged ? 'rgba(74,222,128,.2)' : 'linear-gradient(135deg, rgba(99,102,241,.18), rgba(99,102,241,.08))', color: logged ? '#4ade80' : '#818cf8', border: `1px solid ${logged ? 'rgba(74,222,128,.4)' : 'rgba(99,102,241,.3)'}`, borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" }}
                >
                  {logged ? '✓ Bet logged to tracker!' : slip.length > 1 ? `📊 Log as ${slip.length}-leg parlay ($${stakeNum.toFixed(0)} stake)` : `📊 Log as mock bet ($${stakeNum.toFixed(0)} stake)`}
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

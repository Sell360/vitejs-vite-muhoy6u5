import type { GameData, WNBAGameData, Sport } from '../services/api';

interface GameCardProps {
  game: GameData | WNBAGameData;
  sport: Sport;
  isSelected: boolean;
  onSelectGame: (gameId: string) => void;
}

export function GameCard({ game, sport, isSelected, onSelectGame }: GameCardProps) {
  const mlb = sport === 'mlb' ? game as GameData : null;
  const wnba = sport === 'wnba' ? game as WNBAGameData : null;
  const fmt = (t: string) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const statusColor = game.status === 'live' ? '#4ade80' : game.status === 'final' ? '#334155' : '#fbbf24';
  const statusLabel = game.status.toUpperCase();

  return (
    <div
      onClick={() => onSelectGame(game.id)}
      style={{
        background: isSelected ? 'rgba(14,165,233,.08)' : 'rgba(255,255,255,.025)',
        border: `1px solid ${isSelected ? 'rgba(14,165,233,.35)' : 'rgba(255,255,255,.06)'}`,
        borderLeft: `3px solid ${isSelected ? '#0ea5e9' : 'transparent'}`,
        borderRadius: 10, padding: '11px 14px',
        cursor: 'pointer', transition: 'all .15s',
      }}
      onMouseEnter={e => { if (!isSelected) { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,.12)'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,.04)'; } }}
      onMouseLeave={e => { if (!isSelected) { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,.06)'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,.025)'; } }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7, gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#c8ddf0', lineHeight: 1.2, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: .3 }}>
          {game.awayTeam} <span style={{ color: '#1a3060', fontWeight: 400 }}>@</span> {game.homeTeam}
        </div>
        <div style={{
          background: statusColor + '18', color: statusColor,
          border: `1px solid ${statusColor}40`,
          padding: '2px 7px', borderRadius: 4,
          fontSize: 9, fontWeight: 800, letterSpacing: 1, flexShrink: 0,
          fontFamily: "'Barlow Condensed', sans-serif",
        }}>{statusLabel}</div>
      </div>

      {/* Score */}
      {(game.status === 'live' || game.status === 'final') && game.homeScore !== undefined && (
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 800, color: '#38bdf8', textAlign: 'center', marginBottom: 6, letterSpacing: .5 }}>
          {game.awayScore} — {game.homeScore}
          {mlb?.inning && <span style={{ fontSize: 11, color: '#334155', marginLeft: 6, fontWeight: 600 }}>{mlb.inning}</span>}
        </div>
      )}

      {/* Meta */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontSize: 11, color: '#1e3a60' }}>
        <span>🕐 {fmt(game.startTime)}</span>
        {game.venue && <span>📍 {game.venue}</span>}
        {mlb?.weather && <span>🌤 {mlb.weather.temperature}°F · {mlb.weather.windSpeed}mph</span>}
        {mlb?.umpire && (
          <span style={{ color: mlb.umpire.strikeZoneTendency === 'tight' ? '#f87171' : mlb.umpire.strikeZoneTendency === 'wide' ? '#4ade80' : '#fbbf24' }}>
            ⚖ {mlb.umpire.name} ({mlb.umpire.strikeZoneTendency})
          </span>
        )}
        {wnba?.pace && <span>⚡ {wnba.pace} poss/g</span>}
      </div>

      {isSelected && (
        <div style={{ marginTop: 7, fontSize: 10, fontWeight: 800, color: '#0ea5e9', letterSpacing: 1, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>
          ✓ Selected — view props in Parlays tab
        </div>
      )}
    </div>
  );
}

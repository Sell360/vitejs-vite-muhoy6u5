import type { GameData, WNBAGameData, Sport } from '../services/api';

interface GameCardProps {
  game: GameData | WNBAGameData;
  sport: Sport;
  isSelected: boolean;
  onSelectGame: (gameId: string) => void;
}

export function GameCard({ game, sport, isSelected, onSelectGame }: GameCardProps) {
  const mlbGame = sport === 'mlb' ? game as GameData : null;
  const wnbaGame = sport === 'wnba' ? game as WNBAGameData : null;

  const formatTime = (t: string) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const statusColor = game.status === 'live' ? '#4ade80' : game.status === 'final' ? '#6b7280' : '#fbbf24';

  return (
    <div
      onClick={() => onSelectGame(game.id)}
      style={{
        background: isSelected ? '#162032' : '#1e2a44',
        border: `1px solid ${isSelected ? '#4fc3f7' : '#374151'}`,
        borderRadius: '8px', padding: '14px', margin: '8px 0',
        cursor: 'pointer', transition: 'all 0.2s ease',
        boxShadow: isSelected ? '0 0 0 2px #4fc3f7' : 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#4fc3f7'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = isSelected ? '#4fc3f7' : '#374151'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ fontSize: '17px', fontWeight: 'bold', color: '#e0f0ff' }}>{game.awayTeam} @ {game.homeTeam}</div>
        <div style={{ background: statusColor, color: 'black', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>
          {game.status.toUpperCase()}
        </div>
      </div>

      {(game.status === 'live' || game.status === 'final') && game.homeScore !== undefined && (
        <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#4fc3f7', textAlign: 'center', marginBottom: '8px' }}>
          {game.awayTeam} {game.awayScore} — {game.homeScore} {game.homeTeam}
          {mlbGame?.inning && <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: '8px' }}>{mlbGame.inning}</span>}
        </div>
      )}

      <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>
        📍 {game.venue || 'TBD'} &nbsp;•&nbsp; ⏰ {formatTime(game.startTime)}
      </div>

      {mlbGame?.weather && (
        <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>
          🌤️ {mlbGame.weather.temperature}°F • {mlbGame.weather.conditions} • Wind: {mlbGame.weather.windSpeed}mph
        </div>
      )}

      {mlbGame?.umpire && (
        <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>
          👨‍⚖️ {mlbGame.umpire.name} —
          <span style={{ color: mlbGame.umpire.strikeZoneTendency === 'tight' ? '#f87171' : mlbGame.umpire.strikeZoneTendency === 'wide' ? '#4ade80' : '#fbbf24' }}>
            {' '}{mlbGame.umpire.strikeZoneTendency} zone
          </span>
        </div>
      )}

      {wnbaGame?.referee && (
        <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>
          👩‍⚖️ {wnbaGame.referee.name} —
          <span style={{ color: wnbaGame.referee.foulTendency === 'strict' ? '#f87171' : wnbaGame.referee.foulTendency === 'lenient' ? '#4ade80' : '#fbbf24' }}>
            {' '}{wnbaGame.referee.foulTendency} calls
          </span>
        </div>
      )}

      {wnbaGame?.pace && (
        <div style={{ fontSize: '13px', color: '#9ca3af' }}>⚡ Pace: {wnbaGame.pace} poss/game</div>
      )}

      {isSelected && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#4fc3f7', fontWeight: 'bold' }}>✓ SELECTED</div>
      )}
    </div>
  );
}

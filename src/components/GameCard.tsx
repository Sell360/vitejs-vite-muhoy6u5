import type { GameData, WNBAGameData } from '../services/api';

interface GameCardProps {
  game: GameData | WNBAGameData;
  sport: 'mlb' | 'wnba';
  onSelectGame: (gameId: string) => void;
}

export function GameCard({ game, sport, onSelectGame }: GameCardProps) {
  const isMLB = sport === 'mlb';
  const mlbGame = isMLB ? game as GameData : null;
  const wnbaGame = !isMLB ? game as WNBAGameData : null;

  const formatTime = (timeString: string) => {
    return new Date(timeString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'live': return '#4ade80';
      case 'final': return '#6b7280';
      default: return '#fbbf24';
    }
  };

  return (
    <div 
      onClick={() => onSelectGame(game.id)}
      style={{
        background: '#1e2a44',
        border: '1px solid #374151',
        borderRadius: '8px',
        padding: '16px',
        margin: '8px 0',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#4fc3f7';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#374151';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#e0f0ff' }}>
          {game.awayTeam} @ {game.homeTeam}
        </div>
        <div style={{ 
          background: getStatusColor(game.status), 
          color: 'black', 
          padding: '4px 8px', 
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 'bold'
        }}>
          {game.status.toUpperCase()}
        </div>
      </div>

      <div style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '8px' }}>
        📍 {game.venue} • ⏰ {formatTime(game.startTime)}
      </div>

      {isMLB && mlbGame?.weather && (
        <div style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '8px' }}>
          🌤️ {mlbGame.weather.temperature}°F, {mlbGame.weather.conditions}, Wind: {mlbGame.weather.windSpeed}mph
        </div>
      )}

      {isMLB && mlbGame?.umpire && (
        <div style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '8px' }}>
          👨‍⚖️ Umpire: {mlbGame.umpire.name} ({mlbGame.umpire.strikeZoneTendency} zone)
        </div>
      )}

      {!isMLB && wnbaGame?.referee && (
        <div style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '8px' }}>
          👩‍⚖️ Referee: {wnbaGame.referee.name} ({wnbaGame.referee.foulTendency} calls)
        </div>
      )}

      {!isMLB && wnbaGame?.pace && (
        <div style={{ fontSize: '14px', color: '#9ca3af' }}>
          ⚡ Expected Pace: {wnbaGame.pace} possessions/game
        </div>
      )}
    </div>
  );
}
import type { GameData, WNBAGameData } from '../services/api';

interface GameCardProps {
  game: GameData | WNBAGameData;
  sport: 'mlb' | 'wnba';
  isSelected: boolean;
  onSelectGame: (gameId: string) => void;
}

export function GameCard({ game, sport, isSelected, onSelectGame }: GameCardProps) {
  const isMLB = sport === 'mlb';
  const mlbGame = isMLB ? game as GameData : null;
  const wnbaGame = !isMLB ? game as WNBAGameData : null;

  const formatTime = (timeString: string) => {
    return new Date(timeString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'live': return '#4ade80';
      case 'final': return '#6b7280';
      default: return '#fbbf24';
    }
  };

  const mlbG = mlbGame as any;
  const wnbaG = wnbaGame as any;

  return (
    <div
      onClick={() => onSelectGame(game.id)}
      style={{
        background: isSelected ? '#162032' : '#1e2a44',
        border: `1px solid ${isSelected ? '#4fc3f7' : '#374151'}`,
        borderRadius: '8px',
        padding: '16px',
        margin: '8px 0',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: isSelected ? '0 0 0 2px #4fc3f7' : 'none',
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = '#4fc3f7'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#e0f0ff' }}>
          {game.awayTeam} @ {game.homeTeam}
        </div>
        <div style={{ background: getStatusColor(game.status), color: 'black', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>
          {game.status.toUpperCase()}
        </div>
      </div>

      {/* Score row for live/final */}
      {(game.status === 'live' || game.status === 'final') && (mlbG?.homeScore !== undefined || wnbaG?.homeScore !== undefined) && (
        <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#4fc3f7', marginBottom: '8px', textAlign: 'center', letterSpacing: '2px' }}>
          {game.awayTeam} {isMLB ? mlbG?.awayScore : wnbaG?.awayScore} — {isMLB ? mlbG?.homeScore : wnbaG?.homeScore} {game.homeTeam}
          {isMLB && mlbG?.inning && <span style={{ fontSize: '13px', color: '#9ca3af', marginLeft: '10px' }}>{mlbG.inning}</span>}
        </div>
      )}

      {/* Venue & time */}
      <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '6px' }}>
        📍 {game.venue} &nbsp;•&nbsp; ⏰ {formatTime(game.startTime)}
      </div>

      {/* MLB: weather */}
      {isMLB && mlbGame?.weather && (
        <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '6px' }}>
          🌤️ {mlbGame.weather.temperature}°F &nbsp;|&nbsp; {mlbGame.weather.conditions} &nbsp;|&nbsp; Wind: {mlbGame.weather.windSpeed} mph
        </div>
      )}

      {/* MLB: umpire */}
      {isMLB && mlbGame?.umpire && (
        <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '6px' }}>
          👨‍⚖️ HP Ump: <strong style={{ color: '#e0f0ff' }}>{mlbGame.umpire.name}</strong>
          &nbsp;—&nbsp;
          <span style={{ color: mlbGame.umpire.strikeZoneTendency === 'tight' ? '#f87171' : mlbGame.umpire.strikeZoneTendency === 'wide' ? '#4ade80' : '#fbbf24' }}>
            {mlbGame.umpire.strikeZoneTendency} zone
          </span>
        </div>
      )}

      {/* WNBA: referee */}
      {!isMLB && wnbaGame?.referee && (
        <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '6px' }}>
          👩‍⚖️ Referee: <strong style={{ color: '#e0f0ff' }}>{wnbaGame.referee.name}</strong>
          &nbsp;—&nbsp;
          <span style={{ color: wnbaGame.referee.foulTendency === 'strict' ? '#f87171' : wnbaGame.referee.foulTendency === 'lenient' ? '#4ade80' : '#fbbf24' }}>
            {wnbaGame.referee.foulTendency} calls
          </span>
        </div>
      )}

      {/* WNBA: pace */}
      {!isMLB && wnbaGame?.pace && (
        <div style={{ fontSize: '13px', color: '#9ca3af' }}>
          ⚡ Expected Pace: <strong style={{ color: '#e0f0ff' }}>{wnbaGame.pace}</strong> possessions/game
        </div>
      )}

      {isSelected && (
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#4fc3f7', fontWeight: 'bold' }}>
          ✓ SELECTED — Props loading below ↓
        </div>
      )}
    </div>
  );
}

import type { PlayerProp } from '../services/api';

interface PropsListProps {
  props: PlayerProp[];
  onAnalyzeProp: (prop: PlayerProp) => void;
}

export function PropsList({ props, onAnalyzeProp }: PropsListProps) {
  const formatOdds = (odds: number) => {
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  if (props.length === 0) {
    return (
      <div style={{ 
        background: '#1e2a44', 
        padding: '20px', 
        borderRadius: '8px',
        textAlign: 'center',
        color: '#9ca3af'
      }}>
        No props available for selected game
      </div>
    );
  }

  return (
    <div style={{ marginTop: '20px' }}>
      <h3 style={{ color: '#4fc3f7', marginBottom: '16px' }}>Available Props</h3>
      
      {props.map((prop) => (
        <div 
          key={prop.id}
          onClick={() => onAnalyzeProp(prop)}
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
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#374151';
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#e0f0ff', marginBottom: '4px' }}>
                {prop.playerName} ({prop.team})
              </div>
              <div style={{ fontSize: '14px', color: '#9ca3af' }}>
                {prop.propType}: {prop.line}
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: '#9ca3af' }}>Over</div>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#4ade80' }}>
                  {formatOdds(prop.overOdds)}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: '#9ca3af' }}>Under</div>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#f87171' }}>
                  {formatOdds(prop.underOdds)}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
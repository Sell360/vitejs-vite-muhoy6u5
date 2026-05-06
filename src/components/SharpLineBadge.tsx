import { useEffect, useState } from 'react';
import { getSharpComparison, type SharpComparison } from '../services/polymarket';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeML: number | null;
  awayML: number | null;
}

export function SharpLineBadge({ sport, homeTeam, awayTeam, homeML, awayML }: Props) {
  const { isPro } = useAuth();
  const [data, setData] = useState<SharpComparison | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!homeML || !awayML || !isPro) return;
    let cancelled = false;
    setLoading(true);
    getSharpComparison(sport, homeTeam, awayTeam, homeML, awayML)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sport, homeTeam, awayTeam, homeML, awayML, isPro]);

  if (!isPro) return null;
  if (loading) return null;
  if (!data || !data.found || data.edgePct < 1.5) return null;

  const sharpTeam = data.sharpSide === 'home' ? homeTeam : awayTeam;
  const accentColor = data.edgePct >= 5 ? '#22d3ee' : '#818cf8';

  return (
    <div
      title={`Polymarket prediction market shows ${sharpTeam.split(' ').slice(-1)[0]} ${data.edgePct.toFixed(1)}% more likely to win than the sportsbook implies. Vig-free crypto trader money.`}
      style={{
        marginTop: 4, padding: '4px 8px',
        background: `${accentColor}10`,
        border: `1px solid ${accentColor}40`,
        borderRadius: 5,
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: "'Barlow Condensed', sans-serif",
        cursor: 'help',
      }}
    >
      <span style={{ fontSize: 11, color: accentColor, fontWeight: 800, letterSpacing: .5 }}>📊 SHARP $</span>
      <span style={{ fontSize: 10, color: '#8ab0cc', fontWeight: 600 }}>
        {sharpTeam.split(' ').slice(-1)[0]} +{data.edgePct.toFixed(1)}%
      </span>
      <span style={{ fontSize: 8, color: '#1a3060', fontWeight: 600, marginLeft: 'auto' }}>
        ${(data.liquidity / 1000).toFixed(1)}k liq
      </span>
    </div>
  );
}

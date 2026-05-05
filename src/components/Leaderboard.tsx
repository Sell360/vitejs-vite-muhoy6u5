import { useState, useEffect } from 'react';
import { getLeaderboard, type LeaderboardEntry } from '../services/mockBets';
import { useAuth } from '../contexts/AuthContext';

export function Leaderboard() {
  const { username, isConfigured } = useAuth();
  const [metric, setMetric] = useState<'clv' | 'bankroll' | 'winrate'>('clv');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConfigured) return;
    setLoading(true);
    getLeaderboard(metric, 25).then(e => {
      setEntries(e);
      setLoading(false);
    });
  }, [metric, isConfigured]);

  const metricLabels = { clv: 'Closing Line Value', bankroll: 'Bankroll', winrate: 'Win Rate' };
  const metricSubs = {
    clv: 'The metric that actually predicts long-term winning. Sharp pros track this above all else.',
    bankroll: 'Total mock bankroll built from $1,000 starting balance.',
    winrate: 'Settled bet win percentage. Note: high win rate at low odds = not sharp.',
  };

  if (!isConfigured) {
    return (
      <div style={{ padding: 32, textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 12, fontFamily: "'Barlow', sans-serif" }}>
        <div style={{ fontSize: 13, color: '#1e3560', fontWeight: 700 }}>Leaderboard requires auth setup</div>
        <div style={{ fontSize: 11, color: '#1a3060', marginTop: 4 }}>Configure Supabase to enable</div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Barlow', sans-serif" }}>
      {/* Metric switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 9, padding: 4, alignSelf: 'flex-start', width: 'fit-content' }}>
        {(['clv', 'bankroll', 'winrate'] as const).map(m => (
          <button key={m} onClick={() => setMetric(m)} style={{
            padding: '6px 14px', borderRadius: 6,
            background: metric === m ? 'rgba(14,165,233,.15)' : 'transparent',
            color: metric === m ? '#38bdf8' : '#4a6080',
            border: `1px solid ${metric === m ? 'rgba(14,165,233,.3)' : 'transparent'}`,
            cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: "'Barlow', sans-serif",
          }}>{metricLabels[m]}</button>
        ))}
      </div>

      <div style={{ fontSize: 11, color: '#4a6080', fontWeight: 600, marginBottom: 14, lineHeight: 1.5 }}>
        🎯 {metricSubs[metric]}
      </div>

      {/* Leaderboard */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#1a3060', fontSize: 13, fontWeight: 600 }}>
          ⏳ Loading leaderboard…
        </div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 10 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🏆</div>
          <div style={{ fontSize: 13, color: '#1e3560', fontWeight: 700 }}>No qualifying users yet</div>
          <div style={{ fontSize: 11, color: '#1a3060', marginTop: 4 }}>Users need 3+ logged bets to appear on the leaderboard.</div>
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '40px 1fr 80px 80px 70px 90px',
            gap: 10, padding: '8px 14px',
            background: 'rgba(0,0,0,.3)',
            borderBottom: '1px solid rgba(255,255,255,.06)',
            fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase',
          }}>
            <div>Rank</div>
            <div>User</div>
            <div style={{ textAlign: 'right' }}>Bets</div>
            <div style={{ textAlign: 'right' }}>Win %</div>
            <div style={{ textAlign: 'right' }}>Roll</div>
            <div style={{ textAlign: 'right' }}>Avg CLV</div>
          </div>

          {/* Rows */}
          {entries.map(e => {
            const isMe = e.username === username;
            return (
              <div key={e.username} style={{
                display: 'grid', gridTemplateColumns: '40px 1fr 80px 80px 70px 90px',
                gap: 10, padding: '9px 14px', alignItems: 'center',
                background: isMe ? 'rgba(14,165,233,.08)' : 'transparent',
                borderBottom: '1px solid rgba(255,255,255,.04)',
                borderLeft: isMe ? '3px solid #0ea5e9' : '3px solid transparent',
              }}>
                <div style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontSize: 16, fontWeight: 900,
                  color: e.rank === 1 ? '#fbbf24' : e.rank === 2 ? '#cbd5e1' : e.rank === 3 ? '#a16207' : '#1e3a60',
                }}>
                  {e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `#${e.rank}`}
                </div>
                <div>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, color: isMe ? '#38bdf8' : '#c8ddf0' }}>
                    @{e.username} {isMe && <span style={{ fontSize: 9, color: '#38bdf8', fontWeight: 700 }}>· YOU</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 700, color: '#8ab0cc' }}>{e.total_bets}</div>
                <div style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, color: e.win_rate >= 55 ? '#4ade80' : e.win_rate >= 50 ? '#fbbf24' : '#f87171' }}>{e.win_rate}%</div>
                <div style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, color: e.bankroll >= 1000 ? '#4ade80' : '#f87171' }}>${Math.round(e.bankroll)}</div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontSize: 14, fontWeight: 900,
                    color: e.avg_clv >= 2 ? '#4ade80' : e.avg_clv >= 0 ? '#fbbf24' : '#f87171',
                    background: e.avg_clv >= 2 ? 'rgba(74,222,128,.1)' : e.avg_clv >= 0 ? 'rgba(251,191,36,.08)' : 'rgba(248,113,113,.08)',
                    border: `1px solid ${e.avg_clv >= 2 ? 'rgba(74,222,128,.25)' : e.avg_clv >= 0 ? 'rgba(251,191,36,.2)' : 'rgba(248,113,113,.2)'}`,
                    padding: '2px 8px', borderRadius: 5,
                  }}>
                    {e.avg_clv > 0 ? '+' : ''}{e.avg_clv.toFixed(1)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

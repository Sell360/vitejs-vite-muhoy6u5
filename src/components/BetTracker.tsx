import { useState, useEffect } from 'react';

interface BetEntry {
  id: string;
  date: string;
  sport: string;
  description: string;
  betType: 'parlay' | 'prop' | 'moneyline' | 'spread' | 'total';
  stake: number;
  odds: number;
  result: 'win' | 'loss' | 'push' | 'pending';
  payout: number;
  notes: string;
}

const C = {
  bg: '#050810', surface: '#0d1117', card: '#111827',
  border: '#1f2937', accent: '#3b82f6', accentGlow: 'rgba(59,130,246,0.15)',
  green: '#10b981', red: '#ef4444', yellow: '#f59e0b',
  text: '#f1f5f9', muted: '#64748b', dim: '#374151',
};

function americanToDecimal(odds: number): number {
  if (odds > 0) return odds / 100 + 1;
  return 100 / Math.abs(odds) + 1;
}

function calcPayout(stake: number, odds: number): number {
  return Math.round(stake * americanToDecimal(odds) * 100) / 100;
}

const STORAGE_KEY = 'bet360_tracker';

function loadBets(): BetEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveBets(bets: BetEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
}

export function BetTracker() {
  const [bets, setBets] = useState<BetEntry[]>(loadBets);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'win' | 'loss' | 'pending'>('all');
  const [form, setForm] = useState({
    sport: 'MLB', description: '', betType: 'parlay' as BetEntry['betType'],
    stake: '', odds: '', notes: '',
  });

  useEffect(() => { saveBets(bets); }, [bets]);

  const addBet = () => {
    if (!form.description || !form.stake || !form.odds) return;
    const stake = parseFloat(form.stake);
    const odds = parseInt(form.odds);
    const newBet: BetEntry = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString(),
      sport: form.sport,
      description: form.description,
      betType: form.betType,
      stake,
      odds,
      result: 'pending',
      payout: calcPayout(stake, odds),
      notes: form.notes,
    };
    setBets(prev => [newBet, ...prev]);
    setForm({ sport: 'MLB', description: '', betType: 'parlay', stake: '', odds: '', notes: '' });
    setShowForm(false);
  };

  const updateResult = (id: string, result: BetEntry['result']) => {
    setBets(prev => prev.map(b => b.id === id ? { ...b, result } : b));
  };

  const deleteBet = (id: string) => {
    setBets(prev => prev.filter(b => b.id !== id));
  };

  const filtered = bets.filter(b => filter === 'all' || b.result === filter);

  // Stats
  const settled = bets.filter(b => b.result !== 'pending');
  const wins = bets.filter(b => b.result === 'win');
  const losses = bets.filter(b => b.result === 'loss');
  const totalStaked = settled.reduce((a, b) => a + b.stake, 0);
  const totalReturned = wins.reduce((a, b) => a + b.payout, 0);
  const profit = totalReturned - settled.reduce((a, b) => a + b.stake, 0);
  const roi = totalStaked > 0 ? ((profit / totalStaked) * 100).toFixed(1) : '0.0';
  const winRate = settled.length > 0 ? ((wins.length / settled.length) * 100).toFixed(0) : '0';
  const pending = bets.filter(b => b.result === 'pending');

  const inp = (style = {}) => ({
    background: C.surface, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: '8px', padding: '8px 12px', fontSize: '13px',
    outline: 'none', fontFamily: 'inherit', width: '100%',
    boxSizing: 'border-box' as const, ...style,
  });

  const statCard = (label: string, value: string, color = C.text, sub = '') => (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
      <div style={{ fontSize: '22px', fontWeight: '700', color }}>{value}</div>
      <div style={{ fontSize: '11px', color: C.muted, marginTop: '4px', textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</div>
      {sub && <div style={{ fontSize: '11px', color: C.muted, marginTop: '2px' }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ padding: '0' }}>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginBottom: '20px' }}>
        {statCard('Win Rate', `${winRate}%`, parseInt(winRate) >= 55 ? C.green : parseInt(winRate) >= 45 ? C.yellow : C.red)}
        {statCard('Record', `${wins.length}-${losses.length}`, C.text, `${pending.length} pending`)}
        {statCard('Profit', `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`, profit >= 0 ? C.green : C.red)}
        {statCard('ROI', `${parseFloat(roi) >= 0 ? '+' : ''}${roi}%`, parseFloat(roi) >= 0 ? C.green : C.red)}
        {statCard('Staked', `$${totalStaked.toFixed(2)}`, C.text)}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button onClick={() => setShowForm(!showForm)} style={{
          padding: '8px 16px', background: C.accent, color: 'white',
          border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
        }}>+ Log Bet</button>
        {(['all', 'pending', 'win', 'loss'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '8px 14px',
            background: filter === f ? C.card : 'transparent',
            color: filter === f ? C.text : C.muted,
            border: `1px solid ${filter === f ? C.border : 'transparent'}`,
            borderRadius: '8px', cursor: 'pointer', fontSize: '13px', textTransform: 'capitalize',
          }}>{f === 'all' ? `All (${bets.length})` : f === 'pending' ? `Pending (${pending.length})` : f === 'win' ? `Wins (${wins.length})` : `Losses (${losses.length})`}</button>
        ))}
      </div>

      {/* Add bet form */}
      {showForm && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: C.muted, marginBottom: '14px', letterSpacing: '1px', textTransform: 'uppercase' }}>Log New Bet</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '10px' }}>
            <select value={form.sport} onChange={e => setForm(p => ({ ...p, sport: e.target.value }))} style={inp()}>
              {['MLB', 'NBA', 'NFL', 'NHL', 'WNBA', 'UFC'].map(s => <option key={s}>{s}</option>)}
            </select>
            <select value={form.betType} onChange={e => setForm(p => ({ ...p, betType: e.target.value as any }))} style={inp()}>
              {['parlay', 'prop', 'moneyline', 'spread', 'total'].map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
            <input placeholder="Stake ($)" type="number" value={form.stake} onChange={e => setForm(p => ({ ...p, stake: e.target.value }))} style={inp()} />
            <input placeholder="Odds (e.g. -110, +250)" type="number" value={form.odds} onChange={e => setForm(p => ({ ...p, odds: e.target.value }))} style={inp()} />
          </div>
          <input placeholder="Description (e.g. Aaron Judge Over 1.5 TB)" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} style={{ ...inp(), marginBottom: '10px' }} />
          <input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} style={{ ...inp(), marginBottom: '14px' }} />
          {form.stake && form.odds && (
            <div style={{ fontSize: '13px', color: C.muted, marginBottom: '12px' }}>
              Potential payout: <span style={{ color: C.green, fontWeight: '600' }}>${calcPayout(parseFloat(form.stake) || 0, parseInt(form.odds) || -110).toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={addBet} style={{ padding: '8px 20px', background: C.accent, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Add Bet</button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 14px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Bet list */}
      {filtered.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '32px', textAlign: 'center', color: C.muted }}>
          {bets.length === 0 ? 'No bets logged yet. Click "+ Log Bet" to start tracking.' : 'No bets match this filter.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(bet => (
            <div key={bet.id} style={{
              background: C.card, border: `1px solid ${bet.result === 'win' ? C.green + '40' : bet.result === 'loss' ? C.red + '40' : C.border}`,
              borderLeft: `3px solid ${bet.result === 'win' ? C.green : bet.result === 'loss' ? C.red : bet.result === 'push' ? C.yellow : C.muted}`,
              borderRadius: '10px', padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '11px', background: C.surface, color: C.muted, padding: '2px 6px', borderRadius: '4px', border: `1px solid ${C.border}` }}>{bet.sport}</span>
                    <span style={{ fontSize: '11px', color: C.muted, textTransform: 'capitalize' }}>{bet.betType}</span>
                    <span style={{ fontSize: '11px', color: C.muted }}>{bet.date}</span>
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: C.text, marginBottom: '4px' }}>{bet.description}</div>
                  {bet.notes && <div style={{ fontSize: '12px', color: C.muted }}>{bet.notes}</div>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '13px', color: C.muted }}>
                    ${bet.stake} @ <span style={{ color: bet.odds > 0 ? C.green : C.text }}>{bet.odds > 0 ? '+' : ''}{bet.odds}</span>
                  </div>
                  <div style={{ fontSize: '13px', color: bet.result === 'win' ? C.green : C.muted }}>
                    {bet.result === 'win' ? `+$${(bet.payout - bet.stake).toFixed(2)}` : bet.result === 'loss' ? `-$${bet.stake.toFixed(2)}` : `To win $${(bet.payout - bet.stake).toFixed(2)}`}
                  </div>
                </div>
              </div>

              {/* Result buttons */}
              {bet.result === 'pending' && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                  <button onClick={() => updateResult(bet.id, 'win')} style={{ padding: '4px 12px', background: C.green + '20', color: C.green, border: `1px solid ${C.green}40`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>✓ Win</button>
                  <button onClick={() => updateResult(bet.id, 'loss')} style={{ padding: '4px 12px', background: C.red + '20', color: C.red, border: `1px solid ${C.red}40`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>✗ Loss</button>
                  <button onClick={() => updateResult(bet.id, 'push')} style={{ padding: '4px 12px', background: C.yellow + '20', color: C.yellow, border: `1px solid ${C.yellow}40`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>~ Push</button>
                  <button onClick={() => deleteBet(bet.id)} style={{ padding: '4px 10px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', marginLeft: 'auto' }}>🗑</button>
                </div>
              )}
              {bet.result !== 'pending' && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: bet.result === 'win' ? C.green : bet.result === 'loss' ? C.red : C.yellow, textTransform: 'uppercase' }}>
                    {bet.result === 'win' ? '✓ Won' : bet.result === 'loss' ? '✗ Lost' : '~ Push'}
                  </span>
                  <button onClick={() => updateResult(bet.id, 'pending')} style={{ marginLeft: 'auto', padding: '2px 8px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>Undo</button>
                  <button onClick={() => deleteBet(bet.id)} style={{ padding: '2px 8px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>🗑</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

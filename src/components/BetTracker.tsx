import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getUserBets, getUserStats, getBankroll, getProfile, settleBet, snapshotClosingLine, logBet, resetBankroll, setStartingBankroll, type MockBet } from '../services/mockBets';
import { AuthModal } from './AuthModal';

interface Stats {
  totalBets: number; wins: number; losses: number; pushes: number; pending: number;
  winRate: number; profit: number; roi: number; totalStaked: number;
  avgClv: number; beatCloseRate: number; clvBetCount: number;
}

const SPORT_LABELS: Record<string, string> = {
  mlb: 'MLB', nba: 'NBA', nfl: 'NFL', ncaaf: 'CFB', nhl: 'NHL', wnba: 'WNBA', ufc: 'UFC',
};

function fmt(odds: number) {
  if (!odds) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function BetTracker() {
  const { user, username, isConfigured, signOut } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [bets, setBets] = useState<MockBet[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [bankroll, setBankrollState] = useState<number>(1000);
  const [loading, setLoading] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [showBankrollModal, setShowBankrollModal] = useState(false);
  const [maxBankroll, setMaxBankroll] = useState<number | null>(null);

  // Manual log form fields
  const [form, setForm] = useState({
    sport: 'mlb', matchup: '', betType: 'ML' as MockBet['bet_type'],
    pickLabel: '', pickSide: 'home' as MockBet['pick_side'],
    odds: '', stake: '25', line: '', gameTime: '',
  });

  const refreshData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [bz, st, br, pr] = await Promise.all([
      getUserBets(user.id, 50),
      getUserStats(user.id),
      getBankroll(user.id),
      getProfile(user.id),
    ]);
    setBets(bz);
    setStats(st);
    setBankrollState(br);
    setMaxBankroll(pr?.max_bankroll ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => { refreshData(); }, [refreshData]);

  // Auto-snapshot CLV: fire in background for pending bets whose games have started
  // and don't yet have a closing line recorded. Throttled to once per page load.
  useEffect(() => {
    if (bets.length === 0) return;
    const candidates = bets.filter(b =>
      b.event_id &&
      b.closing_odds === null &&
      new Date(b.game_time).getTime() < Date.now() - 5 * 60 * 1000 // game started 5+ min ago
    );
    if (candidates.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const bet of candidates.slice(0, 10)) { // cap to 10 per cycle to limit API spend
        if (cancelled) break;
        await snapshotClosingLine(bet.id!);
        // Light throttle so we don't hammer the API
        await new Promise(r => setTimeout(r, 600));
      }
      if (!cancelled) await refreshData();
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bets.length]);

  const handleSettle = async (id: string, result: 'won' | 'lost' | 'push') => {
    await settleBet(id, result);
    await refreshData();
  };

  const handleSnapshot = async (id: string) => {
    await snapshotClosingLine(id);
    await refreshData();
  };

  const handleLogBet = async () => {
    if (!user) return;
    const odds = parseFloat(form.odds);
    const stake = parseFloat(form.stake);
    if (!form.matchup || !odds || !stake) return;
    if (stake > bankroll) {
      alert(`Stake exceeds your bankroll of $${bankroll.toFixed(2)}`);
      return;
    }

    await logBet({
      user_id: user.id,
      sport: form.sport,
      event_id: null, // Manual entries don't have event IDs
      game_time: form.gameTime || new Date().toISOString(),
      matchup: form.matchup,
      bet_type: form.betType,
      pick_label: form.pickLabel || form.matchup,
      pick_side: form.pickSide,
      line: form.line ? parseFloat(form.line) : null,
      odds, stake,
      legs: null,
      status: 'pending',
    });

    setShowLogModal(false);
    setForm({ ...form, matchup: '', pickLabel: '', odds: '', line: '' });
    await refreshData();
  };

  // ─── NOT LOGGED IN ──────────────────────────────────────────────────────
  if (!user) {
    return (
      <>
        <div style={{
          background: 'rgba(255,255,255,.025)', border: '1px solid rgba(14,165,233,.2)',
          borderRadius: 12, padding: '40px 24px', textAlign: 'center',
          fontFamily: "'Barlow', sans-serif",
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: 22, fontWeight: 800, color: '#c8ddf0', letterSpacing: .5, marginBottom: 6,
          }}>Track Your Mock Bets</div>
          <div style={{ fontSize: 13, color: '#4a6080', fontWeight: 600, lineHeight: 1.6, maxWidth: 440, margin: '0 auto 18px' }}>
            Practice with a $1,000 virtual bankroll. Track win rate, ROI, and your <strong style={{ color: '#38bdf8' }}>Closing Line Value</strong> — the metric pros use to measure real edge.
          </div>
          <button
            onClick={() => setAuthOpen(true)}
            disabled={!isConfigured}
            style={{
              padding: '10px 28px', borderRadius: 8,
              background: isConfigured ? 'linear-gradient(135deg, #0080ff, #0050d0)' : 'rgba(255,255,255,.05)',
              color: isConfigured ? '#fff' : '#1a3060',
              border: 'none',
              fontSize: 14, fontWeight: 800, fontFamily: "'Barlow', sans-serif",
              cursor: isConfigured ? 'pointer' : 'not-allowed',
              boxShadow: isConfigured ? '0 0 20px rgba(0,128,255,.3)' : 'none',
            }}
          >
            {isConfigured ? 'Sign up free →' : 'Auth not configured'}
          </button>
          {!isConfigured && (
            <div style={{ marginTop: 12, fontSize: 11, color: '#1a3060', fontWeight: 600 }}>
              Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify env vars to enable.
            </div>
          )}
        </div>
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} defaultMode="signup" />
      </>
    );
  }

  // ─── LOGGED IN ──────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Barlow', sans-serif" }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 800, color: '#c8ddf0', letterSpacing: .3 }}>
            👋 {username || user.email?.split('@')[0]}
          </div>
          <div style={{ fontSize: 11, color: '#1a3060', fontWeight: 600 }}>Practice account · Mock bets only</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => setShowBankrollModal(true)}
            title="Click to adjust bankroll"
            style={{
              background: 'rgba(74,222,128,.08)', border: '1px solid rgba(74,222,128,.2)',
              borderRadius: 8, padding: '6px 14px', textAlign: 'center',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
            }}
          >
            <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
              Bankroll {maxBankroll && <span style={{ color: '#fbbf24' }}>· Max ${maxBankroll}</span>}
            </div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 900, color: '#4ade80', lineHeight: 1 }}>${bankroll.toFixed(0)} ⚙</div>
          </button>
          <button onClick={() => setShowLogModal(true)} style={{
            padding: '8px 16px', borderRadius: 7,
            background: 'linear-gradient(135deg, #0080ff, #0050d0)',
            color: '#fff', border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 800, fontFamily: "'Barlow', sans-serif",
            boxShadow: '0 0 14px rgba(0,128,255,.3)',
          }}>+ Log Bet</button>
          <button onClick={signOut} style={{
            padding: '8px 12px', borderRadius: 7,
            background: 'rgba(255,255,255,.04)', color: '#4a6080',
            border: '1px solid rgba(255,255,255,.07)', cursor: 'pointer',
            fontSize: 11, fontWeight: 700, fontFamily: "'Barlow', sans-serif",
          }}>Sign out</button>
        </div>
      </div>

      {/* Stats grid */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 16 }}>
          <StatBox label="Record" value={`${stats.wins}–${stats.losses}${stats.pushes ? `–${stats.pushes}` : ''}`} color="#c8ddf0" />
          <StatBox label="Win Rate" value={`${stats.winRate}%`} color={stats.winRate >= 55 ? '#4ade80' : stats.winRate >= 50 ? '#fbbf24' : '#f87171'} />
          <StatBox label="Profit" value={`${stats.profit >= 0 ? '+' : ''}$${stats.profit.toFixed(0)}`} color={stats.profit >= 0 ? '#4ade80' : '#f87171'} />
          <StatBox label="ROI" value={`${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%`} color={stats.roi >= 5 ? '#4ade80' : stats.roi >= 0 ? '#fbbf24' : '#f87171'} />
          <StatBox
            label={`Avg CLV ${stats.clvBetCount > 0 ? `(${stats.clvBetCount})` : ''}`}
            value={stats.clvBetCount > 0 ? `${stats.avgClv >= 0 ? '+' : ''}${stats.avgClv.toFixed(1)}%` : '—'}
            color={stats.avgClv >= 2 ? '#4ade80' : stats.avgClv >= 0 ? '#fbbf24' : '#f87171'}
            tooltip="Closing Line Value — the gold standard sharp metric. Positive = you got better odds than the closing line."
          />
          <StatBox label="Beat Close" value={stats.clvBetCount > 0 ? `${stats.beatCloseRate.toFixed(0)}%` : '—'} color={stats.beatCloseRate >= 55 ? '#4ade80' : stats.beatCloseRate >= 50 ? '#fbbf24' : '#f87171'} />
        </div>
      )}

      {/* CLV explainer */}
      {stats && stats.clvBetCount === 0 && stats.totalBets > 0 && (
        <div style={{ background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#818cf8', fontWeight: 600 }}>
          🎯 Once your games start, click <strong>"Snapshot Closing Line"</strong> on each bet to track CLV — the metric that actually predicts long-term winning.
        </div>
      )}

      {/* Bets list */}
      <div style={{ fontSize: 11, fontWeight: 800, color: '#1a3060', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
        Recent Bets {loading && <span style={{ color: '#fbbf24', marginLeft: 6 }}>⏳</span>}
      </div>

      {bets.length === 0 ? (
        <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 10, padding: '32px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📝</div>
          <div style={{ fontSize: 13, color: '#1e3560', fontWeight: 700 }}>No bets yet</div>
          <div style={{ fontSize: 11, color: '#1a3060', marginTop: 4 }}>Log your first mock bet to start tracking</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bets.map(bet => <BetRow key={bet.id} bet={bet} onSettle={handleSettle} onSnapshot={handleSnapshot} />)}
        </div>
      )}

      {/* Log Bet Modal */}
      {showLogModal && (
        <LogBetModal
          form={form}
          setForm={setForm}
          onCancel={() => setShowLogModal(false)}
          onSubmit={handleLogBet}
          bankroll={bankroll}
        />
      )}

      {/* Bankroll Modal */}
      {showBankrollModal && user && (
        <BankrollModal
          userId={user.id}
          bankroll={bankroll}
          maxBankroll={maxBankroll}
          onClose={() => setShowBankrollModal(false)}
          onUpdated={async () => { setShowBankrollModal(false); await refreshData(); }}
        />
      )}
    </div>
  );
}

// ─── BANKROLL MODAL ───────────────────────────────────────────────────────
function BankrollModal({ userId, bankroll, maxBankroll, onClose, onUpdated }: { userId: string; bankroll: number; maxBankroll: number | null; onClose: () => void; onUpdated: () => void; }) {
  const [amount, setAmount] = useState(bankroll.toFixed(0));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleReset = async () => {
    if (!confirm('Reset bankroll to your starting amount? Bet history will be preserved.')) return;
    setBusy(true);
    await resetBankroll(userId);
    onUpdated();
  };

  const handleSetAmount = async () => {
    const num = parseFloat(amount);
    if (isNaN(num)) { setError('Invalid amount'); return; }
    setBusy(true);
    setError('');
    const { error } = await setStartingBankroll(userId, num);
    if (error) { setError(error); setBusy(false); return; }
    onUpdated();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(8px)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#070c18', border: '1px solid rgba(74,222,128,.3)', borderRadius: 12, padding: 22, fontFamily: "'Barlow', sans-serif" }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 800, color: '#4ade80', letterSpacing: .3 }}>💰 Bankroll Settings</div>
            <div style={{ fontSize: 11, color: '#1a3060', fontWeight: 600, marginTop: 1 }}>Current balance: ${bankroll.toFixed(2)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#1a3060', cursor: 'pointer', fontSize: 22 }}>×</button>
        </div>

        <div style={{ background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#1a3060', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Set Custom Bankroll</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              min={100}
              max={maxBankroll || 1000000}
              style={{ flex: 1, height: 36, background: 'rgba(255,255,255,.04)', color: '#dce6f0', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, padding: '0 10px', fontSize: 13, fontFamily: "'Barlow', sans-serif", outline: 'none' }}
            />
            <button onClick={handleSetAmount} disabled={busy} style={{ padding: '0 18px', background: 'linear-gradient(135deg, #0080ff, #0050d0)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', fontFamily: "'Barlow', sans-serif" }}>
              {busy ? '...' : 'Set'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#1a3060', fontWeight: 600, marginTop: 6 }}>
            Range: $100 – ${maxBankroll ? maxBankroll.toLocaleString() : '1,000,000'}
            {maxBankroll && <span style={{ color: '#fbbf24', marginLeft: 6 }}>(admin-capped)</span>}
          </div>
          {error && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6, fontWeight: 600 }}>⚠ {error}</div>}
        </div>

        <div style={{ background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 8, padding: 14, marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#1a3060', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Quick Reset</div>
          <button onClick={handleReset} disabled={busy} style={{ width: '100%', padding: '8px', background: 'rgba(251,191,36,.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,.25)', borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', fontFamily: "'Barlow', sans-serif" }}>
            ↻ Reset to Starting Bankroll
          </button>
          <div style={{ fontSize: 10, color: '#1a3060', fontWeight: 600, marginTop: 6 }}>
            Your bet history stays — only the balance resets.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── HELPERS ──────────────────────────────────────────────────────────────
function StatBox({ label, value, color, tooltip }: { label: string; value: string; color: string; tooltip?: string }) {
  return (
    <div title={tooltip} style={{
      background: 'rgba(255,255,255,.025)',
      border: '1px solid rgba(255,255,255,.06)',
      borderRadius: 9, padding: '8px 12px',
      cursor: tooltip ? 'help' : 'default',
    }}>
      <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function BetRow({ bet, onSettle, onSnapshot }: { bet: MockBet; onSettle: (id: string, r: 'won' | 'lost' | 'push') => void; onSnapshot: (id: string) => void; }) {
  const statusColor = bet.status === 'won' ? '#4ade80' : bet.status === 'lost' ? '#f87171' : bet.status === 'push' ? '#fbbf24' : '#64748b';
  const gameStarted = new Date(bet.game_time).getTime() < Date.now();

  return (
    <div style={{ background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 9, padding: '10px 13px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', marginBottom: 1 }}>
            {SPORT_LABELS[bet.sport]} · {bet.bet_type} · {new Date(bet.created_at).toLocaleDateString()}
          </div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 800, color: '#c8ddf0' }}>
            {bet.matchup}
          </div>
          <div style={{ fontSize: 12, color: '#8ab0cc', fontWeight: 600 }}>
            {bet.pick_label}
            {bet.line !== null && bet.bet_type !== 'ML' && <span style={{ color: '#1e3a60' }}> @ {bet.line}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700 }}>STAKE</div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, color: '#c8ddf0' }}>${bet.stake}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700 }}>ODDS</div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, color: bet.odds > 0 ? '#4ade80' : '#c8ddf0' }}>{fmt(bet.odds)}</div>
          </div>
          {bet.closing_odds !== null && (
            <div style={{ textAlign: 'center', background: bet.beat_close ? 'rgba(74,222,128,.08)' : 'rgba(248,113,113,.06)', borderRadius: 6, padding: '2px 8px', border: `1px solid ${bet.beat_close ? 'rgba(74,222,128,.2)' : 'rgba(248,113,113,.15)'}` }}>
              <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 700 }}>CLV</div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 900, color: bet.beat_close ? '#4ade80' : '#f87171' }}>
                {bet.clv_pct! > 0 ? '+' : ''}{bet.clv_pct}%
              </div>
            </div>
          )}
          <div style={{
            background: `${statusColor}15`, color: statusColor,
            border: `1px solid ${statusColor}40`,
            padding: '3px 9px', borderRadius: 5,
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: 11, fontWeight: 800, letterSpacing: .5,
          }}>{bet.status.toUpperCase()}</div>
        </div>
      </div>

      {/* Action row */}
      {bet.status === 'pending' && (
        <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
          <button onClick={() => onSettle(bet.id!, 'won')} style={btnSettleStyle('#4ade80')}>✓ Won</button>
          <button onClick={() => onSettle(bet.id!, 'lost')} style={btnSettleStyle('#f87171')}>✗ Lost</button>
          <button onClick={() => onSettle(bet.id!, 'push')} style={btnSettleStyle('#fbbf24')}>= Push</button>
          {bet.event_id && bet.closing_odds === null && gameStarted && (
            <button onClick={() => onSnapshot(bet.id!)} style={{ ...btnSettleStyle('#818cf8'), marginLeft: 'auto' }}>📸 Snapshot Closing Line</button>
          )}
        </div>
      )}
    </div>
  );
}

const btnSettleStyle = (c: string): React.CSSProperties => ({
  padding: '5px 11px', borderRadius: 5,
  background: `${c}10`, color: c,
  border: `1px solid ${c}30`,
  fontSize: 11, fontWeight: 700,
  fontFamily: "'Barlow', sans-serif",
  cursor: 'pointer', transition: 'all .15s',
});

function LogBetModal({ form, setForm, onCancel, onSubmit, bankroll }: any) {
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(8px)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: '#070c18', border: '1px solid rgba(14,165,233,.3)', borderRadius: 12, padding: 22, fontFamily: "'Barlow', sans-serif" }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 800, color: '#c8ddf0' }}>Log a Bet</div>
          <button onClick={onCancel} style={{ background: 'transparent', border: 'none', color: '#1a3060', cursor: 'pointer', fontSize: 22 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <Field label="Sport">
            <select value={form.sport} onChange={e => setForm({ ...form, sport: e.target.value })} style={inputStyle}>
              {Object.entries(SPORT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Bet Type">
            <select value={form.betType} onChange={e => setForm({ ...form, betType: e.target.value })} style={inputStyle}>
              <option value="ML">Moneyline</option>
              <option value="SPREAD">Spread</option>
              <option value="TOTAL">Total</option>
              <option value="PROP">Player Prop</option>
              <option value="PARLAY">Parlay</option>
            </select>
          </Field>
        </div>

        <Field label="Matchup or Event">
          <input value={form.matchup} onChange={e => setForm({ ...form, matchup: e.target.value })} placeholder="Yankees @ Red Sox" style={inputStyle} />
        </Field>
        <Field label="Pick Label">
          <input value={form.pickLabel} onChange={e => setForm({ ...form, pickLabel: e.target.value })} placeholder="Yankees -1.5" style={inputStyle} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <Field label="Line">
            <input value={form.line} onChange={e => setForm({ ...form, line: e.target.value })} placeholder="-1.5" style={inputStyle} />
          </Field>
          <Field label="Odds">
            <input value={form.odds} onChange={e => setForm({ ...form, odds: e.target.value })} placeholder="-110" style={inputStyle} />
          </Field>
          <Field label={`Stake (max $${bankroll.toFixed(0)})`}>
            <input value={form.stake} onChange={e => setForm({ ...form, stake: e.target.value })} type="number" style={inputStyle} />
          </Field>
        </div>

        <Field label="Pick Side">
          <select value={form.pickSide} onChange={e => setForm({ ...form, pickSide: e.target.value })} style={inputStyle}>
            <option value="home">Home / Over</option>
            <option value="away">Away / Under</option>
          </select>
        </Field>

        <button onClick={onSubmit} style={{ width: '100%', padding: '10px', marginTop: 10, background: 'linear-gradient(135deg, #0080ff, #0050d0)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: "'Barlow', sans-serif", boxShadow: '0 0 14px rgba(0,128,255,.3)' }}>
          Log Bet
        </button>
      </div>
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ fontSize: 10, color: '#1a3060', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
    {children}
  </div>
);

const inputStyle: React.CSSProperties = {
  width: '100%', height: 34,
  background: 'rgba(255,255,255,.04)', color: '#dce6f0',
  border: '1px solid rgba(255,255,255,.1)', borderRadius: 6,
  padding: '0 10px', fontSize: 12, outline: 'none',
  fontFamily: "'Barlow', sans-serif",
};

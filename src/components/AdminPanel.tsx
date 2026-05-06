import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getAllUsers, adminSetUserLimit, adminAdjustBankroll, type AdminUser } from '../services/mockBets';

interface CreditUsage {
  used: number;
  remaining: number;
  total: number;
  percentUsed: number;
  lastCallCost: number;
  timestamp: string;
}

export function AdminPanel() {
  const { isAdmin, user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [credits, setCredits] = useState<CreditUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ bankroll: '', maxBankroll: '' });

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    const [data, creditRes] = await Promise.all([
      getAllUsers(),
      fetch('/api/credit-usage').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    setUsers(data);
    setCredits(creditRes && !creditRes.error ? creditRes : null);
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!user) {
    return (
      <div style={emptyStyle}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 13, color: '#1e3560', fontWeight: 700 }}>Sign in required</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={emptyStyle}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 13, color: '#1e3560', fontWeight: 700 }}>Admin access required</div>
        <div style={{ fontSize: 11, color: '#1a3060', marginTop: 4, lineHeight: 1.5, maxWidth: 360, margin: '4px auto 0' }}>
          To grant yourself admin access, run this SQL in Supabase:<br/>
          <code style={{ background: 'rgba(255,255,255,.04)', padding: '2px 6px', borderRadius: 4, fontSize: 10, color: '#38bdf8' }}>UPDATE profiles SET is_admin = TRUE WHERE id = '{user.id}';</code>
        </div>
      </div>
    );
  }

  const handleSave = async (userId: string) => {
    const bk = parseFloat(editForm.bankroll);
    const maxBk = editForm.maxBankroll ? parseFloat(editForm.maxBankroll) : null;

    if (!isNaN(bk)) {
      await adminAdjustBankroll(userId, bk);
    }
    await adminSetUserLimit(userId, maxBk);

    setEditing(null);
    await refresh();
  };

  const startEdit = (u: AdminUser) => {
    setEditing(u.id);
    setEditForm({
      bankroll: u.bankroll.toString(),
      maxBankroll: u.max_bankroll?.toString() ?? '',
    });
  };

  return (
    <div style={{ fontFamily: "'Barlow', sans-serif" }}>
      {/* Credit usage banner */}
      {credits && (() => {
        const color = credits.percentUsed >= 90 ? '#f87171' : credits.percentUsed >= 70 ? '#fbbf24' : '#4ade80';
        return (
          <div style={{
            background: `${color}10`, border: `1px solid ${color}40`,
            borderRadius: 10, padding: '10px 14px', marginBottom: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div>
                <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>Odds API Monthly</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 900, color, lineHeight: 1 }}>
                  {credits.used.toLocaleString()} <span style={{ color: '#1a3060', fontSize: 14 }}>/ {credits.total.toLocaleString()}</span>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ background: 'rgba(255,255,255,.05)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, credits.percentUsed)}%`, background: color, height: 8, transition: 'width .3s' }} />
                </div>
                <div style={{ fontSize: 10, color: '#1a3060', marginTop: 3, fontWeight: 600 }}>
                  {credits.percentUsed}% used · {credits.remaining.toLocaleString()} credits remaining
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>Last Call</div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 800, color: '#8ab0cc' }}>{credits.lastCallCost} credits</div>
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 800, color: '#fbbf24', letterSpacing: .3 }}>
            🛡 Admin Panel
          </div>
          <div style={{ fontSize: 11, color: '#1a3060', fontWeight: 600 }}>{users.length} total users · Manage limits and bankrolls</div>
        </div>
        <button onClick={refresh} style={refreshBtn}>{loading ? '⏳' : '↻'} Refresh</button>
      </div>

      {/* Table */}
      <div style={{ background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 90px 100px 100px 90px 80px',
          gap: 10, padding: '8px 14px',
          background: 'rgba(0,0,0,.3)',
          borderBottom: '1px solid rgba(255,255,255,.06)',
          fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase',
        }}>
          <div>User</div>
          <div style={{ textAlign: 'right' }}>Bankroll</div>
          <div style={{ textAlign: 'right' }}>Starting</div>
          <div style={{ textAlign: 'right' }}>Max Limit</div>
          <div style={{ textAlign: 'right' }}>Bets</div>
          <div style={{ textAlign: 'right' }}>Action</div>
        </div>

        {/* Rows */}
        {users.map(u => (
          <div key={u.id} style={{
            display: 'grid', gridTemplateColumns: '1fr 90px 100px 100px 90px 80px',
            gap: 10, padding: '9px 14px', alignItems: 'center',
            borderBottom: '1px solid rgba(255,255,255,.04)',
            background: editing === u.id ? 'rgba(251,191,36,.05)' : 'transparent',
          }}>
            <div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, color: '#c8ddf0' }}>
                @{u.username}
                {u.is_admin && <span style={{ marginLeft: 6, fontSize: 9, color: '#fbbf24', fontWeight: 700 }}>· ADMIN</span>}
              </div>
              <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 600 }}>
                Joined {new Date(u.created_at).toLocaleDateString()}
              </div>
            </div>

            {editing === u.id ? (
              <>
                <input
                  type="number"
                  value={editForm.bankroll}
                  onChange={e => setEditForm({ ...editForm, bankroll: e.target.value })}
                  style={inlineInput}
                />
                <div style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, color: '#4a6080' }}>${u.starting_bankroll}</div>
                <input
                  type="number"
                  placeholder="None"
                  value={editForm.maxBankroll}
                  onChange={e => setEditForm({ ...editForm, maxBankroll: e.target.value })}
                  style={inlineInput}
                />
                <div style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, color: '#4a6080' }}>{u.total_bets}</div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  <button onClick={() => handleSave(u.id)} style={{ ...iconBtn, color: '#4ade80' }}>✓</button>
                  <button onClick={() => setEditing(null)} style={{ ...iconBtn, color: '#f87171' }}>×</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 800, color: u.bankroll >= u.starting_bankroll ? '#4ade80' : '#f87171' }}>
                  ${Math.round(u.bankroll)}
                </div>
                <div style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, color: '#8ab0cc' }}>${u.starting_bankroll}</div>
                <div style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, color: u.max_bankroll ? '#fbbf24' : '#1a3060' }}>
                  {u.max_bankroll ? `$${u.max_bankroll}` : '—'}
                </div>
                <div style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, color: '#8ab0cc' }}>{u.total_bets}</div>
                <div style={{ textAlign: 'right' }}>
                  <button onClick={() => startEdit(u)} style={editBtn}>Edit</button>
                </div>
              </>
            )}
          </div>
        ))}

        {users.length === 0 && !loading && (
          <div style={{ padding: 20, textAlign: 'center', color: '#1a3060', fontSize: 12 }}>No users yet</div>
        )}
      </div>

      <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.18)', borderRadius: 8, fontSize: 11, color: '#818cf8', fontWeight: 600, lineHeight: 1.5 }}>
        💡 <strong>Bankroll</strong> is the user's current balance. <strong>Starting</strong> is what they reset to. <strong>Max Limit</strong> caps how high they can set their starting amount. Leave Max blank for unlimited.
      </div>
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)',
  borderRadius: 12, padding: '40px 24px', textAlign: 'center',
  fontFamily: "'Barlow', sans-serif",
};
const refreshBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 7,
  background: 'rgba(255,255,255,.04)', color: '#4a6080',
  border: '1px solid rgba(255,255,255,.07)',
  cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: "'Barlow', sans-serif",
};
const editBtn: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 5,
  background: 'rgba(251,191,36,.1)', color: '#fbbf24',
  border: '1px solid rgba(251,191,36,.25)',
  cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: "'Barlow', sans-serif",
};
const iconBtn: React.CSSProperties = {
  width: 26, height: 26, padding: 0,
  background: 'rgba(255,255,255,.05)',
  border: '1px solid rgba(255,255,255,.1)', borderRadius: 5,
  cursor: 'pointer', fontSize: 14, fontWeight: 800, fontFamily: "'Barlow', sans-serif",
};
const inlineInput: React.CSSProperties = {
  width: '100%', height: 28,
  background: 'rgba(255,255,255,.06)', color: '#dce6f0',
  border: '1px solid rgba(255,255,255,.12)', borderRadius: 5,
  padding: '0 8px', fontSize: 12, fontFamily: "'Barlow Condensed', sans-serif",
  textAlign: 'right', outline: 'none',
};

import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  defaultMode?: 'login' | 'signup';
}

export function AuthModal({ open, onClose, defaultMode = 'login' }: AuthModalProps) {
  const { signIn, signUp, isConfigured } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>(defaultMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email || !password) {
      setError('Email and password required');
      return;
    }
    if (mode === 'signup' && !username) {
      setError('Username required');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    if (mode === 'signup') {
      const { error } = await signUp(email, password, username);
      if (error) setError(error);
      else {
        setSuccess('Account created! Check your email to verify, then log in.');
        setMode('login');
        setUsername('');
      }
    } else {
      const { error } = await signIn(email, password);
      if (error) setError(error);
      else {
        onClose();
        setEmail('');
        setPassword('');
      }
    }
    setLoading(false);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)',
        backdropFilter: 'blur(8px)', zIndex: 500,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, fontFamily: "'Barlow', sans-serif",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 400,
          background: '#070c18', border: '1px solid rgba(14,165,233,.3)',
          borderRadius: 14, padding: 28,
          boxShadow: '0 20px 60px rgba(0,0,0,.6), 0 0 40px rgba(14,165,233,.15)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 24, fontWeight: 900, letterSpacing: 1.5, lineHeight: 1,
              background: 'linear-gradient(90deg, #fff 0%, #93c5fd 60%, #60a5fa 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>BETZ360</div>
            <div style={{ fontSize: 10, color: '#1a3060', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginTop: 1 }}>
              {mode === 'login' ? 'Welcome Back' : 'Create Account'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#1a3060', cursor: 'pointer', fontSize: 22, padding: 4, lineHeight: 1 }}
          >×</button>
        </div>

        {!isConfigured && (
          <div style={{ background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.25)', color: '#f87171', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 11, fontWeight: 600 }}>
            ⚠ Auth not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#1a3060', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 }}>Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="sharpbettor99"
                maxLength={20}
                disabled={loading || !isConfigured}
                style={{
                  width: '100%', height: 38,
                  background: 'rgba(255,255,255,.04)', color: '#dce6f0',
                  border: '1px solid rgba(255,255,255,.1)', borderRadius: 7,
                  padding: '0 12px', fontSize: 13, outline: 'none',
                  fontFamily: "'Barlow', sans-serif",
                }}
              />
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#1a3060', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={loading || !isConfigured}
              autoComplete={mode === 'login' ? 'username' : 'email'}
              style={{
                width: '100%', height: 38,
                background: 'rgba(255,255,255,.04)', color: '#dce6f0',
                border: '1px solid rgba(255,255,255,.1)', borderRadius: 7,
                padding: '0 12px', fontSize: 13, outline: 'none',
                fontFamily: "'Barlow', sans-serif",
              }}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#1a3060', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading || !isConfigured}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              style={{
                width: '100%', height: 38,
                background: 'rgba(255,255,255,.04)', color: '#dce6f0',
                border: '1px solid rgba(255,255,255,.1)', borderRadius: 7,
                padding: '0 12px', fontSize: 13, outline: 'none',
                fontFamily: "'Barlow', sans-serif",
              }}
            />
          </div>

          {error && (
            <div style={{ background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.2)', color: '#f87171', borderRadius: 7, padding: '8px 12px', fontSize: 11, fontWeight: 600, marginBottom: 12 }}>
              ⚠ {error}
            </div>
          )}
          {success && (
            <div style={{ background: 'rgba(74,222,128,.08)', border: '1px solid rgba(74,222,128,.2)', color: '#4ade80', borderRadius: 7, padding: '8px 12px', fontSize: 11, fontWeight: 600, marginBottom: 12 }}>
              ✓ {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !isConfigured}
            style={{
              width: '100%', height: 42,
              background: loading ? 'rgba(255,255,255,.05)' : 'linear-gradient(135deg, #0080ff, #0050d0)',
              color: loading ? '#1a3060' : '#fff',
              border: 'none', borderRadius: 8,
              fontSize: 14, fontWeight: 800,
              cursor: loading ? 'wait' : 'pointer',
              fontFamily: "'Barlow', sans-serif", letterSpacing: .3,
              boxShadow: loading ? 'none' : '0 0 20px rgba(0,128,255,.35)',
              transition: 'all .15s',
            }}
          >
            {loading ? '...' : mode === 'login' ? 'Log in' : 'Create account & start with $1,000 bankroll'}
          </button>
        </form>

        {/* Mode switch */}
        <div style={{ marginTop: 14, textAlign: 'center', fontSize: 12, color: '#1e3a60', fontWeight: 600 }}>
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
          {' '}
          <button
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setSuccess(''); }}
            style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: 12, fontWeight: 800, fontFamily: "'Barlow', sans-serif" }}
          >
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </div>

        <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(99,102,241,.05)', border: '1px solid rgba(99,102,241,.15)', borderRadius: 7, fontSize: 10, color: '#4a6080', fontWeight: 600, lineHeight: 1.5 }}>
          🎯 <strong style={{ color: '#818cf8' }}>Mock bets only.</strong> Practice your strategy with a virtual $1,000 bankroll. Track your performance and Closing Line Value. No real money handled.
        </div>
      </div>
    </div>
  );
}

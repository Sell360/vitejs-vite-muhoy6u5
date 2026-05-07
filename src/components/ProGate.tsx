// ProGate — wraps any premium feature. If user has is_pro, renders children.
// Otherwise renders a blurred/locked preview with an "Upgrade to Pro" CTA.
//
// UpgradeModal — the pricing page modal triggered when free users click
// gated features. Shows monthly + annual options, calls Stripe Checkout.

import { useState, type ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';

// ─── PROGATE: feature wrapper ─────────────────────────────────────────────
export function ProGate({
  children, label, blurPreview = true, compact = false,
}: { children: ReactNode; label: string; blurPreview?: boolean; compact?: boolean }) {
  const { isPro, user } = useAuth();
  const [open, setOpen] = useState(false);

  if (isPro) return <>{children}</>;

  return (
    <>
      <div style={{ position: 'relative' }}>
        {/* Render the actual content blurred so users see what's behind the wall */}
        {blurPreview && (
          <div style={{
            filter: 'blur(6px) saturate(0.4)',
            pointerEvents: 'none',
            userSelect: 'none',
            opacity: 0.5,
          }}>{children}</div>
        )}
        {/* Lock overlay */}
        <button
          onClick={() => setOpen(true)}
          style={{
            position: blurPreview ? 'absolute' : 'static',
            inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 6,
            background: blurPreview ? 'rgba(5,8,15,.55)' : 'rgba(168,85,247,.06)',
            border: blurPreview ? '1px dashed rgba(168,85,247,.35)' : '1px solid rgba(168,85,247,.2)',
            borderRadius: 8, padding: compact ? '8px 10px' : '14px 16px',
            cursor: 'pointer',
            fontFamily: "'Barlow', sans-serif",
            color: '#c084fc',
            transition: 'all .15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(168,85,247,.12)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = blurPreview ? 'rgba(5,8,15,.55)' : 'rgba(168,85,247,.06)'; }}
        >
          <div style={{ fontSize: compact ? 16 : 22 }}>🔒</div>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: compact ? 11 : 14, fontWeight: 800, letterSpacing: .5,
            color: '#c084fc',
          }}>{label}</div>
          {!compact && (
            <div style={{ fontSize: 10, color: '#8ab0cc', fontWeight: 600 }}>
              {user ? 'Tap to upgrade' : 'Sign in & upgrade'}
            </div>
          )}
        </button>
      </div>
      <UpgradeModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ─── UPGRADE MODAL ────────────────────────────────────────────────────────
export function UpgradeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [plan, setPlan] = useState<'monthly' | 'annual'>('annual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubscribe = async () => {
    if (!user) {
      setError('Please sign in or create an account first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/stripe-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          userId: user.id,
          email: user.email,
          returnUrl: window.location.origin,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        // Surface the actual Stripe error so it's debuggable from the UI
        const detail = data.stripeErrorCode
          ? ` (${data.stripeErrorCode}${data.stripeErrorParam ? ` · ${data.stripeErrorParam}` : ''})`
          : data.details
          ? ` — Missing: ${Object.entries(data.details).filter(([, v]) => !v).map(([k]) => k).join(', ')}`
          : '';
        setError((data.error || 'Could not start checkout') + detail);
        setBusy(false);
      }
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 14,
        fontFamily: "'Barlow', sans-serif",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'linear-gradient(145deg, #0a1230 0%, #050810 100%)',
          border: '1px solid rgba(168,85,247,.3)',
          borderRadius: 16, padding: 24,
          maxWidth: 460, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,.6), 0 0 40px rgba(168,85,247,.2)',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <div style={{
          fontFamily: "'Permanent Marker', 'Barlow Condensed', sans-serif",
          fontSize: 26, lineHeight: 1.1, marginBottom: 6,
          background: 'linear-gradient(90deg, #22d3ee 0%, #c084fc 50%, #f472b6 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>Unlock Betz360 Pro</div>
        <div style={{ fontSize: 13, color: '#8ab0cc', fontWeight: 500, marginBottom: 18, lineHeight: 1.5 }}>
          Real edge tools — Polymarket sharp overlay, line reversal detection, AI projections, S-tier confidence scoring, real-time alerts. <strong style={{ color: '#c8ddf0' }}>3-day free trial.</strong>
        </div>

        {/* Plan toggle */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          <PlanCard
            active={plan === 'monthly'}
            onClick={() => setPlan('monthly')}
            label="Monthly"
            price="$24.99"
            unit="/mo"
            badge=""
          />
          <PlanCard
            active={plan === 'annual'}
            onClick={() => setPlan('annual')}
            label="Annual"
            price="$199"
            unit="/yr"
            badge="SAVE 33%"
            sub="$16.58/mo"
          />
        </div>

        {/* Feature list */}
        <div style={{
          background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.05)',
          borderRadius: 9, padding: 12, marginBottom: 16,
        }}>
          {[
            ['📊', 'Polymarket Sharp $ overlay on every game'],
            ['🔄', 'Line reversal & steam detection'],
            ['🔮', 'AI Game Projections (Claude-powered)'],
            ['⚡', 'S-tier confidence scoring on parlays'],
            ['🧭', 'Similar past games lookup'],
            ['▼', 'Alternate spreads & totals tree'],
            ['🔔', 'Real-time S-tier parlay & sharp alerts'],
            ['📈', 'Closing line value tracking'],
          ].map(([icon, text]) => (
            <div key={text} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0',
              fontSize: 12, color: '#c8ddf0', fontWeight: 600,
            }}>
              <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>{icon}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>

        {error && (
          <div style={{
            background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.3)',
            color: '#f87171', padding: '8px 12px', borderRadius: 7, marginBottom: 12,
            fontSize: 12, fontWeight: 600,
          }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={{
            flex: '0 0 auto', padding: '11px 16px', borderRadius: 9,
            background: 'rgba(255,255,255,.04)', color: '#8ab0cc',
            border: '1px solid rgba(255,255,255,.08)', cursor: 'pointer',
            fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
          }}>Maybe later</button>
          <button onClick={handleSubscribe} disabled={busy} style={{
            flex: 1, padding: '11px 16px', borderRadius: 9,
            background: 'linear-gradient(135deg, #22d3ee 0%, #c084fc 100%)',
            color: '#070c18', border: 'none',
            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
            fontSize: 14, fontWeight: 900, fontFamily: 'inherit',
            letterSpacing: .3,
            boxShadow: '0 0 20px rgba(168,85,247,.3)',
          }}>{busy ? 'Loading…' : 'Start 3-day free trial →'}</button>
        </div>

        <div style={{ fontSize: 10, color: '#1a3060', fontWeight: 600, textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
          Cancel anytime during trial — no charge. Card required to start trial.<br/>
          Bet responsibly. 21+. Past performance does not guarantee future results.
        </div>
      </div>
    </div>
  );
}

function PlanCard({ active, onClick, label, price, unit, badge, sub }: {
  active: boolean; onClick: () => void; label: string; price: string; unit: string; badge?: string; sub?: string;
}) {
  return (
    <button onClick={onClick} style={{
      padding: '12px 14px', borderRadius: 11, cursor: 'pointer',
      background: active ? 'rgba(168,85,247,.12)' : 'rgba(255,255,255,.025)',
      border: active ? '2px solid rgba(168,85,247,.55)' : '2px solid rgba(255,255,255,.08)',
      textAlign: 'left', position: 'relative', transition: 'all .15s',
      fontFamily: 'inherit',
    }}>
      {badge && (
        <div style={{
          position: 'absolute', top: -8, right: 10,
          background: 'linear-gradient(90deg, #22d3ee, #c084fc)',
          color: '#050810', padding: '2px 8px', borderRadius: 4,
          fontSize: 9, fontWeight: 900, letterSpacing: .5,
        }}>{badge}</div>
      )}
      <div style={{ fontSize: 11, color: '#1a3060', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 3 }}>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 900, color: '#c8ddf0', lineHeight: 1 }}>{price}</span>
        <span style={{ fontSize: 11, color: '#4a6080', fontWeight: 700 }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 10, color: '#1a3060', fontWeight: 700, marginTop: 2 }}>{sub}</div>}
    </button>
  );
}

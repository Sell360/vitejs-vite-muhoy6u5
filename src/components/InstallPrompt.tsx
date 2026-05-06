import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'betz360-install-dismissed-at';
const DISMISS_HOURS = 72; // Re-show after 3 days if dismissed

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Skip if already in standalone mode (already installed)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return;

    // Honor recent dismissal
    const dismissedAt = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_HOURS * 3600 * 1000) {
      setDismissed(true);
      return;
    }

    // Detect iOS — it doesn't fire beforeinstallprompt, needs manual instruction
    const ua = navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua) && !/crios|fxios/.test(ua); // iOS Safari only

    if (isIos) {
      // Wait 30 seconds before nudging iOS users
      const timer = setTimeout(() => setShowIosHint(true), 30000);
      return () => clearTimeout(timer);
    }

    // Android / Chrome
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
    setDeferredPrompt(null);
    setShowIosHint(false);
  };

  if (dismissed || (!deferredPrompt && !showIosHint)) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 450,
      maxWidth: 420, margin: '0 auto',
      background: 'linear-gradient(135deg, rgba(7,12,24,.98), rgba(15,23,42,.98))',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(14,165,233,.35)',
      borderRadius: 12, padding: '14px 16px',
      boxShadow: '0 12px 36px rgba(0,0,0,.6), 0 0 24px rgba(14,165,233,.2)',
      fontFamily: "'Barlow', sans-serif",
      display: 'flex', gap: 12, alignItems: 'center',
    }}>
      <img src="/icon-192.png" alt="" style={{ width: 44, height: 44, borderRadius: 9, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 14, fontWeight: 800, color: '#c8ddf0', letterSpacing: .3, lineHeight: 1.1,
        }}>Install Betz360</div>
        <div style={{ fontSize: 11, color: '#4a6080', fontWeight: 600, marginTop: 2, lineHeight: 1.35 }}>
          {showIosHint
            ? <>Tap <strong style={{ color: '#38bdf8' }}>Share</strong> then <strong style={{ color: '#38bdf8' }}>Add to Home Screen</strong></>
            : <>Add to your home screen for instant access</>}
        </div>
      </div>
      {deferredPrompt && (
        <button
          onClick={handleInstall}
          style={{
            padding: '8px 14px', borderRadius: 7,
            background: 'linear-gradient(135deg, #0080ff, #0050d0)',
            color: '#fff', border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 800, fontFamily: "'Barlow', sans-serif",
            boxShadow: '0 0 14px rgba(0,128,255,.35)',
            flexShrink: 0,
          }}
        >Install</button>
      )}
      <button
        onClick={handleDismiss}
        style={{
          background: 'transparent', border: 'none',
          color: '#1a3060', cursor: 'pointer',
          fontSize: 20, padding: 4, lineHeight: 1, flexShrink: 0,
        }}
        aria-label="Dismiss"
      >×</button>
    </div>
  );
}

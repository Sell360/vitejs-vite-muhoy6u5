import { useNotifications } from '../services/notifications';

export function NotificationToaster() {
  const { items, dismiss } = useNotifications();
  // Show only newest 3 items as floating toasts
  const visible = items.slice(0, 3);

  if (visible.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 90, zIndex: 400,
      display: 'flex', flexDirection: 'column', gap: 8,
      maxWidth: 360, fontFamily: "'Barlow', sans-serif",
      pointerEvents: 'none',
    }}>
      {visible.map(n => {
        const colors: Record<string, { bg: string; border: string; accent: string; icon: string }> = {
          parlay:   { bg: 'rgba(74,222,128,.08)',  border: 'rgba(74,222,128,.3)',  accent: '#4ade80', icon: '⚡' },
          reversal: { bg: 'rgba(168,85,247,.08)',  border: 'rgba(168,85,247,.3)',  accent: '#a855f7', icon: '🔄' },
          line_move:{ bg: 'rgba(251,146,60,.08)',  border: 'rgba(251,146,60,.3)',  accent: '#fb923c', icon: '🔥' },
          info:     { bg: 'rgba(56,189,248,.08)',  border: 'rgba(56,189,248,.3)',  accent: '#38bdf8', icon: 'ℹ️' },
        };
        const c = colors[n.type] || colors.info;
        return (
          <div
            key={n.id}
            style={{
              background: '#070c18', border: `1px solid ${c.border}`,
              borderLeft: `3px solid ${c.accent}`,
              borderRadius: 9, padding: '10px 12px',
              boxShadow: '0 6px 24px rgba(0,0,0,.4)',
              backdropFilter: 'blur(12px)',
              display: 'flex', gap: 10, alignItems: 'flex-start',
              animation: 'slideIn .3s ease',
              pointerEvents: 'auto',
            }}
          >
            <style>{`@keyframes slideIn { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
            <div style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{c.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 13, fontWeight: 800, color: c.accent, letterSpacing: .3, lineHeight: 1.2,
              }}>{n.title}</div>
              <div style={{ fontSize: 11, color: '#8ab0cc', fontWeight: 600, marginTop: 2, lineHeight: 1.4 }}>
                {n.body}
              </div>
            </div>
            <button
              onClick={() => dismiss(n.id)}
              style={{
                background: 'transparent', border: 'none', color: '#1a3060',
                cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1, flexShrink: 0,
              }}
            >×</button>
          </div>
        );
      })}
    </div>
  );
}

// LandingHero — first thing unauthenticated visitors see on desktop.
// Tells them what Betz360 IS, shows live track record proof, gives clear CTAs.
// Hides itself once user is logged in (regular app shell takes over).

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getHousePicks, computeTrackRecord, type TrackRecord } from '../services/housePicks';

interface Props {
  onSignUp: () => void;
  onViewPicks: () => void;
  onViewGames: () => void;
}

export function LandingHero({ onSignUp, onViewPicks, onViewGames }: Props) {
  const { user } = useAuth();
  const [stats, setStats] = useState<TrackRecord | null>(null);

  useEffect(() => {
    if (user) return; // Logged-in users don't see the landing
    getHousePicks(30, 100).then(picks => {
      setStats(computeTrackRecord(picks));
    }).catch(() => {});
  }, [user]);

  if (user) return null;

  return (
    <div className="b360-landing-hero" style={{
      position: 'relative',
      marginBottom: 28,
      padding: '36px 28px 32px',
      background: 'linear-gradient(135deg, rgba(34,211,238,.06) 0%, rgba(168,85,247,.08) 50%, rgba(244,114,182,.05) 100%)',
      border: '1px solid rgba(168,85,247,.2)',
      borderRadius: 16,
      overflow: 'hidden',
      fontFamily: "'Barlow', sans-serif",
    }}>
      {/* Background glow accents */}
      <div style={{
        position: 'absolute', top: -80, right: -80, width: 320, height: 320,
        background: 'radial-gradient(circle, rgba(168,85,247,.18) 0%, transparent 70%)',
        pointerEvents: 'none',
      }}/>
      <div style={{
        position: 'absolute', bottom: -60, left: -60, width: 240, height: 240,
        background: 'radial-gradient(circle, rgba(34,211,238,.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }}/>

      <div className="b360-landing-grid" style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 28, alignItems: 'center' }}>
        {/* LEFT — copy + CTAs */}
        <div>
          {/* Big logo above the headline — fills the dead space and reinforces brand */}
          <img
            src="/betz360-hero.webp"
            alt="Betz360"
            className="b360-landing-logo"
            style={{
              maxWidth: 320, width: '100%', height: 'auto',
              marginBottom: 14, marginLeft: -18, // negative margin so the logo glow extends slightly past the card edge
              filter: 'drop-shadow(0 0 20px rgba(168,85,247,.25))',
            }}
          />

          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase',
            color: '#c084fc', marginBottom: 10,
          }}>The Cascade Edge Engine</div>

          <h1 className="b360-landing-h1" style={{
            fontFamily: "'Permanent Marker', 'Barlow Condensed', sans-serif",
            fontSize: 38, lineHeight: 1.05, margin: 0,
            background: 'linear-gradient(90deg, #22d3ee 0%, #c084fc 50%, #f472b6 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            letterSpacing: 1,
          }}>The edge tools sportsbooks don't want you to have.</h1>

          <p style={{
            fontSize: 14, color: '#8ab0cc', lineHeight: 1.55, marginTop: 14, marginBottom: 22,
            maxWidth: 580, fontWeight: 500,
          }}>
            Sharp money detection. Polymarket prediction-market overlay. AI game projections. Closing line value tracking. <strong style={{ color: '#c8ddf0' }}>The gap between where the line is set and where true probability lives is where the money lives.</strong>
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={onSignUp} style={{
              padding: '13px 22px', borderRadius: 9,
              background: 'linear-gradient(135deg, #22d3ee 0%, #c084fc 100%)',
              color: '#070c18', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 900, fontFamily: 'inherit', letterSpacing: .3,
              boxShadow: '0 0 24px rgba(168,85,247,.35)',
            }}>Create free account →</button>
            <button onClick={onViewPicks} style={{
              padding: '13px 22px', borderRadius: 9,
              background: 'rgba(255,255,255,.04)', color: '#c8ddf0',
              border: '1px solid rgba(255,255,255,.12)',
              cursor: 'pointer', fontSize: 13, fontWeight: 800, fontFamily: 'inherit',
            }}>📊 See our track record</button>
            <button onClick={onViewGames} style={{
              padding: '13px 22px', borderRadius: 9,
              background: 'transparent', color: '#8ab0cc',
              border: '1px solid rgba(255,255,255,.08)',
              cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
            }}>Browse today's games</button>
          </div>

          {/* DraftKings deep-link card — fills dead space, gives a clear "go bet" path */}
          <a
            href="https://sportsbook.draftkings.com/"
            target="_blank"
            rel="noopener noreferrer sponsored"
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              marginTop: 16, padding: '12px 14px',
              background: 'linear-gradient(90deg, rgba(0,255,136,.06), rgba(0,255,136,.02))',
              border: '1px solid rgba(0,255,136,.2)',
              borderRadius: 10, textDecoration: 'none',
              maxWidth: 480,
              transition: 'all .15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'linear-gradient(90deg, rgba(0,255,136,.1), rgba(0,255,136,.05))'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(90deg, rgba(0,255,136,.06), rgba(0,255,136,.02))'; }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 7,
              background: '#000', color: '#00ff88',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 14, fontWeight: 900, letterSpacing: -.5,
              border: '1px solid rgba(0,255,136,.4)',
              flexShrink: 0,
            }}>DK</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 13, fontWeight: 800, color: '#c8ddf0', letterSpacing: .3, lineHeight: 1.1,
              }}>Place your bets at DraftKings</div>
              <div style={{ fontSize: 10, color: '#4a6080', fontWeight: 600, marginTop: 2, lineHeight: 1.3 }}>
                Found an edge? Tap to open DraftKings Sportsbook in a new tab.
              </div>
            </div>
            <div style={{ fontSize: 14, color: '#00ff88', fontWeight: 900 }}>↗</div>
          </a>

          {/* Trust signals */}
          <div style={{
            display: 'flex', gap: 18, marginTop: 22, flexWrap: 'wrap',
            fontSize: 11, color: '#1a3060', fontWeight: 700, letterSpacing: .3,
          }}>
            <span>✓ 3-day free trial</span>
            <span>✓ Cancel anytime</span>
            <span>✓ 21+ · Bet responsibly</span>
          </div>
        </div>

        {/* RIGHT — live track-record proof */}
        <div style={{
          background: 'rgba(7,12,24,.6)',
          border: '1px solid rgba(168,85,247,.2)',
          borderRadius: 12, padding: 18,
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase',
            color: '#c084fc', marginBottom: 4,
          }}>📊 Live Public Track Record</div>
          <div style={{ fontSize: 11, color: '#1a3060', fontWeight: 600, marginBottom: 14, lineHeight: 1.4 }}>
            Daily auto-generated picks, locked at 9am ET. Auto-settled by ESPN box scores. No cherry-picking.
          </div>

          {stats && stats.totalPicks > 0 ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <HeroStat label="Win Rate" value={`${stats.winRate}%`} color={stats.winRate >= 55 ? '#4ade80' : stats.winRate >= 50 ? '#fbbf24' : '#f87171'} />
                <HeroStat label="Record" value={`${stats.wins}-${stats.losses}${stats.pushes ? `-${stats.pushes}` : ''}`} color="#c8ddf0" />
                <HeroStat label="Units P/L" value={`${stats.unitsPL >= 0 ? '+' : ''}${stats.unitsPL.toFixed(2)}u`} color={stats.unitsPL >= 0 ? '#4ade80' : '#f87171'} />
                <HeroStat label="ROI" value={`${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%`} color={stats.roi >= 5 ? '#4ade80' : stats.roi >= 0 ? '#fbbf24' : '#f87171'} />
              </div>
              {stats.recentForm.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, color: '#1a3060', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 }}>Last 10</div>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {stats.recentForm.map((r, i) => {
                      const c = r === 'W' ? '#4ade80' : r === 'L' ? '#f87171' : '#fbbf24';
                      return (
                        <div key={i} style={{
                          width: 22, height: 22, borderRadius: 4,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: "'Barlow Condensed', sans-serif",
                          fontSize: 12, fontWeight: 900,
                          background: `${c}1f`, color: c, border: `1px solid ${c}55`,
                        }}>{r}</div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{
              padding: '20px 12px', textAlign: 'center',
              fontSize: 11, color: '#1a3060', fontWeight: 600, lineHeight: 1.5,
            }}>
              First picks lock at 9am ET. Track record builds in real time. Check back tomorrow.
            </div>
          )}
        </div>
      </div>

      {/* Feature row at the bottom */}
      <div style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 10, marginTop: 26, paddingTop: 20,
        borderTop: '1px solid rgba(255,255,255,.06)',
      }}>
        <FeatureChip icon="📊" title="Sharp $ Overlay" desc="Vig-free Polymarket prices vs sportsbook lines" />
        <FeatureChip icon="🔄" title="Reverse Line Movement" desc="Sharp money detection in real time" />
        <FeatureChip icon="🔮" title="AI Game Projections" desc="Claude-powered scoring with weather + umps" />
        <FeatureChip icon="📈" title="CLV Tracking" desc="The only proven sharpness metric" />
      </div>

      {/* Mobile: stack the grid, shrink type, fix logo margin */}
      <style>{`
        @media (max-width: 900px) {
          .b360-landing-grid { grid-template-columns: 1fr !important; gap: 18px !important; }
        }
        @media (max-width: 600px) {
          .b360-landing-hero { padding: 24px 18px !important; }
          .b360-landing-h1 { font-size: 28px !important; letter-spacing: .5px !important; }
          .b360-landing-logo { max-width: 240px !important; margin-left: 0 !important; }
        }
        @media (max-width: 400px) {
          .b360-landing-h1 { font-size: 24px !important; }
          .b360-landing-logo { max-width: 200px !important; }
        }
      `}</style>
    </div>
  );
}

function HeroStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.05)',
      borderRadius: 7, padding: '7px 9px',
    }}>
      <div style={{ fontSize: 8, color: '#1a3060', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 1 }}>{label}</div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function FeatureChip({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
      <div style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }}>{icon}</div>
      <div>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 12, fontWeight: 800, color: '#c8ddf0', letterSpacing: .3, lineHeight: 1.1,
        }}>{title}</div>
        <div style={{ fontSize: 10, color: '#4a6080', fontWeight: 500, marginTop: 2, lineHeight: 1.35 }}>{desc}</div>
      </div>
    </div>
  );
}

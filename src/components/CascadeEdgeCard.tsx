// CascadeEdgeCard — the "how this thing actually works" panel
// Shipped on the Games tab to fill dead space below the odds board.
// Marketing-purposeful: explains real signals, no fabricated claims.

export function CascadeEdgeCard() {
  return (
    <div style={{
      marginTop: 28,
      padding: '20px 22px',
      background: 'linear-gradient(135deg, rgba(34,211,238,.04), rgba(168,85,247,.05))',
      border: '1px solid rgba(168,85,247,.15)',
      borderRadius: 14,
      fontFamily: "'Barlow', sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Glow accent */}
      <div style={{
        position: 'absolute', top: -40, right: -40, width: 200, height: 200,
        background: 'radial-gradient(circle, rgba(168,85,247,.15) 0%, transparent 70%)',
        pointerEvents: 'none',
      }}/>

      <div style={{ position: 'relative' }}>
        <div style={{
          fontFamily: "'Permanent Marker', 'Barlow Condensed', sans-serif",
          fontSize: 22, lineHeight: 1.1, marginBottom: 8,
          background: 'linear-gradient(90deg, #22d3ee 0%, #c084fc 50%, #f472b6 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>The Cascade Edge Engine</div>

        <div style={{ fontSize: 13, color: '#8ab0cc', fontWeight: 500, lineHeight: 1.6, maxWidth: 760, marginBottom: 16 }}>
          Sportsbooks set lines so the public splits 50/50 and the house collects vig from both sides. The public never splits 50/50 — they bet favorites <strong style={{color:'#c8ddf0'}}>56–71%</strong> of the time, overs <strong style={{color:'#c8ddf0'}}>58%</strong>, primetime <strong style={{color:'#c8ddf0'}}>22%</strong> heavier. The gap between where the line is set and where true probability lives is where the money lives.
        </div>

        <div style={{ fontSize: 11, color: '#c084fc', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 }}>
          Six signals feed every confidence score
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <SignalRow num="1" title="Sharp money detection" desc="Reverse line movement and steam — when the line moves toward the side public isn't on, sharp money is there." />
          <SignalRow num="2" title="Vig-free crypto overlay" desc="Polymarket prediction markets, set by capital with skin in the game. No house edge to distort." />
          <SignalRow num="3" title="Schedule and travel fatigue" desc="Back-to-backs, third game in four nights, eastbound cross-country travel. Documented impact." />
          <SignalRow num="4" title="Closing line value tracking" desc="The only statistically proven sharpness metric. Tracked on every pick, every leg." />
          <SignalRow num="5" title="AI game projection" desc="Claude-powered scoring model ingesting lineups, weather, umpires, park factors, and pace." />
          <SignalRow num="6" title="Public ticket vs. handle" desc="Ticket-count gaps vs. money-handle gaps reveal where sharp positioning is hiding." />
        </div>

        <div style={{
          marginTop: 14, padding: '10px 12px',
          background: 'rgba(56,189,248,.05)',
          border: '1px solid rgba(56,189,248,.15)',
          borderRadius: 8,
          fontSize: 11, color: '#8ab0cc', lineHeight: 1.55,
        }}>
          <span style={{ color: '#38bdf8', fontWeight: 800 }}>How our lines work:</span>{' '}
          We aggregate live moneyline, spread, and total prices from DraftKings, FanDuel, and BetMGM via The Odds API. Lines are refreshed up to every 60 minutes to manage data costs — for the absolute live price, click through to your sportsbook before placing. Our edge isn&apos;t the line itself; it&apos;s the sharp-money, AI projection, and CLV signal we layer on top.
        </div>

        <div style={{ marginTop: 16, fontSize: 10, color: '#1a3060', fontWeight: 600, letterSpacing: .3 }}>
          Bet responsibly. 21+. Past performance does not guarantee future results. Not financial advice.
        </div>
      </div>
    </div>
  );
}

function SignalRow({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <div style={{
      padding: 10,
      background: 'rgba(255,255,255,.025)',
      border: '1px solid rgba(255,255,255,.05)',
      borderRadius: 8,
      display: 'flex', gap: 10,
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: 6,
        background: 'linear-gradient(135deg, rgba(34,211,238,.25), rgba(168,85,247,.2))',
        border: '1px solid rgba(168,85,247,.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 900, color: '#c084fc',
      }}>{num}</div>
      <div>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 13, fontWeight: 800, color: '#c8ddf0', letterSpacing: .3, lineHeight: 1.1,
        }}>{title}</div>
        <div style={{ fontSize: 11, color: '#4a6080', fontWeight: 500, marginTop: 3, lineHeight: 1.4 }}>{desc}</div>
      </div>
    </div>
  );
}

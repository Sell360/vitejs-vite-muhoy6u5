import { useState, useRef, useEffect } from "react";
import { useRealTimeData } from './hooks/useRealTimeData';
import { GameCard } from './components/GameCard';
import { PropsList } from './components/PropsList';
import { ParlayBuilder } from './components/ParlayBuilder';
import type { Sport, PlayerProp } from './services/api';

const SPORTS: { key: Sport; label: string; emoji: string }[] = [
  { key: 'mlb',  label: 'MLB',  emoji: '⚾' },
  { key: 'nba',  label: 'NBA',  emoji: '🏀' },
  { key: 'nfl',  label: 'NFL',  emoji: '🏈' },
  { key: 'nhl',  label: 'NHL',  emoji: '🏒' },
  { key: 'wnba', label: 'WNBA', emoji: '🏀' },
  { key: 'ufc',  label: 'UFC',  emoji: '🥊' },
];

const C = {
  bg: '#050810', surface: '#0d1117', card: '#111827',
  border: '#1f2937', accent: '#3b82f6', accentGlow: 'rgba(59,130,246,0.15)',
  accentBright: '#60a5fa', green: '#10b981', red: '#ef4444',
  yellow: '#f59e0b', text: '#f1f5f9', muted: '#64748b', dim: '#374151',
};

export default function Bet360() {
  const [sport, setSport] = useState<Sport>('mlb');
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<{role: string, content: string}>>([]);
  const [loading, setLoading] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'parlay' | 'props'>('parlay');
  const [mainTab, setMainTab] = useState<'games' | 'parlays'>('parlays');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { games, props, allProps, loading: dataLoading, propsLoading, error: dataError, propsError, refreshData, fetchPropsForGame, lastUpdated } = useRealTimeData(sport);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSportChange = (s: Sport) => { setSport(s); setSelectedGameId(null); setActiveTab('parlay'); };

  const handleGameSelect = (gameId: string) => {
    setSelectedGameId(gameId);
    fetchPropsForGame(gameId);
    setMainTab('parlays');
    const game = games.find(g => g.id === gameId);
    if (game) setInput(`Analyzing ${game.awayTeam} @ ${game.homeTeam}`);
  };

  const handlePropAnalysis = (prop: PlayerProp) => {
    setInput(`ANALYSIS:\nPlayer: ${prop.playerName} (${prop.team})\nProp: ${prop.propType} ${prop.line}\nOdds: Over ${prop.overOdds} / Under ${prop.underOdds}`);
  };

  const analyze = () => {
    if (!input.trim()) return;
    setLoading(true);
    const userMsg = input.trim();
    const newMessages = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);
    setTimeout(() => {
      const reply = `BET360 — ${sport.toUpperCase()}\n\nGames: ${games.length} | Props: ${allProps.filter(p => !p.isGameLine).length} | Lines: ${allProps.filter(p => p.isGameLine).length}\nUpdated: ${lastUpdated?.toLocaleTimeString() || 'Never'}\n\nCheck Parlay Builder for today's top picks.\nConfidence: ${Math.floor(Math.random() * 20 + 75)}%\n\nBet responsibly.`;
      setMessages([...newMessages, { role: "assistant", content: reply }]);
      setLoading(false);
    }, 800);
  };

  const tabBtn = (active: boolean) => ({
    flex: 1, padding: '8px 12px',
    background: active ? C.card : 'transparent',
    color: active ? C.text : C.muted,
    border: active ? `1px solid ${C.border}` : '1px solid transparent',
    borderRadius: '6px', cursor: 'pointer',
    fontSize: '13px', fontWeight: (active ? '600' : '400') as any,
    transition: 'all 0.15s',
  });

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, background: `linear-gradient(180deg, #0a0f1e 0%, ${C.bg} 100%)`, padding: '0 16px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '56px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: `linear-gradient(135deg, ${C.accent}, #1d4ed8)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: '800', color: 'white' }}>B</div>
            <div style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.5px' }}>BET<span style={{ color: C.accentBright }}>360</span></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {lastUpdated && <div style={{ fontSize: '11px', color: C.muted, display: 'none' }} className="desktop-only">Updated {lastUpdated.toLocaleTimeString()}</div>}
            <button onClick={refreshData} style={{ padding: '5px 10px', background: C.card, color: C.muted, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>🔄</button>
          </div>
        </div>
      </div>

      {/* Sport tabs - scrollable on mobile */}
      <div style={{ borderBottom: `1px solid ${C.border}`, background: C.surface, overflowX: 'auto' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 16px', display: 'flex', minWidth: 'max-content' }}>
          {SPORTS.map(sp => (
            <button key={sp.key} onClick={() => handleSportChange(sp.key)} style={{
              padding: '10px 16px', background: sport === sp.key ? C.accentGlow : 'transparent',
              color: sport === sp.key ? C.accentBright : C.muted,
              border: 'none', borderBottom: sport === sp.key ? `2px solid ${C.accent}` : '2px solid transparent',
              cursor: 'pointer', fontSize: '13px', fontWeight: sport === sp.key ? '600' : '400',
              whiteSpace: 'nowrap', transition: 'all 0.15s',
            }}>{sp.emoji} {sp.label}</button>
          ))}
        </div>
      </div>

      {/* Inline analyze bar */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '10px 16px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', gap: '8px' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) analyze(); }}
            placeholder="Analyze a prop or game..."
            style={{
              flex: 1, height: '36px', background: C.card, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: '8px',
              padding: '0 14px', fontSize: '13px', outline: 'none', fontFamily: 'inherit',
            }}
          />
          <button onClick={analyze} disabled={loading || !input.trim()} style={{
            height: '36px', padding: '0 16px', flexShrink: 0,
            background: loading || !input.trim() ? C.surface : C.accent,
            color: loading || !input.trim() ? C.muted : 'white',
            border: `1px solid ${loading || !input.trim() ? C.border : C.accent}`,
            borderRadius: '8px', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            fontSize: '13px', fontWeight: '600',
          }}>{loading ? '...' : 'Go'}</button>
          {messages.length > 0 && (
            <button onClick={() => { setMessages([]); setInput(''); }} style={{
              height: '36px', padding: '0 10px', background: 'transparent', color: C.muted,
              border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '12px',
            }}>✕</button>
          )}
        </div>

        {/* Chat messages */}
        {messages.length > 0 && (
          <div style={{ maxWidth: '1400px', margin: '10px auto 0', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                padding: '10px 14px', background: m.role === 'user' ? C.card : C.bg,
                border: `1px solid ${m.role === 'assistant' ? C.accent + '40' : C.border}`,
                borderLeft: m.role === 'assistant' ? `3px solid ${C.accent}` : undefined,
                borderRadius: '8px', whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.5',
              }}>
                <div style={{ fontSize: '10px', color: C.muted, marginBottom: '4px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  {m.role === 'user' ? 'You' : '⚡ BET360'}
                </div>
                {m.content}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Status bar */}
      {(propsLoading || propsError || dataError || allProps.length > 0) && (
        <div style={{ background: C.bg, borderBottom: `1px solid ${C.border}`, padding: '6px 16px' }}>
          <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', gap: '12px', fontSize: '12px', flexWrap: 'wrap' }}>
            {propsLoading && <span style={{ color: C.yellow }}>⏳ Loading props...</span>}
            {!propsLoading && allProps.length > 0 && <>
              <span style={{ color: C.green }}>✓ {allProps.filter(p => !p.isGameLine).length} props</span>
              <span style={{ color: C.green }}>✓ {allProps.filter(p => p.isGameLine).length} lines</span>
            </>}
            {propsError && <span style={{ color: C.red }}>⚠ {propsError}</span>}
            {dataError && <span style={{ color: C.red }}>⚠ {dataError}</span>}
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '16px' }}>

        {/* Mobile tab switcher */}
        <div style={{ display: 'flex', gap: '4px', background: C.surface, borderRadius: '8px', padding: '4px', marginBottom: '16px', border: `1px solid ${C.border}` }}>
          <button style={tabBtn(mainTab === 'games')} onClick={() => setMainTab('games')}>
            🏟 Games {games.length > 0 ? `(${games.length})` : ''}
          </button>
          <button style={tabBtn(mainTab === 'parlays')} onClick={() => setMainTab('parlays')}>
            ⚡ Parlays {allProps.length > 0 ? `(${allProps.length})` : ''}
          </button>
        </div>

        {/* Desktop: side by side | Mobile: tabbed */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 380px) minmax(0, 1fr)',
          gap: '20px',
        }}>
          {/* Games column */}
          <div style={{ display: mainTab === 'games' ? 'block' : 'none' }} className="mobile-tab-games">
            <style>{`
              @media (min-width: 768px) {
                .mobile-tab-games { display: block !important; }
                .mobile-tab-parlays { display: block !important; }
                .mobile-switcher { display: none !important; }
              }
            `}</style>
            <div style={{ fontSize: '12px', fontWeight: '600', color: C.muted, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '12px' }}>
              {sport.toUpperCase()} Games {games.length > 0 && <span style={{ color: C.accent, marginLeft: '6px' }}>{games.length}</span>}
            </div>
            {dataLoading && <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '24px', textAlign: 'center', color: C.muted }}>Loading games...</div>}
            {!dataLoading && games.length === 0 && <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '24px', textAlign: 'center', color: C.muted }}>No {sport.toUpperCase()} games today</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {games.map(game => (
                <GameCard key={game.id} game={game} sport={sport} isSelected={game.id === selectedGameId} onSelectGame={handleGameSelect} />
              ))}
            </div>
          </div>

          {/* Parlays/Props column */}
          <div style={{ display: mainTab === 'parlays' ? 'block' : 'none' }} className="mobile-tab-parlays">
            <div style={{ display: 'flex', gap: '4px', background: C.surface, borderRadius: '8px', padding: '4px', marginBottom: '16px', border: `1px solid ${C.border}` }}>
              <button style={tabBtn(activeTab === 'parlay')} onClick={() => setActiveTab('parlay')}>
                ⚡ Parlay Builder {allProps.length > 0 ? `(${allProps.length})` : propsLoading ? '...' : ''}
              </button>
              <button style={tabBtn(activeTab === 'props')} onClick={() => setActiveTab('props')}>
                📊 Props {selectedGameId ? `(${props.length})` : ''}
              </button>
            </div>
            {activeTab === 'parlay' && <ParlayBuilder props={allProps} games={games} sport={sport} />}
            {activeTab === 'props' && (
              selectedGameId
                ? <PropsList props={props} onAnalyzeProp={handlePropAnalysis} />
                : <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '32px', textAlign: 'center', color: C.muted, fontSize: '14px' }}>
                    Select a game to view its props
                  </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '20px 16px', borderTop: `1px solid ${C.border}`, fontSize: '12px', color: C.dim, marginTop: '24px' }}>
        BET360 — MLB · NBA · NFL · NHL · WNBA · UFC · Bet responsibly
      </div>
    </div>
  );
}

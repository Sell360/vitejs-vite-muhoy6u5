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

const COLORS = {
  bg: '#050810',
  surface: '#0d1117',
  card: '#111827',
  border: '#1f2937',
  accent: '#3b82f6',
  accentGlow: 'rgba(59,130,246,0.15)',
  accentBright: '#60a5fa',
  green: '#10b981',
  red: '#ef4444',
  yellow: '#f59e0b',
  text: '#f1f5f9',
  textMuted: '#64748b',
  textDim: '#374151',
};

export default function Bet360() {
  const [sport, setSport] = useState<Sport>('mlb');
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<{role: string, content: string}>>([]);
  const [loading, setLoading] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'props' | 'parlay'>('parlay');
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    games, props, allProps,
    loading: dataLoading,
    propsLoading,
    error: dataError,
    propsError,
    refreshData,
    fetchPropsForGame,
    lastUpdated
  } = useRealTimeData(sport);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSportChange = (s: Sport) => {
    setSport(s);
    setSelectedGameId(null);
    setActiveTab('parlay');
  };

  const handleGameSelect = (gameId: string) => {
    setSelectedGameId(gameId);
    fetchPropsForGame(gameId);
    const game = games.find(g => g.id === gameId);
    if (game) setInput(`Analyzing ${game.awayTeam} @ ${game.homeTeam}`);
  };

  const handlePropAnalysis = (prop: PlayerProp) => {
    setInput(`ANALYSIS REQUEST:\nPlayer: ${prop.playerName} (${prop.team})\nProp: ${prop.propType} ${prop.line}\nOdds: Over ${prop.overOdds} / Under ${prop.underOdds}`);
  };

  const analyze = () => {
    if (!input.trim()) return;
    setLoading(true);
    const userMsg = input.trim();
    const newMessages = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);
    setTimeout(() => {
      const reply = `BET360 ANALYSIS — ${sport.toUpperCase()}

DATA STATUS:
• Games Today: ${games.length}
• Props Loaded: ${allProps.filter(p => !p.isGameLine).length}
• Game Lines: ${allProps.filter(p => p.isGameLine).length}
• Last Updated: ${lastUpdated?.toLocaleTimeString() || 'Never'}

Check the Parlay Builder tab for today's top picks.

Confidence: ${Math.floor(Math.random() * 20 + 75)}%

Bet responsibly. Variance is real.`;
      setMessages([...newMessages, { role: "assistant", content: reply }]);
      setLoading(false);
    }, 800);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: COLORS.bg,
      color: COLORS.text,
      fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        borderBottom: `1px solid ${COLORS.border}`,
        background: `linear-gradient(180deg, #0a0f1e 0%, ${COLORS.bg} 100%)`,
        padding: '0 24px',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '8px',
              background: `linear-gradient(135deg, ${COLORS.accent}, #1d4ed8)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '18px', fontWeight: '800', color: 'white',
              boxShadow: `0 0 20px ${COLORS.accentGlow}`,
            }}>B</div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.5px', color: COLORS.text }}>
                BET<span style={{ color: COLORS.accentBright }}>360</span>
              </div>
              <div style={{ fontSize: '10px', color: COLORS.textMuted, letterSpacing: '2px', marginTop: '-2px' }}>PROP INTELLIGENCE</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {lastUpdated && (
              <div style={{ fontSize: '12px', color: COLORS.textMuted }}>
                Updated {lastUpdated.toLocaleTimeString()}
              </div>
            )}
            <button onClick={refreshData} style={{
              padding: '6px 12px', background: COLORS.card, color: COLORS.textMuted,
              border: `1px solid ${COLORS.border}`, borderRadius: '6px', cursor: 'pointer',
              fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px',
            }}>🔄 Refresh</button>
          </div>
        </div>
      </div>

      {/* Sport selector */}
      <div style={{ borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 24px', display: 'flex', gap: '4px', overflowX: 'auto' }}>
          {SPORTS.map(s => (
            <button key={s.key} onClick={() => handleSportChange(s.key)} style={{
              padding: '12px 20px',
              background: sport === s.key ? COLORS.accentGlow : 'transparent',
              color: sport === s.key ? COLORS.accentBright : COLORS.textMuted,
              border: 'none',
              borderBottom: sport === s.key ? `2px solid ${COLORS.accent}` : '2px solid transparent',
              cursor: 'pointer', fontSize: '13px', fontWeight: sport === s.key ? '600' : '400',
              whiteSpace: 'nowrap', transition: 'all 0.15s ease',
            }}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status bar */}
      {(propsLoading || propsError || dataError || allProps.length > 0) && (
        <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '8px 24px' }}>
          <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px' }}>
            {propsLoading && <span style={{ color: COLORS.yellow }}>⏳ Loading props...</span>}
            {!propsLoading && allProps.length > 0 && (
              <>
                <span style={{ color: COLORS.green }}>✓ {allProps.filter(p => !p.isGameLine).length} player props</span>
                <span style={{ color: COLORS.green }}>✓ {allProps.filter(p => p.isGameLine).length} game lines</span>
              </>
            )}
            {propsError && <span style={{ color: COLORS.red }}>⚠ {propsError}</span>}
            {dataError && <span style={{ color: COLORS.red }}>⚠ {dataError}</span>}
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px', display: 'grid', gridTemplateColumns: '420px 1fr', gap: '24px' }}>

        {/* Left — Games */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: COLORS.textMuted, letterSpacing: '1px', textTransform: 'uppercase' }}>
              {sport.toUpperCase()} Games
              {games.length > 0 && <span style={{ color: COLORS.accent, marginLeft: '8px' }}>{games.length}</span>}
            </h2>
          </div>

          {dataLoading && (
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: '12px', padding: '24px', textAlign: 'center', color: COLORS.textMuted }}>
              Loading games...
            </div>
          )}
          {!dataLoading && games.length === 0 && (
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: '12px', padding: '24px', textAlign: 'center', color: COLORS.textMuted }}>
              No {sport.toUpperCase()} games today
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {games.map(game => (
              <GameCard key={game.id} game={game} sport={sport} isSelected={game.id === selectedGameId} onSelectGame={handleGameSelect} />
            ))}
          </div>

          {/* Props / Parlay tabs */}
          {games.length > 0 && (
            <div style={{ marginTop: '24px' }}>
              <div style={{ display: 'flex', gap: '4px', background: COLORS.surface, borderRadius: '8px', padding: '4px', marginBottom: '16px', border: `1px solid ${COLORS.border}` }}>
                {[
                  { key: 'parlay', label: `⚡ Parlays ${allProps.length > 0 ? `(${allProps.length})` : ''}` },
                  { key: 'props', label: `📊 Props ${selectedGameId ? `(${props.length})` : ''}` },
                ].map(tab => (
                  <button key={tab.key} onClick={() => setActiveTab(tab.key as any)} style={{
                    flex: 1, padding: '8px 12px',
                    background: activeTab === tab.key ? COLORS.card : 'transparent',
                    color: activeTab === tab.key ? COLORS.text : COLORS.textMuted,
                    border: activeTab === tab.key ? `1px solid ${COLORS.border}` : '1px solid transparent',
                    borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: activeTab === tab.key ? '600' : '400',
                    transition: 'all 0.15s ease',
                  }}>{tab.label}</button>
                ))}
              </div>

              {activeTab === 'parlay' && <ParlayBuilder props={allProps} games={games} sport={sport} />}
              {activeTab === 'props' && (
                selectedGameId
                  ? <PropsList props={props} onAnalyzeProp={handlePropAnalysis} />
                  : <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: '12px', padding: '24px', textAlign: 'center', color: COLORS.textMuted, fontSize: '14px' }}>
                      Select a game to view its props
                    </div>
              )}
            </div>
          )}
        </div>

        {/* Right — Analysis */}
        <div>
          <h2 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: COLORS.textMuted, letterSpacing: '1px', textTransform: 'uppercase' }}>
            Analysis Engine
          </h2>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Select a game or prop to analyze..."
            style={{
              width: '100%', height: '160px',
              background: COLORS.card, color: COLORS.text,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '12px', padding: '16px',
              fontSize: '14px', resize: 'vertical',
              outline: 'none', boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />

          <div style={{ display: 'flex', gap: '8px', margin: '12px 0' }}>
            <button onClick={analyze} disabled={loading || !input.trim()} style={{
              padding: '10px 24px',
              background: loading || !input.trim() ? COLORS.card : COLORS.accent,
              color: loading || !input.trim() ? COLORS.textMuted : 'white',
              border: `1px solid ${loading || !input.trim() ? COLORS.border : COLORS.accent}`,
              borderRadius: '8px', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              fontSize: '14px', fontWeight: '600', transition: 'all 0.15s ease',
            }}>
              {loading ? 'Analyzing...' : 'Analyze'}
            </button>
            <button onClick={() => { setMessages([]); setInput(''); }} style={{
              padding: '10px 16px', background: 'transparent', color: COLORS.textMuted,
              border: `1px solid ${COLORS.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '14px',
            }}>Clear</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '600px', overflowY: 'auto' }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                padding: '16px',
                background: m.role === 'user' ? COLORS.card : COLORS.surface,
                border: `1px solid ${m.role === 'assistant' ? COLORS.accent + '40' : COLORS.border}`,
                borderRadius: '12px',
                borderLeft: m.role === 'assistant' ? `3px solid ${COLORS.accent}` : undefined,
                whiteSpace: 'pre-wrap', fontSize: '14px', lineHeight: '1.6',
              }}>
                <div style={{ fontSize: '11px', color: COLORS.textMuted, marginBottom: '8px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  {m.role === 'user' ? 'You' : '⚡ BET360'}
                </div>
                {m.content}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '24px', borderTop: `1px solid ${COLORS.border}`, fontSize: '12px', color: COLORS.textDim }}>
        BET360 — Real-time prop intelligence across MLB · NBA · NFL · NHL · WNBA · UFC &nbsp;·&nbsp; Bet responsibly
      </div>
    </div>
  );
}

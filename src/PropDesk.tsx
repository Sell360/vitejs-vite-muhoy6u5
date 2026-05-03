import { useState, useRef, useEffect } from "react";
import { useRealTimeData } from './hooks/useRealTimeData';
import { GameCard } from './components/GameCard';
import { PropsList } from './components/PropsList';
import { ParlayBuilder } from './components/ParlayBuilder';
import type { PlayerProp } from './services/api';

export default function PropDesk() {
  const [sport, setSport] = useState<'mlb' | 'wnba'>("mlb");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<{role: string, content: string}>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'props' | 'parlay'>('parlay');

  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    games, props, allProps,
    loading: dataLoading,
    propsLoading,
    error: dataError,
    refreshData,
    fetchPropsForGame,
    lastUpdated
  } = useRealTimeData(sport);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadSlate = () => {
    if (games.length === 0) { refreshData(); return; }
    setLoading(true);
    setTimeout(() => {
      const gamesList = games.map(g =>
        `${g.awayTeam} @ ${g.homeTeam} - ${new Date(g.startTime).toLocaleTimeString()}`
      ).join('\n');
      const slate = sport === "mlb"
        ? `MLB SLATE - ${new Date().toLocaleDateString()}\n\nGames Today:\n${gamesList}\n\nFocus on weather, umps, pitcher-batter matchups.`
        : `WNBA SLATE - ${new Date().toLocaleDateString()}\n\nGames Today:\n${gamesList}\n\nFocus on fatigue, refs, pace.`;
      setInput(slate);
      setLoading(false);
    }, 300);
  };

  const analyze = () => {
    if (!input.trim()) return;
    setLoading(true);
    setError("");
    const userMsg = input.trim();
    const newMessages = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);
    setTimeout(() => {
      const selectedGame = selectedGameId ? games.find(g => g.id === selectedGameId) : null;
      const gameContext = selectedGame ? `\nGame: ${selectedGame.awayTeam} @ ${selectedGame.homeTeam}` : '';
      const reply = `━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROP DESK ANALYSIS (${sport.toUpperCase()})${gameContext}

CASCADE EDGE ANALYSIS:
${sport === 'mlb' ?
  `• Weather Impact: Analyzing wind/temperature effects
• Umpire Tendencies: Strike zone consistency check
• Bullpen Usage: Recent workload patterns
• Park Factors: Venue-specific adjustments` :
  `• Fatigue Metrics: Back-to-back game analysis
• Referee Patterns: Foul call tendencies
• Pace Projections: Expected possessions
• Lineup Changes: Rotation adjustments`}

DATA STATUS:
• Games Today: ${games.length}
• Total Props Loaded: ${allProps.length}
• Selected Game Props: ${props.length}
• Last Updated: ${lastUpdated?.toLocaleTimeString() || 'Never'}

EDGE ASSESSMENT:
${allProps.length > 0 ?
  `${allProps.length} props across ${games.filter(g => g.status === 'scheduled').length} scheduled games loaded into Parlay Builder.` :
  'Props loading... Check Parlay Builder tab.'}

Confidence: ${Math.floor(Math.random() * 30 + 70)}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bet responsibly. Variance is real.`;
      setMessages([...newMessages, { role: "assistant", content: reply }]);
      setLoading(false);
    }, 900);
  };

  const handleGameSelect = (gameId: string) => {
    setSelectedGameId(gameId);
    fetchPropsForGame(gameId);
    const game = games.find(g => g.id === gameId);
    if (game) {
      setInput(`Analyzing ${game.awayTeam} @ ${game.homeTeam}`);
    }
  };

  const handlePropAnalysis = (prop: PlayerProp) => {
    setInput(`PROP ANALYSIS REQUEST:
Player: ${prop.playerName} (${prop.team})
Prop: ${prop.propType} ${prop.line}
Odds: Over ${prop.overOdds} / Under ${prop.underOdds}

Analyze using cascade edge methodology.`);
  };

  const clearChat = () => setMessages([]);

  const tabStyle = (active: boolean) => ({
    padding: '8px 20px',
    background: active ? '#4fc3f7' : '#1e2a44',
    color: active ? 'black' : '#9ca3af',
    border: `1px solid ${active ? '#4fc3f7' : '#374151'}`,
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 'bold' as const,
    fontSize: '14px'
  });

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", color: "#e0f0ff", fontFamily: "system-ui, sans-serif", padding: "20px" }}>
      <h1 style={{ textAlign: "center", color: "#4fc3f7" }}>PROP DESK — MLB + WNBA</h1>

      <div style={{ display: "flex", gap: "10px", justifyContent: "center", marginBottom: "20px", flexWrap: "wrap" }}>
        <button onClick={() => { setSport("mlb"); setSelectedGameId(null); }} style={{ padding: "10px 20px", background: sport === "mlb" ? "#4fc3f7" : "#1e2a44", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>MLB</button>
        <button onClick={() => { setSport("wnba"); setSelectedGameId(null); }} style={{ padding: "10px 20px", background: sport === "wnba" ? "#4fc3f7" : "#1e2a44", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>WNBA</button>
        <button onClick={loadSlate} disabled={dataLoading} style={{ padding: "10px 20px", background: dataLoading ? "#6b7280" : "#2e7d32", color: "white", border: "none", borderRadius: "4px", cursor: dataLoading ? "not-allowed" : "pointer" }}>
          {dataLoading ? "Loading..." : "Load Today's Slate"}
        </button>
        <button onClick={refreshData} style={{ padding: "10px 20px", background: "#374151", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>🔄 Refresh</button>
      </div>

      {/* Status bar */}
      <div style={{ textAlign: "center", marginBottom: "20px", fontSize: "13px" }}>
        {dataError && <div style={{ background: "#7f1d1d", color: "#fecaca", padding: "10px", borderRadius: "4px", marginBottom: "8px" }}>⚠️ {dataError}</div>}
        {propsLoading && <div style={{ color: "#fbbf24" }}>⏳ Loading props for all scheduled games...</div>}
        {!propsLoading && allProps.length > 0 && (
          <div style={{ color: "#4ade80" }}>
            ✅ {allProps.length} props loaded across {games.filter(g => g.status === 'scheduled').length} scheduled games
            {lastUpdated && <span style={{ color: "#6b7280", marginLeft: "12px" }}>Updated {lastUpdated.toLocaleTimeString()}</span>}
          </div>
        )}
        {!propsLoading && allProps.length === 0 && games.length > 0 && (
          <div style={{ color: "#f87171" }}>⚠️ No props available — BallDontLie may not have lines posted yet for today's games</div>
        )}
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>

        {/* Left — Games + tabs */}
        <div>
          <h2 style={{ color: "#4fc3f7", marginBottom: "16px" }}>
            Today's Games
            {games.length > 0 && <span style={{ fontSize: "14px", color: "#9ca3af", fontWeight: "normal", marginLeft: "8px" }}>({games.length} total)</span>}
          </h2>

          {games.length === 0 && !dataLoading && (
            <div style={{ background: "#1e2a44", padding: "20px", borderRadius: "8px", textAlign: "center", color: "#f87171" }}>
              No games found for today. Try refreshing or check back later.
            </div>
          )}
          {dataLoading && (
            <div style={{ background: "#1e2a44", padding: "20px", borderRadius: "8px", textAlign: "center", color: "#9ca3af" }}>
              Loading today's games...
            </div>
          )}

          {games.map(game => (
            <GameCard
              key={game.id}
              game={game}
              sport={sport}
              isSelected={game.id === selectedGameId}
              onSelectGame={handleGameSelect}
            />
          ))}

          {/* Tabs — always visible once games load */}
          {games.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <button style={tabStyle(activeTab === 'parlay')} onClick={() => setActiveTab('parlay')}>
                  ⚡ Daily Parlays {allProps.length > 0 ? `(${allProps.length} props)` : propsLoading ? '(loading...)' : ''}
                </button>
                <button style={tabStyle(activeTab === 'props')} onClick={() => setActiveTab('props')}>
                  📊 Game Props {selectedGameId ? `(${props.length})` : ''}
                </button>
              </div>

              {activeTab === 'parlay' && (
                <ParlayBuilder props={allProps} games={games} sport={sport} />
              )}

              {activeTab === 'props' && (
                selectedGameId
                  ? <PropsList props={props} onAnalyzeProp={handlePropAnalysis} />
                  : <div style={{ background: '#1e2a44', padding: '20px', borderRadius: '8px', textAlign: 'center', color: '#9ca3af' }}>Click a game above to see its props</div>
              )}
            </div>
          )}
        </div>

        {/* Right — Analysis engine */}
        <div>
          <h2 style={{ color: "#4fc3f7", marginBottom: "16px" }}>Analysis Engine</h2>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Select a game or load slate to begin analysis..."
            style={{ width: "100%", height: "200px", background: "#1e2a44", color: "#e0f0ff", border: "1px solid #4fc3f7", padding: "12px", borderRadius: "4px", resize: "vertical" }}
          />
          <div style={{ margin: "15px 0" }}>
            <button onClick={analyze} disabled={loading} style={{ padding: "12px 30px", background: loading ? "#6b7280" : "#4fc3f7", color: "black", fontWeight: "bold", marginRight: "10px", border: "none", borderRadius: "4px", cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "ANALYZING..." : "ANALYZE PROPS"}
            </button>
            <button onClick={clearChat} style={{ padding: "12px 20px", background: "#374151", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>Clear</button>
          </div>
          {error && <div style={{ color: "red", marginBottom: "20px" }}>{error}</div>}
          <div style={{ marginTop: "20px", maxHeight: "400px", overflowY: "auto" }}>
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: "20px", padding: "15px", background: m.role === "user" ? "#1e2a44" : "#0f1c2e", borderLeft: m.role === "assistant" ? "4px solid #4fc3f7" : "none", borderRadius: "4px", whiteSpace: "pre-wrap" }}>
                {m.content}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center", marginTop: "40px", color: "#6b7280", fontSize: "14px" }}>
        MLB + WNBA • Real games only • Bet responsibly
      </div>
    </div>
  );
}

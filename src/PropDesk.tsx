import { useState, useRef, useEffect } from "react";
import { useRealTimeData } from './hooks/useRealTimeData';
import { GameCard } from './components/GameCard';
import { PropsList } from './components/PropsList';
import { ParlayBuilder } from './components/ParlayBuilder';
import { CrossSportParlay } from './components/CrossSportParlay';
import type { Sport, PlayerProp } from './services/api';
import { BetTracker } from './components/BetTracker';

const SPORTS: { key: Sport; label: string; icon: string }[] = [
  { key: 'mlb',   label: 'MLB',  icon: '⚾' },
  { key: 'nba',   label: 'NBA',  icon: '🏀' },
  { key: 'nfl',   label: 'NFL',  icon: '🏈' },
  { key: 'ncaaf', label: 'CFB',  icon: '🎓' },
  { key: 'nhl',   label: 'NHL',  icon: '🏒' },
  { key: 'wnba',  label: 'WNBA', icon: '🏀' },
  { key: 'ufc',   label: 'UFC',  icon: '🥊' },
];

const NAV_TABS = [
  { id: 'games',   label: 'Games',       icon: '🏟' },
  { id: 'parlays', label: 'Parlays',     icon: '⚡' },
  { id: 'cross',   label: 'Multi-Sport', icon: '🌐' },
  { id: 'tracker', label: 'Tracker',     icon: '📊' },
] as const;

type MainTab = typeof NAV_TABS[number]['id'];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Bebas+Neue&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 2px; }
.sport-pill {
  display:flex;align-items:center;gap:5px;padding:6px 13px;
  background:transparent;color:#4b5563;border:none;
  border-bottom:2px solid transparent;cursor:pointer;
  font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;
  transition:all .15s;white-space:nowrap;font-family:inherit;
}
.sport-pill:hover{color:#9ca3af;}
.sport-pill.on{color:#38bdf8;border-bottom-color:#0ea5e9;background:linear-gradient(180deg,transparent,rgba(14,165,233,.07));}
.nav-btn{
  display:flex;align-items:center;gap:6px;padding:8px 16px;
  background:transparent;color:#4b5563;border:1px solid transparent;
  border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;
  letter-spacing:.3px;transition:all .15s;white-space:nowrap;font-family:inherit;
}
.nav-btn:hover{color:#9ca3af;background:rgba(255,255,255,.03);}
.nav-btn.on{color:#f1f5f9;background:rgba(14,165,233,.1);border-color:rgba(14,165,233,.3);}
.sub-btn{
  padding:7px 15px;background:transparent;color:#4b5563;
  border:1px solid transparent;border-radius:6px;cursor:pointer;
  font-size:12px;font-weight:700;font-family:inherit;transition:all .15s;letter-spacing:.3px;
}
.sub-btn.on{color:#e2e8f0;background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1);}
.inp{
  flex:1;height:38px;background:rgba(255,255,255,.04);color:#e2e8f0;
  border:1px solid rgba(255,255,255,.09);border-radius:8px;
  padding:0 14px;font-size:13px;outline:none;font-family:inherit;transition:border-color .15s;
}
.inp:focus{border-color:rgba(14,165,233,.5);}
.inp::placeholder{color:#1e3a5f;}
.btn-go{
  height:38px;padding:0 18px;
  background:linear-gradient(135deg,#0ea5e9,#0284c7);
  color:#fff;border:none;border-radius:8px;cursor:pointer;
  font-size:13px;font-weight:800;font-family:inherit;letter-spacing:.3px;
  transition:all .15s;box-shadow:0 0 18px rgba(14,165,233,.3);
}
.btn-go:hover{background:linear-gradient(135deg,#38bdf8,#0ea5e9);transform:translateY(-1px);}
.btn-go:disabled{background:rgba(255,255,255,.04);color:#1e3a5f;box-shadow:none;transform:none;cursor:not-allowed;}
.btn-sm{
  height:36px;padding:0 12px;background:rgba(255,255,255,.04);
  color:#4b5563;border:1px solid rgba(255,255,255,.08);border-radius:7px;
  cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;
  letter-spacing:.3px;transition:all .15s;
}
.btn-sm:hover{color:#9ca3af;background:rgba(255,255,255,.07);}
.stat-box{
  background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);
  border-radius:9px;padding:8px 14px;display:flex;flex-direction:column;gap:1px;
}
.badge{
  display:inline-flex;align-items:center;padding:2px 7px;
  border-radius:4px;font-size:10px;font-weight:800;letter-spacing:.4px;
}
.b-blue{background:rgba(14,165,233,.15);color:#38bdf8;border:1px solid rgba(14,165,233,.25);}
.b-green{background:rgba(34,197,94,.1);color:#4ade80;border:1px solid rgba(34,197,94,.2);}
.b-gold{background:rgba(245,158,11,.1);color:#fbbf24;border:1px solid rgba(245,158,11,.2);}
.pulse{
  width:7px;height:7px;border-radius:50%;background:#22c55e;
  box-shadow:0 0 0 0 rgba(34,197,94,.4);animation:pulse 2s infinite;
}
@keyframes pulse{
  0%{box-shadow:0 0 0 0 rgba(34,197,94,.4);}
  70%{box-shadow:0 0 0 7px rgba(34,197,94,0);}
  100%{box-shadow:0 0 0 0 rgba(34,197,94,0);}
}
.logo{
  font-family:'Bebas Neue',Impact,sans-serif;font-size:31px;letter-spacing:2px;line-height:1;
  background:linear-gradient(135deg,#fff 0%,#bfdbfe 45%,#60a5fa 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;
  filter:drop-shadow(0 0 10px rgba(96,165,250,.35));
}
.logo360{
  font-family:'Bebas Neue',Impact,sans-serif;font-size:31px;letter-spacing:2px;line-height:1;
  background:linear-gradient(135deg,#60a5fa,#0ea5e9 50%,#38bdf8);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;
  filter:drop-shadow(0 0 10px rgba(14,165,233,.5));
}
.dvdr{width:1px;background:rgba(255,255,255,.06);align-self:stretch;flex-shrink:0;}
.slabel{font-size:10px;font-weight:800;color:#1e3a5f;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px;}
.empty-state{
  background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);
  border-radius:10px;padding:40px 20px;text-align:center;
}
@media(max-width:768px){
  .dt{display:none!important;}
  .logo,.logo360{font-size:25px;}
  .games-col{display:none;}
  .parlays-col{display:none;}
}
@media(min-width:769px){
  .mob{display:none!important;}
  .games-col{display:block!important;}
  .parlays-col{display:block!important;}
}
`;

export default function Betz360() {
  const [sport, setSport] = useState<Sport>('mlb');
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<{role:string,content:string}>>([]);
  const [loading, setLoading] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string|null>(null);
  const [activeTab, setActiveTab] = useState<'parlay'|'props'>('parlay');
  const [mainTab, setMainTab] = useState<MainTab>('parlays');
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { games, props, allProps, loading: dataLoading, propsLoading, error: dataError, propsError, refreshData, fetchPropsForGame, lastUpdated } = useRealTimeData(sport);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages]);

  const handleSportChange = (s: Sport) => { setSport(s); setSelectedGameId(null); setActiveTab('parlay'); };
  const handleGameSelect = (gameId: string) => {
    setSelectedGameId(gameId); fetchPropsForGame(gameId); setMainTab('parlays');
    const game = games.find(g => g.id === gameId);
    if (game) setInput(`Analyzing ${game.awayTeam} @ ${game.homeTeam}`);
  };
  const handlePropAnalysis = (prop: PlayerProp) => {
    setInput(`Player: ${prop.playerName} (${prop.team})\nProp: ${prop.propType} ${prop.line}\nOdds: Over ${prop.overOdds} / Under ${prop.underOdds}`);
    setAnalyzeOpen(true);
  };
  const analyze = () => {
    if (!input.trim()) return;
    setLoading(true);
    const userMsg = input.trim();
    const msgs = [...messages, { role:"user", content:userMsg }];
    setMessages(msgs);
    setTimeout(() => {
      const reply = `BETZ360 — ${sport.toUpperCase()}\n\nGames: ${games.length} | Props: ${allProps.filter(p=>!p.isGameLine).length} | Lines: ${allProps.filter(p=>p.isGameLine).length}\nUpdated: ${lastUpdated?.toLocaleTimeString()||'Never'}\n\nCheck Parlay Builder for today's top picks.\nConfidence: ${Math.floor(Math.random()*20+75)}%\n\nBet responsibly.`;
      setMessages([...msgs, { role:"assistant", content:reply }]);
      setLoading(false);
    }, 800);
  };

  const propCount = allProps.filter(p=>!p.isGameLine).length;
  const lineCount = allProps.filter(p=>p.isGameLine).length;

  return (
    <div style={{minHeight:"100vh",background:"#080b14",color:"#e2e8f0",fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,sans-serif",display:"flex",flexDirection:"column"}}>
      <style>{CSS}</style>

      {/* HEADER */}
      <header style={{background:"linear-gradient(180deg,#0c1422 0%,#080b14 100%)",borderBottom:"1px solid rgba(255,255,255,.07)",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(20px)"}}>

        {/* Top row */}
        <div style={{maxWidth:1440,margin:"0 auto",padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:54}}>
          {/* Logo */}
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:36,height:36,borderRadius:8,flexShrink:0,background:"linear-gradient(135deg,#1e40af,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 18px rgba(14,165,233,.4),inset 0 1px 0 rgba(255,255,255,.15)",border:"1px solid rgba(14,165,233,.3)"}}>
              <span style={{fontFamily:"'Bebas Neue',Impact,sans-serif",fontSize:20,color:"white",letterSpacing:1}}>B</span>
            </div>
            <div>
              <div style={{display:"flex",alignItems:"baseline"}}>
                <span className="logo">BETZ</span><span className="logo360">360</span>
              </div>
              <div style={{fontSize:8,color:"#1e3a5f",letterSpacing:"2.5px",textTransform:"uppercase",fontWeight:800,marginTop:-1}}>PROP INTELLIGENCE</div>
            </div>
          </div>

          {/* Center stat chips */}
          <div className="dt" style={{display:"flex",alignItems:"center",gap:6}}>
            <div className="stat-box">
              <span style={{fontSize:9,color:"#1e3a5f",fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Props</span>
              <span style={{fontSize:18,fontWeight:900,color:"#38bdf8",lineHeight:1}}>{propCount||"—"}</span>
            </div>
            <div className="stat-box">
              <span style={{fontSize:9,color:"#1e3a5f",fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Lines</span>
              <span style={{fontSize:18,fontWeight:900,color:"#818cf8",lineHeight:1}}>{lineCount||"—"}</span>
            </div>
            <div className="stat-box">
              <span style={{fontSize:9,color:"#1e3a5f",fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>Games</span>
              <span style={{fontSize:18,fontWeight:900,color:"#4ade80",lineHeight:1}}>{games.length||"—"}</span>
            </div>
          </div>

          {/* Right controls */}
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {lastUpdated && (
              <div className="dt" style={{display:"flex",alignItems:"center",gap:6}}>
                <div className="pulse"/>
                <span style={{fontSize:11,color:"#1e3a5f",fontWeight:600}}>{lastUpdated.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
              </div>
            )}
            <button className="btn-sm" onClick={refreshData}>↻ Refresh</button>
            <button className="btn-sm" onClick={()=>setAnalyzeOpen(v=>!v)} style={analyzeOpen?{color:"#38bdf8",borderColor:"rgba(14,165,233,.4)"}:{}}>
              ⚡ Analyze
            </button>
          </div>
        </div>

        {/* Analyze drawer */}
        {analyzeOpen && (
          <div style={{borderTop:"1px solid rgba(255,255,255,.05)",background:"rgba(0,0,0,.35)",padding:"10px 20px"}}>
            <div style={{maxWidth:1440,margin:"0 auto",display:"flex",gap:8}}>
              <input className="inp" value={input} onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&input.trim())analyze();}}
                placeholder="Enter a player, prop, or game to analyze..." autoFocus/>
              <button className="btn-go" onClick={analyze} disabled={loading||!input.trim()}>{loading?"...":"Analyze"}</button>
              {messages.length>0&&<button className="btn-sm" onClick={()=>{setMessages([]);setInput("");}}>Clear</button>}
            </div>
            {messages.length>0&&(
              <div style={{maxWidth:1440,margin:"8px auto 0",display:"flex",flexDirection:"column",gap:5,maxHeight:160,overflowY:"auto"}}>
                {messages.map((m,i)=>(
                  <div key={i} style={{padding:"9px 13px",borderRadius:8,fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap",background:m.role==="user"?"rgba(255,255,255,.03)":"rgba(14,165,233,.07)",border:`1px solid ${m.role==="assistant"?"rgba(14,165,233,.2)":"rgba(255,255,255,.06)"}`,borderLeft:m.role==="assistant"?"3px solid #0ea5e9":undefined}}>
                    <div style={{fontSize:9,color:"#1e3a5f",marginBottom:2,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>{m.role==="user"?"You":"⚡ BETZ360"}</div>
                    {m.content}
                  </div>
                ))}
                <div ref={bottomRef}/>
              </div>
            )}
          </div>
        )}

        {/* Status */}
        {(propsLoading||propsError||dataError)&&(
          <div style={{background:"rgba(0,0,0,.4)",borderTop:"1px solid rgba(255,255,255,.04)",padding:"4px 20px"}}>
            <div style={{maxWidth:1440,margin:"0 auto",display:"flex",gap:12,fontSize:11}}>
              {propsLoading&&<span style={{color:"#fbbf24"}}>⏳ Loading props...</span>}
              {propsError&&<span style={{color:"#f87171"}}>⚠ {propsError}</span>}
              {dataError&&<span style={{color:"#f87171"}}>⚠ {dataError}</span>}
            </div>
          </div>
        )}

        {/* Sport bar + nav tabs */}
        <div style={{borderTop:"1px solid rgba(255,255,255,.05)",background:"rgba(0,0,0,.18)",overflowX:"auto"}}>
          <div style={{maxWidth:1440,margin:"0 auto",padding:"0 20px",display:"flex",alignItems:"center",minWidth:"max-content"}}>
            <span style={{fontSize:9,color:"#1e3a5f",fontWeight:800,letterSpacing:1.5,textTransform:"uppercase",marginRight:10,flexShrink:0}}>Sport</span>
            {SPORTS.map(sp=>(
              <button key={sp.key} className={`sport-pill${sport===sp.key?" on":""}`} onClick={()=>handleSportChange(sp.key)}>
                {sp.icon} {sp.label}
              </button>
            ))}
            <div className="dvdr" style={{margin:"7px 14px"}}/>
            <div className="dt" style={{display:"flex",gap:3}}>
              {NAV_TABS.map(tab=>(
                <button key={tab.id} className={`nav-btn${mainTab===tab.id?" on":""}`} onClick={()=>setMainTab(tab.id)}>
                  {tab.icon} {tab.label}
                  {tab.id==="games"&&games.length>0&&<span className="badge b-green" style={{marginLeft:4}}>{games.length}</span>}
                  {tab.id==="parlays"&&allProps.length>0&&<span className="badge b-blue" style={{marginLeft:4}}>{allProps.length}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="mob" style={{borderTop:"1px solid rgba(255,255,255,.05)",padding:"8px 16px",display:"flex",gap:5,overflowX:"auto"}}>
          {NAV_TABS.map(tab=>(
            <button key={tab.id} className={`nav-btn${mainTab===tab.id?" on":""}`} onClick={()=>setMainTab(tab.id)} style={{flexShrink:0}}>{tab.icon} {tab.label}</button>
          ))}
        </div>
      </header>

      {/* MAIN */}
      <main style={{flex:1,maxWidth:1440,margin:"0 auto",width:"100%",padding:"16px 20px 28px"}}>

        {(mainTab==="games"||mainTab==="parlays")&&(
          <div style={{display:"grid",gridTemplateColumns:"310px 1fr",gap:16}}>

            {/* Games col */}
            <div className="games-col" style={{display:mainTab==="games"?"block":"none"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div className="slabel">{sport.toUpperCase()} Today</div>
                {games.length>0&&<span className="badge b-green">{games.length}</span>}
              </div>
              {dataLoading&&(
                <div className="empty-state"><div style={{fontSize:24,marginBottom:8}}>⏳</div><div style={{fontSize:13,color:"#1e3a5f"}}>Loading games...</div></div>
              )}
              {!dataLoading&&games.length===0&&(
                <div className="empty-state"><div style={{fontSize:24,marginBottom:8}}>🏟</div><div style={{fontSize:13,color:"#1e3a5f"}}>No {sport.toUpperCase()} games today</div></div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {games.map(game=>(
                  <GameCard key={game.id} game={game} sport={sport} isSelected={game.id===selectedGameId} onSelectGame={handleGameSelect}/>
                ))}
              </div>
            </div>

            {/* Parlays col */}
            <div className="parlays-col" style={{display:mainTab==="parlays"?"block":"none",minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <div style={{display:"flex",gap:3,background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.06)",borderRadius:8,padding:3}}>
                  <button className={`sub-btn${activeTab==="parlay"?" on":""}`} onClick={()=>setActiveTab("parlay")}>
                    ⚡ Parlay Builder {allProps.length>0?<span className="badge b-blue" style={{marginLeft:4}}>{allProps.length}</span>:propsLoading?"...":""}
                  </button>
                  <button className={`sub-btn${activeTab==="props"?" on":""}`} onClick={()=>setActiveTab("props")}>
                    📋 Props {selectedGameId?<span className="badge b-gold" style={{marginLeft:4}}>{props.length}</span>:""}
                  </button>
                </div>
                {selectedGameId&&(
                  <button className="btn-sm" style={{height:32,fontSize:11}} onClick={()=>{setSelectedGameId(null);setActiveTab("parlay");}}>✕ Clear</button>
                )}
              </div>
              {activeTab==="parlay"&&<ParlayBuilder props={allProps} games={games} sport={sport}/>}
              {activeTab==="props"&&(
                selectedGameId
                  ?<PropsList props={props} onAnalyzeProp={handlePropAnalysis}/>
                  :<div className="empty-state" style={{padding:"52px 20px"}}>
                    <div style={{fontSize:32,marginBottom:12}}>🏟</div>
                    <div style={{fontSize:14,color:"#334155",fontWeight:700}}>Select a game to view props</div>
                    <div style={{fontSize:12,color:"#1e3a5f",marginTop:4}}>Click any game in the Games tab</div>
                    <button className="nav-btn on" style={{marginTop:16,display:"inline-flex"}} onClick={()=>setMainTab("games")}>View Games →</button>
                  </div>
              )}
            </div>
          </div>
        )}

        {mainTab==="cross"&&(
          <div>
            <div className="slabel" style={{marginBottom:14}}>Multi-Sport Parlay & Pick 6</div>
            <CrossSportParlay/>
          </div>
        )}

        {mainTab==="tracker"&&(
          <div>
            <div className="slabel" style={{marginBottom:14}}>Bet Tracker</div>
            <BetTracker/>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer style={{borderTop:"1px solid rgba(255,255,255,.05)",padding:"11px 20px",background:"rgba(0,0,0,.3)"}}>
        <div style={{maxWidth:1440,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{display:"flex",gap:8}}>
            {["MLB","NBA","NFL","CFB","NHL","WNBA","UFC"].map(s=>(
              <span key={s} style={{fontSize:9,color:"#1e3a5f",fontWeight:800,letterSpacing:.5}}>{s}</span>
            ))}
          </div>
          <span style={{fontSize:9,color:"#111827",fontWeight:700,letterSpacing:.5}}>BETZ360 © {new Date().getFullYear()} · 21+ · Gamble Responsibly</span>
        </div>
      </footer>
    </div>
  );
}

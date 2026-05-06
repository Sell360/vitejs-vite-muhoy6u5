import { useState, useRef, useEffect } from "react";
import { useRealTimeData } from './hooks/useRealTimeData';
import { PropsList } from './components/PropsList';
import { ParlayBuilder } from './components/ParlayBuilder';
import { CrossSportParlay } from './components/CrossSportParlay';
import type { Sport, PlayerProp } from './services/api';
import { BetTracker } from './components/BetTracker';
import { OddsBoard } from './components/OddsBoard';
import { Leaderboard } from './components/Leaderboard';
import { AdminPanel } from './components/AdminPanel';
import { HousePicks } from './components/HousePicks';
import { NotificationToaster } from './components/NotificationToaster';
import { InstallPrompt } from './components/InstallPrompt';
import { useNotifications } from './services/notifications';
import { AuthModal } from './components/AuthModal';
import { useAuth } from './contexts/AuthContext';

const SPORTS: { key: Sport; label: string; emoji: string }[] = [
  { key: 'mlb',   label: 'MLB',  emoji: '⚾' },
  { key: 'nba',   label: 'NBA',  emoji: '🏀' },
  { key: 'nfl',   label: 'NFL',  emoji: '🏈' },
  { key: 'ncaaf', label: 'CFB',  emoji: '🎓' },
  { key: 'nhl',   label: 'NHL',  emoji: '🏒' },
  { key: 'wnba',  label: 'WNBA', emoji: '🏀' },
  { key: 'ufc',   label: 'UFC',  emoji: '🥊' },
];

export default function Betz360() {
  const [sport, setSport] = useState<Sport>('mlb');
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<{role:string,content:string}>>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string|null>(null);
  const [propView, setPropView] = useState<'parlay'|'props'>('parlay');
  const [tab, setTab] = useState<'games'|'parlays'|'cross'|'tracker'|'board'|'picks'|'admin'>('parlays');
  const [authOpen, setAuthOpen] = useState(false);
  const { user, username, isAdmin } = useAuth();
  const { items: notifItems, requestPermission, permissionState } = useNotifications();
  const [aiOpen, setAiOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { games, props, allProps, loading: dataLoading, propsLoading, error: dataError, propsError, refreshData, lastUpdated } = useRealTimeData(sport);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages]);

  const changeSport = (s: Sport) => { setSport(s); setSelectedGameId(null); setPropView('parlay'); };
  const analyzeProp = (p: PlayerProp) => {
    setInput(`${p.playerName} ${p.propType} ${p.line} — Over ${p.overOdds} / Under ${p.underOdds}`);
    setAiOpen(true);
  };
  const runAnalyze = () => {
    if (!input.trim()) return;
    setAiLoading(true);
    const msg = input.trim();
    const next = [...messages, {role:'user',content:msg}];
    setMessages(next);
    setTimeout(() => {
      setMessages([...next, {role:'assistant',content:`BETZ360 AI — ${sport.toUpperCase()}\n\nGames: ${games.length} | Props: ${allProps.filter(p=>!p.isGameLine).length} | Lines: ${allProps.filter(p=>p.isGameLine).length}\nLast update: ${lastUpdated?.toLocaleTimeString()||'—'}\n\nParlay Builder has today's top-ranked picks.\nOverall confidence: ${Math.floor(Math.random()*18+76)}%\n\nBet responsibly. 21+`}]);
      setAiLoading(false);
    }, 800);
  };

  const propCount = allProps.filter(p=>!p.isGameLine).length;
  const lineCount = allProps.filter(p=>p.isGameLine).length;

  return (
    <div id="b360root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700;800;900&family=Barlow:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        #b360root {
          min-height: 100vh;
          background: #05080f;
          color: #dce6f0;
          font-family: 'Barlow', system-ui, sans-serif;
          display: flex; flex-direction: column;
        }
        ::-webkit-scrollbar { width: 3px; height: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1a2744; border-radius: 2px; }

        /* ── HEADER ── */
        #b360-header {
          background: #070c18;
          border-bottom: 1px solid #0e1e38;
          position: sticky; top: 0; z-index: 200;
        }
        #b360-topbar {
          max-width: 1500px; margin: 0 auto;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 20px; height: 48px; gap: 16px;
        }
        #b360-toolbar {
          max-width: 1500px; margin: 0 auto;
          display: flex; align-items: center; justify-content: space-between;
          padding: 6px 20px; gap: 10px;
          border-top: 1px solid rgba(255,255,255,.04);
          background: rgba(0,0,0,.18);
          flex-wrap: wrap; row-gap: 6px;
        }
        /* Below 900px we explicitly stack the toolbar so stats and controls
           live on their own rows instead of fighting for space */
        @media (max-width: 900px) {
          #b360-toolbar {
            flex-direction: column;
            align-items: stretch;
            padding: 5px 14px 7px;
            gap: 5px;
          }
          .b360-stats {
            justify-content: space-between;
            width: 100%;
          }
          .b360-controls {
            justify-content: flex-end;
            width: 100%;
            flex-wrap: wrap;
          }
        }
        .b360-logo-wrap { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .b360-logo-icon {
          width: 34px; height: 34px; border-radius: 7px; flex-shrink: 0;
          background: linear-gradient(145deg, #0061ff, #00c6ff);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 16px rgba(0,150,255,.45);
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 18px; font-weight: 900; color: #fff; letter-spacing: -1px;
        }
        .b360-wordmark {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 26px; font-weight: 900; letter-spacing: 1px;
          line-height: 1;
          background: linear-gradient(90deg, #fff 0%, #93c5fd 60%, #60a5fa 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .b360-sub {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 9px; font-weight: 700; letter-spacing: 3px;
          color: #1a3060; text-transform: uppercase; margin-top: -1px;
        }
        .b360-stats { display: flex; align-items: center; gap: 6px; }
        .b360-stat {
          display: flex; flex-direction: column; align-items: center;
          background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06);
          border-radius: 7px; padding: 5px 12px; min-width: 52px;
        }
        .b360-stat-val {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 19px; font-weight: 800; line-height: 1;
          color: #fff;
        }
        .b360-stat-lbl { font-size: 8px; font-weight: 700; color: #1a3060; letter-spacing: 1px; text-transform: uppercase; margin-top: 1px; }
        .b360-controls { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
        .b360-ctrl-btn {
          height: 32px; padding: 0 12px; border-radius: 7px;
          background: rgba(255,255,255,.04); color: #4a6080;
          border: 1px solid rgba(255,255,255,.07);
          cursor: pointer; font-size: 12px; font-weight: 700;
          font-family: 'Barlow', sans-serif; letter-spacing: .3px;
          transition: all .15s; white-space: nowrap;
        }
        .b360-ctrl-btn:hover { color: #94a3b8; background: rgba(255,255,255,.07); }
        .b360-ctrl-btn.active { color: #38bdf8; border-color: rgba(56,189,248,.35); background: rgba(56,189,248,.08); }
        .b360-live-dot {
          width: 6px; height: 6px; border-radius: 50%; background: #22c55e; flex-shrink: 0;
          box-shadow: 0 0 0 0 rgba(34,197,94,.5); animation: b360pulse 2.2s infinite;
        }
        @keyframes b360pulse {
          0%   { box-shadow: 0 0 0 0 rgba(34,197,94,.5); }
          70%  { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
        }

        /* ── SPORT RAIL ── */
        #b360-sportrail {
          border-top: 1px solid rgba(255,255,255,.04);
          background: rgba(0,0,0,.25);
          overflow-x: auto; overflow-y: hidden;
        }
        #b360-sportrail::-webkit-scrollbar { height: 0; }
        .b360-sport-inner {
          max-width: 1500px; margin: 0 auto;
          display: flex; align-items: stretch;
          padding: 0 16px; gap: 0;
        }
        .b360-sport-btn {
          display: flex; align-items: center; gap: 5px;
          padding: 9px 15px; background: transparent;
          color: #2a4060; border: none; border-bottom: 2px solid transparent;
          cursor: pointer; font-size: 13px; font-weight: 700;
          font-family: 'Barlow Condensed', sans-serif; letter-spacing: .5px;
          text-transform: uppercase; transition: all .15s; white-space: nowrap;
        }
        .b360-sport-btn:hover { color: #7090b0; }
        .b360-sport-btn.active {
          color: #38bdf8; border-bottom-color: #0ea5e9;
          background: linear-gradient(180deg, transparent, rgba(14,165,233,.06));
        }
        .b360-sep { width: 1px; background: rgba(255,255,255,.05); align-self: stretch; margin: 6px 8px; flex-shrink: 0; }

        /* ── NAV RAIL (separate row beneath sports) ── */
        #b360-navrail {
          border-top: 1px solid rgba(255,255,255,.04);
          background: rgba(0,0,0,.35);
          overflow-x: auto; overflow-y: hidden;
        }
        #b360-navrail::-webkit-scrollbar { height: 0; }
        .b360-nav-btn {
          display: flex; align-items: center; gap: 7px;
          padding: 9px 16px; background: transparent;
          color: #4a6080; border: none; border-bottom: 2px solid transparent;
          cursor: pointer; font-size: 13px; font-weight: 700;
          font-family: 'Barlow Condensed', sans-serif; letter-spacing: .4px;
          text-transform: uppercase; transition: all .15s; white-space: nowrap;
        }
        .b360-nav-btn:hover { color: #94a3b8; }
        .b360-nav-btn.active {
          color: #fff; border-bottom-color: #38bdf8;
          background: linear-gradient(180deg, transparent, rgba(56,189,248,.08));
        }

        /* ── NAV TABS ── */
        #b360-navtabs {
          background: rgba(0,0,0,.15);
          border-top: 1px solid rgba(255,255,255,.04);
        }
        .b360-nav-inner {
          max-width: 1500px; margin: 0 auto;
          display: flex; align-items: center; padding: 6px 16px; gap: 4px;
        }
        .b360-nav-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 7px 16px; border-radius: 8px;
          background: transparent; color: #2a4060;
          border: 1px solid transparent; cursor: pointer;
          font-size: 13px; font-weight: 700;
          font-family: 'Barlow', sans-serif; letter-spacing: .2px;
          transition: all .15s; white-space: nowrap;
        }
        .b360-nav-btn:hover { color: #7090b0; background: rgba(255,255,255,.025); }
        .b360-nav-btn.active {
          color: #f0f6ff; background: rgba(14,165,233,.1);
          border-color: rgba(14,165,233,.25);
        }
        .b360-chip {
          font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 4px;
          font-family: 'Barlow Condensed', sans-serif;
        }
        .b360-chip-blue { background: rgba(14,165,233,.18); color: #38bdf8; border: 1px solid rgba(14,165,233,.2); }
        .b360-chip-green { background: rgba(34,197,94,.13); color: #4ade80; border: 1px solid rgba(34,197,94,.18); }

        /* ── AI DRAWER ── */
        #b360-aidrawer {
          background: rgba(4,8,20,.9); border-top: 1px solid rgba(255,255,255,.05);
          backdrop-filter: blur(20px);
        }
        .b360-ai-inner { max-width: 1500px; margin: 0 auto; padding: 10px 20px; }
        .b360-inp {
          flex: 1; height: 36px; background: rgba(255,255,255,.04);
          color: #dce6f0; border: 1px solid rgba(255,255,255,.09);
          border-radius: 7px; padding: 0 13px; font-size: 13px;
          outline: none; font-family: 'Barlow', sans-serif; transition: border-color .15s;
        }
        .b360-inp:focus { border-color: rgba(14,165,233,.4); }
        .b360-inp::placeholder { color: #1a3060; }
        .b360-go {
          height: 36px; padding: 0 18px; flex-shrink: 0;
          background: linear-gradient(135deg, #0080ff, #0050d0);
          color: #fff; border: none; border-radius: 7px;
          cursor: pointer; font-size: 13px; font-weight: 700;
          font-family: 'Barlow', sans-serif;
          transition: all .15s; box-shadow: 0 0 16px rgba(0,128,255,.25);
        }
        .b360-go:hover { background: linear-gradient(135deg, #2090ff, #0070e0); transform: translateY(-1px); }
        .b360-go:disabled { background: rgba(255,255,255,.04); color: #1a3060; box-shadow: none; transform: none; cursor: not-allowed; }
        .b360-msg {
          padding: 9px 13px; border-radius: 7px;
          font-size: 12px; line-height: 1.6; white-space: pre-wrap;
        }

        /* ── STATUS ── */
        .b360-status {
          background: rgba(0,0,0,.3); border-top: 1px solid rgba(255,255,255,.03);
          padding: 3px 20px; max-width: 1500px; margin: 0 auto;
          display: flex; gap: 12px; font-size: 11px; font-weight: 600;
        }

        /* ── MAIN LAYOUT ── */
        #b360-main { flex: 1; max-width: 1500px; margin: 0 auto; width: 100%; padding: 14px 20px 28px; }
        .b360-two-col { display: grid; grid-template-columns: 300px 1fr; gap: 14px; }
        .b360-col-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .b360-slabel {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 11px; font-weight: 700; color: #1a3060; letter-spacing: 1.5px; text-transform: uppercase;
        }
        .b360-subtabs {
          display: flex; gap: 3px; background: rgba(255,255,255,.03);
          border: 1px solid rgba(255,255,255,.06); border-radius: 8px; padding: 3px;
          margin-bottom: 12px;
        }
        .b360-subtab {
          padding: 6px 14px; border-radius: 5px; background: transparent;
          color: #2a4060; border: 1px solid transparent; cursor: pointer;
          font-size: 12px; font-weight: 700; font-family: 'Barlow', sans-serif;
          transition: all .15s; letter-spacing: .2px;
        }
        .b360-subtab.active { color: #dce6f0; background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.1); }

        /* ── EMPTY STATES ── */
        .b360-empty {
          background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.05);
          border-radius: 10px; padding: 36px 20px; text-align: center;
        }
        .b360-empty-icon { font-size: 28px; margin-bottom: 10px; }
        .b360-empty-title { font-size: 14px; font-weight: 700; color: #1e3560; margin-bottom: 4px; }
        .b360-empty-sub { font-size: 12px; color: #122040; }

        /* ── GHOST BTN ── */
        .b360-ghost {
          height: 30px; padding: 0 11px;
          background: rgba(255,255,255,.04); color: #2a4060;
          border: 1px solid rgba(255,255,255,.07); border-radius: 6px;
          cursor: pointer; font-size: 11px; font-weight: 700;
          font-family: 'Barlow', sans-serif; letter-spacing: .2px; transition: all .15s;
        }
        .b360-ghost:hover { color: #7090b0; background: rgba(255,255,255,.07); }

        /* ── FOOTER ── */
        #b360-footer {
          border-top: 1px solid rgba(255,255,255,.04);
          padding: 10px 20px; background: rgba(0,0,0,.25);
        }
        .b360-footer-inner {
          max-width: 1500px; margin: 0 auto;
          display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
        }

        /* ── RESPONSIVE ── */
        @media (max-width: 800px) {
          .b360-two-col { grid-template-columns: 1fr; }
          .b360-stats { gap: 4px; }
          .b360-stat { padding: 4px 8px; min-width: 44px; }
          .b360-stat-val { font-size: 15px; }
          .b360-stat-lbl { font-size: 7px; letter-spacing: .5px; }
          .b360-games-col { display: none; }
          .b360-parlays-col { display: none; }
          .b360-wordmark { font-size: 22px; }
          .b360-sub { font-size: 8px; letter-spacing: 2px; }
          #b360-topbar { padding: 0 14px; height: 44px; }
          #b360-toolbar { padding: 5px 14px; }
          .b360-ctrl-btn { padding: 0 10px; font-size: 11px; height: 32px; min-width: 44px; }
          .b360-controls { gap: 5px; }
          .b360-sport-btn { min-height: 36px; }
          /* Bigger tap targets in odds cells on mobile */
          main { padding: 14px 12px 100px !important; }
        }
        @media (max-width: 480px) {
          /* On the smallest phones, shrink stat values further but keep them
             visible since they now sit on their own dedicated toolbar row */
          .b360-stat-val { font-size: 13px; }
          .b360-stat { padding: 3px 6px; min-width: 38px; }
          .b360-controls { gap: 4px; }
          .b360-ctrl-btn { padding: 0 8px; font-size: 10px; }
        }
        @media (min-width: 801px) {
          .b360-games-col { display: block !important; }
          .b360-parlays-col { display: block !important; }
        }

        /* ── PWA STANDALONE MODE ── */
        /* When installed as a PWA, respect the device safe area (iOS notch / Android nav bar) */
        @supports (padding: max(0px)) {
          #b360-header { padding-top: env(safe-area-inset-top); }
          main { padding-bottom: max(70px, env(safe-area-inset-bottom)) !important; }
        }
        @media (display-mode: standalone) {
          /* Hide install prompt when already installed */
          #betz360-install { display: none !important; }
          /* Tighter top padding when running standalone */
          body { -webkit-tap-highlight-color: transparent; }
        }
        /* Better mobile touch behavior across the app */
        button, a { -webkit-tap-highlight-color: rgba(0,128,255,.15); touch-action: manipulation; }
        /* Disable pull-to-refresh on mobile (we have our own refresh button) */
        body { overscroll-behavior-y: contain; }
      `}</style>

      {/* ── HEADER ── */}
      <header id="b360-header">
        {/* First row: logo + sign in */}
        <div id="b360-topbar">
          {/* Logo */}
          <div className="b360-logo-wrap">
            <div className="b360-logo-icon">B3</div>
            <div>
              <div className="b360-wordmark">BETZ360</div>
              <div className="b360-sub">Prop Intelligence</div>
            </div>
          </div>

          {/* Auth */}
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            {user ? (
              <button
                className="b360-ctrl-btn"
                onClick={() => setTab('tracker')}
                title={`Logged in as @${username || 'user'}`}
                style={{ color: '#38bdf8', borderColor: 'rgba(14,165,233,.3)' }}
              >👤 @{username || 'me'}</button>
            ) : (
              <button
                className="b360-ctrl-btn"
                onClick={() => setAuthOpen(true)}
                style={{ color: '#38bdf8', borderColor: 'rgba(14,165,233,.3)' }}
              >Sign in</button>
            )}
          </div>
        </div>

        {/* Second row: sport rail */}
        <div id="b360-sportrail">
          <div className="b360-sport-inner">
            {SPORTS.map(sp => (
              <button
                key={sp.key}
                className={`b360-sport-btn${sport===sp.key?' active':''}`}
                onClick={() => changeSport(sp.key)}
              >{sp.emoji} {sp.label}</button>
            ))}
          </div>
        </div>

        {/* Third row: stats + controls */}
        <div id="b360-toolbar">
          {/* Live stats */}
          <div className="b360-stats">
            <div className="b360-stat">
              <span className="b360-stat-val" style={{color:'#38bdf8'}}>{propCount||'—'}</span>
              <span className="b360-stat-lbl">Props</span>
            </div>
            <div className="b360-stat">
              <span className="b360-stat-val" style={{color:'#818cf8'}}>{lineCount||'—'}</span>
              <span className="b360-stat-lbl">Lines</span>
            </div>
            <div className="b360-stat">
              <span className="b360-stat-val" style={{color:'#4ade80'}}>{games.length||'—'}</span>
              <span className="b360-stat-lbl">Games</span>
            </div>
          </div>

          {/* Controls */}
          <div className="b360-controls">
            {lastUpdated && (
              <>
                <div className="b360-live-dot"/>
                <span style={{fontSize:11,color:'#1a3060',fontWeight:600}}>{lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
              </>
            )}
            <button className="b360-ctrl-btn" onClick={refreshData}>↻ Refresh</button>
            <button
              className={`b360-ctrl-btn${aiOpen?' active':''}`}
              onClick={() => setAiOpen(v => !v)}
            >⚡ AI Analyze</button>
            <button
              className="b360-ctrl-btn"
              onClick={() => { if (permissionState !== 'granted') requestPermission(); }}
              title={permissionState === 'granted' ? `${notifItems.length} recent` : 'Click to enable notifications'}
              style={notifItems.length > 0 ? { color: '#fbbf24', borderColor: 'rgba(251,191,36,.3)' } : {}}
            >
              🔔 {notifItems.length > 0 && <span style={{ marginLeft: 4, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900 }}>{notifItems.length}</span>}
            </button>
          </div>
        </div>

        {/* Nav rail */}
        <div id="b360-navrail">
          <div className="b360-sport-inner">
            {((isAdmin ? (['games','parlays','cross','picks','tracker','board','admin'] as const) : (['games','parlays','cross','picks','tracker','board'] as const)) as readonly typeof tab[]).map(t => {
              const labels:{[k:string]:string} = {games:'🏟 Games',parlays:'⚡ Parlays',cross:'🌐 Multi-Sport',picks:'📊 House Picks',tracker:'📊 Tracker',board:'🏆 Leaderboard',admin:'🛡 Admin'};
              return (
                <button
                  key={t}
                  className={`b360-nav-btn${tab===t?' active':''}`}
                  onClick={() => setTab(t)}
                >
                  {labels[t]}
                  {t==='games'&&games.length>0&&<span className="b360-chip b360-chip-green">{games.length}</span>}
                  {t==='parlays'&&allProps.length>0&&<span className="b360-chip b360-chip-blue">{allProps.length}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* AI Drawer */}
        {aiOpen && (
          <div id="b360-aidrawer">
            <div className="b360-ai-inner">
              <div style={{display:'flex',gap:8}}>
                <input
                  className="b360-inp"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if(e.key==='Enter'&&input.trim()) runAnalyze(); }}
                  placeholder="Ask about a player, prop, or game…"
                  autoFocus
                />
                <button className="b360-go" onClick={runAnalyze} disabled={aiLoading||!input.trim()}>
                  {aiLoading ? '…' : 'Analyze'}
                </button>
                {messages.length > 0 && (
                  <button className="b360-ghost" style={{height:36}} onClick={() => { setMessages([]); setInput(''); }}>Clear</button>
                )}
              </div>
              {messages.length > 0 && (
                <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:5,maxHeight:150,overflowY:'auto'}}>
                  {messages.map((m,i) => (
                    <div key={i} className="b360-msg" style={{
                      background: m.role==='user' ? 'rgba(255,255,255,.03)' : 'rgba(0,128,255,.07)',
                      border: `1px solid ${m.role==='assistant' ? 'rgba(0,128,255,.2)' : 'rgba(255,255,255,.05)'}`,
                      borderLeft: m.role==='assistant' ? '3px solid #0080ff' : undefined,
                    }}>
                      <div style={{fontSize:9,color:'#1a3060',marginBottom:2,fontWeight:800,letterSpacing:1,textTransform:'uppercase'}}>{m.role==='user'?'You':'⚡ BETZ360 AI'}</div>
                      {m.content}
                    </div>
                  ))}
                  <div ref={bottomRef}/>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status bar */}
        {(propsLoading||propsError||dataError) && (
          <div style={{borderTop:'1px solid rgba(255,255,255,.03)',padding:'3px 20px',maxWidth:1500,margin:'0 auto',display:'flex',gap:12,fontSize:11,fontWeight:600}}>
            {propsLoading&&<span style={{color:'#fbbf24'}}>⏳ Loading props…</span>}
            {propsError&&<span style={{color:'#f87171'}}>⚠ {propsError}</span>}
            {dataError&&<span style={{color:'#f87171'}}>⚠ {dataError}</span>}
          </div>
        )}
      </header>

      {/* ── MAIN ── */}
      <main id="b360-main">

        {(tab==='games'||tab==='parlays') && (
          <div className={tab==='games' ? '' : 'b360-two-col'}>

            {/* Games column — full odds board */}
            <div style={{display: tab==='games'?'block':'none', gridColumn: '1 / -1'}}>
              {dataLoading ? (
                <div className="b360-empty"><div className="b360-empty-icon">⏳</div><div className="b360-empty-title">Loading games…</div></div>
              ) : (
                <OddsBoard sport={sport} games={games} onNavigateParlays={() => setTab('parlays')} />
              )}
            </div>

            {/* Parlays column */}
            <div className={`b360-parlays-col`} style={{display: tab==='parlays'?'block':'none',minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <div className="b360-subtabs">
                  <button className={`b360-subtab${propView==='parlay'?' active':''}`} onClick={() => setPropView('parlay')}>
                    ⚡ Parlay Builder {allProps.length>0&&<span className="b360-chip b360-chip-blue" style={{marginLeft:5}}>{allProps.length}</span>}
                  </button>
                  <button className={`b360-subtab${propView==='props'?' active':''}`} onClick={() => setPropView('props')}>
                    📋 Props {selectedGameId&&<span className="b360-chip b360-chip-green" style={{marginLeft:5}}>{props.length}</span>}
                  </button>
                </div>
                {selectedGameId && (
                  <button className="b360-ghost" onClick={() => { setSelectedGameId(null); setPropView('parlay'); }}>✕ Clear game</button>
                )}
              </div>
              {propView==='parlay' && <ParlayBuilder props={allProps} games={games} sport={sport}/>}
              {propView==='props' && (
                selectedGameId
                  ? <PropsList props={props} onAnalyzeProp={analyzeProp}/>
                  : <div className="b360-empty" style={{padding:'48px 20px'}}>
                      <div className="b360-empty-icon">🏟</div>
                      <div className="b360-empty-title">Select a game to view props</div>
                      <div className="b360-empty-sub">Switch to the Games tab and click any matchup</div>
                      <button className="b360-nav-btn active" style={{marginTop:14,display:'inline-flex',borderRadius:7,padding:'7px 16px',fontSize:13,fontWeight:700,fontFamily:"'Barlow',sans-serif",cursor:'pointer',color:'#f0f6ff',background:'rgba(14,165,233,.1)',border:'1px solid rgba(14,165,233,.25)'}} onClick={() => setTab('games')}>
                        View Games →
                      </button>
                    </div>
              )}
            </div>
          </div>
        )}

        {tab==='cross' && (
          <div>
            <div className="b360-slabel" style={{marginBottom:14}}>Multi-Sport Parlay & Pick 6</div>
            <CrossSportParlay/>
          </div>
        )}

        {tab==='tracker' && (
          <div>
            <div className="b360-slabel" style={{marginBottom:14}}>Bet Tracker</div>
            <BetTracker/>
          </div>
        )}

        {tab==='board' && (
          <div>
            <div className="b360-slabel" style={{marginBottom:14}}>Leaderboard — Top Sharp Bettors</div>
            <Leaderboard/>
          </div>
        )}

        {tab==='picks' && (
          <div>
            <div className="b360-slabel" style={{marginBottom:14}}>House Picks — Public Track Record</div>
            <HousePicks/>
          </div>
        )}

        {tab==='admin' && (
          <div>
            <div className="b360-slabel" style={{marginBottom:14}}>Admin — User Management</div>
            <AdminPanel/>
          </div>
        )}
      </main>

      {/* ── FOOTER ── */}
      <footer id="b360-footer">
        <div className="b360-footer-inner">
          <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
            {['MLB','NBA','NFL','CFB','NHL','WNBA','UFC'].map(s => (
              <span key={s} style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,color:'#0e2040',fontWeight:800,letterSpacing:.5}}>{s}</span>
            ))}
          </div>
          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:10,color:'#091525',fontWeight:700,letterSpacing:.5}}>
            BETZ360 © {new Date().getFullYear()} · Must be 21+ · Gamble Responsibly · Not financial advice
          </span>
        </div>
      </footer>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      <NotificationToaster />
      <InstallPrompt />
    </div>
  );
}

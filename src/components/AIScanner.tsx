import { useState } from 'react';

const C = {
  bg: '#050810', surface: '#0d1117', card: '#111827',
  border: '#1f2937', accent: '#3b82f6',
  green: '#10b981', red: '#ef4444', yellow: '#f59e0b',
  text: '#f1f5f9', muted: '#64748b', dim: '#374151',
};

interface Leg {
  playerName: string;
  propType: string;
  line: number;
  pick: 'over' | 'under';
  odds: number;
  homeTeam?: string;
  awayTeam?: string;
}

interface ScanResult {
  overall: string;
  score: number;
  tier: string;
  tierColor: string;
  legs: {
    player: string;
    prop: string;
    pick: string;
    risk: 'low' | 'medium' | 'high';
    reason: string;
    suggestion: string;
  }[];
  publicFade: string[];
  sharpSignals: string[];
  summary: string;
}

function fmt(odds: number) { return odds > 0 ? `+${odds}` : `${odds}`; }

export function AIScanner({ legs }: { legs: Leg[] }) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const scan = async () => {
    if (legs.length === 0) return;
    setLoading(true);
    setError('');
    setResult(null);

    const parlayDesc = legs.map((l, i) =>
      `Leg ${i + 1}: ${l.playerName} ${l.pick.toUpperCase()} ${l.line} ${l.propType} (${fmt(l.odds)}) — ${l.awayTeam || ''} @ ${l.homeTeam || ''}`
    ).join('\n');

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: `You are an expert sports betting analyst specializing in parlay analysis. Analyze parlays and return ONLY valid JSON with no markdown or backticks. Be direct and specific.`,
          messages: [{
            role: 'user',
            content: `Analyze this ${legs.length}-leg parlay and return a JSON object with exactly this structure:
{
  "overall": "one sentence overall assessment",
  "score": <number 0-100 overall confidence>,
  "tier": "S-TIER" | "A-TIER" | "B-TIER" | "C-TIER",
  "legs": [
    {
      "player": "<player name>",
      "prop": "<prop type and line>",
      "pick": "<over/under>",
      "risk": "low" | "medium" | "high",
      "reason": "<why this leg is risky or solid in one sentence>",
      "suggestion": "<specific actionable swap or confirmation>"
    }
  ],
  "publicFade": ["<any legs where 70%+ public is on same side — fade opportunity>"],
  "sharpSignals": ["<any sharp money indicators or line movement signals>"],
  "summary": "<2 sentence actionable summary>"
}

Parlay to analyze:
${parlayDesc}

Consider: line value, correlated risk, injury news, matchup context, historical trends for these prop types.`
          }]
        })
      });

      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed: ScanResult = JSON.parse(clean);
      parsed.tierColor = parsed.tier === 'S-TIER' ? C.green : parsed.tier === 'A-TIER' ? '#fbbf24' : parsed.tier === 'B-TIER' ? C.accent : C.muted;
      setResult(parsed);
    } catch (e) {
      setError('Scan failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const riskColor = (r: string) => r === 'low' ? C.green : r === 'medium' ? C.yellow : C.red;
  const riskIcon = (r: string) => r === 'low' ? '✅' : r === 'medium' ? '⚠️' : '🚨';

  return (
    <div style={{ marginTop: '16px' }}>
      <button onClick={scan} disabled={loading || legs.length === 0} style={{
        width: '100%', padding: '12px',
        background: loading ? C.surface : `linear-gradient(135deg, ${C.accent}, #6366f1)`,
        color: loading ? C.muted : 'white',
        border: `1px solid ${loading ? C.border : C.accent}`,
        borderRadius: '8px', cursor: loading || legs.length === 0 ? 'not-allowed' : 'pointer',
        fontSize: '14px', fontWeight: '700',
        boxShadow: loading ? 'none' : '0 0 20px rgba(59,130,246,0.3)',
      }}>
        {loading ? '🔍 Scanning parlay...' : legs.length === 0 ? 'Add legs to scan' : `🤖 AI Scan ${legs.length}-Leg Parlay`}
      </button>

      {error && <div style={{ color: C.red, fontSize: '12px', marginTop: '8px', textAlign: 'center' }}>{error}</div>}

      {result && (
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

          {/* Overall score */}
          <div style={{ background: C.card, border: `1px solid ${result.tierColor}40`, borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontSize: '13px', color: C.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>AI Analysis</div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div style={{ fontSize: '22px', fontWeight: '800', color: result.tierColor }}>{result.score}%</div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: result.tierColor, background: result.tierColor + '20', padding: '3px 8px', borderRadius: '4px' }}>{result.tier}</div>
              </div>
            </div>
            <div style={{ fontSize: '13px', color: C.text, lineHeight: '1.5' }}>{result.overall}</div>
            <div style={{ marginTop: '8px', background: C.dim, borderRadius: '4px', height: '4px' }}>
              <div style={{ width: `${result.score}%`, background: result.tierColor, height: '4px', borderRadius: '4px' }} />
            </div>
          </div>

          {/* Leg by leg breakdown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {result.legs.map((leg, i) => (
              <div key={i} style={{ background: C.card, border: `1px solid ${riskColor(leg.risk)}30`, borderLeft: `3px solid ${riskColor(leg.risk)}`, borderRadius: '8px', padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: C.text }}>{riskIcon(leg.risk)} {leg.player} — {leg.pick.toUpperCase()} {leg.prop}</div>
                    <div style={{ fontSize: '12px', color: C.muted, marginTop: '3px' }}>{leg.reason}</div>
                    {leg.suggestion && (
                      <div style={{ fontSize: '12px', color: C.accent, marginTop: '4px', fontStyle: 'italic' }}>💡 {leg.suggestion}</div>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: riskColor(leg.risk), textTransform: 'uppercase', flexShrink: 0 }}>{leg.risk}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Public fade signals */}
          {result.publicFade?.length > 0 && (
            <div style={{ background: C.card, border: `1px solid ${C.yellow}40`, borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: C.yellow, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>📊 Fade the Public</div>
              {result.publicFade.map((s, i) => <div key={i} style={{ fontSize: '12px', color: C.text, marginBottom: '4px' }}>• {s}</div>)}
            </div>
          )}

          {/* Sharp signals */}
          {result.sharpSignals?.length > 0 && (
            <div style={{ background: C.card, border: `1px solid ${C.green}40`, borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: C.green, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>💰 Sharp Signals</div>
              {result.sharpSignals.map((s, i) => <div key={i} style={{ fontSize: '12px', color: C.text, marginBottom: '4px' }}>• {s}</div>)}
            </div>
          )}

          {/* Summary */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px', fontSize: '13px', color: C.text, lineHeight: '1.6' }}>
            {result.summary}
          </div>
        </div>
      )}
    </div>
  );
}

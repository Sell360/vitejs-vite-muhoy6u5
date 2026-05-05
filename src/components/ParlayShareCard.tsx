import { useState, useRef } from 'react';

interface ShareLeg {
  label: string;
  matchup: string;
  betType: string;
  odds: number;
  sport: string;
}

interface ParlayShareCardProps {
  legs: ShareLeg[];
  combinedOdds: number;
  stake?: number;
  payout?: number;
  confidence?: number;
}

function fmt(odds: number) {
  if (!odds) return '';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function americanToDecimal(odds: number) {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}

const SPORT_EMOJI: Record<string, string> = {
  mlb: '⚾', nba: '🏀', nfl: '🏈', ncaaf: '🎓', nhl: '🏒', wnba: '🏀', ufc: '🥊',
};

export function ParlayShareCard({ legs, combinedOdds, stake = 25, payout, confidence }: ParlayShareCardProps) {
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const actualPayout = payout || (stake * americanToDecimal(combinedOdds));
  const profit = actualPayout - stake;

  const generateAndCopy = async () => {
    if (generating || legs.length === 0) return;
    setGenerating(true);

    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = 800;
    const H = 180 + legs.length * 64 + 120;
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#07101f');
    bg.addColorStop(1, '#040810');
    ctx.fillStyle = bg;
    ctx.roundRect(0, 0, W, H, 16);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(14,165,233,.35)';
    ctx.lineWidth = 1.5;
    ctx.roundRect(1, 1, W - 2, H - 2, 16);
    ctx.stroke();

    // Top accent line
    const accentGrad = ctx.createLinearGradient(0, 0, W, 0);
    accentGrad.addColorStop(0, '#0ea5e9');
    accentGrad.addColorStop(0.5, '#818cf8');
    accentGrad.addColorStop(1, '#0ea5e9');
    ctx.fillStyle = accentGrad;
    ctx.fillRect(0, 0, W, 3);

    // Header: BETZ360 logo text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px "Barlow Condensed", "Impact", sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillText('BETZ', 30, 52);
    ctx.fillStyle = '#0ea5e9';
    ctx.fillText('360', 30 + ctx.measureText('BETZ').width + 2, 52);

    // Sub label
    ctx.fillStyle = '#1a3060';
    ctx.font = '700 10px "Barlow", sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillText('PROP INTELLIGENCE', 30, 70);

    // Parlay badge
    const badgeText = `${legs.length}-LEG PARLAY`;
    ctx.fillStyle = 'rgba(14,165,233,.15)';
    const bW = 140, bH = 28, bX = W - 170, bY = 32;
    ctx.roundRect(bX, bY, bW, bH, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(14,165,233,.3)';
    ctx.lineWidth = 1;
    ctx.roundRect(bX, bY, bW, bH, 6);
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 12px "Barlow Condensed", sans-serif';
    ctx.letterSpacing = '1px';
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, bX + bW / 2, bY + 19);
    ctx.textAlign = 'left';

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, 90);
    ctx.lineTo(W - 30, 90);
    ctx.stroke();

    // Legs
    let y = 115;
    for (const leg of legs) {
      const emoji = SPORT_EMOJI[leg.sport] || '🏆';

      // Leg bg pill
      ctx.fillStyle = 'rgba(255,255,255,.025)';
      ctx.roundRect(24, y - 14, W - 48, 52, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.06)';
      ctx.lineWidth = 1;
      ctx.roundRect(24, y - 14, W - 48, 52, 8);
      ctx.stroke();

      // Sport emoji + matchup
      ctx.fillStyle = '#2a4060';
      ctx.font = '600 11px "Barlow", sans-serif';
      ctx.letterSpacing = '0px';
      ctx.fillText(`${emoji} ${leg.matchup}`, 42, y + 4);

      // Label (pick)
      ctx.fillStyle = '#c8ddf0';
      ctx.font = 'bold 15px "Barlow Condensed", sans-serif';
      ctx.fillText(leg.label, 42, y + 22);

      // Bet type badge
      ctx.fillStyle = 'rgba(129,140,248,.12)';
      const btW = 70, btH = 18;
      ctx.roundRect(42 + ctx.measureText(leg.label).width + 8, y + 8, btW, btH, 4);
      ctx.fill();
      ctx.fillStyle = '#818cf8';
      ctx.font = 'bold 9px "Barlow Condensed", sans-serif';
      ctx.letterSpacing = '0.5px';
      ctx.fillText(leg.betType.toUpperCase(), 42 + ctx.measureText(leg.label).width + 16, y + 21);
      ctx.letterSpacing = '0px';

      // Odds right-aligned
      const oddsText = fmt(leg.odds);
      ctx.font = 'bold 20px "Barlow Condensed", sans-serif';
      ctx.fillStyle = leg.odds > 0 ? '#4ade80' : '#c8ddf0';
      ctx.textAlign = 'right';
      ctx.fillText(oddsText, W - 42, y + 22);
      ctx.textAlign = 'left';

      y += 64;
    }

    // Bottom stats row
    const statsY = H - 90;
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, statsY);
    ctx.lineTo(W - 30, statsY);
    ctx.stroke();

    const stats = [
      { label: 'COMBINED ODDS', value: fmt(combinedOdds), color: '#38bdf8' },
      { label: `$${stake} WINS`, value: `$${actualPayout.toFixed(0)}`, color: '#4ade80' },
      { label: 'PROFIT', value: `+$${profit.toFixed(0)}`, color: '#4ade80' },
      ...(confidence ? [{ label: 'CONFIDENCE', value: `${confidence}%`, color: confidence >= 70 ? '#4ade80' : '#fbbf24' }] : []),
    ];

    const colW = (W - 60) / stats.length;
    stats.forEach((s, i) => {
      const cx = 30 + i * colW + colW / 2;
      ctx.fillStyle = '#1a3060';
      ctx.font = '700 9px "Barlow", sans-serif';
      ctx.letterSpacing = '1px';
      ctx.textAlign = 'center';
      ctx.fillText(s.label, cx, statsY + 22);
      ctx.fillStyle = s.color;
      ctx.font = 'bold 22px "Barlow Condensed", sans-serif';
      ctx.letterSpacing = '0px';
      ctx.fillText(s.value, cx, statsY + 48);
    });
    ctx.textAlign = 'left';

    // Watermark
    ctx.fillStyle = 'rgba(14,165,233,.15)';
    ctx.font = '600 10px "Barlow Condensed", sans-serif';
    ctx.letterSpacing = '1px';
    ctx.textAlign = 'right';
    ctx.fillText('betz360.com', W - 30, H - 18);
    ctx.textAlign = 'left';
    ctx.letterSpacing = '0px';

    // Copy to clipboard
    try {
      canvas.toBlob(async blob => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
          // Fallback: download
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'betz360-parlay.png'; a.click();
          URL.revokeObjectURL(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        }
        setGenerating(false);
      }, 'image/png');
    } catch {
      setGenerating(false);
    }
  };

  if (legs.length === 0) return null;

  return (
    <div>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <button
        onClick={generateAndCopy}
        disabled={generating}
        style={{
          width: '100%', padding: '8px',
          background: copied ? 'rgba(74,222,128,.1)' : 'rgba(255,255,255,.04)',
          color: copied ? '#4ade80' : '#4a6080',
          border: `1px solid ${copied ? 'rgba(74,222,128,.25)' : 'rgba(255,255,255,.08)'}`,
          borderRadius: 7, cursor: generating ? 'wait' : 'pointer',
          fontSize: 12, fontWeight: 700,
          fontFamily: "'Barlow', sans-serif",
          transition: 'all .2s', letterSpacing: .3,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        {copied ? '✓ Copied to clipboard!' : generating ? '⏳ Generating…' : '📸 Share Parlay Card'}
      </button>
    </div>
  );
}

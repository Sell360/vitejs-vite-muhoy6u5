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
  mlb: '⚾', nba: '🏀', nfl: '🏈', ncaaf: '🎓', nhl: '🏒', wnba: '🏀', ufc: '🥊', soccer: '⚽',
};

// Load image as Promise so we can await it before drawing canvas
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

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
    if (!canvas) { setGenerating(false); return; }

    // Larger card: 1080x1350 portrait so it dominates feeds + reads on mobile
    const W = 1080;
    const headerH = 220;
    const legBlockH = 110;
    const statsH = 240;
    const footerH = 80;
    const H = headerH + legs.length * legBlockH + statsH + footerH;
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    if (!ctx) { setGenerating(false); return; }

    // Try to load logo (won't block rendering if it fails)
    const logo = await loadImage('/betz360-icon-small.webp');

    // Background — radial deep purple → near-black
    const bgGrad = ctx.createRadialGradient(W * 0.65, H * 0.25, 100, W / 2, H / 2, Math.max(W, H) * 0.7);
    bgGrad.addColorStop(0, '#1a0d3d');
    bgGrad.addColorStop(0.5, '#0a1230');
    bgGrad.addColorStop(1, '#040810');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle grid pattern overlay
    ctx.strokeStyle = 'rgba(26,48,96,0.25)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 60) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Glow accent top-right
    const glowR = ctx.createRadialGradient(W * 0.85, 200, 50, W * 0.85, 200, 400);
    glowR.addColorStop(0, 'rgba(168,85,247,0.25)');
    glowR.addColorStop(1, 'rgba(168,85,247,0)');
    ctx.fillStyle = glowR;
    ctx.fillRect(0, 0, W, 500);

    // Glow accent bottom-left
    const glowL = ctx.createRadialGradient(180, H - 200, 50, 180, H - 200, 350);
    glowL.addColorStop(0, 'rgba(34,211,238,0.20)');
    glowL.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.fillStyle = glowL;
    ctx.fillRect(0, H - 500, 500, 500);

    // Brand-gradient helper (cyan → purple → pink, matching site)
    const brandGrad = ctx.createLinearGradient(0, 0, W, 0);
    brandGrad.addColorStop(0, '#22d3ee');
    brandGrad.addColorStop(0.5, '#c084fc');
    brandGrad.addColorStop(1, '#f472b6');

    // ─── HEADER: logo + wordmark + parlay badge ─────────────────────────
    if (logo) {
      ctx.save();
      ctx.shadowColor = 'rgba(168,85,247,0.6)';
      ctx.shadowBlur = 30;
      ctx.drawImage(logo, 50, 50, 110, 110);
      ctx.restore();
    }

    // Wordmark
    ctx.fillStyle = brandGrad;
    ctx.font = '900 78px "Permanent Marker", "Impact", sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Betz360', logo ? 180 : 50, 130);

    // Subtitle
    ctx.fillStyle = '#c084fc';
    ctx.font = '800 16px "Barlow", sans-serif';
    ctx.fillText('PROP INTELLIGENCE', logo ? 184 : 54, 162);

    // Parlay badge — top right
    const badgeText = `${legs.length}-LEG PARLAY`;
    ctx.font = '900 20px "Barlow Condensed", sans-serif';
    const badgeMetrics = ctx.measureText(badgeText);
    const bW = badgeMetrics.width + 40;
    const bH = 50;
    const bX = W - bW - 50;
    const bY = 75;
    ctx.fillStyle = 'rgba(34,211,238,0.18)';
    ctx.beginPath();
    ctx.roundRect(bX, bY, bW, bH, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(34,211,238,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bX, bY, bW, bH, 10);
    ctx.stroke();
    ctx.fillStyle = '#22d3ee';
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, bX + bW / 2, bY + 33);
    ctx.textAlign = 'left';

    // Divider under header
    ctx.strokeStyle = 'rgba(192,132,252,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(50, headerH - 20);
    ctx.lineTo(W - 50, headerH - 20);
    ctx.stroke();

    // ─── LEGS ────────────────────────────────────────────────────────────
    let y = headerH;
    for (const leg of legs) {
      const emoji = SPORT_EMOJI[leg.sport] || '🏆';

      // Leg card background
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.roundRect(40, y + 10, W - 80, legBlockH - 20, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(34,211,238,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(40, y + 10, W - 80, legBlockH - 20, 14);
      ctx.stroke();

      // Sport emoji + matchup
      ctx.fillStyle = '#8ab0cc';
      ctx.font = '700 22px "Barlow", sans-serif';
      ctx.fillText(`${emoji} ${leg.matchup}`, 70, y + 50);

      // Pick label (large)
      ctx.fillStyle = '#c8ddf0';
      ctx.font = '800 32px "Barlow Condensed", sans-serif';
      ctx.fillText(leg.label, 70, y + 88);

      // Bet type badge
      const btText = leg.betType.toUpperCase();
      ctx.font = '900 14px "Barlow Condensed", sans-serif';
      const btM = ctx.measureText(btText);
      const btW = btM.width + 18;
      const btH = 28;
      const btX = 70 + ctx.measureText(leg.label).width + 16;
      const btY = y + 64;
      ctx.fillStyle = 'rgba(192,132,252,0.18)';
      ctx.beginPath();
      ctx.roundRect(btX, btY, btW, btH, 6);
      ctx.fill();
      ctx.fillStyle = '#c084fc';
      ctx.textAlign = 'center';
      ctx.fillText(btText, btX + btW / 2, btY + 19);
      ctx.textAlign = 'left';

      // Odds right-aligned
      const oddsText = fmt(leg.odds);
      ctx.font = '900 44px "Barlow Condensed", sans-serif';
      ctx.fillStyle = leg.odds > 0 ? '#4ade80' : '#c8ddf0';
      ctx.textAlign = 'right';
      ctx.fillText(oddsText, W - 70, y + 78);
      ctx.textAlign = 'left';

      y += legBlockH;
    }

    // ─── BOTTOM STATS BLOCK ──────────────────────────────────────────────
    const statsY = y + 30;
    // Stats container
    ctx.fillStyle = 'rgba(34,211,238,0.05)';
    ctx.beginPath();
    ctx.roundRect(40, statsY, W - 80, 180, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(34,211,238,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(40, statsY, W - 80, 180, 16);
    ctx.stroke();

    const stats = [
      { label: 'COMBINED ODDS', value: fmt(combinedOdds), color: '#22d3ee' },
      { label: `$${stake} WINS`, value: `$${actualPayout.toFixed(0)}`, color: '#4ade80' },
      { label: 'PROFIT', value: `+$${profit.toFixed(0)}`, color: '#4ade80' },
      ...(confidence ? [{ label: 'CONFIDENCE', value: `${confidence}%`, color: confidence >= 70 ? '#4ade80' : '#fbbf24' }] : []),
    ];

    const colW = (W - 80) / stats.length;
    stats.forEach((s, i) => {
      const cx = 40 + i * colW + colW / 2;
      ctx.fillStyle = '#8ab0cc';
      ctx.font = '900 16px "Barlow", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.label, cx, statsY + 60);
      ctx.fillStyle = s.color;
      ctx.font = '900 56px "Barlow Condensed", sans-serif';
      ctx.fillText(s.value, cx, statsY + 130);
    });
    ctx.textAlign = 'left';

    // ─── FOOTER WATERMARK ───────────────────────────────────────────────
    ctx.fillStyle = brandGrad;
    ctx.font = '900 38px "Permanent Marker", "Impact", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BETZ360.COM', W / 2, H - 30);
    ctx.textAlign = 'left';

    // Copy to clipboard or download
    try {
      canvas.toBlob(async blob => {
        if (!blob) { setGenerating(false); return; }
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
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
          width: '100%', padding: '10px',
          background: copied ? 'rgba(74,222,128,0.12)' : 'linear-gradient(135deg, rgba(34,211,238,0.1), rgba(192,132,252,0.08))',
          color: copied ? '#4ade80' : '#22d3ee',
          border: `1px solid ${copied ? 'rgba(74,222,128,0.3)' : 'rgba(34,211,238,0.3)'}`,
          borderRadius: 8, cursor: generating ? 'wait' : 'pointer',
          fontSize: 13, fontWeight: 800,
          fontFamily: "'Barlow', sans-serif",
          letterSpacing: 0.5,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        {copied ? '✓ Copied to clipboard!' : generating ? '⏳ Generating…' : '📸 Share Parlay Card'}
      </button>
    </div>
  );
}

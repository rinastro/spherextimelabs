// Small canvas scatter plot used for spectra and light curves.

function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

function ticks(min, max, count) {
  if (!(max > min)) return [min];
  const step = niceStep(max - min, count);
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

export function scatterPlot(canvas, opts) {
  const { series = [], xLabel = '', yLabel = '', xFormat = v => String(v), yFormat, xRange, empty = 'No data' } = opts;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600;
  const H = canvas.clientHeight || 280;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim() || '#161616';
  const muted = css.getPropertyValue('--muted').trim() || '#555';
  const grid = 'rgba(0,0,0,0.08)';
  ctx.font = '12px Montserrat, system-ui, sans-serif';

  const pts = series.flatMap(s => s.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  if (!pts.length) {
    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    ctx.fillText(empty, W / 2, H / 2);
    return;
  }

  let [x0, x1] = xRange || [Math.min(...pts.map(p => p.x)), Math.max(...pts.map(p => p.x))];
  let y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
  if (x1 === x0) { x0 -= 1; x1 += 1; }
  if (y1 === y0) { y0 -= 1; y1 += 1; }
  const yPad = (y1 - y0) * 0.08; y0 -= yPad; y1 += yPad;
  if (!xRange) { const xPad = (x1 - x0) * 0.04; x0 -= xPad; x1 += xPad; }

  const m = { l: 70, r: 14, t: 14, b: 44 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const sx = v => m.l + ((v - x0) / (x1 - x0)) * pw;
  const sy = v => m.t + ph - ((v - y0) / (y1 - y0)) * ph;

  ctx.strokeStyle = grid;
  ctx.fillStyle = muted;
  ctx.lineWidth = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of ticks(x0, x1, Math.max(3, Math.floor(pw / 90)))) {
    const x = sx(t);
    ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
    ctx.fillText(xFormat(t), x, m.t + ph + 6);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const yf = yFormat || (v => (Math.abs(v) >= 1e5 || (Math.abs(v) < 0.001 && v !== 0) ? v.toExponential(1) : +v.toPrecision(3)));
  for (const t of ticks(y0, y1, Math.max(3, Math.floor(ph / 50)))) {
    const y = sy(t);
    ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
    ctx.fillText(yf(t), m.l - 8, y);
  }

  ctx.strokeStyle = ink;
  ctx.beginPath();
  ctx.moveTo(m.l, m.t); ctx.lineTo(m.l, m.t + ph); ctx.lineTo(m.l + pw, m.t + ph);
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(xLabel, m.l + pw / 2, H - 4);
  ctx.save();
  ctx.translate(14, m.t + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'middle';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  for (const s of series) {
    for (const p of s.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const x = sx(p.x), y = sy(p.y);
      if (Number.isFinite(p.err) && p.err > 0) {
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(x, sy(p.y - p.err)); ctx.lineTo(x, sy(p.y + p.err)); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(x, y, p.hollow ? 3.2 : 3.6, 0, Math.PI * 2);
      if (p.hollow) {
        ctx.strokeStyle = s.color; ctx.lineWidth = 1.4; ctx.stroke();
      } else {
        ctx.fillStyle = s.color; ctx.fill();
      }
      if (p.highlight) {
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
  }
  ctx.lineWidth = 1;
}

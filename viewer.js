import { CONFIG, proxied } from './config.js';
import { fetchFitsHDUs } from './fits.js';
import { CelestialWCS, tanProject, tanDeproject, wavelengthAt } from './wcs.js';
import {
  TARGETS, targetPosition, parseRA, parseDec, formatRA, formatDec,
  resolveName, propagate, mjdToYear, formatDate
} from './sky.js';
import { scatterPlot } from './plot.js';

const $ = sel => document.querySelector(sel);
const DISPLAY = 640;

const el = {
  form: $('#search-form'),
  name: $('#target-name'),
  resolve: $('#resolve-btn'),
  ra: $('#ra'),
  dec: $('#dec'),
  fov: $('#fov'),
  max: $('#max-images'),
  coll: $('#collection'),
  precise: $('#precise'),
  presets: $('#presets'),
  status: $('#status'),
  progress: $('#progress'),
  progressBar: $('#progress span'),
  stage: $('#stage'),
  canvas: $('#sky'),
  empty: $('#stage-empty'),
  frameLabel: $('#frame-label'),
  frameSub: $('#frame-sub'),
  play: $('#play'),
  prev: $('#prev'),
  next: $('#next'),
  slider: $('#frame-slider'),
  fps: $('#fps'),
  mode: $('#mode'),
  det: $('#detector'),
  diff: $('#difference'),
  stretch: $('#stretch'),
  clip: $('#clip'),
  cmap: $('#colormap'),
  ovCross: $('#ov-cross'),
  ovGaia: $('#ov-gaia'),
  ovFlags: $('#ov-flags'),
  ovCompass: $('#ov-compass'),
  readout: $('#readout'),
  copyLink: $('#copy-link'),
  embedBtn: $('#copy-embed'),
  savePng: $('#save-png'),
  chartTabs: document.querySelectorAll('[data-chart]'),
  chartCanvas: $('#chart'),
  chartNote: $('#chart-note'),
  meta: $('#meta-body'),
  metaWrap: $('#meta-panel'),
  chartWrap: $('#chart-panel'),
  irsaLink: $('#irsa-link'),
  aladinBox: $('#aladin-lite'),
  aladinSurvey: $('#aladin-survey'),
  aladinGaia: $('#aladin-gaia'),
  aladinWise: $('#aladin-wise')
};

const state = {
  center: null,
  fov: CONFIG.defaultFovArcmin,
  grid: null,
  frames: [],
  views: [],
  idx: 0,
  timer: null,
  abort: null,
  gaia: [],
  probe: null,
  chart: 'spectrum',
  collectionUsed: null,
  aladin: null,
  aladinCats: []
};

const off = document.createElement('canvas');
const offCtx = off.getContext('2d');
const ctx = el.canvas.getContext('2d');
el.canvas.width = DISPLAY;
el.canvas.height = DISPLAY;

/* ---------- setup ---------- */

function init() {
  for (const c of CONFIG.collections) el.coll.add(new Option(c.label, c.id));
  for (const s of CONFIG.aladinSurveys) el.aladinSurvey?.add(new Option(s.label, s.id));
  el.fov.value = String(CONFIG.defaultFovArcmin);
  el.max.value = String(CONFIG.defaultMaxImages);

  for (const [key, t] of Object.entries(TARGETS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = t.name;
    b.addEventListener('click', () => applyTarget(key, true));
    el.presets.appendChild(b);
  }

  el.form.addEventListener('submit', e => { e.preventDefault(); run(); });
  el.resolve.addEventListener('click', onResolve);
  el.name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onResolve(); } });

  el.play.addEventListener('click', togglePlay);
  el.prev.addEventListener('click', () => step(-1));
  el.next.addEventListener('click', () => step(1));
  el.slider.addEventListener('input', () => { state.idx = Number(el.slider.value); render(); });
  el.fps.addEventListener('input', () => { if (state.timer) { stopPlay(); startPlay(); } });

  for (const c of [el.mode, el.det, el.diff]) c.addEventListener('change', () => { buildViews(); render(); updateCharts(); updateUrl(); });
  for (const c of [el.stretch, el.clip, el.cmap]) c.addEventListener('change', () => { state.views.forEach(v => { v.lim = null; }); render(); });
  for (const c of [el.ovCross, el.ovGaia, el.ovFlags, el.ovCompass]) c.addEventListener('change', render);

  el.canvas.addEventListener('mousemove', onHover);
  el.canvas.addEventListener('mouseleave', () => { el.readout.textContent = 'Hover over the image to read coordinates.'; });
  el.canvas.addEventListener('click', onProbe);

  el.chartTabs.forEach(b => b.addEventListener('click', () => {
    state.chart = b.dataset.chart;
    el.chartTabs.forEach(x => x.classList.toggle('active', x === b));
    const isTable = state.chart === 'table';
    el.chartWrap.hidden = isTable;
    el.metaWrap.hidden = !isTable;
    updateCharts();
  }));

  el.copyLink.addEventListener('click', () => copyText(shareUrl(false), el.copyLink, 'Link copied'));
  el.embedBtn.addEventListener('click', () => {
    const code = `<iframe src="${shareUrl(true)}" width="720" height="820" style="border:0" loading="lazy" title="SPHEREx sky viewer"></iframe>`;
    copyText(code, el.embedBtn, 'Embed code copied');
  });
  el.savePng.addEventListener('click', savePng);

  document.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  window.addEventListener('resize', () => updateCharts());

  initAladin();
  readUrl();
}

function applyTarget(key, autorun) {
  const t = TARGETS[key];
  if (!t) return;
  const p = targetPosition(t);
  el.name.value = t.name;
  el.ra.value = p.ra.toFixed(6);
  el.dec.value = p.dec.toFixed(6);
  el.fov.value = String(t.fov);
  el.mode.value = t.mode;
  el.diff.value = t.diff;
  el.det.value = t.det;
  const moved = t.epoch && (t.pmra || t.pmdec);
  setStatus(moved
    ? `${t.name}: position corrected for proper motion to ${CONFIG.referenceEpoch.toFixed(1)}.`
    : `${t.name} loaded.`);
  if (autorun) run();
}

async function onResolve() {
  const name = el.name.value.trim();
  if (!name) { setStatus('Type an object name first, e.g. “Barnard’s Star” or “M 101”.', 'warn'); return; }
  const preset = Object.entries(TARGETS).find(([, t]) => t.name.toLowerCase() === name.toLowerCase());
  if (preset) { applyTarget(preset[0], false); return; }
  setStatus(`Looking up “${name}”…`);
  try {
    const r = await resolveName(name);
    let pos = { ra: r.ra, dec: r.dec };
    if (r.pmra || r.pmdec) pos = propagate(r.ra, r.dec, r.pmra, r.pmdec, 2000.0, CONFIG.referenceEpoch);
    el.ra.value = pos.ra.toFixed(6);
    el.dec.value = pos.dec.toFixed(6);
    const pmNote = (r.pmra || r.pmdec) ? ` Proper motion applied (${Math.hypot(r.pmra, r.pmdec).toFixed(0)} mas/yr).` : '';
    setStatus(`Found “${name}” at ${formatRA(pos.ra)} ${formatDec(pos.dec)}.${pmNote} Press “Load images”.`, 'ok');
  } catch (err) {
    setStatus(`Name lookup failed: ${err.message}. You can still type coordinates.`, 'error');
  }
}

/* ---------- URL state ---------- */

function readUrl() {
  const q = new URLSearchParams(location.search);
  if (q.get('embed') === '1') document.body.classList.add('embed');
  const set = (k, input) => { if (q.has(k) && input) input.value = q.get(k); };
  if (q.has('target') && TARGETS[q.get('target')]) applyTarget(q.get('target'), false);
  set('ra', el.ra); set('dec', el.dec); set('fov', el.fov); set('max', el.max);
  set('mode', el.mode); set('det', el.det); set('diff', el.diff);
  set('stretch', el.stretch); set('cmap', el.cmap); set('fps', el.fps);
  if (q.has('coll')) {
    const id = q.get('coll');
    if (![...el.coll.options].some(o => o.value === id)) el.coll.add(new Option(id, id));
    el.coll.value = id;
  }
  if (q.get('precise') === '1') el.precise.checked = true;
  if (q.has('name')) el.name.value = q.get('name');
  if ((q.has('ra') && q.has('dec')) || q.has('target')) run();
}

function currentParams(embed) {
  const q = new URLSearchParams();
  if (!state.center) return q;
  q.set('ra', state.center.ra.toFixed(6));
  q.set('dec', state.center.dec.toFixed(6));
  q.set('fov', el.fov.value);
  q.set('mode', el.mode.value);
  if (el.det.value !== 'all') q.set('det', el.det.value);
  if (el.diff.value !== 'none') q.set('diff', el.diff.value);
  if (el.max.value !== String(CONFIG.defaultMaxImages)) q.set('max', el.max.value);
  if (el.coll.value !== CONFIG.collections[0].id) q.set('coll', el.coll.value);
  if (el.precise.checked) q.set('precise', '1');
  if (el.name.value.trim()) q.set('name', el.name.value.trim());
  if (embed) q.set('embed', '1');
  return q;
}

function shareUrl(embed) {
  return `${location.origin}${location.pathname}?${currentParams(embed).toString()}`;
}

function updateUrl() {
  if (!state.center) return;
  const q = currentParams(document.body.classList.contains('embed'));
  history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
}

/* ---------- archive search ---------- */

async function querySIA(ra, dec, collection, signal) {
  const url = `${CONFIG.siaEndpoint}?COLLECTION=${encodeURIComponent(collection)}&POS=CIRCLE+${ra.toFixed(6)}+${dec.toFixed(6)}+0.0003&RESPONSEFORMAT=votable`;
  const res = await fetch(proxied(url), { signal });
  if (!res.ok) throw new Error(`Archive search returned HTTP ${res.status}`);
  const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
  const info = [...xml.getElementsByTagName('INFO')].find(i => i.getAttribute('name') === 'QUERY_STATUS');
  if (info && info.getAttribute('value') === 'ERROR') throw new Error(info.textContent.trim() || 'Archive query error');
  const fields = [...xml.getElementsByTagName('FIELD')].map(f => f.getAttribute('name'));
  const rows = [...xml.getElementsByTagName('TR')].map(tr => {
    const tds = tr.getElementsByTagName('TD');
    const o = {};
    fields.forEach((f, i) => { o[f] = tds[i] ? tds[i].textContent.trim() : ''; });
    return o;
  });
  const seen = new Set();
  return rows.filter(r => {
    const u = r.access_url;
    if (!u || seen.has(u) || !/\.fits(\?|$)/i.test(u)) return false;
    seen.add(u);
    return true;
  }).map(toRecord);
}

function toUm(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return n < 1e-3 ? n * 1e6 : n;
}

function toRecord(r) {
  let det = Number((r.energy_bandpassname || '').match(/D(\d)/)?.[1]);
  if (!det) det = Number((r.access_url.match(/_\dD(\d)_/) || [])[1]) || 0;
  const band = CONFIG.detectors.find(d => d.id === det);
  let wlMin = toUm(r.em_min), wlMax = toUm(r.em_max);
  if (!Number.isFinite(wlMin) && band) [wlMin, wlMax] = band.range;
  return {
    url: r.access_url,
    mjd: Number(r.t_min) || Number(r.t_max) || NaN,
    det,
    wlMin, wlMax,
    obsId: r.obs_id || r.access_url.split('/').pop().replace(/\.fits.*$/, ''),
    band: r.energy_bandpassname || (det ? `SPHEREx-D${det}` : '')
  };
}

async function search(ra, dec, signal) {
  const first = el.coll.value;
  const order = [first, ...CONFIG.collections.map(c => c.id).filter(id => id !== first)];
  let lastErr = null;
  for (const coll of order) {
    try {
      const rows = await querySIA(ra, dec, coll, signal);
      if (rows.length) return { rows, coll };
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return { rows: [], coll: first };
}

function cutoutUrl(url, ra, dec, sizeDeg) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}center=${ra.toFixed(6)},${dec.toFixed(6)}&size=${sizeDeg.toFixed(4)}`;
}

function sampleEvenly(list, max) {
  if (!max || list.length <= max) return list;
  const out = [];
  for (let k = 0; k < max; k++) out.push(list[Math.floor((k * list.length) / max)]);
  return out;
}

/* ---------- main run ---------- */

async function run() {
  const ra = parseRA(el.ra.value);
  const dec = parseDec(el.dec.value);
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || dec < -90 || dec > 90) {
    setStatus('Please enter a valid Right Ascension and declination.', 'error');
    return;
  }
  stopPlay();
  if (state.abort) state.abort.abort();
  const abort = new AbortController();
  state.abort = abort;

  state.center = { ra, dec };
  state.fov = Number(el.fov.value) || CONFIG.defaultFovArcmin;
  state.grid = makeGrid(ra, dec, state.fov);
  state.frames = [];
  state.views = [];
  state.gaia = [];
  state.probe = { i: state.grid.c, j: state.grid.c };
  updateUrl();
  updateIrsaLink();
  updateAladin();
  clearStage('Searching the archive…');
  setProgress(0);
  setStatus(`Searching SPHEREx images at ${formatRA(ra)} ${formatDec(dec)}…`);

  loadGaia(ra, dec, state.fov, abort.signal);

  let found;
  try {
    found = await search(ra, dec, abort.signal);
  } catch (err) {
    if (err.name === 'AbortError') return;
    networkError(err);
    return;
  }
  if (!found.rows.length) {
    clearStage('No images here yet');
    setStatus('No SPHEREx images cover this position in the selected release yet. Try another release, or check back after the next data drop.', 'warn');
    setProgress(null);
    return;
  }
  state.collectionUsed = found.coll;
  if (found.coll !== el.coll.value) el.coll.value = found.coll;

  const sorted = found.rows.filter(r => Number.isFinite(r.mjd)).sort((a, b) => a.mjd - b.mjd);
  const maxN = el.max.value === 'all' ? 0 : Number(el.max.value);
  const picked = sampleEvenly(sorted, maxN);
  const sizeDeg = (state.fov / 60) * 1.45;
  const wanted = el.precise.checked ? ['IMAGE', 'FLAGS', 'WCS-WAVE'] : ['IMAGE', 'FLAGS'];

  setStatus(`Found ${sorted.length} images. Downloading ${picked.length} cutouts…`);
  let done = 0, failed = 0, lastErr = null, lastDraw = 0;

  await pool(picked, CONFIG.maxConcurrentDownloads, async rec => {
    try {
      const frame = await loadFrame(rec, state.grid, sizeDeg, wanted, abort.signal);
      if (abort.signal.aborted) return;
      state.frames.push(frame);
    } catch (err) {
      if (err.name === 'AbortError') return;
      failed++;
      lastErr = err;
    }
    done++;
    if (abort.signal.aborted) return;
    setProgress(done / picked.length);
    setStatus(`Downloading cutouts: ${done}/${picked.length}${failed ? ` (${failed} failed)` : ''}`);
    const now = performance.now();
    if (state.frames.length && now - lastDraw > 900) {
      lastDraw = now;
      finalizeFrames();
    }
  });
  if (abort.signal.aborted) return;
  setProgress(null);

  if (!state.frames.length) {
    networkError(lastErr || new Error('No cutouts could be read'));
    return;
  }
  finalizeFrames();
  const epochs = new Set(state.frames.map(f => f.epoch)).size;
  setStatus(`Showing ${state.frames.length} images across ${epochs} epoch${epochs === 1 ? '' : 's'} from ${collectionLabel(found.coll)}${failed ? ` · ${failed} cutouts could not be read` : ''}.`, 'ok');
  if (state.views.length > 1) startPlay();
}

function finalizeFrames() {
  state.frames.sort((a, b) => a.mjd - b.mjd);
  let epoch = 0;
  state.frames.forEach((f, i) => {
    if (i > 0 && f.mjd - state.frames[i - 1].mjd > CONFIG.epochGapDays) epoch++;
    f.epoch = epoch;
  });
  buildViews();
  render();
  updateCharts();
}

function collectionLabel(id) {
  return CONFIG.collections.find(c => c.id === id)?.label || id;
}

async function pool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const k = next++;
      await fn(items[k], k);
    }
  });
  await Promise.all(workers);
}

/* ---------- frames ---------- */

function makeGrid(ra, dec, fovArcmin) {
  const scale = CONFIG.pixelScaleArcsec / 3600;
  let n = Math.max(15, Math.round((fovArcmin * 60) / CONFIG.pixelScaleArcsec));
  if (n % 2 === 0) n++;
  const c = (n - 1) / 2;
  const ras = new Float64Array(n * n);
  const decs = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [r, d] = tanDeproject(-(i - c) * scale, (c - j) * scale, ra, dec);
      ras[j * n + i] = r;
      decs[j * n + i] = d;
    }
  }
  return { n, c, scale, ra, dec, ras, decs };
}

function worldToGrid(ra, dec) {
  const g = state.grid;
  const [xi, eta] = tanProject(ra, dec, g.ra, g.dec);
  return [g.c - xi / g.scale, g.c - eta / g.scale];
}

async function loadFrame(rec, grid, sizeDeg, wanted, signal) {
  const url = cutoutUrl(rec.url, grid.ra, grid.dec, sizeDeg);
  const { byName, hdus } = await fetchFitsHDUs(proxied(url), wanted, signal);
  const img = byName.IMAGE || hdus.find(h => h.data && h.width > 1 && h.height > 1);
  if (!img || !img.data) throw new Error('Cutout has no image data');
  const wcs = new CelestialWCS(img.header);
  if (!wcs.valid) throw new Error('Cutout has no usable WCS');
  const w = img.width, h = img.height;
  const flagsHdu = byName.FLAGS;
  const n = grid.n;
  const raw = new Float32Array(n * n).fill(NaN);
  const flags = flagsHdu && flagsHdu.data ? new Float64Array(n * n) : null;

  for (let k = 0; k < n * n; k++) {
    const [x, y] = wcs.world2pix(grid.ras[k], grid.decs[k]);
    if (!(x > -0.5 && y > -0.5 && x < w - 0.5 && y < h - 0.5)) continue;
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(x)));
    const y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
    const fx = Math.min(1, Math.max(0, x - x0)), fy = Math.min(1, Math.max(0, y - y0));
    const d = img.data;
    const v00 = d[y0 * w + x0], v10 = d[y0 * w + x0 + 1], v01 = d[(y0 + 1) * w + x0], v11 = d[(y0 + 1) * w + x0 + 1];
    let v = (1 - fx) * (1 - fy) * v00 + fx * (1 - fy) * v10 + (1 - fx) * fy * v01 + fx * fy * v11;
    if (!Number.isFinite(v)) v = d[Math.round(Math.min(h - 1, Math.max(0, y))) * w + Math.round(Math.min(w - 1, Math.max(0, x)))];
    raw[k] = v;
    if (flags) {
      const xi = Math.round(Math.min(w - 1, Math.max(0, x)));
      const yi = Math.round(Math.min(h - 1, Math.max(0, y)));
      flags[k] = flagsHdu.data[yi * w + xi] || 0;
    }
  }

  const { median, sigma } = robustStats(raw);
  const norm = new Float32Array(raw.length);
  for (let k = 0; k < raw.length; k++) norm[k] = (raw[k] - median) / sigma;

  let flagged = 0, covered = 0;
  if (flags) for (let k = 0; k < flags.length; k++) { if (Number.isFinite(raw[k])) { covered++; if (flags[k]) flagged++; } }

  return {
    ...rec,
    cutoutUrl: url,
    raw, norm, flags,
    sky: median, noise: sigma,
    flaggedFrac: covered ? flagged / covered : NaN,
    wcs,
    header: img.header,
    waveTable: byName['WCS-WAVE']?.table || null
  };
}

function robustStats(arr) {
  const vals = [];
  for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i])) vals.push(arr[i]);
  if (!vals.length) return { median: 0, sigma: 1 };
  vals.sort((a, b) => a - b);
  const median = vals[vals.length >> 1];
  const dev = vals.map(v => Math.abs(v - median)).sort((a, b) => a - b);
  const sigma = 1.4826 * dev[dev.length >> 1] || (vals[vals.length - 1] - vals[0]) / 6 || 1;
  return { median, sigma };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];
}

/* ---------- views: frames, stacks, differences ---------- */

function meanStack(arrays) {
  const n = arrays[0].length;
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0, c = 0;
    for (const a of arrays) { const v = a[k]; if (Number.isFinite(v)) { s += v; c++; } }
    out[k] = c ? s / c : NaN;
  }
  return out;
}

function medianStack(arrays) {
  const n = arrays[0].length;
  const out = new Float32Array(n);
  const buf = [];
  for (let k = 0; k < n; k++) {
    buf.length = 0;
    for (const a of arrays) if (Number.isFinite(a[k])) buf.push(a[k]);
    if (!buf.length) { out[k] = NaN; continue; }
    buf.sort((x, y) => x - y);
    out[k] = buf[buf.length >> 1];
  }
  return out;
}

function subtract(a, b) {
  const out = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] - b[k];
  return out;
}

function orFlags(frames) {
  const withFlags = frames.filter(f => f.flags);
  if (!withFlags.length) return null;
  const out = new Uint8Array(withFlags[0].flags.length);
  for (const f of withFlags) for (let k = 0; k < out.length; k++) if (f.flags[k]) out[k] = 1;
  return out;
}

function detLabel(frames) {
  const ids = [...new Set(frames.map(f => f.det))].sort();
  return ids.length === 1 ? `D${ids[0]}` : `D${ids[0]}–D${ids[ids.length - 1]}`;
}

function buildViews() {
  const det = el.det.value;
  const frames = state.frames.filter(f => det === 'all' || String(f.det) === det);
  let views;
  if (!frames.length) { state.views = []; syncSlider(); return; }

  if (el.mode.value === 'epochs') {
    const groups = new Map();
    for (const f of frames) {
      if (!groups.has(f.epoch)) groups.set(f.epoch, []);
      groups.get(f.epoch).push(f);
    }
    views = [...groups.values()].map((g, i) => {
      const mjd = g.reduce((s, f) => s + f.mjd, 0) / g.length;
      const t0 = formatDate(g[0].mjd), t1 = formatDate(g[g.length - 1].mjd);
      return {
        data: meanStack(g.map(f => f.norm)),
        frames: g,
        mjd,
        title: `Epoch ${i + 1} · ${t0 === t1 ? t0 : `${t0} → ${t1}`}`,
        sub: `Stack of ${g.length} image${g.length === 1 ? '' : 's'} · ${detLabel(g)}`
      };
    });
  } else {
    views = frames.map(f => ({
      data: f.norm,
      frames: [f],
      mjd: f.mjd,
      title: `${formatDate(f.mjd, true)} UTC · D${f.det}`,
      sub: `${f.wlMin.toFixed(2)}–${f.wlMax.toFixed(2)} µm band · epoch ${f.epoch + 1} · ${f.obsId}`
    }));
  }

  const diff = el.diff.value;
  if (views.length > 1 && diff !== 'none') {
    if (diff === 'first') {
      const ref = views[0].data;
      views = views.map(v => ({ ...v, data: subtract(v.data, ref), diff: true, sub: `${v.sub} · minus first` }));
    } else if (diff === 'prev') {
      views = views.slice(1).map((v, i) => ({ ...v, data: subtract(v.data, views[i].data), diff: true, sub: `${v.sub} · minus previous` }));
    } else if (diff === 'median') {
      const ref = medianStack(views.map(v => v.data));
      views = views.map(v => ({ ...v, data: subtract(v.data, ref), diff: true, sub: `${v.sub} · minus median sky` }));
    }
  }
  views.forEach(v => { v.flagMask = orFlags(v.frames); v.lim = null; });
  state.views = views;
  state.idx = Math.min(state.idx, views.length - 1);
  syncSlider();
}

function syncSlider() {
  el.slider.max = String(Math.max(0, state.views.length - 1));
  el.slider.value = String(state.idx);
  el.slider.disabled = state.views.length < 2;
  el.play.disabled = state.views.length < 2;
}

/* ---------- rendering ---------- */

function limitsFor(v) {
  if (v.lim) return v.lim;
  const vals = [];
  for (let k = 0; k < v.data.length; k++) if (Number.isFinite(v.data[k])) vals.push(v.data[k]);
  vals.sort((a, b) => a - b);
  const clip = Number(el.clip.value);
  if (v.diff) {
    const abs = vals.map(Math.abs).sort((a, b) => a - b);
    const s = percentile(abs, clip) || 1;
    v.lim = [-s, s];
  } else {
    const lo = percentile(vals, Math.max(0.1, 100 - clip));
    const hi = percentile(vals, clip);
    v.lim = [lo, hi > lo ? hi : lo + 1];
  }
  return v.lim;
}

const COLORMAPS = {
  gray: t => [t * 255, t * 255, t * 255],
  inverted: t => [255 - t * 255, 255 - t * 255, 255 - t * 255],
  heat: t => [Math.min(255, t * 3 * 255), Math.min(255, Math.max(0, t * 3 - 1) * 255), Math.min(255, Math.max(0, t * 3 - 2) * 255)],
  diverging: t => {
    const a = [44, 82, 160], m = [247, 244, 236], b = [180, 52, 40];
    const [c0, c1, u] = t < 0.5 ? [a, m, t * 2] : [m, b, (t - 0.5) * 2];
    return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
  },
  green: t => [30 + t * 200, 40 + t * 215, 25 + t * 150]
};

function stretchFn() {
  const s = el.stretch.value;
  if (s === 'linear') return t => t;
  if (s === 'sqrt') return t => Math.sqrt(t);
  const a = 8;
  const k = Math.asinh(a);
  return t => Math.asinh(a * t) / k;
}

function render() {
  const v = state.views[state.idx];
  if (!v || !state.grid) {
    if (state.frames.length) clearStage('No images for this detector');
    return;
  }
  el.empty.hidden = true;
  const n = state.grid.n;
  if (off.width !== n) { off.width = n; off.height = n; }
  const img = offCtx.createImageData(n, n);
  const [lo, hi] = limitsFor(v);
  const st = stretchFn();
  const cmap = COLORMAPS[el.cmap.value] || COLORMAPS.gray;
  const centred = v.diff;
  for (let k = 0; k < n * n; k++) {
    const val = v.data[k];
    const p = k * 4;
    if (!Number.isFinite(val)) {
      img.data[p] = 120; img.data[p + 1] = 110; img.data[p + 2] = 90; img.data[p + 3] = 255;
      continue;
    }
    let t = (val - lo) / (hi - lo);
    t = Math.min(1, Math.max(0, t));
    if (centred) {
      const u = t * 2 - 1;
      t = 0.5 + 0.5 * Math.sign(u) * st(Math.abs(u));
    } else {
      t = st(t);
    }
    const [r, g, b] = cmap(t);
    img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
  }
  offCtx.putImageData(img, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, DISPLAY, DISPLAY);
  ctx.drawImage(off, 0, 0, DISPLAY, DISPLAY);
  drawOverlays(v);

  el.frameLabel.textContent = v.title;
  el.frameSub.textContent = `${v.sub} · frame ${state.idx + 1}/${state.views.length}`;
  el.slider.value = String(state.idx);
  highlightMetaRows(v);
}

function drawOverlays(v) {
  const n = state.grid.n;
  const s = DISPLAY / n;
  const toCanvas = (i, j) => [(i + 0.5) * s, (j + 0.5) * s];

  if (el.ovFlags.checked && v.flagMask) {
    ctx.fillStyle = 'rgba(214, 60, 40, 0.35)';
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (v.flagMask[j * n + i]) ctx.fillRect(i * s, j * s, s, s);
  }

  if (el.ovGaia.checked && state.gaia.length) {
    const year = mjdToYear(v.mjd);
    ctx.strokeStyle = '#FFA142';
    ctx.lineWidth = 1.5;
    for (const g of state.gaia) {
      const p = propagate(g.ra, g.dec, g.pmra, g.pmdec, 2016.0, year);
      const [gi, gj] = worldToGrid(p.ra, p.dec);
      if (gi < -1 || gj < -1 || gi > n || gj > n) continue;
      const [x, y] = toCanvas(gi, gj);
      const r = Math.max(4, Math.min(14, (21 - (g.mag || 20)) * 1.2));
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    }
  }

  if (el.ovCross.checked) {
    const [cx, cy] = toCanvas(state.grid.c, state.grid.c);
    ctx.strokeStyle = '#1A1AA7';
    ctx.lineWidth = 2;
    const g = 10, L = 26;
    ctx.beginPath();
    ctx.moveTo(cx - g - L, cy); ctx.lineTo(cx - g, cy);
    ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g + L, cy);
    ctx.moveTo(cx, cy - g - L); ctx.lineTo(cx, cy - g);
    ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + g + L);
    ctx.stroke();
  }

  if (state.probe && (state.probe.i !== state.grid.c || state.probe.j !== state.grid.c)) {
    const [px, py] = toCanvas(state.probe.i, state.probe.j);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px - s * 1.6, py - s * 1.6, s * 3.2, s * 3.2);
  }

  if (el.ovCompass.checked) {
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,20,0.55)';
    roundRect(ctx, 10, 10, 86, 74, 10); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2;
    ctx.font = '600 13px Montserrat, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ox = 70, oy = 64;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy - 38); ctx.moveTo(ox, oy); ctx.lineTo(ox - 38, oy); ctx.stroke();
    ctx.fillText('N', ox, oy - 47 + 0);
    ctx.fillText('E', ox - 48, oy);
    ctx.restore();

    const arcminPx = (60 / CONFIG.pixelScaleArcsec) * s;
    const len = arcminPx <= DISPLAY * 0.4 ? arcminPx : arcminPx / 2;
    const label = arcminPx <= DISPLAY * 0.4 ? '1′' : '30″';
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,20,0.55)';
    roundRect(ctx, DISPLAY - len - 34, DISPLAY - 44, len + 24, 34, 10); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(DISPLAY - len - 22, DISPLAY - 20); ctx.lineTo(DISPLAY - 22, DISPLAY - 20); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '600 12px Montserrat, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, DISPLAY - 22 - len / 2, DISPLAY - 30);
    ctx.restore();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function clearStage(msg) {
  ctx.clearRect(0, 0, DISPLAY, DISPLAY);
  el.empty.hidden = false;
  el.empty.textContent = msg;
  el.frameLabel.textContent = '—';
  el.frameSub.textContent = '';
}

/* ---------- playback ---------- */

function step(d) {
  if (!state.views.length) return;
  state.idx = (state.idx + d + state.views.length) % state.views.length;
  render();
}

function startPlay() {
  if (state.views.length < 2) return;
  const fps = Number(el.fps.value) || 2;
  state.timer = setInterval(() => step(1), 1000 / fps);
  el.play.textContent = 'Pause';
  el.play.setAttribute('aria-pressed', 'true');
}

function stopPlay() {
  clearInterval(state.timer);
  state.timer = null;
  el.play.textContent = 'Play';
  el.play.setAttribute('aria-pressed', 'false');
}

function togglePlay() {
  if (state.timer) stopPlay(); else startPlay();
}

/* ---------- interaction ---------- */

function eventToGrid(e) {
  const rect = el.canvas.getBoundingClientRect();
  const n = state.grid.n;
  const i = Math.floor(((e.clientX - rect.left) / rect.width) * n);
  const j = Math.floor(((e.clientY - rect.top) / rect.height) * n);
  return [Math.max(0, Math.min(n - 1, i)), Math.max(0, Math.min(n - 1, j))];
}

function onHover(e) {
  if (!state.grid || !state.views.length) return;
  const [i, j] = eventToGrid(e);
  const k = j * state.grid.n + i;
  const v = state.views[state.idx];
  const val = v.data[k];
  const ra = state.grid.ras[k], dec = state.grid.decs[k];
  const dx = (i - state.grid.c) * CONFIG.pixelScaleArcsec, dy = (state.grid.c - j) * CONFIG.pixelScaleArcsec;
  const valText = Number.isFinite(val) ? `${val.toFixed(2)} σ` : 'no data';
  el.readout.textContent = `${formatRA(ra)} ${formatDec(dec)} · offset ${(-dx).toFixed(0)}″ E, ${dy.toFixed(0)}″ N · ${valText}`;
}

function onProbe(e) {
  if (!state.grid || !state.frames.length) return;
  const [i, j] = eventToGrid(e);
  state.probe = { i, j };
  render();
  updateCharts();
}

/* ---------- photometry, spectra, light curves ---------- */

function aperture(f, pi, pj) {
  const n = state.grid.n;
  let sum = 0, count = 0;
  const ring = [];
  for (let j = pj - 7; j <= pj + 7; j++) {
    for (let i = pi - 7; i <= pi + 7; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const v = f.raw[j * n + i];
      if (!Number.isFinite(v)) continue;
      const r = Math.hypot(i - pi, j - pj);
      if (r <= 1.5) { sum += v; count++; } else if (r >= 4 && r <= 7) ring.push(v);
    }
  }
  if (!count || ring.length < 8) return null;
  ring.sort((a, b) => a - b);
  const bg = ring[ring.length >> 1];
  const omega = Math.pow((CONFIG.pixelScaleArcsec / 206264.806), 2);
  const flux = (sum - count * bg) * omega * 1e9;
  const err = f.noise * Math.sqrt(count) * omega * 1e9;
  return { flux, err };
}

function wavelengthFor(f, ra, dec) {
  const mid = (f.wlMin + f.wlMax) / 2;
  if (f.waveTable) {
    const [x, y] = f.wcs.world2pix(ra, dec);
    const wl = wavelengthAt(f.header, f.waveTable, x, y);
    if (wl && wl >= f.wlMin * 0.97 && wl <= f.wlMax * 1.03) return { wl, exact: true };
  }
  return { wl: mid, exact: false };
}

function updateCharts() {
  renderMetaTable();
  if (state.chart === 'table') return;
  if (!state.frames.length || !state.grid) {
    scatterPlot(el.chartCanvas, { series: [], empty: 'Load a position to see its spectrum and light curve.' });
    el.chartNote.textContent = '';
    return;
  }
  const { i, j } = state.probe;
  const k = j * state.grid.n + i;
  const ra = state.grid.ras[k], dec = state.grid.decs[k];
  const det = el.det.value;
  const frames = state.frames.filter(f => det === 'all' || String(f.det) === det);
  const current = new Set(state.views[state.idx]?.frames || []);
  const where = `${formatRA(ra)} ${formatDec(dec)}`;

  if (state.chart === 'spectrum') {
    const epochs = [...new Set(frames.map(f => f.epoch))];
    const palette = ['#3d5a98', '#b33a3a', '#6a9f3c', '#c9971c', '#7d4fa0', '#2f9c95'];
    let exact = 0;
    const series = epochs.map((ep, idx) => ({
      label: `Epoch ${ep + 1}`,
      color: palette[idx % palette.length],
      points: frames.filter(f => f.epoch === ep).map(f => {
        const ph = aperture(f, i, j);
        const w = wavelengthFor(f, ra, dec);
        if (w.exact) exact++;
        return ph ? { x: w.wl, y: ph.flux, err: ph.err, hollow: !w.exact, highlight: current.has(f) } : null;
      }).filter(Boolean)
    }));
    scatterPlot(el.chartCanvas, {
      series,
      xLabel: 'Wavelength (µm)',
      yLabel: 'Aperture flux (mJy)',
      xFormat: v => v.toFixed(1),
      xRange: [0.7, 5.05]
    });
    const legend = series.map(s => `<span class="key"><i style="background:${s.color}"></i>${s.label}</span>`).join('');
    const exactNote = exact
      ? `${exact} of ${frames.length} points use exact per-pixel wavelengths.`
      : 'Hollow points sit at the centre of each detector band. Tick “Exact wavelengths” and reload for a full-resolution spectrum.';
    el.chartNote.innerHTML = `<div class="legend">${legend}</div>Spectrum at ${where}. ${exactNote} Click the image to measure another spot.`;
  } else {
    const dets = CONFIG.detectors.filter(d => frames.some(f => f.det === d.id));
    const series = dets.map(d => ({
      label: `D${d.id}`,
      color: d.color,
      points: frames.filter(f => f.det === d.id).map(f => {
        const ph = aperture(f, i, j);
        return ph ? { x: f.mjd, y: ph.flux, err: ph.err, highlight: current.has(f) } : null;
      }).filter(Boolean)
    }));
    scatterPlot(el.chartCanvas, {
      series,
      xLabel: 'Date (UTC)',
      yLabel: 'Aperture flux (mJy)',
      xFormat: v => formatDate(v).slice(0, 7)
    });
    const legend = series.map(s => `<span class="key"><i style="background:${s.color}"></i>${s.label} (${CONFIG.detectors.find(d => `D${d.id}` === s.label).range.join('–')} µm)</span>`).join('');
    el.chartNote.innerHTML = `<div class="legend">${legend}</div>Light curve at ${where}. Each detector covers a different wavelength range, so compare points of the same colour.`;
  }
}

function flagBits(value) {
  const bits = [];
  for (let b = 0; b < 32; b++) if (value & (1 << b)) bits.push(b);
  return bits;
}

function renderMetaTable() {
  if (!el.meta) return;
  if (!state.frames.length) {
    el.meta.innerHTML = '<tr><td colspan="8" class="muted">No images loaded.</td></tr>';
    return;
  }
  const { i, j } = state.probe || { i: state.grid.c, j: state.grid.c };
  const k = j * state.grid.n + i;
  const ra = state.grid.ras[k], dec = state.grid.decs[k];
  el.meta.innerHTML = state.frames.map((f, idx) => {
    const w = wavelengthFor(f, ra, dec);
    const fl = f.flags ? flagBits(f.flags[k]) : [];
    const flagText = f.flags ? (fl.length ? fl.join(', ') : 'none') : '—';
    const pct = Number.isFinite(f.flaggedFrac) ? `${(f.flaggedFrac * 100).toFixed(0)}%` : '—';
    return `<tr data-frame="${idx}">
      <td>${idx + 1}</td>
      <td>${formatDate(f.mjd, true)}</td>
      <td>${f.epoch + 1}</td>
      <td><span class="det-dot" style="background:${CONFIG.detectors.find(d => d.id === f.det)?.color || '#999'}"></span>D${f.det}</td>
      <td>${w.wl.toFixed(3)}${w.exact ? '' : ' *'}</td>
      <td>${pct}</td>
      <td>${flagText}</td>
      <td><a href="${f.cutoutUrl}" target="_blank" rel="noopener" title="${f.obsId}">FITS</a></td>
    </tr>`;
  }).join('');
  highlightMetaRows(state.views[state.idx]);
}

function highlightMetaRows(v) {
  if (!el.meta || !v) return;
  const ids = new Set(v.frames.map(f => state.frames.indexOf(f)));
  el.meta.querySelectorAll('tr[data-frame]').forEach(tr => tr.classList.toggle('current', ids.has(Number(tr.dataset.frame))));
}

/* ---------- Gaia overlay ---------- */

async function loadGaia(ra, dec, fov, signal) {
  const radius = Math.ceil((fov / 2) * 60 * 1.5);
  const url = `${CONFIG.vizierAsu}?-source=${encodeURIComponent(CONFIG.gaiaVizier)}&-c=${ra.toFixed(6)}%20${dec >= 0 ? '%2B' : ''}${dec.toFixed(6)}&-c.rs=${radius}&-out=RA_ICRS,DE_ICRS,pmRA,pmDE,Gmag&-out.max=3000`;
  try {
    const res = await fetch(proxied(url), { signal });
    if (!res.ok) return;
    const lines = (await res.text()).split('\n').filter(l => l.trim() && !l.startsWith('#'));
    const rows = lines.slice(3).map(l => l.split('\t').map(s => s.trim()));
    state.gaia = rows.map(r => ({
      ra: Number(r[0]), dec: Number(r[1]),
      pmra: Number(r[2]) || 0, pmdec: Number(r[3]) || 0,
      mag: Number(r[4])
    })).filter(g => Number.isFinite(g.ra) && Number.isFinite(g.dec));
    if (el.ovGaia.checked) render();
  } catch (err) {
    state.gaia = [];
  }
}

/* ---------- Aladin Lite ---------- */

function initAladin() {
  if (!el.aladinBox || !window.A) return;
  window.A.init.then(() => {
    state.aladin = window.A.aladin('#aladin-lite', {
      survey: CONFIG.aladinSurveys[0].id,
      fov: 0.15,
      target: '0 0',
      cooFrame: 'ICRS',
      showReticle: true,
      showFullscreenControl: true
    });
    el.aladinSurvey.addEventListener('change', () => {
      const a = state.aladin;
      if (a.setBaseImageLayer) a.setBaseImageLayer(el.aladinSurvey.value);
      else a.setImageSurvey(el.aladinSurvey.value);
    });
    el.aladinGaia.addEventListener('change', toggleAladinCats);
    el.aladinWise.addEventListener('change', toggleAladinCats);
    if (state.center) updateAladin();
  }).catch(() => {});
}

function updateAladin() {
  const a = state.aladin;
  if (!a || !state.center) return;
  const { ra, dec } = state.center;
  a.gotoRaDec(ra, dec);
  a.setFoV((state.fov / 60) * 1.6);
  for (const c of state.aladinCats) { try { c.cat.hide(); } catch (e) { /* ignore */ } }
  state.aladinCats = [];
  const radius = (state.fov / 60) * 1.2;
  const add = (id, name, color, key) => {
    try {
      const cat = window.A.catalogFromVizieR(id, `${ra} ${dec}`, radius, { name, color, sourceSize: 12, onClick: 'showTable' });
      a.addCatalog(cat);
      state.aladinCats.push({ key, cat });
    } catch (e) { /* ignore */ }
  };
  add(CONFIG.gaiaVizier, 'Gaia DR3', '#E3F40C', 'gaia');
  add(CONFIG.wiseVizier, 'AllWISE', '#FFA142', 'wise');
  toggleAladinCats();
}

function toggleAladinCats() {
  for (const { key, cat } of state.aladinCats) {
    const on = key === 'gaia' ? el.aladinGaia.checked : el.aladinWise.checked;
    try { on ? cat.show() : cat.hide(); } catch (e) { /* ignore */ }
  }
}

/* ---------- misc ---------- */

function updateIrsaLink() {
  if (!el.irsaLink || !state.center) return;
  const { ra, dec } = state.center;
  el.irsaLink.href = `${CONFIG.siaEndpoint}?COLLECTION=${encodeURIComponent(el.coll.value)}&POS=circle+${ra.toFixed(6)}+${dec.toFixed(6)}+0.0003&RESPONSEFORMAT=HTML`;
  el.irsaLink.hidden = false;
}

function setStatus(msg, kind = '') {
  el.status.textContent = msg;
  el.status.dataset.kind = kind;
}

function setProgress(p) {
  if (p === null) { el.progress.hidden = true; return; }
  el.progress.hidden = false;
  el.progressBar.style.width = `${Math.round(p * 100)}%`;
}

function networkError(err) {
  setProgress(null);
  clearStage('Could not load images');
  const hint = err instanceof TypeError
    ? 'The browser could not reach the IRSA archive. Check your connection; if the problem persists, see Guide → Troubleshooting for setting a proxy.'
    : err.message;
  setStatus(`Something went wrong: ${hint}`, 'error');
}

async function copyText(text, btn, done) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  const old = btn.textContent;
  btn.textContent = done;
  setTimeout(() => { btn.textContent = old; }, 1600);
}

function savePng() {
  if (!state.views.length) return;
  const a = document.createElement('a');
  const { ra, dec } = state.center;
  a.download = `spherex_${ra.toFixed(4)}_${dec.toFixed(4)}_${state.idx + 1}.png`;
  a.href = el.canvas.toDataURL('image/png');
  a.click();
}

init();

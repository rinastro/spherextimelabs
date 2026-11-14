import { CONFIG, proxied } from './config.js';

// Test targets suggested by the challenge. Positions are J2000 at the
// given epoch; proper motions (mas/yr) are applied before searching.
export const TARGETS = {
  barnard: {
    name: "Barnard's Star",
    kind: 'Fastest-moving star in the sky',
    ra: '17 57 48.97', dec: '+04 41 36.11',
    epoch: 2000.0, pmra: -798.58, pmdec: 10328.12,
    fov: 4, mode: 'epochs', diff: 'none', det: 'all'
  },
  'eps-indi-b': {
    name: 'Epsilon Indi B',
    kind: 'Pair of brown dwarfs orbiting a nearby star',
    ra: '22 04 10.52', dec: '-56 46 57.7',
    epoch: 2000.0, pmra: 3966.66, pmdec: -2536.19,
    fov: 4, mode: 'epochs', diff: 'none', det: 'all'
  },
  wise0855: {
    name: 'WISE 0855−0714',
    kind: 'Coldest known brown dwarf, fast-moving',
    ra: '08 55 10.831', dec: '-07 14 42.53',
    epoch: null, pmra: 0, pmdec: 0,
    fov: 6, mode: 'epochs', diff: 'median', det: '6'
  },
  'rw-aur': {
    name: 'RW Aurigae',
    kind: 'Young variable star',
    ra: '05 07 49.54', dec: '+30 24 05.07',
    epoch: null, pmra: 0, pmdec: 0,
    fov: 3, mode: 'frames', diff: 'none', det: 'all'
  },
  'r-dra': {
    name: 'R Draconis',
    kind: 'Mira-type long-period variable',
    ra: '16 32 40.18', dec: '+66 45 17.9',
    epoch: null, pmra: 0, pmdec: 0,
    fov: 3, mode: 'frames', diff: 'none', det: 'all'
  }
};

export function targetPosition(t, toYear = CONFIG.referenceEpoch) {
  const ra = parseRA(t.ra), dec = parseDec(t.dec);
  if (!t.epoch || (!t.pmra && !t.pmdec)) return { ra, dec };
  return propagate(ra, dec, t.pmra, t.pmdec, t.epoch, toYear);
}

export function parseRA(input) {
  const s = String(input ?? '').trim();
  if (!s) return NaN;
  if (/^[+]?\d+(\.\d+)?$/.test(s)) return Number(s);
  const p = s.replace(/[hmsHMS:]/g, ' ').trim().split(/\s+/).map(Number);
  if (p.some(Number.isNaN)) return NaN;
  const [h, m = 0, sec = 0] = p;
  return (h + m / 60 + sec / 3600) * 15;
}

export function parseDec(input) {
  let s = String(input ?? '').trim().replace(/−/g, '-');
  if (!s) return NaN;
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Number(s);
  const neg = s.startsWith('-');
  s = s.replace(/^[+-]/, '').replace(/[dD°'":mMsS′″]/g, ' ').trim();
  const p = s.split(/\s+/).map(Number);
  if (p.some(Number.isNaN)) return NaN;
  const [d, m = 0, sec = 0] = p;
  const v = d + m / 60 + sec / 3600;
  return neg ? -v : v;
}

const pad = (n, w, dp = 0) => {
  const s = dp ? n.toFixed(dp) : String(Math.floor(n));
  const [i, f] = s.split('.');
  return i.padStart(w, '0') + (f ? '.' + f : '');
};

export function formatRA(deg) {
  let t = (((deg % 360) + 360) % 360) / 15;
  const h = Math.floor(t); t = (t - h) * 60;
  const m = Math.floor(t); let s = (t - m) * 60;
  if (s >= 59.995) s = 59.99;
  return `${pad(h, 2)}h${pad(m, 2)}m${pad(s, 2, 2)}s`;
}

export function formatDec(deg) {
  const sign = deg < 0 ? '−' : '+';
  let t = Math.abs(deg);
  const d = Math.floor(t); t = (t - d) * 60;
  const m = Math.floor(t); let s = (t - m) * 60;
  if (s >= 59.95) s = 59.9;
  return `${sign}${pad(d, 2)}°${pad(m, 2)}′${pad(s, 2, 1)}″`;
}

export function propagate(ra, dec, pmra, pmdec, fromYear, toYear) {
  const dt = toYear - fromYear;
  const dDec = (pmdec * dt) / 3.6e6;
  const dRa = (pmra * dt) / 3.6e6 / Math.cos((dec * Math.PI) / 180);
  return { ra: (((ra + dRa) % 360) + 360) % 360, dec: dec + dDec };
}

export function mjdToYear(mjd) {
  return 2000 + (mjd - 51544.5) / 365.25;
}

export function mjdToDate(mjd) {
  return new Date((mjd - 40587) * 86400000);
}

export function formatDate(mjd, withTime = false) {
  const iso = mjdToDate(mjd).toISOString();
  return withTime ? iso.slice(0, 16).replace('T', ' ') : iso.slice(0, 10);
}

// Name lookup through the CDS Sesame service (SIMBAD, NED, VizieR).
export async function resolveName(name) {
  const res = await fetch(proxied(CONFIG.sesame + encodeURIComponent(name)));
  if (!res.ok) throw new Error(`Name service returned ${res.status}`);
  const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
  const get = tag => {
    const el = xml.getElementsByTagName(tag)[0];
    return el ? Number(el.textContent) : NaN;
  };
  const ra = get('jradeg'), dec = get('jdedeg');
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) throw new Error(`“${name}” was not found`);
  const pmra = get('pmRA'), pmdec = get('pmDE');
  return {
    ra, dec,
    pmra: Number.isFinite(pmra) ? pmra : 0,
    pmdec: Number.isFinite(pmdec) ? pmdec : 0
  };
}

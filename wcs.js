// Gnomonic (TAN) world coordinate system with optional SIP distortion,
// plus a lookup for the SPHEREx spectral WCS table (WCS-WAVE).

const D2R = Math.PI / 180;

export function tanProject(ra, dec, ra0, dec0) {
  const a = ra * D2R, d = dec * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc;
  return [xi / D2R, eta / D2R];
}

export function tanDeproject(xi, eta, ra0, dec0) {
  const x = xi * D2R, y = eta * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R;
  const den = Math.cos(d0) - y * Math.sin(d0);
  let a = (a0 + Math.atan2(x, den)) / D2R;
  const d = Math.atan2(Math.sin(d0) + y * Math.cos(d0), Math.hypot(x, den)) / D2R;
  a = ((a % 360) + 360) % 360;
  return [a, d];
}

function readSip(h, prefix) {
  const order = h[`${prefix}_ORDER`];
  if (!order) return null;
  const terms = [];
  for (let p = 0; p <= order; p++) {
    for (let q = 0; q <= order - p; q++) {
      const c = h[`${prefix}_${p}_${q}`];
      if (c) terms.push([p, q, c]);
    }
  }
  return terms.length ? terms : null;
}

function evalSip(terms, u, v) {
  let s = 0;
  for (const [p, q, c] of terms) s += c * Math.pow(u, p) * Math.pow(v, q);
  return s;
}

export class CelestialWCS {
  constructor(h, key = '') {
    const g = (name, def) => (h[name + key] !== undefined ? h[name + key] : def);
    this.crpix = [g('CRPIX1', 0), g('CRPIX2', 0)];
    this.crval = [g('CRVAL1', 0), g('CRVAL2', 0)];
    let cd;
    if (h['CD1_1' + key] !== undefined || h['CD2_2' + key] !== undefined) {
      cd = [g('CD1_1', 0), g('CD1_2', 0), g('CD2_1', 0), g('CD2_2', 0)];
    } else {
      const c1 = g('CDELT1', 1), c2 = g('CDELT2', 1);
      cd = [c1 * g('PC1_1', 1), c1 * g('PC1_2', 0), c2 * g('PC2_1', 0), c2 * g('PC2_2', 1)];
    }
    this.cd = cd;
    const det = cd[0] * cd[3] - cd[1] * cd[2];
    this.inv = [cd[3] / det, -cd[1] / det, -cd[2] / det, cd[0] / det];
    const ctype = String(h['CTYPE1' + key] || '');
    const sip = ctype.includes('SIP') || h.A_ORDER;
    this.a = sip ? readSip(h, 'A') : null;
    this.b = sip ? readSip(h, 'B') : null;
    this.ap = sip ? readSip(h, 'AP') : null;
    this.bp = sip ? readSip(h, 'BP') : null;
    this.valid = Number.isFinite(det) && det !== 0;
  }

  // x, y are zero-based pixel indices
  pix2world(x, y) {
    let u = x + 1 - this.crpix[0];
    let v = y + 1 - this.crpix[1];
    if (this.a && this.b) {
      const du = evalSip(this.a, u, v), dv = evalSip(this.b, u, v);
      u += du; v += dv;
    }
    const xi = this.cd[0] * u + this.cd[1] * v;
    const eta = this.cd[2] * u + this.cd[3] * v;
    return tanDeproject(xi, eta, this.crval[0], this.crval[1]);
  }

  world2pix(ra, dec) {
    const [xi, eta] = tanProject(ra, dec, this.crval[0], this.crval[1]);
    const U = this.inv[0] * xi + this.inv[1] * eta;
    const V = this.inv[2] * xi + this.inv[3] * eta;
    let u = U, v = V;
    if (this.ap && this.bp) {
      u = U + evalSip(this.ap, U, V);
      v = V + evalSip(this.bp, U, V);
    } else if (this.a && this.b) {
      for (let i = 0; i < 8; i++) {
        const nu = U - evalSip(this.a, u, v);
        const nv = V - evalSip(this.b, u, v);
        u = nu; v = nv;
      }
    }
    return [u + this.crpix[0] - 1, v + this.crpix[1] - 1];
  }
}

function findColumn(table, names) {
  const keys = Object.keys(table.data);
  for (const n of names) {
    if (!n) continue;
    const k = keys.find(key => key.toUpperCase() === String(n).toUpperCase());
    if (k) return { name: k, col: table.columns.find(c => c.name === k) };
  }
  return null;
}

function fractionalIndex(arr, value) {
  const n = arr.length;
  if (n < 2) return null;
  const asc = arr[n - 1] > arr[0];
  const lo = asc ? arr[0] : arr[n - 1];
  const hi = asc ? arr[n - 1] : arr[0];
  if (value < lo || value > hi) return null;
  let a = 0, b = n - 1;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if ((arr[m] <= value) === asc) a = m; else b = m;
  }
  const f = (value - arr[a]) / (arr[b] - arr[a]);
  return a + (Number.isFinite(f) ? f : 0);
}

// Wavelength (micrometres) at a zero-based pixel of a SPHEREx spectral image,
// read from the WCS-WAVE lookup table. Returns null when it cannot be evaluated.
export function wavelengthAt(header, table, x, y) {
  if (!table || !table.data) return null;
  const h = header;
  const crpix1 = h.CRPIX1W, crpix2 = h.CRPIX2W;
  if (crpix1 === undefined || crpix2 === undefined) return null;
  const u = (h.CRVAL1W ?? 0) + (h.CDELT1W ?? 1) * (x + 1 - crpix1);
  const v = (h.CRVAL2W ?? 0) + (h.CDELT2W ?? 1) * (y + 1 - crpix2);

  const xc = findColumn(table, [h.PS3_1W, 'X']);
  const yc = findColumn(table, [h.PS3_2W, 'Y']);
  const vc = findColumn(table, [h.PS3_3W, 'VALUES']);
  if (!xc || !yc || !vc) return null;
  const X = table.data[xc.name][0];
  const Y = table.data[yc.name][0];
  const V = table.data[vc.name][0];
  const nx = X.length, ny = Y.length;
  const m = Math.round(V.length / (nx * ny));
  if (!m || m * nx * ny !== V.length) return null;

  const fx = fractionalIndex(X, u);
  const fy = fractionalIndex(Y, v);
  if (fx === null || fy === null) return null;
  const x0 = Math.min(nx - 2, Math.floor(fx)), y0 = Math.min(ny - 2, Math.floor(fy));
  const tx = fx - x0, ty = fy - y0;
  const at = (i, j) => V[(j * nx + i) * m];
  const val = (1 - tx) * (1 - ty) * at(x0, y0) + tx * (1 - ty) * at(x0 + 1, y0)
    + (1 - tx) * ty * at(x0, y0 + 1) + tx * ty * at(x0 + 1, y0 + 1);
  if (!Number.isFinite(val)) return null;
  if (val < 1e-3) return val * 1e6;   // metres
  if (val > 100) return val / 1000;   // nanometres
  return val;                          // micrometres
}

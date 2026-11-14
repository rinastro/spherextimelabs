// Minimal FITS reader for multi-extension files (images and binary tables).
// Reads the response as a stream and stops as soon as the requested
// extensions have arrived, so large trailing HDUs are never downloaded.

const BLOCK = 2880;
const ELEMENT_SIZE = { L: 1, B: 1, I: 2, J: 4, K: 8, A: 1, E: 4, D: 8, C: 8, M: 16, P: 8, Q: 16 };

export async function fetchFitsHDUs(url, wanted = null, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const need = wanted ? wanted.map(w => w.toUpperCase()) : null;
  let buf = new Uint8Array(1 << 16);
  let len = 0;
  let pos = 0;
  const hdus = [];
  const byName = {};

  const append = chunk => {
    if (len + chunk.length > buf.length) {
      const next = new Uint8Array(Math.max(buf.length * 2, len + chunk.length));
      next.set(buf.subarray(0, len));
      buf = next;
    }
    buf.set(chunk, len);
    len += chunk.length;
  };

  const complete = () => need && need.every(n => byName[n]);

  const parseAvailable = () => {
    for (;;) {
      if (complete()) return true;
      const hdr = readHeader(buf, pos, len);
      if (!hdr) return false;
      const size = dataSize(hdr.cards);
      if (hdr.end + size > len) return false;
      const isPrimary = hdus.length === 0;
      const name = String(hdr.cards.EXTNAME || (isPrimary ? 'PRIMARY' : `HDU${hdus.length}`)).trim().toUpperCase();
      const hdu = { name, header: hdr.cards };
      if (!need || need.includes(name) || (isPrimary && size > 0)) {
        decode(hdu, buf.slice(hdr.end, hdr.end + size));
      }
      hdus.push(hdu);
      if (!byName[name]) byName[name] = hdu;
      pos = hdr.end + Math.ceil(size / BLOCK) * BLOCK;
    }
  };

  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      append(value);
      if (parseAvailable()) {
        try { await reader.cancel(); } catch (e) { /* ignore */ }
        break;
      }
    }
  } else {
    append(new Uint8Array(await res.arrayBuffer()));
  }
  parseAvailable();
  if (!hdus.length) throw new Error('Not a FITS file');
  return { hdus, byName };
}

function readHeader(buf, start, len) {
  const cards = {};
  for (let b = start; b + BLOCK <= len; b += BLOCK) {
    for (let c = 0; c < 36; c++) {
      const o = b + c * 80;
      let s = '';
      for (let i = 0; i < 80; i++) s += String.fromCharCode(buf[o + i]);
      const key = s.slice(0, 8).trim();
      if (key === 'END') return { cards, end: b + BLOCK };
      if (!key || key === 'COMMENT' || key === 'HISTORY') continue;
      if (s[8] !== '=') continue;
      cards[key] = parseValue(s.slice(10));
    }
  }
  return null;
}

function parseValue(raw) {
  let v = raw.trim();
  if (v.startsWith("'")) {
    let out = '';
    for (let i = 1; i < v.length; i++) {
      if (v[i] === "'") {
        if (v[i + 1] === "'") { out += "'"; i++; continue; }
        break;
      }
      out += v[i];
    }
    return out.trimEnd();
  }
  const slash = v.indexOf('/');
  if (slash >= 0) v = v.slice(0, slash).trim();
  if (v === 'T') return true;
  if (v === 'F') return false;
  const n = Number(v.replace(/D/i, 'E'));
  return Number.isNaN(n) ? v : n;
}

function dataSize(h) {
  const naxis = h.NAXIS || 0;
  if (!naxis) return 0;
  let n = 1;
  for (let i = 1; i <= naxis; i++) n *= h[`NAXIS${i}`] || 0;
  const gcount = h.GCOUNT ?? 1;
  const pcount = h.PCOUNT ?? 0;
  return (Math.abs(h.BITPIX) / 8) * gcount * (pcount + n);
}

function decode(hdu, bytes) {
  const h = hdu.header;
  if (String(h.XTENSION || '').trim() === 'BINTABLE') {
    hdu.table = readBintable(h, bytes);
    return;
  }
  if (!h.NAXIS) return;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let n = 1;
  for (let i = 1; i <= h.NAXIS; i++) n *= h[`NAXIS${i}`];
  const bitpix = h.BITPIX;
  const out = bitpix === -32 ? new Float32Array(n) : new Float64Array(n);
  const scale = h.BSCALE ?? 1;
  const zero = h.BZERO ?? 0;
  const blank = h.BLANK;
  for (let i = 0; i < n; i++) {
    let v;
    switch (bitpix) {
      case -32: v = dv.getFloat32(i * 4, false); break;
      case -64: v = dv.getFloat64(i * 8, false); break;
      case 8: v = dv.getUint8(i); break;
      case 16: v = dv.getInt16(i * 2, false); break;
      case 32: v = dv.getInt32(i * 4, false); break;
      case 64: v = Number(dv.getBigInt64(i * 8, false)); break;
      default: v = NaN;
    }
    if (bitpix > 0 && blank !== undefined && v === blank) v = NaN;
    out[i] = v * scale + zero;
  }
  hdu.data = out;
  hdu.width = h.NAXIS1;
  hdu.height = h.NAXIS2 || 1;
}

function readBintable(h, bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rowLen = h.NAXIS1;
  const nRows = h.NAXIS2;
  const columns = [];
  let offset = 0;
  for (let i = 1; i <= (h.TFIELDS || 0); i++) {
    const m = /^(\d*)([LXBIJKAEDCMPQ])/.exec(String(h[`TFORM${i}`]).trim());
    if (!m) continue;
    const repeat = m[1] === '' ? 1 : Number(m[1]);
    const type = m[2];
    const width = type === 'X' ? Math.ceil(repeat / 8) : repeat * ELEMENT_SIZE[type];
    columns.push({
      name: String(h[`TTYPE${i}`] || `COL${i}`).trim(),
      type, repeat, offset,
      tdim: parseTdim(h[`TDIM${i}`])
    });
    offset += width;
  }
  const data = {};
  for (const col of columns) {
    const rows = [];
    for (let r = 0; r < nRows; r++) {
      const base = r * rowLen + col.offset;
      if (col.type === 'A') {
        let s = '';
        for (let k = 0; k < col.repeat; k++) s += String.fromCharCode(dv.getUint8(base + k));
        rows.push(s.replace(/\0+$/, '').trim());
        continue;
      }
      const arr = new Float64Array(col.repeat);
      for (let k = 0; k < col.repeat; k++) {
        switch (col.type) {
          case 'E': arr[k] = dv.getFloat32(base + k * 4, false); break;
          case 'D': arr[k] = dv.getFloat64(base + k * 8, false); break;
          case 'B': arr[k] = dv.getUint8(base + k); break;
          case 'I': arr[k] = dv.getInt16(base + k * 2, false); break;
          case 'J': arr[k] = dv.getInt32(base + k * 4, false); break;
          case 'K': arr[k] = Number(dv.getBigInt64(base + k * 8, false)); break;
          default: arr[k] = NaN;
        }
      }
      rows.push(arr);
    }
    data[col.name] = rows;
  }
  return { columns, data };
}

function parseTdim(v) {
  if (!v) return null;
  const m = String(v).match(/\d+/g);
  return m ? m.map(Number) : null;
}

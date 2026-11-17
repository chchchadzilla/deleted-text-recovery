/**
 * Decompressors for the two formats the autosave files use:
 *  - Snappy (LevelDB table blocks in Chromium browsers and Electron apps)
 *  - LZ4 block format inside Mozilla's "mozLz40" container (Firefox session files)
 * Both are written from the public format descriptions and bounds-check every step,
 * because the input comes straight off disk and may be truncated or damaged.
 */
import { readVarint, u32le, startsWithBytes, asciiBytes } from './bytes';

const MAX_OUTPUT = 512 * 1024 * 1024;

export function snappyDecompress(src: Uint8Array): Uint8Array {
  const [len, start] = readVarint(src, 0);
  if (len > MAX_OUTPUT) throw new Error('snappy: declared size is unreasonably large');
  const out = new Uint8Array(len);
  const n = src.length;
  let i = start;
  let o = 0;
  while (i < n) {
    const tag = src[i++];
    const type = tag & 3;
    if (type === 0) {
      let l = tag >>> 2;
      if (l >= 60) {
        const nb = l - 59;
        if (i + nb > n) throw new Error('snappy: truncated literal length');
        l = 0;
        for (let k = 0; k < nb; k++) l += src[i + k] * 2 ** (8 * k);
        i += nb;
      }
      l += 1;
      if (i + l > n || o + l > len) throw new Error('snappy: literal runs past the end');
      out.set(src.subarray(i, i + l), o);
      i += l;
      o += l;
      continue;
    }
    let l: number;
    let off: number;
    if (type === 1) {
      if (i >= n) throw new Error('snappy: truncated copy');
      l = ((tag >>> 2) & 7) + 4;
      off = ((tag >>> 5) << 8) | src[i++];
    } else if (type === 2) {
      if (i + 2 > n) throw new Error('snappy: truncated copy');
      l = (tag >>> 2) + 1;
      off = src[i] | (src[i + 1] << 8);
      i += 2;
    } else {
      if (i + 4 > n) throw new Error('snappy: truncated copy');
      l = (tag >>> 2) + 1;
      off = u32le(src, i);
      i += 4;
    }
    if (off === 0 || off > o || o + l > len) throw new Error('snappy: copy points outside the data');
    if (off >= l) {
      out.copyWithin(o, o - off, o - off + l);
      o += l;
    } else {
      for (let k = 0; k < l; k++) {
        out[o] = out[o - off];
        o++;
      }
    }
  }
  if (o !== len) throw new Error('snappy: output is shorter than declared');
  return out;
}

export function lz4BlockDecompress(src: Uint8Array, outLen: number): Uint8Array {
  if (outLen > MAX_OUTPUT) throw new Error('lz4: declared size is unreasonably large');
  const out = new Uint8Array(outLen);
  const n = src.length;
  let i = 0;
  let o = 0;
  while (i < n) {
    const token = src[i++];
    let lit = token >>> 4;
    if (lit === 15) {
      for (;;) {
        if (i >= n) throw new Error('lz4: truncated literal length');
        const b = src[i++];
        lit += b;
        if (b !== 255) break;
      }
    }
    if (i + lit > n || o + lit > outLen) throw new Error('lz4: literal runs past the end');
    out.set(src.subarray(i, i + lit), o);
    i += lit;
    o += lit;
    if (i >= n) break; // the last sequence is literals only
    if (i + 2 > n) throw new Error('lz4: truncated match offset');
    const off = src[i] | (src[i + 1] << 8);
    i += 2;
    let ml = token & 15;
    if (ml === 15) {
      for (;;) {
        if (i >= n) throw new Error('lz4: truncated match length');
        const b = src[i++];
        ml += b;
        if (b !== 255) break;
      }
    }
    ml += 4;
    if (off === 0 || off > o || o + ml > outLen) throw new Error('lz4: match points outside the data');
    if (off >= ml) {
      out.copyWithin(o, o - off, o - off + ml);
      o += ml;
    } else {
      for (let k = 0; k < ml; k++) {
        out[o] = out[o - off];
        o++;
      }
    }
  }
  return o === outLen ? out : out.subarray(0, o);
}

export const MOZLZ4_MAGIC = asciiBytes('mozLz40\0');

export function isMozLz4(data: Uint8Array): boolean {
  return startsWithBytes(data, MOZLZ4_MAGIC);
}

/** Firefox ".jsonlz4" / ".baklz4": 8-byte magic, 4-byte little-endian size, then one LZ4 block. */
export function decodeMozLz4(data: Uint8Array): Uint8Array {
  if (!isMozLz4(data) || data.length < 12) throw new Error('not a mozLz4 file');
  return lz4BlockDecompress(data.subarray(12), u32le(data, 8));
}

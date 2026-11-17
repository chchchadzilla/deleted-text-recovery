/** Small, dependency-free byte helpers shared by every parser. */

export function u16le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}

export function u32le(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

export function writeU32le(b: Uint8Array, i: number, v: number): void {
  b[i] = v & 0xff;
  b[i + 1] = (v >>> 8) & 0xff;
  b[i + 2] = (v >>> 16) & 0xff;
  b[i + 3] = (v >>> 24) & 0xff;
}

/** Reads a LEB128 varint. Returns [value, nextIndex]. Throws if it runs off the end. */
export function readVarint(b: Uint8Array, i: number): [number, number] {
  let result = 0;
  let mul = 1;
  for (let n = 0; n < 10; n++) {
    if (i >= b.length) throw new RangeError('varint runs past the end of the data');
    const c = b[i++];
    result += (c & 0x7f) * mul;
    if (c < 0x80) return [result, i];
    mul *= 128;
  }
  throw new RangeError('varint is too long');
}

export function writeVarint(v: number): number[] {
  const out: number[] = [];
  while (v >= 0x80) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

const dec16 = new TextDecoder('utf-16le');
const dec8strict = new TextDecoder('utf-8', { fatal: true });
const dec1252 = new TextDecoder('windows-1252');

export function decodeUtf16le(b: Uint8Array): string {
  return dec16.decode(b);
}

/** True Latin-1 (every byte is the code point), as used by V8 one-byte strings and Chromium storage. */
export function decodeLatin1(b: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < b.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, b.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return out;
}

/** UTF-8 when the bytes are valid UTF-8, otherwise Windows-1252. */
export function decodeBytesAsText(b: Uint8Array): string {
  try {
    return dec8strict.decode(b);
  } catch {
    return dec1252.decode(b);
  }
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function utf16leBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 * i] = c & 0xff;
    out[2 * i + 1] = c >>> 8;
  }
  return out;
}

/** Last position of `needle` that starts within [from, to). Returns -1 when absent. */
export function lastIndexOfBytes(hay: Uint8Array, needle: Uint8Array, from: number, to: number): number {
  const n = needle.length;
  const start = Math.min(to - 1, hay.length - n);
  outer: for (let i = start; i >= from; i--) {
    for (let k = 0; k < n; k++) {
      if (hay[i + k] !== needle[k]) continue outer;
    }
    return i;
  }
  return -1;
}

export function startsWithBytes(hay: Uint8Array, needle: Uint8Array, at = 0): boolean {
  if (at + needle.length > hay.length) return false;
  for (let k = 0; k < needle.length; k++) {
    if (hay[at + k] !== needle[k]) return false;
  }
  return true;
}

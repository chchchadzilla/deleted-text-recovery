/**
 * String finders. Each one understands a specific way programs store text on disk:
 *
 *  findMojoString16   Chromium's tab-restore files. Every text box on a page is saved as a
 *                     length-prefixed UTF-16 array, re-saved as you type. Exact and Unicode-safe.
 *  findV8Strings      Values in IndexedDB (V8's structured-clone format).
 *  findUtf16Runs      Fallback for unknown binary files (UTF-16, as Windows apps write it).
 *  findByteRuns       Fallback for unknown binary files (UTF-8 / single-byte text).
 */
import {
  decodeBytesAsText,
  decodeLatin1,
  decodeUtf16le,
  readVarint,
  startsWithBytes,
  u32le,
  utf16leBytes,
  writeU32le,
} from './bytes';
import { isMostlyText } from './text';

export interface FoundString {
  /** Byte offset where the text itself begins. Later in the file means saved later. */
  offset: number;
  end: number;
  text: string;
}

/**
 * A Mojo array<uint16> is: uint32 total bytes (8 + 2n), uint32 element count n, then n UTF-16 units.
 * Requiring both numbers to agree makes false matches vanishingly rare and gives exact boundaries.
 */
export function findMojoString16(buf: Uint8Array, minChars = 12, maxChars = 8_000_000): FoundString[] {
  const out: FoundString[] = [];
  const n = buf.length;
  const limit = n - 8;
  let i = 0;
  while (i <= limit) {
    if (buf[i] & 1) {
      i++;
      continue; // 8 + 2n is always even
    }
    const count = u32le(buf, i + 4);
    if (count < minChars || count > maxChars || u32le(buf, i) !== 8 + 2 * count) {
      i++;
      continue;
    }
    const start = i + 8;
    const end = start + 2 * count;
    if (end > n || !startsLikeUtf16Text(buf, start, count)) {
      i++;
      continue;
    }
    const text = decodeUtf16le(buf.subarray(start, end));
    if (!isMostlyText(text)) {
      i++;
      continue;
    }
    out.push({ offset: start, end, text });
    i = end;
  }
  return out;
}

/**
 * A cheap look at the first few UTF-16 units before paying to decode a whole candidate.
 * Without it, binary data that happens to resemble a length prefix (a stored PDF, an image)
 * would be decoded in full again and again, turning a linear scan into a quadratic one.
 */
function startsLikeUtf16Text(buf: Uint8Array, start: number, units: number): boolean {
  const check = Math.min(units, 24);
  for (let k = 0; k < check; k++) {
    const c = buf[start + 2 * k] | (buf[start + 2 * k + 1] << 8);
    if ((c < 0x20 && c !== 9 && c !== 10 && c !== 13) || (c >= 0x7f && c <= 0x9f) || c >= 0xfffe) return false;
  }
  return true;
}

const FORM_CONTROL_TYPES =['textarea', 'text', 'search', 'email', 'url', 'tel', 'number'] as const;

const FORM_MARKERS = FORM_CONTROL_TYPES.map((type) => {
  const data = utf16leBytes(type);
  const bytes = new Uint8Array(8 + data.length);
  writeU32le(bytes, 0, 8 + data.length);
  writeU32le(bytes, 4, type.length);
  bytes.set(data, 8);
  return { type, bytes };
});

/**
 * Chromium saves each form control as four strings in a row: name, type, value count, value.
 * Every string is a 16-byte struct header followed by its array, padded to 8 bytes. So the
 * value's array header sits at a fixed distance after the type string:
 *
 *   [type array, padded] [16: struct] [16: count array "1"] [16: struct] [value array header]
 *
 * Checking that exact position (measured on real Chrome session files: 72 bytes after the
 * start of "textarea", 64 after "text") tells us a string was the contents of a text box,
 * and never mistakes the next field's name for typed text.
 */
export function formControlTypeBefore(buf: Uint8Array, valueOffset: number): string | null {
  const header = valueOffset - 8;
  for (const marker of FORM_MARKERS) {
    const at = header - 48 - ((marker.bytes.length + 7) & ~7);
    if (at >= 0 && startsWithBytes(buf, marker.bytes, at)) return marker.type;
  }
  return null;
}

function isPrintableLatin1(b: Uint8Array): boolean {
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (!(c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e) || c >= 0xa0)) return false;
  }
  return true;
}

const dec8strict = new TextDecoder('utf-8', { fatal: true });

/** V8 serialised strings: '"' + length + Latin-1, 'c' + byte length + UTF-16LE, 'S' + length + UTF-8. */
export function findV8Strings(value: Uint8Array, minChars: number): string[] {
  const out: string[] = [];
  const n = value.length;
  let i = 0;
  while (i < n - 2) {
    const tag = value[i];
    if (tag === 0x63 || tag === 0x22 || tag === 0x53) {
      let len = 0;
      let j = 0;
      try {
        [len, j] = readVarint(value, i + 1);
      } catch {
        break;
      }
      const minBytes = tag === 0x63 ? minChars * 2 : minChars;
      if (len >= minBytes && j + len <= n) {
        const body = value.subarray(j, j + len);
        let text: string | null = null;
        if (tag === 0x63) {
          if (len % 2 === 0 && startsLikeUtf16Text(value, j, len / 2)) {
            const t = decodeUtf16le(body);
            if (isMostlyText(t)) text = t;
          }
        } else if (tag === 0x22) {
          if (isPrintableLatin1(body)) text = decodeLatin1(body);
        } else if (isPrintableLatin1(body.subarray(0, 24))) {
          try {
            const t = dec8strict.decode(body);
            if (isMostlyText(t)) text = t;
          } catch {
            text = null;
          }
        }
        if (text !== null) {
          out.push(text);
          i = j + len;
          continue;
        }
      }
    }
    i++;
  }
  return out;
}

export interface RawRun {
  offset: number;
  text: string;
}

function isAsciiText(c: number): boolean {
  return c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e);
}

/**
 * Runs of ASCII text, well-formed UTF-8 sequences, and single accented Latin-1 letters that sit
 * between ASCII characters. Stray high bytes end a run, so binary noise is not glued onto text.
 */
export function findByteRuns(buf: Uint8Array, minBytes: number): RawRun[] {
  const out: RawRun[] = [];
  const n = buf.length;
  let start = -1;
  let i = 0;
  const flush = (end: number): void => {
    if (start >= 0 && end - start >= minBytes) {
      out.push({ offset: start, text: decodeBytesAsText(buf.subarray(start, end)) });
    }
    start = -1;
  };
  while (i < n) {
    const c = buf[i];
    let len = 0;
    if (isAsciiText(c)) {
      len = 1;
    } else if (c >= 0xc2 && c <= 0xf4) {
      len = c <= 0xdf ? 2 : c <= 0xef ? 3 : 4;
      if (i + len > n) len = 0;
      for (let k = 1; k < len; k++) {
        if ((buf[i + k] & 0xc0) !== 0x80) {
          len = 0;
          break;
        }
      }
    }
    if (len === 0 && c >= 0xc0 && i > 0 && i + 1 < n && isAsciiText(buf[i - 1]) && isAsciiText(buf[i + 1])) len = 1;
    if (len === 0) {
      flush(i);
      i++;
      continue;
    }
    if (start < 0) start = i;
    i += len;
  }
  flush(n);
  return out;
}

/**
 * Latin, Greek, Cyrillic and common punctuation only. Scripts written without spaces cannot be
 * told apart from random bytes in a blind scan; they are recovered by the exact finders above.
 */
function isTextUnit(c: number): boolean {
  return (
    c === 9 ||
    c === 10 ||
    c === 13 ||
    (c >= 0x20 && c <= 0x7e) ||
    (c >= 0xa0 && c <= 0x24f) ||
    (c >= 0x370 && c <= 0x52f) ||
    (c >= 0x2010 && c <= 0x205e) ||
    (c >= 0x20a0 && c <= 0x20bf) ||
    c === 0x2122
  );
}

export function findUtf16Runs(buf: Uint8Array, minChars: number): RawRun[] {
  const out: RawRun[] = [];
  const n = buf.length;
  for (let parity = 0; parity < 2; parity++) {
    let start = -1;
    for (let i = parity; ; i += 2) {
      const has = i + 1 < n;
      if (has && isTextUnit(buf[i] | (buf[i + 1] << 8))) {
        if (start < 0) start = i;
        continue;
      }
      if (start >= 0) {
        if ((i - start) / 2 >= minChars) out.push({ offset: start, text: decodeUtf16le(buf.subarray(start, i)) });
        start = -1;
      }
      if (!has) break;
    }
  }
  out.sort((a, b) => a.offset - b.offset);
  return out;
}

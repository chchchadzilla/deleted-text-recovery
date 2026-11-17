/**
 * Builders for synthetic autosave files.
 *
 * Tests and the in-app demo use these so that no real browser data is ever needed as a fixture.
 * Each builder writes the same on-disk layout the matching reader expects.
 */
import { asciiBytes, concatBytes, utf16leBytes, writeU32le, writeVarint } from './bytes';

/** A Mojo array<uint16>: uint32 byte count, uint32 element count, UTF-16 data, padded to 8 bytes. */
export function mojoString16(text: string): Uint8Array {
  const data = utf16leBytes(text);
  const out = new Uint8Array((8 + data.length + 7) & ~7);
  writeU32le(out, 0, 8 + data.length);
  writeU32le(out, 4, text.length);
  out.set(data, 8);
  return out;
}

function noise(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

const STRUCT_HEADER = new Uint8Array([16, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0]);

export interface FakeSessionOptions {
  fieldType?: string;
  fieldName?: string;
  /** Strings stored near each snapshot that are not form fields (page titles and the like). */
  otherStrings?: string[];
}

/** A tab-restore file holding one saved form state per snapshot, oldest first. */
export function fakeChromiumSession(snapshots: string[], opts: FakeSessionOptions = {}): Uint8Array {
  const parts: Uint8Array[] = [asciiBytes('SNSS'), new Uint8Array([3, 0, 0, 0])];
  snapshots.forEach((snapshot, i) => {
    parts.push(noise(48, 1000 + i));
    for (const s of opts.otherStrings ?? []) parts.push(STRUCT_HEADER, mojoString16(s), noise(300, 7000 + i));
    parts.push(
      STRUCT_HEADER,
      mojoString16(opts.fieldName ?? 'message'),
      STRUCT_HEADER,
      mojoString16(opts.fieldType ?? 'textarea'),
      STRUCT_HEADER,
      mojoString16('1'),
      STRUCT_HEADER,
      mojoString16(snapshot),
      noise(32, 5000 + i),
    );
  });
  return concatBytes(parts);
}

/** Prefixes of `text` at growing lengths, ending with the whole text: what typing leaves behind. */
export function typingSnapshots(text: string, steps: number): string[] {
  const out: string[] = [];
  for (let k = 1; k <= steps; k++) out.push(text.slice(0, Math.ceil((text.length * k) / steps)));
  return out;
}

export interface FakeEntry {
  key: Uint8Array;
  value: Uint8Array | null;
}

const LOG_BLOCK = 32768;

/** A LevelDB write-ahead log with one write batch per entry, fragmented across blocks as needed. */
export function fakeLevelDbLog(entries: FakeEntry[], firstSeq = 1): Uint8Array {
  const chunks: Uint8Array[] = [];
  let pos = 0;
  const emit = (b: Uint8Array): void => {
    chunks.push(b);
    pos += b.length;
  };
  entries.forEach((e, i) => {
    const seq = firstSeq + i;
    const head = new Uint8Array(12);
    writeU32le(head, 0, seq >>> 0);
    writeU32le(head, 4, Math.floor(seq / 2 ** 32));
    writeU32le(head, 8, 1);
    const pieces: Uint8Array[] = [head, new Uint8Array([e.value ? 1 : 0]), new Uint8Array(writeVarint(e.key.length)), e.key];
    if (e.value) pieces.push(new Uint8Array(writeVarint(e.value.length)), e.value);
    const rec = concatBytes(pieces);
    let off = 0;
    let first = true;
    while (off < rec.length) {
      let left = LOG_BLOCK - (pos % LOG_BLOCK);
      if (left < 7) {
        emit(new Uint8Array(left));
        left = LOG_BLOCK;
      }
      const take = Math.min(rec.length - off, left - 7);
      const last = off + take === rec.length;
      const header = new Uint8Array(7);
      header[4] = take & 0xff;
      header[5] = take >>> 8;
      header[6] = first && last ? 1 : first ? 2 : last ? 4 : 3;
      emit(header);
      emit(rec.subarray(off, off + take));
      off += take;
      first = false;
    }
  });
  return concatBytes(chunks);
}

/** Valid Snappy that uses literals only. */
export function snappyLiteral(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array(writeVarint(data.length))];
  for (let off = 0; off < data.length; off += 65536) {
    const chunk = data.subarray(off, off + 65536);
    const n = chunk.length - 1;
    parts.push(n < 60 ? new Uint8Array([n << 2]) : new Uint8Array([61 << 2, n & 0xff, n >>> 8]), chunk);
  }
  return concatBytes(parts);
}

/** A one-block LevelDB table (.ldb), optionally Snappy-compressed. */
export function fakeLevelDbTable(entries: FakeEntry[], opts: { compress?: boolean; firstSeq?: number } = {}): Uint8Array {
  const body: Uint8Array[] = [];
  let lastKey = new Uint8Array(0);
  entries.forEach((e, i) => {
    const seq = (opts.firstSeq ?? 1) + i;
    const ikey = new Uint8Array(e.key.length + 8);
    ikey.set(e.key);
    writeU32le(ikey, e.key.length, (((seq & 0xffffff) << 8) | (e.value ? 1 : 0)) >>> 0);
    writeU32le(ikey, e.key.length + 4, Math.floor(seq / 2 ** 24));
    const value = e.value ?? new Uint8Array(0);
    body.push(new Uint8Array([...writeVarint(0), ...writeVarint(ikey.length), ...writeVarint(value.length)]), ikey, value);
    lastKey = ikey;
  });
  const restarts = new Uint8Array(8);
  writeU32le(restarts, 4, 1);
  const dataBlock = concatBytes([...body, restarts]);
  const stored = opts.compress ? snappyLiteral(dataBlock) : dataBlock;
  const trailer = (type: number): Uint8Array => new Uint8Array([type, 0, 0, 0, 0]);
  const handle = (off: number, size: number): Uint8Array => new Uint8Array([...writeVarint(off), ...writeVarint(size)]);
  const dataHandle = handle(0, stored.length);
  const indexBlock = concatBytes([
    new Uint8Array([...writeVarint(0), ...writeVarint(lastKey.length), ...writeVarint(dataHandle.length)]),
    lastKey,
    dataHandle,
    restarts,
  ]);
  const metaBlock = restarts.slice();
  const metaOff = stored.length + 5;
  const indexOff = metaOff + metaBlock.length + 5;
  const footer = new Uint8Array(48);
  footer.set(concatBytes([handle(metaOff, metaBlock.length), handle(indexOff, indexBlock.length)]));
  writeU32le(footer, 40, 0x8b80fb57);
  writeU32le(footer, 44, 0xdb477524);
  return concatBytes([stored, trailer(opts.compress ? 1 : 0), metaBlock, trailer(0), indexBlock, trailer(0), footer]);
}

/** Chromium Local Storage key: "_" + origin + NUL + encoding byte + key. */
export function localStorageKey(origin: string, key: string): Uint8Array {
  return concatBytes([asciiBytes('_' + origin), new Uint8Array([0, 1]), asciiBytes(key)]);
}

/** Chromium Local Storage value: 1 + Latin-1 when possible, otherwise 0 + UTF-16. */
export function localStorageValue(text: string): Uint8Array {
  let narrow = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0xff) {
      narrow = false;
      break;
    }
  }
  return narrow
    ? concatBytes([new Uint8Array([1]), asciiBytes(text)])
    : concatBytes([new Uint8Array([0]), utf16leBytes(text)]);
}

/** A Firefox ".jsonlz4" file holding `json`, using a literal-only LZ4 block. */
export function fakeMozLz4(json: string): Uint8Array {
  const body = new TextEncoder().encode(json);
  const head: number[] = [];
  if (body.length < 15) {
    head.push(body.length << 4);
  } else {
    head.push(0xf0);
    let rest = body.length - 15;
    while (rest >= 255) {
      head.push(255);
      rest -= 255;
    }
    head.push(rest);
  }
  const size = new Uint8Array(4);
  writeU32le(size, 0, body.length);
  return concatBytes([asciiBytes('mozLz40\0'), size, new Uint8Array(head), body]);
}

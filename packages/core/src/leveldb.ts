/**
 * Read-only LevelDB readers.
 *
 * Chromium browsers and Electron apps keep Local Storage, Session Storage, IndexedDB and
 * extension storage in LevelDB. Two file kinds matter:
 *   NNNNNN.log  the write-ahead journal: every recent write, uncompressed, in order
 *   NNNNNN.ldb  sorted tables, Snappy-compressed in blocks
 * Old values are not erased when they are overwritten or deleted. They stay in these files
 * until a background compaction rewrites them, which is exactly why lost text is often still here.
 *
 * Checksums are intentionally not verified: a slightly damaged file is still worth reading.
 */
import { concatBytes, readVarint, u32le } from './bytes';
import { snappyDecompress } from './compression';

export interface LevelDbEntry {
  /** Sequence number: higher means written later. */
  seq: number;
  key: Uint8Array;
  /** null when this entry records a deletion. */
  value: Uint8Array | null;
}

const BLOCK_SIZE = 32768;
const HEADER_SIZE = 7;

export function parseLevelDbLog(data: Uint8Array): LevelDbEntry[] {
  const out: LevelDbEntry[] = [];
  const n = data.length;
  let pos = 0;
  let pending: Uint8Array[] | null = null;
  while (pos + HEADER_SIZE <= n) {
    const blockStart = pos - (pos % BLOCK_SIZE);
    const left = BLOCK_SIZE - (pos - blockStart);
    if (left < HEADER_SIZE) {
      pos += left;
      continue;
    }
    const length = data[pos + 4] | (data[pos + 5] << 8);
    const type = data[pos + 6];
    if (type === 0 && length === 0) {
      pos += left; // preallocated or zero-padded tail of a block
      continue;
    }
    if (type < 1 || type > 4 || HEADER_SIZE + length > left) {
      pos = blockStart + BLOCK_SIZE; // damaged record: resynchronise at the next block
      pending = null;
      continue;
    }
    const payload = data.subarray(pos + HEADER_SIZE, Math.min(pos + HEADER_SIZE + length, n));
    pos += HEADER_SIZE + length;
    if (type === 1) {
      readWriteBatch(payload, out);
      pending = null;
    } else if (type === 2) {
      pending = [payload];
    } else if (type === 3) {
      if (pending) pending.push(payload);
    } else if (pending) {
      pending.push(payload);
      readWriteBatch(concatBytes(pending), out);
      pending = null;
    }
  }
  return out;
}

function readWriteBatch(rec: Uint8Array, out: LevelDbEntry[]): void {
  if (rec.length < 12) return;
  const seq = u32le(rec, 0) + u32le(rec, 4) * 2 ** 32;
  const count = u32le(rec, 8);
  let i = 12;
  try {
    for (let k = 0; k < count && i < rec.length; k++) {
      const tag = rec[i++];
      let klen: number;
      [klen, i] = readVarint(rec, i);
      if (i + klen > rec.length) return;
      const key = rec.subarray(i, i + klen);
      i += klen;
      if (tag === 1) {
        let vlen: number;
        [vlen, i] = readVarint(rec, i);
        if (i + vlen > rec.length) return;
        out.push({ seq: seq + k, key, value: rec.subarray(i, i + vlen) });
        i += vlen;
      } else if (tag === 0) {
        out.push({ seq: seq + k, key, value: null });
      } else {
        return;
      }
    }
  } catch {
    // truncated batch: keep what was read
  }
}

const TABLE_MAGIC_LO = 0x8b80fb57;
const TABLE_MAGIC_HI = 0xdb477524;
const FOOTER_SIZE = 48;

export function isLevelDbTable(data: Uint8Array): boolean {
  const n = data.length;
  return n >= FOOTER_SIZE && u32le(data, n - 8) === TABLE_MAGIC_LO && u32le(data, n - 4) === TABLE_MAGIC_HI;
}

export function parseLevelDbTable(data: Uint8Array): LevelDbEntry[] {
  if (!isLevelDbTable(data)) throw new Error('not a LevelDB table file');
  const out: LevelDbEntry[] = [];
  let p = data.length - FOOTER_SIZE;
  [, p] = readVarint(data, p); // metaindex offset
  [, p] = readVarint(data, p); // metaindex size
  let ixOff: number;
  let ixSize: number;
  [ixOff, p] = readVarint(data, p);
  [ixSize, p] = readVarint(data, p);
  const index = readBlock(data, ixOff, ixSize);
  for (const [, handle] of blockEntries(index)) {
    try {
      const [off, q] = readVarint(handle, 0);
      const [size] = readVarint(handle, q);
      for (const [ikey, val] of blockEntries(readBlock(data, off, size))) {
        const kl = ikey.length;
        if (kl < 8) continue;
        const lo = u32le(ikey, kl - 8);
        const hi = u32le(ikey, kl - 4);
        const seq = (lo >>> 8) + hi * 2 ** 24;
        out.push({ seq, key: ikey.subarray(0, kl - 8), value: (lo & 0xff) === 1 ? val : null });
      }
    } catch {
      // one damaged or unsupported block must not hide the rest of the table
    }
  }
  return out;
}

function readBlock(data: Uint8Array, off: number, size: number): Uint8Array {
  if (off + size + 1 > data.length) throw new Error('block lies outside the file');
  const raw = data.subarray(off, off + size);
  const compression = data[off + size];
  if (compression === 0) return raw;
  if (compression === 1) return snappyDecompress(raw);
  throw new Error(`unsupported block compression type ${compression}`);
}

function* blockEntries(block: Uint8Array): Generator<[Uint8Array, Uint8Array]> {
  if (block.length < 4) return;
  const restarts = u32le(block, block.length - 4);
  const end = block.length - 4 - 4 * restarts;
  if (end < 0) throw new Error('block restart array is damaged');
  let i = 0;
  let key = new Uint8Array(0);
  while (i < end) {
    let shared: number;
    let nonShared: number;
    let vlen: number;
    [shared, i] = readVarint(block, i);
    [nonShared, i] = readVarint(block, i);
    [vlen, i] = readVarint(block, i);
    if (shared > key.length || i + nonShared + vlen > end) throw new Error('block entry is damaged');
    const k = new Uint8Array(shared + nonShared);
    k.set(key.subarray(0, shared));
    k.set(block.subarray(i, i + nonShared), shared);
    i += nonShared;
    const v = block.subarray(i, i + vlen);
    i += vlen;
    key = k;
    yield [k, v];
  }
}

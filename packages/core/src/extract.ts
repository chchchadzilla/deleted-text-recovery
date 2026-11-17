/**
 * One file in, passages out. The file's real format is decided by its contents first and its
 * path second, so a renamed or copied file is still read correctly.
 */
import { asciiBytes, decodeBytesAsText, decodeUtf16le, startsWithBytes } from './bytes';
import { classifyPath, MAX_FILE_BYTES } from './classify';
import { isMozLz4 } from './compression';
import { isLevelDbTable, parseLevelDbLog, parseLevelDbTable } from './leveldb';
import { candidatesFromFirefoxSession, candidatesFromLevelDb, type Candidate } from './storage';
import { findByteRuns, findMojoString16, findUtf16Runs, formControlTypeBefore } from './strings';
import { isMostlyText, looksLikeUrl, normalizeText, proseScore } from './text';
import type { ExtractOptions, FileMeta, FileType, Kind, Passage } from './types';

const SNSS_MAGIC = asciiBytes('SNSS');
const DEFAULT_MIN_CHARS = 40;
const TYPED_MIN_CHARS = 12;
const MAX_TEXT_FILE_BYTES = 4 * 1024 * 1024;

export interface ExtractResult {
  type: FileType;
  passages: Passage[];
  /** Set when the file was skipped or only partly readable. */
  note?: string;
}

export function extractPassages(
  path: string,
  data: Uint8Array,
  meta: FileMeta = {},
  opts: ExtractOptions = {},
): ExtractResult {
  const cls = classifyPath(path);
  if (cls.forbidden) {
    return { type: 'unknown', passages: [], note: 'skipped: this file can hold passwords, cookies or payment details, so it is never read' };
  }
  if (data.length > MAX_FILE_BYTES) {
    return { type: cls.type, passages: [], note: 'skipped: larger than 256 MB' };
  }
  const minChars = Math.max(20, opts.minChars ?? DEFAULT_MIN_CHARS);

  let type: FileType = cls.type;
  if (startsWithBytes(data, SNSS_MAGIC)) type = 'chromium-session';
  else if (isMozLz4(data)) type = 'firefox-session';
  else if (isLevelDbTable(data)) type = 'leveldb-table';
  else if (type !== 'leveldb-log' && type !== 'text-backup' && type !== 'binary-backup') {
    type = looksLikeTextFile(data) ? 'text-backup' : 'binary-backup';
  }
  if (type === 'text-backup' && (data.length > MAX_TEXT_FILE_BYTES || !looksLikeTextFile(data))) type = 'binary-backup';

  const isBackupPlace = cls.type === 'text-backup' || cls.type === 'binary-backup';
  const looseKind: Kind = isBackupPlace ? 'backup' : 'other';
  const passages: Passage[] = [];
  const push = (c: Candidate): void => {
    passages.push({
      text: c.text,
      kind: c.kind,
      file: path,
      area: cls.area,
      app: meta.app ?? cls.app,
      profile: cls.profile,
      origin: c.origin ?? cls.origin,
      key: c.key,
      field: c.field,
      order: c.order,
      mtimeMs: meta.mtimeMs,
      hinted: c.hinted,
      wasHtml: c.wasHtml,
    });
  };

  try {
    switch (type) {
      case 'chromium-session':
        fromChromiumSession(data, minChars).forEach(push);
        break;
      case 'firefox-session':
        candidatesFromFirefoxSession(data, minChars).forEach(push);
        break;
      case 'leveldb-log':
        candidatesFromLevelDb(parseLevelDbLog(data), cls.flavor, minChars).forEach(push);
        break;
      case 'leveldb-table':
        candidatesFromLevelDb(parseLevelDbTable(data), cls.flavor, minChars).forEach(push);
        break;
      case 'text-backup': {
        const text = normalizeText(decodeTextFile(data));
        if (text.length >= minChars && isMostlyText(text)) push({ text, kind: looseKind, order: 0 });
        break;
      }
      default:
        fromRawScan(data, minChars, looseKind).forEach(push);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { type, passages, note: `could not be fully read (${message})` };
  }
  return { type, passages };
}

/**
 * Chromium re-saves the state of every form field on a page into the tab-restore file as you
 * type, and old saves stay in the file. Each save of a long message is a full copy of it.
 */
function fromChromiumSession(data: Uint8Array, minChars: number): Candidate[] {
  const out: Candidate[] = [];
  const found = findMojoString16(data, TYPED_MIN_CHARS);
  for (const f of found) {
    const text = normalizeText(f.text);
    if (text.length < TYPED_MIN_CHARS) continue;
    const field = formControlTypeBefore(data, f.offset);
    if (field) {
      out.push({ text, kind: 'typed', order: f.offset, field });
    } else if (text.length >= minChars && !looksLikeUrl(text) && proseScore(text) >= 0.5) {
      out.push({ text, kind: 'other', order: f.offset });
    }
  }
  if (found.length === 0) return fromRawScan(data, minChars, 'other');
  return out;
}

function fromRawScan(data: Uint8Array, minChars: number, kind: Kind): Candidate[] {
  const out: Candidate[] = [];
  const min = Math.max(minChars, 40);
  const consider = (offset: number, raw: string): void => {
    const text = normalizeText(raw);
    if (text.length >= min && isMostlyText(text) && proseScore(text) >= 0.5) out.push({ text, kind, order: offset });
  };
  for (const r of findUtf16Runs(data, min)) consider(r.offset, r.text);
  for (const r of findByteRuns(data, min)) consider(r.offset, r.text);
  return out;
}

function looksLikeTextFile(data: Uint8Array): boolean {
  const n = Math.min(data.length, 8192);
  if (n === 0) return false;
  if (n >= 2 && ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff))) return true;
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const c = data[i];
    if (c === 0) return false;
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13 && c !== 12) odd++;
  }
  return odd <= n * 0.02;
}

function decodeTextFile(data: Uint8Array): string {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return decodeUtf16le(data.subarray(2, 2 + ((data.length - 2) & ~1)));
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    const swapped = new Uint8Array((data.length - 2) & ~1);
    for (let i = 0; i < swapped.length; i += 2) {
      swapped[i] = data[i + 3];
      swapped[i + 1] = data[i + 2];
    }
    return decodeUtf16le(swapped);
  }
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return decodeBytesAsText(data.subarray(3));
  }
  return decodeBytesAsText(data);
}

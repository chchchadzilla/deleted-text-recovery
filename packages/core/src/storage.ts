/**
 * Turns raw LevelDB entries into candidate passages, according to which Chromium storage
 * area they came from. Also reads Firefox session files, which are JSON once decompressed.
 */
import { decodeBytesAsText, decodeLatin1, decodeUtf16le } from './bytes';
import { decodeMozLz4 } from './compression';
import type { LevelDbEntry } from './leveldb';
import { findV8Strings } from './strings';
import { htmlToTextIfHtml, isMostlyText, normalizeText, proseScore } from './text';
import type { Kind, StorageFlavor } from './types';

export interface Candidate {
  text: string;
  kind: Kind;
  order: number;
  origin?: string;
  key?: string;
  field?: string;
  hinted?: boolean;
  wasHtml?: boolean;
}

const MAX_VALUE_BYTES = 16 * 1024 * 1024;
const MAX_JSON_CHARS = 8 * 1024 * 1024;
const UNHINTED_MIN_CHARS = 80;
const DRAFT_KEY = /draft|autosave|auto-save|unsaved|unsent|compos|editor|comment|reply|message|note|body|post|prompt|input|textarea|content|text/i;

/** Chromium prefixes stored strings with 0 (UTF-16) or 1 (Latin-1). */
function decodePrefixed(b: Uint8Array): string {
  if (b.length === 0) return '';
  if (b[0] === 0) return decodeUtf16le(b.subarray(1, 1 + ((b.length - 1) & ~1)));
  if (b[0] === 1) return decodeLatin1(b.subarray(1));
  return decodeLatin1(b);
}

function looksUtf16(b: Uint8Array): boolean {
  if (b.length < 2 || b.length % 2 !== 0) return false;
  let zeros = 0;
  for (let i = 1; i < b.length; i += 2) if (b[i] === 0) zeros++;
  return zeros >= b.length / 4;
}

type Sink = (raw: string, key: string | undefined) => void;

/** Websites usually store JSON. Unwrap it, and JSON inside JSON, to reach the actual strings. */
function unwrap(raw: string, key: string | undefined, depth: number, sink: Sink): void {
  const t = raw.trim();
  if (t.length < 8) return;
  const c0 = t.charCodeAt(0);
  if (depth < 3 && (c0 === 0x7b || c0 === 0x5b || c0 === 0x22) && t.length <= MAX_JSON_CHARS) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      parsed = undefined;
    }
    if (parsed !== undefined && parsed !== null && typeof parsed !== 'number' && typeof parsed !== 'boolean') {
      walkJson(parsed, key, depth, sink);
      return;
    }
  }
  sink(raw, key);
}

function walkJson(node: unknown, path: string | undefined, depth: number, sink: Sink): void {
  if (typeof node === 'string') {
    unwrap(node, path, depth + 1, sink);
  } else if (Array.isArray(node)) {
    for (let i = 0; i < node.length && i < 20000; i++) walkJson(node[i], path, depth, sink);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walkJson(v, path ? `${path}.${k}` : k, depth, sink);
    }
  }
}

function makeSink(out: Candidate[], minChars: number, order: number, origin: string | undefined, kind: Kind): Sink {
  return (raw, key) => {
    const { text, wasHtml } = htmlToTextIfHtml(raw);
    const norm = normalizeText(text);
    if (norm.length < 20 || !isMostlyText(norm)) return;
    const hinted = key !== undefined && DRAFT_KEY.test(key);
    const score = proseScore(norm);
    // Websites store a great deal of their own wording (menus, help text, cached articles).
    // Without a key that looks like a draft, ask for a couple of sentences of real prose.
    const ok = hinted ? score >= 0.3 : norm.length >= Math.max(minChars, UNHINTED_MIN_CHARS) && score >= 0.5;
    if (!ok) return;
    out.push({ text: norm, kind, order, origin, key: key ? key.slice(0, 160) : undefined, hinted, wasHtml });
  };
}

export function candidatesFromLevelDb(entries: LevelDbEntry[], flavor: StorageFlavor, minChars: number): Candidate[] {
  const out: Candidate[] = [];
  const mapOrigins = new Map<string, string>();
  if (flavor === 'session-storage') {
    for (const e of entries) {
      if (!e.value || e.key.length < 48 || e.key[0] !== 0x6e) continue;
      const k = decodeLatin1(e.key);
      if (!k.startsWith('namespace-')) continue;
      mapOrigins.set(decodeLatin1(e.value), k.slice(47).split('^')[0]);
    }
  }
  for (const e of entries) {
    const value = e.value;
    if (!value || value.length < 20 || value.length > MAX_VALUE_BYTES) continue;
    let origin: string | undefined;
    let key: string | undefined;
    let strings: string[];
    if (flavor === 'local-storage') {
      if (e.key[0] !== 0x5f) continue;
      const z = e.key.indexOf(0, 1);
      if (z < 0) continue;
      origin = decodeLatin1(e.key.subarray(1, z)).split('^')[0];
      key = decodePrefixed(e.key.subarray(z + 1));
      strings = [decodePrefixed(value)];
    } else if (flavor === 'session-storage') {
      const m = /^map-(\d+)-/.exec(decodeLatin1(e.key.subarray(0, Math.min(e.key.length, 24))));
      if (!m) continue;
      origin = mapOrigins.get(m[1]);
      const rest = e.key.subarray(m[0].length);
      key = looksUtf16(rest) ? decodeUtf16le(rest) : decodeLatin1(rest);
      strings = [looksUtf16(value) ? decodeUtf16le(value) : decodeLatin1(value)];
    } else if (flavor === 'indexeddb') {
      strings = findV8Strings(value, 20);
    } else {
      key = decodeBytesAsText(e.key).replace(/[^\x20-\x7e]/g, '').slice(0, 160) || undefined;
      strings = [decodeBytesAsText(value)];
    }
    const sink = makeSink(out, minChars, e.seq, origin, 'draft');
    for (const s of strings) unwrap(s, key, 0, sink);
  }
  return out;
}

const dec8 = new TextDecoder('utf-8');

/**
 * Firefox keeps the contents of form fields explicitly, under "formdata", for every open tab
 * and for recently closed tabs and windows. It also keeps each tab's session storage.
 */
export function candidatesFromFirefoxSession(data: Uint8Array, minChars: number): Candidate[] {
  const json: unknown = JSON.parse(dec8.decode(decodeMozLz4(data)));
  const out: Candidate[] = [];
  let order = 0;

  const formStrings = (node: unknown, origin: string | undefined, field: string | undefined): void => {
    if (typeof node === 'string') {
      const { text, wasHtml } = htmlToTextIfHtml(node);
      const norm = normalizeText(text);
      if (norm.length >= 12 && isMostlyText(norm)) {
        out.push({ text: norm, kind: 'typed', order: order++, origin, field, wasHtml });
      }
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'url') continue;
        formStrings(v, origin, k === 'id' || k === 'xpath' ? field : k);
      }
    }
  };

  const walk = (node: unknown, url: string | undefined, depth: number): void => {
    if (depth > 64 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, url, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const here = typeof obj.url === 'string' ? originOf(obj.url) : url;
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'formdata') {
        formStrings(v, here, undefined);
      } else if (k === 'storage' && v && typeof v === 'object') {
        for (const [origin, kv] of Object.entries(v as Record<string, unknown>)) {
          if (!kv || typeof kv !== 'object') continue;
          for (const [key, val] of Object.entries(kv as Record<string, unknown>)) {
            if (typeof val !== 'string') continue;
            unwrap(val, key, 0, makeSink(out, minChars, order++, origin, 'draft'));
          }
        }
      } else {
        walk(v, here, depth + 1);
      }
    }
  };

  walk(json, undefined, 0);
  return out;
}

function originOf(url: string): string | undefined {
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(url);
  return m ? m[1] : undefined;
}

/**
 * Turns thousands of raw passages into a short, ranked list of findings.
 *
 * The same text usually exists many times: a browser saves a text box again and again as you
 * type. Those copies are grouped into one finding with a version history. A growing trail of
 * copies is also the strongest sign that a piece of text was typed live, so it ranks highest.
 */
import { countWords, normalizeText, proseScore } from './text';
import type { Finding, Kind, Passage, SourceRef, Version } from './types';

const KIND_RANK: Record<Kind, number> = { typed: 3, draft: 2, backup: 2, other: 1 };
const KIND_BASE: Record<Kind, number> = { typed: 1, draft: 0.62, backup: 0.66, other: 0.42 };
const MAX_VERSIONS = 60;
const MAX_SOURCES = 6;

interface Item {
  text: string;
  best: Passage;
  all: Passage[];
}

interface Cluster {
  items: Item[];
  probes: string[] | null;
  file: string;
}

const MAX_PROBE_CHARS = 200_000;

function isLiveKind(kind: Kind): boolean {
  return kind === 'typed' || kind === 'draft';
}

const PREFIX_CHARS = 36;

function prefixKey(text: string): string {
  return text.slice(0, PREFIX_CHARS).toLowerCase().replace(/\s+/g, ' ');
}

function makeProbes(text: string): string[] {
  const n = text.length;
  return [0.2, 0.5, 0.8].map((f) => text.substr(Math.floor(n * f), 28));
}

function probeHits(probes: string[], text: string): number {
  let hits = 0;
  for (const p of probes) if (text.includes(p)) hits++;
  return hits;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function buildFindings(passages: Passage[], now: number = Date.now()): Finding[] {
  // 1. Identical text found in several places becomes one item with several sources.
  const byText = new Map<string, Item>();
  for (const p of passages) {
    const text = normalizeText(p.text);
    if (!text) continue;
    const hit = byText.get(text);
    if (!hit) {
      byText.set(text, { text, best: p, all: [p] });
      continue;
    }
    hit.all.push(p);
    const better =
      KIND_RANK[p.kind] > KIND_RANK[hit.best.kind] ||
      (KIND_RANK[p.kind] === KIND_RANK[hit.best.kind] && (p.mtimeMs ?? 0) > (hit.best.mtimeMs ?? 0));
    if (better) hit.best = p;
  }

  // 2. Oldest first, so that within a group the last item is the newest saved copy.
  const items = [...byText.values()].sort(
    (a, b) =>
      (a.best.mtimeMs ?? 0) - (b.best.mtimeMs ?? 0) ||
      (a.best.file < b.best.file ? -1 : a.best.file > b.best.file ? 1 : 0) ||
      a.best.order - b.best.order,
  );

  // 3. Group saved copies of the same evolving text: same opening, or same body after an edit.
  const clusters: Cluster[] = [];
  const byPrefix = new Map<string, Cluster>();
  const shortStarts = new Map<string, Cluster>();
  for (const it of items) {
    const key = prefixKey(it.text);
    let c = byPrefix.get(key);
    if (!c) {
      // The first few saves of a message are only a handful of words: the start of the trail.
      for (let len = Math.min(PREFIX_CHARS - 1, key.length - 1); len >= 12 && !c; len--) {
        c = shortStarts.get(key.slice(0, len));
      }
    }
    // An edit to the opening changes the prefix, so also match on the body. This only makes
    // sense for text being typed, and only against recent copies from the same file; keeping
    // it that narrow also keeps grouping fast when there are thousands of large backup files.
    const probeable = isLiveKind(it.best.kind) && it.text.length >= 160 && it.text.length <= MAX_PROBE_CHARS;
    if (!c && probeable) {
      for (let k = clusters.length - 1, seen = 0; k >= 0 && seen < 60; k--, seen++) {
        const cand = clusters[k];
        if (cand.probes && cand.file === it.best.file && probeHits(cand.probes, it.text) >= 2) {
          c = cand;
          break;
        }
      }
    }
    if (!c) {
      c = { items: [], probes: null, file: it.best.file };
      clusters.push(c);
    }
    byPrefix.set(key, c);
    if (it.text.length < PREFIX_CHARS) shortStarts.set(key, c);
    c.items.push(it);
    if (probeable) {
      c.probes = makeProbes(it.text);
      c.file = it.best.file;
    }
  }

  const findings = clusters.map((c, i) => toFinding(c, i, now));
  findings.sort((a, b) => b.score - a.score || (b.newestMtimeMs ?? 0) - (a.newestMtimeMs ?? 0) || b.chars - a.chars);
  return findings;
}

function toFinding(c: Cluster, index: number, now: number): Finding {
  const items = c.items;
  const latest = items[items.length - 1];
  let longest = latest;
  for (const it of items) if (it.text.length > longest.text.length) longest = it;
  // After an accidental delete the newest copy is the damaged one. Prefer the fullest copy then.
  const shownLongest = latest.text.length < 0.6 * longest.text.length;
  const primary = shownLongest ? longest : latest;

  let kind: Kind = 'other';
  let hinted = false;
  let newest: number | undefined;
  for (const it of items) {
    for (const p of it.all) {
      if (KIND_RANK[p.kind] > KIND_RANK[kind]) kind = p.kind;
      if (p.hinted) hinted = true;
      if (p.mtimeMs !== undefined && (newest === undefined || p.mtimeMs > newest)) newest = p.mtimeMs;
    }
  }

  const kept = sampleVersions(items, primary, longest);
  const versions: Version[] = kept.map((it) => ({
    text: it.text,
    chars: it.text.length,
    file: it.best.file,
    mtimeMs: it.best.mtimeMs,
  }));

  const sources: SourceRef[] = [];
  const seen = new Set<string>();
  const addSources = (it: Item): void => {
    // Strongest evidence first, so the place named on the card matches the kind shown.
    const ordered = [...it.all].sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind]);
    for (const p of ordered) {
      const k = `${p.file}|${p.origin ?? ''}|${p.key ?? ''}`;
      if (seen.has(k) || sources.length >= MAX_SOURCES) continue;
      seen.add(k);
      sources.push({ file: p.file, area: p.area, app: p.app, profile: p.profile, origin: p.origin, key: p.key, mtimeMs: p.mtimeMs });
    }
  };
  addSources(primary);
  for (let k = items.length - 1; k >= 0 && sources.length < MAX_SOURCES; k--) addSources(items[k]);

  const chars = primary.text.length;
  const quality = proseScore(primary.text);
  let score = KIND_BASE[kind] * (0.45 + 0.55 * (kind === 'typed' ? Math.max(quality, 0.6) : quality));
  score *= Math.min(1, Math.log10(Math.max(10, chars)) / 3.4);
  if (items.length >= 3) score *= 1.35;
  else if (items.length === 2) score *= 1.12;
  if (hinted) score *= 1.2;
  // Hidden form fields hold long machine-made codes (anti-robot tokens and the like). Nobody
  // types forty characters without a space, so these sink to the bottom instead of the top.
  const tokenLike = chars >= 40 && !/\s/.test(primary.text);
  if (tokenLike) score *= 0.12;
  if (newest !== undefined) {
    const hours = (now - newest) / 3_600_000;
    if (hours <= 24) score *= 1.25;
    else if (hours <= 168) score *= 1.1;
    else if (hours > 2160) score *= 0.85;
  }

  return {
    id: `f${index.toString(36)}-${fnv1a(primary.text.slice(0, 240) + chars)}`,
    text: primary.text,
    kind,
    score,
    chars,
    words: countWords(primary.text),
    why: tokenLike
      ? [...reasons(kind, primary, items.length, shownLongest), 'This looks like a machine-made code rather than writing, so it is ranked low.']
      : reasons(kind, primary, items.length, shownLongest),
    sources,
    versions,
    versionCount: items.length,
    primaryIndex: kept.indexOf(primary),
    newestMtimeMs: newest,
  };
}

function sampleVersions(items: Item[], primary: Item, longest: Item): Item[] {
  if (items.length <= MAX_VERSIONS) return items;
  const keep = new Set<number>([0, items.length - 1, items.indexOf(primary), items.indexOf(longest)]);
  const step = (items.length - 1) / (MAX_VERSIONS - 4);
  for (let k = 0; k < MAX_VERSIONS - 4; k++) keep.add(Math.round(k * step));
  return [...keep].sort((a, b) => a - b).map((i) => items[i]);
}

function reasons(kind: Kind, primary: Item, count: number, shownLongest: boolean): string[] {
  const p = primary.best;
  const app = p.app ?? 'the app';
  const why: string[] = [];
  if (kind === 'typed') {
    why.push(`This was the contents of a text box${p.origin ? ` on ${p.origin}` : ''}, kept in ${app}'s tab-restore history.`);
  } else if (kind === 'draft') {
    why.push(`Saved by ${p.origin ?? 'a website or app'} in its own storage${p.key ? ` (under "${p.key}")` : ''}.`);
  } else if (kind === 'backup') {
    why.push(`${p.area} kept by ${app}.`);
  } else {
    why.push(`Readable text found in ${app}'s files (${p.area.toLowerCase()}).`);
  }
  if (count >= 3) why.push(`Saved ${count} times as it changed, which is what live typing looks like.`);
  else if (count === 2) why.push('Two saved copies exist.');
  if (shownLongest) {
    why.push('The newest copy is much shorter than an earlier one, so the fullest copy is shown. The others are under "Other saved copies".');
  }
  if (p.wasHtml) why.push('Formatting was removed so you get plain text.');
  return why;
}

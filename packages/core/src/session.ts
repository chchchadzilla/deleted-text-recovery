/** The one object both apps use: feed it files, then ask it questions. */
import { buildFindings } from './cluster';
import { extractPassages, type ExtractResult } from './extract';
import type { ExtractOptions, FileMeta, Finding, FindingView, Passage, Query, QueryResult, ScanStats, Version } from './types';

const MAX_IDENTICAL_COPIES = 4;

export class RecoverySession {
  private passages: Passage[] = [];
  private findings: Finding[] = [];
  private byId = new Map<string, Finding>();
  private readonly copies = new Map<string, number>();
  private readonly lowerCache = new Map<string, string>();
  readonly stats: ScanStats = { files: 0, bytes: 0, passages: 0, errors: 0 };
  readonly notes: string[] = [];

  constructor(private readonly options: ExtractOptions = {}) {}

  /** Reads one file. Never throws: problems are recorded in `notes`. */
  addFile(path: string, data: Uint8Array, meta: FileMeta = {}): ExtractResult {
    const result = extractPassages(path, data, meta, this.options);
    this.stats.files++;
    this.stats.bytes += data.length;
    for (const p of result.passages) {
      // Website storage repeats the same value across many files. A few copies are enough to
      // show where a text lives; keeping every one would only cost memory. Text-box history
      // is never thinned, because there each copy is a different moment of typing.
      if (p.kind !== 'typed') {
        const seen = this.copies.get(p.text) ?? 0;
        if (seen >= MAX_IDENTICAL_COPIES) continue;
        this.copies.set(p.text, seen + 1);
      }
      this.passages.push(p);
      this.stats.passages++;
    }
    if (result.note) {
      this.stats.errors++;
      if (this.notes.length < 200) this.notes.push(`${path}: ${result.note}`);
    }
    return result;
  }

  /** Groups and ranks everything read so far. Call again after adding more files. */
  finish(now: number = Date.now()): number {
    this.findings = buildFindings(this.passages, now);
    this.byId = new Map(this.findings.map((f) => [f.id, f]));
    this.lowerCache.clear();
    return this.findings.length;
  }

  get all(): readonly Finding[] {
    return this.findings;
  }

  versions(id: string): Version[] {
    return this.byId.get(id)?.versions ?? [];
  }

  query(query: Query = {}): QueryResult {
    const terms = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const kinds = query.kinds && query.kinds.length ? new Set(query.kinds) : null;
    const minChars = query.minChars ?? 0;
    const limit = query.limit ?? 200;
    const out: FindingView[] = [];
    let matched = 0;
    for (const f of this.findings) {
      if (kinds && !kinds.has(f.kind)) continue;
      if (f.chars < minChars) continue;
      let shown: number | undefined;
      if (terms.length) {
        let lower = this.lowerCache.get(f.id);
        if (lower === undefined) {
          lower = f.text.toLowerCase();
          this.lowerCache.set(f.id, lower);
        }
        if (!terms.every((t) => lower.includes(t))) {
          shown = -1;
          for (let k = f.versions.length - 1; k >= 0; k--) {
            const v = f.versions[k].text.toLowerCase();
            if (terms.every((t) => v.includes(t))) {
              shown = k;
              break;
            }
          }
          if (shown < 0) continue;
        }
      }
      matched++;
      if (out.length >= limit) continue;
      const { versions, ...rest } = f;
      if (shown === undefined) {
        out.push(rest);
      } else {
        const v = versions[shown];
        out.push({ ...rest, text: v.text, chars: v.chars, shownVersion: shown });
      }
    }
    return { total: this.findings.length, matched, findings: out };
  }
}

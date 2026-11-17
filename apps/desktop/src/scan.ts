/** Reads the discovered files (read-only) and feeds them to the engine. */
import { readFile } from 'node:fs/promises';
import { RecoverySession } from '@deleted-text-recovery/core';
import { discover, discoverPaths, type FoundFile } from './discover';

export interface Progress {
  done: number;
  total: number;
  current?: string;
  found: number;
}

export interface Summary {
  files: number;
  bytes: number;
  findings: number;
  locked: { path: string; app?: string }[];
  notes: string[];
  ms: number;
  places: string[];
  timings: { discoverMs: number; readMs: number; groupMs: number };
}

export interface ScanOptions {
  days: number;
  paths?: string[];
  onProgress?: (p: Progress) => void;
  /** Diagnostics: called after each file with how long it took. */
  onFile?: (info: { path: string; ms: number; bytes: number; passages: number }) => void;
}

const LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

export async function scan(opts: ScanOptions): Promise<{ session: RecoverySession; summary: Summary }> {
  const started = Date.now();
  const session = new RecoverySession();
  const files: FoundFile[] = opts.paths && opts.paths.length ? await discoverPaths(opts.paths) : await discover(opts.days);
  const discoverMs = Date.now() - started;
  const locked: Summary['locked'] = [];
  const places = new Set<string>();
  let done = 0;
  for (const f of files) {
    opts.onProgress?.({ done, total: files.length, current: f.path, found: session.stats.passages });
    const fileStarted = Date.now();
    try {
      const data = await readFile(f.path);
      const result = session.addFile(f.path, data, { mtimeMs: f.mtimeMs, app: f.app, explicit: f.explicit });
      if (f.app) places.add(f.app);
      opts.onFile?.({ path: f.path, ms: Date.now() - fileStarted, bytes: data.length, passages: result.passages.length });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (LOCK_CODES.has(code)) locked.push({ path: f.path, app: f.app });
      else if (code !== 'ENOENT') session.notes.push(`${f.path}: could not be read (${code || 'unknown error'})`);
    }
    done++;
  }
  opts.onProgress?.({ done, total: files.length, found: session.stats.passages });
  const groupStarted = Date.now();
  const findings = session.finish();
  const groupMs = Date.now() - groupStarted;
  return {
    session,
    summary: {
      files: session.stats.files,
      bytes: session.stats.bytes,
      findings,
      locked,
      notes: session.notes,
      ms: Date.now() - started,
      places: [...places].sort(),
      timings: { discoverMs, readMs: groupStarted - started - discoverMs, groupMs },
    },
  };
}

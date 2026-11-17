/**
 * Scanning inside the browser tab. Runs in a Web Worker when possible, on the page itself
 * otherwise. Files are read with the File API straight from the person's disk into memory;
 * nothing is uploaded, and this code contains no network calls at all.
 */
import { RecoverySession, classifyPath, type Query, type QueryResult, type Version } from '@deleted-text-recovery/core';
import { buildDemoFiles } from './demo';
import type { LockedFile, PickedFile, ProgressFn, ScanSummary } from './protocol';

export class BrowserEngine {
  private session = new RecoverySession();
  private locked: LockedFile[] = [];

  reset(): void {
    this.session = new RecoverySession();
    this.locked = [];
  }

  async scan(files: PickedFile[], onProgress: ProgressFn): Promise<ScanSummary> {
    const started = Date.now();
    const ordered = [...files].sort((a, b) => b.file.lastModified - a.file.lastModified);
    let done = 0;
    for (const f of ordered) {
      onProgress({ done, total: ordered.length, current: f.path, found: this.session.stats.passages });
      try {
        const data = new Uint8Array(await f.file.arrayBuffer());
        this.session.addFile(f.path, data, { mtimeMs: f.file.lastModified, explicit: f.explicit });
      } catch {
        // On Windows a running browser holds its newest history file locked.
        this.locked.push({ path: f.path, app: classifyPath(f.path).app });
      }
      done++;
    }
    onProgress({ done, total: ordered.length, found: this.session.stats.passages });
    return this.summarise(started);
  }

  async demo(onProgress: ProgressFn): Promise<ScanSummary> {
    const started = Date.now();
    this.reset();
    const files = buildDemoFiles(Date.now());
    files.forEach((f, i) => {
      onProgress({ done: i, total: files.length, current: f.path, found: this.session.stats.passages });
      this.session.addFile(f.path, f.data, { mtimeMs: f.mtimeMs });
    });
    onProgress({ done: files.length, total: files.length, found: this.session.stats.passages });
    return this.summarise(started);
  }

  private summarise(started: number): ScanSummary {
    const findings = this.session.finish();
    return {
      files: this.session.stats.files,
      bytes: this.session.stats.bytes,
      findings,
      locked: this.locked,
      notes: this.session.notes,
      ms: Date.now() - started,
    };
  }

  query(q: Query): QueryResult {
    return this.session.query(q);
  }

  versions(id: string): Version[] {
    return this.session.versions(id);
  }
}

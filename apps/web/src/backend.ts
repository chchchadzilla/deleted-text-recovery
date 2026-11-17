/** The two engines the page can talk to: one inside this tab, one inside the desktop app. */
import type { Query, QueryResult, Version } from '@deleted-text-recovery/core';
import { BrowserEngine } from './engine';
import type { Engine, PickedFile, ProgressFn, ScanSummary, WorkerRequest, WorkerResponse } from './protocol';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Op = DistributiveOmit<WorkerRequest, 'id'>;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  progress?: ProgressFn;
}

/** Scans in a Web Worker so the page stays responsive; falls back to the page itself if workers are blocked. */
export class InTabEngine implements Engine {
  private worker: Worker | null = null;
  private fallback: BrowserEngine | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly ready: Promise<void>;

  constructor(workerSource: string) {
    this.ready = this.start(workerSource);
  }

  private async start(source: string): Promise<void> {
    try {
      const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker did not start')), 2500);
        worker.onerror = () => {
          clearTimeout(timer);
          reject(new Error('worker failed to load'));
        };
        worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
          if (e.data.id === 0) {
            clearTimeout(timer);
            resolve();
          }
        };
        worker.postMessage({ id: 0, op: 'reset' } satisfies WorkerRequest);
      });
      worker.onerror = null;
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
      this.worker = worker;
    } catch {
      this.fallback = new BrowserEngine();
    }
  }

  private onMessage(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.ev === 'progress') {
      p.progress?.(msg.progress);
      return;
    }
    this.pending.delete(msg.id);
    if (msg.ev === 'done') p.resolve(msg.result);
    else p.reject(new Error(msg.message));
  }

  private async call<T>(op: Op, progress?: ProgressFn): Promise<T> {
    await this.ready;
    const local = this.fallback;
    if (local) {
      const noop: ProgressFn = () => undefined;
      if (op.op === 'scan') return (await local.scan(op.files, progress ?? noop)) as T;
      if (op.op === 'demo') return (await local.demo(progress ?? noop)) as T;
      if (op.op === 'query') return local.query(op.query) as T;
      if (op.op === 'versions') return local.versions(op.findingId) as T;
      local.reset();
      return null as T;
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, progress });
      this.worker?.postMessage({ ...op, id });
    });
  }

  scan(files: PickedFile[], progress: ProgressFn): Promise<ScanSummary> {
    return this.call<ScanSummary>({ op: 'scan', files }, progress);
  }

  demo(progress: ProgressFn): Promise<ScanSummary> {
    return this.call<ScanSummary>({ op: 'demo' }, progress);
  }

  query(query: Query): Promise<QueryResult> {
    return this.call<QueryResult>({ op: 'query', query });
  }

  versions(findingId: string): Promise<Version[]> {
    return this.call<Version[]>({ op: 'versions', findingId });
  }

  reset(): Promise<void> {
    return this.call<void>({ op: 'reset' });
  }
}

export interface LocalInfo {
  version: string;
  platform: string;
}

/** Talks to the desktop app, which runs on this computer at 127.0.0.1 and nowhere else. */
export class LocalApi implements Engine {
  constructor(private readonly key: string) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(path, {
      ...init,
      headers: { 'x-dtr-key': this.key, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`The app answered with an error (${res.status}).`);
    return res;
  }

  async info(): Promise<LocalInfo> {
    return (await (await this.request('/api/info')).json()) as LocalInfo;
  }

  async scanComputer(days: number, progress: ProgressFn): Promise<ScanSummary> {
    const res = await this.request(`/api/scan?days=${encodeURIComponent(String(days))}`, { method: 'POST' });
    if (!res.body) throw new Error('The app sent no data.');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let summary: ScanSummary | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as
          | { t: 'progress'; progress: Parameters<ProgressFn>[0] }
          | { t: 'done'; summary: ScanSummary }
          | { t: 'error'; message: string };
        if (msg.t === 'progress') progress(msg.progress);
        else if (msg.t === 'done') summary = msg.summary;
        else throw new Error(msg.message);
      }
    }
    if (!summary) throw new Error('The scan stopped before it finished.');
    return summary;
  }

  async query(query: Query): Promise<QueryResult> {
    return (await (await this.request('/api/query', { method: 'POST', body: JSON.stringify(query) })).json()) as QueryResult;
  }

  async versions(findingId: string): Promise<Version[]> {
    return (await (await this.request(`/api/versions?id=${encodeURIComponent(findingId)}`)).json()) as Version[];
  }

  async quit(): Promise<void> {
    await this.request('/api/quit', { method: 'POST' });
  }
}

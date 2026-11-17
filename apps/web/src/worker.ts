/** Web Worker entry: keeps the page responsive while large files are read. */
import { BrowserEngine } from './engine';
import type { WorkerRequest, WorkerResponse } from './protocol';

const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const engine = new BrowserEngine();

ctx.onmessage = (event) => {
  const req = event.data;
  const progress = (p: Parameters<Parameters<BrowserEngine['scan']>[1]>[0]): void => {
    ctx.postMessage({ id: req.id, ev: 'progress', progress: p });
  };
  void (async () => {
    try {
      let result: unknown = null;
      if (req.op === 'scan') result = await engine.scan(req.files, progress);
      else if (req.op === 'demo') result = await engine.demo(progress);
      else if (req.op === 'query') result = engine.query(req.query);
      else if (req.op === 'versions') result = engine.versions(req.findingId);
      else engine.reset();
      ctx.postMessage({ id: req.id, ev: 'done', result });
    } catch (err) {
      ctx.postMessage({ id: req.id, ev: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
};

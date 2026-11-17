/**
 * The local server behind the desktop app's page.
 *
 * It serves text recovered from this computer, so it is locked down on purpose:
 *  - listens on 127.0.0.1 only, so no other device can connect
 *  - every API call needs a random key that only the page opened by the app knows
 *  - the Host and Origin headers must be this server's own, which stops other websites
 *    (including DNS-rebinding tricks) from reading results through the person's browser
 *  - no CORS, no caching, no framing, and nothing is ever written to disk
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { VERSION, type Query, type RecoverySession } from '@deleted-text-recovery/core';
import { scan } from './scan';

const PREFERRED_PORT = 47533;
const MAX_BODY_BYTES = 64 * 1024;

export interface ServerHandle {
  url: string;
  port: number;
  close(): void;
}

function platformName(): string {
  if (process.platform === 'win32') return 'Windows';
  if (process.platform === 'darwin') return 'macOS';
  return 'Linux';
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function startServer(opts: { port?: number; onQuit: () => void }): Promise<ServerHandle> {
  const key = randomBytes(24).toString('hex');
  const keyBytes = Buffer.from(key);
  let session: RecoverySession | null = null;
  let scanning = false;
  let port = 0;

  const baseHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const keyOk = (req: IncomingMessage): boolean => {
    const given = Buffer.from(String(req.headers['x-dtr-key'] ?? ''));
    return given.length === keyBytes.length && timingSafeEqual(given, keyBytes);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const origin = req.headers.origin;
    if (!hosts.has(req.headers.host ?? '') || (origin !== undefined && !hosts.has(origin.replace(/^http:\/\//, '')))) {
      send(res, 403, { error: 'forbidden' });
      return;
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /') {
      res.writeHead(200, {
        ...baseHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "frame-ancestors 'none'",
      });
      res.end(__DTR_UI_HTML__);
      return;
    }
    if (route === 'GET /favicon.ico') {
      res.writeHead(204, baseHeaders);
      res.end();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      send(res, 404, { error: 'not found' });
      return;
    }
    if (!keyOk(req)) {
      send(res, 401, { error: 'missing or wrong key' });
      return;
    }

    if (route === 'GET /api/info') {
      send(res, 200, { version: VERSION, platform: platformName() });
    } else if (route === 'POST /api/scan') {
      if (scanning) {
        send(res, 409, { error: 'a scan is already running' });
        return;
      }
      scanning = true;
      const days = Math.max(0, Math.min(3650, Number(url.searchParams.get('days') ?? '30') || 0));
      res.writeHead(200, { ...baseHeaders, 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      let lastSent = 0;
      try {
        const result = await scan({
          days,
          onProgress: (progress) => {
            const now = Date.now();
            if (now - lastSent < 120 && progress.done < progress.total) return;
            lastSent = now;
            res.write(JSON.stringify({ t: 'progress', progress }) + '\n');
          },
        });
        session = result.session;
        res.write(JSON.stringify({ t: 'done', summary: result.summary }) + '\n');
      } catch (err) {
        res.write(JSON.stringify({ t: 'error', message: err instanceof Error ? err.message : String(err) }) + '\n');
      } finally {
        scanning = false;
        res.end();
      }
    } else if (route === 'POST /api/query') {
      const query = JSON.parse((await readBody(req)) || '{}') as Query;
      send(res, 200, session ? session.query(query) : { total: 0, matched: 0, findings: [] });
    } else if (route === 'GET /api/versions') {
      send(res, 200, session ? session.versions(url.searchParams.get('id') ?? '') : []);
    } else if (route === 'POST /api/quit') {
      send(res, 200, { ok: true });
      setTimeout(opts.onQuit, 150);
    } else {
      send(res, 404, { error: 'not found' });
    }
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) send(res, 500, { error: err instanceof Error ? err.message : 'internal error' });
      else res.end();
    });
  });

  try {
    port = await listen(server, opts.port ?? PREFERRED_PORT);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || opts.port !== undefined) throw err;
    port = await listen(server, 0);
  }

  return {
    port,
    url: `http://127.0.0.1:${port}/?k=${key}`,
    close: () => server.close(),
  };
}

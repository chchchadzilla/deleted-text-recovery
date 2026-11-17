// Serves apps/web/dist on this computer only, for trying the web app before it is published.
// Usage: npm run build && npm run serve:web   then open http://127.0.0.1:4173/
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'dist');
const port = Number(process.env.PORT ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const name = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
    try {
      const body = await readFile(path.join(dist, name));
      res.writeHead(200, { 'Content-Type': types[path.extname(name)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`Web app: http://127.0.0.1:${port}/  (add ?demo to load the sample data)`));

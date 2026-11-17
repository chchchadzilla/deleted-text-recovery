import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { VERSION, classifyPath } from '@deleted-text-recovery/core';
import { discover } from '../src/discover';
import { startServer } from '../src/server';

interface Reply {
  status: number;
  body: string;
  type: string;
}

function call(port: number, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), type: String(res.headers['content-type'] ?? '') }),
        );
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test('local server: serves the page, and guards every API call', async () => {
  let quit = false;
  const server = await startServer({ port: 0, onQuit: () => (quit = true) });
  try {
    const key = new URL(server.url).searchParams.get('k') ?? '';
    assert.match(key, /^[0-9a-f]{48}$/);
    assert.ok(server.url.startsWith(`http://127.0.0.1:${server.port}/`));
    const auth = { 'x-dtr-key': key };

    const page = await call(server.port, '/');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);

    // no key, wrong key
    assert.equal((await call(server.port, '/api/info')).status, 401);
    assert.equal((await call(server.port, '/api/info', { headers: { 'x-dtr-key': 'f'.repeat(48) } })).status, 401);

    // right key
    const info = await call(server.port, '/api/info', { headers: auth });
    assert.equal(info.status, 200);
    assert.equal((JSON.parse(info.body) as { version: string }).version, VERSION);

    // another website reaching this server through the person's browser: wrong Host or Origin
    assert.equal((await call(server.port, '/api/info', { headers: { ...auth, Host: 'evil.example' } })).status, 403);
    assert.equal((await call(server.port, '/api/info', { headers: { ...auth, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await call(server.port, '/', { headers: { Host: `evil.example:${server.port}` } })).status, 403);
    // the page's own origin is allowed
    assert.equal((await call(server.port, '/api/info', { headers: { ...auth, Origin: `http://127.0.0.1:${server.port}` } })).status, 200);

    // before any scan there is simply nothing to return
    const empty = await call(server.port, '/api/query', { method: 'POST', headers: auth, body: '{}' });
    assert.deepEqual(JSON.parse(empty.body), { total: 0, matched: 0, findings: [] });
    assert.deepEqual(JSON.parse((await call(server.port, '/api/versions?id=nope', { headers: auth })).body), []);

    assert.equal((await call(server.port, '/api/nope', { headers: auth })).status, 404);
    assert.equal((await call(server.port, '/somewhere-else')).status, 404);

    assert.equal((await call(server.port, '/api/quit', { method: 'POST', headers: auth })).status, 200);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(quit, true);
  } finally {
    server.close();
  }
});

test('discovery: runs on this operating system and never offers a forbidden file', async () => {
  const files = await discover(1);
  assert.ok(Array.isArray(files));
  for (const f of files) {
    const cls = classifyPath(f.path);
    assert.equal(cls.forbidden, false, f.path);
    assert.equal(cls.known, true, f.path);
    assert.ok(f.size > 0);
  }
});

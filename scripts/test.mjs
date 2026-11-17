// Bundles every *.test.ts with esbuild and runs it on Node's built-in test runner.
// No test framework dependency: fewer packages to trust.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.tmp', 'test');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const entries = [];
for (const group of ['packages', 'apps']) {
  const groupDir = path.join(root, group);
  if (!existsSync(groupDir)) continue;
  for (const name of readdirSync(groupDir)) {
    const testDir = path.join(groupDir, name, 'test');
    if (!existsSync(testDir)) continue;
    for (const file of readdirSync(testDir)) {
      if (file.endsWith('.test.ts')) entries.push(path.join(testDir, file));
    }
  }
}
if (entries.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const outputs = [];
for (const entry of entries) {
  const rel = path.relative(root, entry).replace(/[\\/]/g, '__').replace(/\.ts$/, '.mjs');
  const outfile = path.join(outDir, rel);
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    logLevel: 'warning',
    // the desktop app embeds the built page at build time; tests only need a stand-in
    define: { __DTR_UI_HTML__: JSON.stringify('<!doctype html><title>test page</title>') },
  });
  outputs.push(outfile);
}

const result = spawnSync(process.execPath, ['--test', ...outputs], { stdio: 'inherit' });
process.exit(result.status ?? 1);

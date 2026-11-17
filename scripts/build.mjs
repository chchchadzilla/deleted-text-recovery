// Builds both apps.
//
//   apps/web/dist/index.html                       the whole web app in one file (for GitHub Pages)
//   apps/desktop/dist/deleted-text-recovery.cjs    the desktop app in one file (run with Node,
//                                                  or compiled to a standalone program in CI)
//
// The page is a single self-contained file on purpose: its Content-Security-Policy allows only
// the exact inline script that is hashed here, and forbids every network connection. That is
// what lets the web app promise that nothing a person recovers can be sent anywhere.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/chchchadzilla/deleted-text-recovery';
const SITE = 'https://chchchadzilla.github.io/deleted-text-recovery/';

const read = (p) => readFile(path.join(root, p), 'utf8');
const maybeRead = async (p) => {
  try {
    return await read(p);
  } catch {
    return null;
  }
};

const pkg = JSON.parse(await read('package.json'));
const coreIndex = await read('packages/core/src/index.ts');
if (!coreIndex.includes(`VERSION = '${pkg.version}'`)) {
  throw new Error(`packages/core/src/index.ts VERSION does not match package.json (${pkg.version})`);
}

async function bundle(entry, options = {}) {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
    ...options,
  });
  return result.outputFiles[0].text;
}

/** Prepares an SVG file for inlining: no XML prolog, no comments, sized by CSS. */
function inlineSvg(svg) {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(width|height)="[^"]*"/g, ''))
    .trim();
}

const FALLBACK_MARK =
  '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" rx="14" fill="#0F172A"/><circle cx="32" cy="34" r="18" fill="#F5A623"/><circle cx="25" cy="31" r="3" fill="#0F172A"/><circle cx="39" cy="31" r="3" fill="#0F172A"/><ellipse cx="32" cy="40" rx="4" ry="3" fill="#0F172A"/></svg>';

async function buildPage(mode) {
  const worker = await bundle('apps/web/src/worker.ts');
  const js = (
    await bundle('apps/web/src/main.ts', {
      define: {
        __DTR_MODE__: JSON.stringify(mode),
        __DTR_VERSION__: JSON.stringify(pkg.version),
        __DTR_WORKER__: JSON.stringify(worker),
        __DTR_REPO__: JSON.stringify(REPO),
      },
    })
  ).replace(/<\/script/gi, '<\\/script');
  const css = await read('apps/web/src/styles.css');
  const iconSvg = await maybeRead('assets/icon.svg');
  const mark = inlineSvg(iconSvg ?? FALLBACK_MARK);
  const icon = `<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(mark).toString('base64')}">`;
  const og =
    mode === 'web'
      ? [
          `<link rel="canonical" href="${SITE}">`,
          '<meta property="og:type" content="website">',
          '<meta property="og:title" content="Deleted Text Recovery">',
          '<meta property="og:description" content="Typed it. Lost it. Get it back. Free, no ads, and nothing is uploaded.">',
          `<meta property="og:url" content="${SITE}">`,
          `<meta property="og:image" content="${SITE}social-preview.png">`,
          '<meta name="twitter:card" content="summary_large_image">',
        ].join('\n')
      : '';
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${createHash('sha256').update(js).digest('base64')}'`,
    'worker-src blob:',
    "style-src 'unsafe-inline'",
    'img-src data:',
    mode === 'web' ? "connect-src 'none'" : "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  let html = await read('apps/web/src/index.html');
  html = html
    .replace('data-mode="web"', `data-mode="${mode}"`)
    .replace('__CSP__', () => csp)
    .replace('<!--__OG__-->', () => og)
    .replace('<!--__ICON__-->', () => icon)
    .replace('/*__CSS__*/', () => css)
    .replaceAll('<!--__MASCOT__-->', () => mark)
    .replaceAll('__REPO__', () => REPO)
    .replace('/*__JS__*/', () => js);
  return html;
}

// ---- web app ----
const webDist = path.join(root, 'apps/web/dist');
await mkdir(webDist, { recursive: true });
const webHtml = await buildPage('web');
await writeFile(path.join(webDist, 'index.html'), webHtml);
await writeFile(path.join(webDist, '.nojekyll'), '');
for (const asset of ['social-preview.png', 'icon-192.png', 'icon-512.png']) {
  try {
    await copyFile(path.join(root, 'assets', asset), path.join(webDist, asset));
  } catch {
    // brand assets are optional for a build
  }
}

// ---- desktop app ----
const localHtml = await buildPage('local');
const desktopOut = path.join(root, 'apps/desktop/dist/deleted-text-recovery.cjs');
await build({
  entryPoints: [path.join(root, 'apps/desktop/src/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: desktopOut,
  define: { __DTR_UI_HTML__: JSON.stringify(localHtml) },
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'warning',
});

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`web      apps/web/dist/index.html (${kb(webHtml)})`);
console.log(`desktop  apps/desktop/dist/deleted-text-recovery.cjs (${kb(await readFile(desktopOut, 'utf8'))})`);

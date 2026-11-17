/**
 * Deleted Text Recovery, desktop app.
 *
 * Double-click it (or run it with no arguments) and it opens a page in your browser with one
 * big button. Run it with --cli for a terminal report, which is also how AI coding agents and
 * scripts use it.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { VERSION, type FindingView, type Kind } from '@deleted-text-recovery/core';
import { scan } from './scan';
import { startServer } from './server';

interface Args {
  cli: boolean;
  days: number;
  json?: string;
  save?: string;
  search?: string;
  top: number;
  minChars: number;
  paths: string[];
  open: boolean;
  port?: number;
  help: boolean;
  version: boolean;
  verbose: boolean;
  all: boolean;
}

const HELP = `Deleted Text Recovery ${VERSION}
Get back text you typed and lost. Free, no ads, runs entirely on this computer.

Usage
  deleted-text-recovery                 open the app in your browser (the easy way)
  deleted-text-recovery --cli           print what it finds in this terminal

Options
  --cli                 terminal mode: no browser, no server
  --days <n>            only read files changed in the last n days (default 30, 0 = everything)
  --search "<words>"    only show text containing all of these words
  --min <n>             shortest text to show, in characters (default 40)
  --top <n>             how many results to print (default 10)
  --save <folder>       write each printed result to its own .txt file in this folder
  --json <file>         write the printed results, with all their saved copies, as JSON
                        ("-" sends the JSON to stdout and prints nothing else)
  --all                 with --json: include every result, not just the top ones (can be large)
  --path <file|folder>  look here instead of searching the whole computer (repeatable)
  --port <n>            port for the app's page (default 47533, or any free one)
  --no-open             do not open a browser window
  --verbose             with --cli: report timings and any file that was slow to read
  --version, --help

It reads autosave history only, read-only. It never opens password, cookie or payment files,
makes no network connections, and writes nothing unless you pass --save or --json.
`;

function parseArgs(argv: string[]): Args {
  const args: Args = { cli: false, days: 30, top: 10, minChars: 40, paths: [], open: true, help: false, version: false, verbose: false, all: false };
  const need = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined) throw new Error(`${flag} needs a value`);
    return v;
  };
  const number = (v: string, flag: string): number => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} needs a number, got "${v}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cli') args.cli = true;
    else if (a === '--days') args.days = number(need(++i, a), a);
    else if (a === '--top') args.top = number(need(++i, a), a);
    else if (a === '--min') args.minChars = number(need(++i, a), a);
    else if (a === '--port') args.port = number(need(++i, a), a);
    else if (a === '--json') args.json = need(++i, a);
    else if (a === '--save') args.save = need(++i, a);
    else if (a === '--search') args.search = need(++i, a);
    else if (a === '--path') args.paths.push(need(++i, a));
    else if (a === '--no-open') args.open = false;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--all') args.all = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else throw new Error(`unknown option "${a}". Try --help.`);
  }
  if (args.paths.length || args.json || args.save || args.search) args.cli = true;
  return args;
}

const KIND_LABEL: Record<Kind, string> = {
  typed: 'Typed in a text box',
  draft: 'Saved by a website',
  backup: 'App backup',
  other: 'Other text',
};

function ago(ms?: number): string {
  if (!ms) return '';
  const minutes = (Date.now() - ms) / 60_000;
  if (minutes < 90) return `changed ${Math.max(1, Math.round(minutes))} min ago`;
  if (minutes < 36 * 60) return `changed ${Math.round(minutes / 60)} h ago`;
  return `changed ${Math.round(minutes / 1440)} days ago`;
}

function headline(f: FindingView, i: number): string {
  const src = f.sources[0];
  const bits = [`#${i + 1}`, `[${KIND_LABEL[f.kind]}]`, `${f.chars.toLocaleString()} characters`];
  if (f.versionCount > 1) bits.push(`${f.versionCount} saved copies`);
  if (src?.app) bits.push(src.profile && src.profile !== src.app ? `${src.app} (${src.profile})` : src.app);
  if (src?.origin) bits.push(src.origin);
  const when = ago(f.newestMtimeMs);
  if (when) bits.push(when);
  return bits.join('  ');
}

async function runCli(args: Args): Promise<void> {
  const quiet = args.json === '-';
  const out = (line = ''): void => {
    if (!quiet) process.stdout.write(line + '\n');
  };
  const live = process.stderr.isTTY === true;
  let last = 0;
  const { session, summary } = await scan({
    days: args.days,
    paths: args.paths,
    onFile: args.verbose
      ? (f) => {
          if (f.ms >= 250) process.stderr.write(`slow: ${String(f.ms).padStart(6)} ms  ${(f.bytes / 1048576).toFixed(1).padStart(6)} MB  ${f.passages} passages  ${f.path}\n`);
        }
      : undefined,
    onProgress: (p) => {
      if (!live || args.verbose) return;
      const now = Date.now();
      if (now - last < 150 && p.done < p.total) return;
      last = now;
      process.stderr.write(`\r  Reading ${p.done} of ${p.total} files, ${p.found} pieces of text so far   `);
    },
  });
  if (live && !args.verbose) process.stderr.write('\r' + ' '.repeat(72) + '\r');
  if (args.verbose) {
    const t = summary.timings;
    process.stderr.write(`timings: finding files ${t.discoverMs} ms, reading ${t.readMs} ms, grouping ${t.groupMs} ms\n`);
  }

  const result = session.query({ q: args.search, minChars: args.minChars, limit: args.top });
  out(`Deleted Text Recovery ${VERSION}`);
  out(`Read ${summary.files.toLocaleString()} files (${(summary.bytes / 1048576).toFixed(1)} MB) in ${(summary.ms / 1000).toFixed(1)} s.`);
  if (summary.places.length) out(`Looked in: ${summary.places.join(', ')}.`);
  out(`Found ${result.total.toLocaleString()} separate pieces of text${args.search ? `, ${result.matched.toLocaleString()} containing "${args.search}"` : ''}.`);
  for (const app of new Set(summary.locked.map((l) => l.app ?? 'An app'))) {
    const count = summary.locked.filter((l) => (l.app ?? 'An app') === app).length;
    out(`NOTE: ${app} is open, so ${count} of its newest history file(s) were locked. Close it completely (do not reopen it) and run this again.`);
  }
  out();
  result.findings.forEach((f, i) => {
    out(headline(f, i));
    const preview = f.text.replace(/\s+/g, ' ').slice(0, 240);
    out(`    ${preview}${f.text.length > 240 ? ' ...' : ''}`);
    out();
  });
  if (result.findings.length === 0) out('Nothing matched. Try --days 0, a different --search, or --min 0.');

  if (args.save) {
    await mkdir(args.save, { recursive: true });
    let n = 0;
    for (const f of result.findings) {
      n++;
      const name = `${String(n).padStart(3, '0')}-${f.kind}-${f.chars}-characters.txt`;
      await writeFile(path.join(args.save, name), f.text, 'utf8');
    }
    out(`Saved ${n} text file(s) to ${path.resolve(args.save)}`);
  }
  if (args.json) {
    const all = args.all ? session.query({ q: args.search, minChars: args.minChars, limit: 1_000_000 }).findings : result.findings;
    const payload = JSON.stringify(
      {
        tool: 'deleted-text-recovery',
        version: VERSION,
        scannedAt: new Date().toISOString(),
        summary,
        totalFindings: result.total,
        matchedFindings: result.matched,
        findings: all.map((f) => ({ ...f, versions: session.versions(f.id) })),
      },
      null,
      2,
    );
    if (quiet) process.stdout.write(payload + '\n');
    else {
      await writeFile(args.json, payload, 'utf8');
      out(`Wrote ${all.length} result(s) to ${path.resolve(args.json)}`);
    }
  }
}

function openBrowser(url: string): void {
  try {
    const options = { detached: true, stdio: 'ignore' as const, windowsHide: true };
    if (process.platform === 'win32') spawn('rundll32', ['url.dll,FileProtocolHandler', url], options).unref();
    else if (process.platform === 'darwin') spawn('open', [url], options).unref();
    else spawn('xdg-open', [url], options).unref();
  } catch {
    // The address is printed as well, so the person can open it by hand.
  }
}

async function runApp(args: Args): Promise<void> {
  const handle = await startServer({
    port: args.port,
    onQuit: () => {
      console.log('\n  Closed. You can close this window.\n');
      process.exit(0);
    },
  });
  console.log(`
  Deleted Text Recovery ${VERSION}
  ------------------------------------------------------------
  It is running. A page should open in your browser in a moment.

  If it does not, copy this address into your browser:

      ${handle.url}

  Keep this window open while you use the page.
  Close this window when you are done.

  Everything stays on this computer. Nothing is uploaded.
`);
  if (args.open) openBrowser(handle.url);
  process.on('SIGINT', () => process.exit(0));
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(64);
  }
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.version) {
    console.log(VERSION);
    return;
  }
  if (args.cli) await runCli(args);
  else await runApp(args);
}

main().catch((err: unknown) => {
  console.error('\n  Something went wrong: ' + (err instanceof Error ? err.message : String(err)));
  console.error('  Please report it: https://github.com/chchchadzilla/deleted-text-recovery/issues\n');
  process.exit(1);
});

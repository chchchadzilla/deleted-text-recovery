// Refuses to let private material into the repository.
//
// Run by CI on every push, and worth running by hand before a release:  node scripts/audit.mjs
//
// It checks every file git would publish for:
//   - credentials (keys, tokens, private key blocks)
//   - real browser or app data used as a fixture (tab-restore files, Firefox session files,
//     LevelDB tables). Tests must build synthetic files with packages/core/src/testing.ts.
//   - a real person's home folder path or e-mail address
//   - any extra words listed in the DTR_AUDIT_WORDS environment variable (comma separated),
//     for maintainers who want to be sure a private name or phrase never ships
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, 'private key block'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, 'GitHub fine-grained token'],
  [/\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{24,}\b/, 'API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
];
// Home folders of real people. The names below are the only ones allowed in examples.
const HOME_PATH = /(?:[A-Za-z]:[\\/]Users[\\/]|\/Users\/|\/home\/)([^\\/\s"'`<>*%$]+)/g;
const ALLOWED_HOMES = new Set(['someone', 'a', 'you', 'name', 'yourname', 'runner', 'runneradmin', 'user', '.', '..']);
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const ALLOWED_EMAIL = /@(users\.noreply\.github\.com|anthropic\.com|example\.(com|org|net))$/i;
const extraWords = (process.env.DTR_AUDIT_WORDS ?? '')
  .split(',')
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean);

const problems = [];
const report = (file, what) => problems.push(`${file}: ${what}`);

for (const file of files) {
  const full = path.join(root, file);
  let size;
  try {
    size = statSync(full).size;
  } catch {
    continue;
  }
  const base = path.basename(file).toLowerCase();
  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') report(file, 'environment file must not be committed');
  if (/^(session|tabs)_\d+$/.test(base) || /\.(jsonlz4|baklz4|ldb)$/.test(base) || /^\d{6}\.log$/.test(base)) {
    report(file, 'looks like real browser data; build synthetic fixtures instead');
  }
  if (size > 5 * 1024 * 1024) report(file, `unexpectedly large (${(size / 1048576).toFixed(1)} MB)`);
  const data = readFileSync(full);
  const head = data.subarray(0, 8).toString('latin1');
  if (head.startsWith('SNSS') || head.startsWith('mozLz40')) report(file, 'is a real browser session file');
  if (data.subarray(0, 4096).includes(0)) continue; // binary (images): nothing more to check
  const text = data.toString('utf8');
  for (const [re, name] of SECRET_PATTERNS) if (re.test(text)) report(file, `contains what looks like a ${name}`);
  for (const m of text.matchAll(HOME_PATH)) {
    if (!ALLOWED_HOMES.has(m[1].toLowerCase())) report(file, `contains a personal folder path (${m[0]})`);
  }
  for (const m of text.matchAll(EMAIL)) {
    if (!ALLOWED_EMAIL.test(m[0])) report(file, `contains an e-mail address (${m[0]})`);
  }
  const lower = text.toLowerCase();
  for (const word of extraWords) if (lower.includes(word)) report(file, 'contains a word from DTR_AUDIT_WORDS');
}

if (problems.length) {
  console.error(`Audit failed (${problems.length}):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`Audit passed: ${files.length} files, no credentials, no real browser data, no personal paths or addresses.`);

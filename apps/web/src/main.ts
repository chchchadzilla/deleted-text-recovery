/**
 * The page. One file of plain DOM code, no framework: it has to load instantly, work offline,
 * and be easy for anyone to audit. Recovered text is untrusted input, so it is only ever
 * placed in the page with textContent, never as HTML.
 */
import type { FindingView, Kind, Query } from '@deleted-text-recovery/core';
import { InTabEngine, LocalApi } from './backend';
import { entriesFromDrop, filesFromEntries, filesFromInput, type Picked } from './dropfiles';
import { GUIDES, detectOs, openSteps, type Os } from './guides';
import type { Engine, ProgressFn, ScanProgress, ScanSummary } from './protocol';

const MODE = __DTR_MODE__;
const EXCERPT_CHARS = 700;
const KIND_LABEL: Record<Kind, string> = {
  typed: 'Typed in a text box',
  draft: 'Saved by a website',
  backup: 'App backup',
  other: 'Other text',
};

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const num = (n: number): string => n.toLocaleString();

function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function timeAgo(ms?: number): string {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'changed just now';
  const m = s / 60;
  if (m < 90) return `changed ${Math.round(m)} minutes ago`;
  const hr = m / 60;
  if (hr < 36) return `changed ${Math.round(hr)} hours ago`;
  const d = hr / 24;
  if (d < 60) return `changed ${Math.round(d)} days ago`;
  return `changed ${new Date(ms).toLocaleDateString()}`;
}

const inTab = new InTabEngine(__DTR_WORKER__);
const localKey =
  new URLSearchParams(location.search).get('k') ?? new URLSearchParams(location.hash.slice(1)).get('k') ?? '';
const local = MODE === 'local' ? new LocalApi(localKey) : null;

const state = {
  os: detectOs() as Os,
  app: 'chrome',
  active: null as Engine | null,
  summary: null as ScanSummary | null,
  demo: false,
  busy: false,
  seq: 0,
  q: '',
  kind: 'all' as Kind | 'all',
  minChars: 40,
};

// ---------- small helpers ----------

async function copyText(text: string, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const area = h('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
  }
  button.textContent = ok ? 'Copied' : 'Select the text and copy it by hand';
  setTimeout(() => {
    button.textContent = original;
  }, 1800);
}

function saveText(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = h('a');
  a.href = url;
  a.download = 'recovered-text.txt';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function showError(message: string | null): void {
  const box = byId('error-box');
  box.hidden = message === null;
  box.textContent = message ?? '';
  if (message) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function friendly(err: unknown): string {
  if (err instanceof TypeError && MODE === 'local') return 'The app stopped answering. Close this tab and start the app again.';
  return err instanceof Error ? err.message : String(err);
}

function chips(
  container: HTMLElement,
  options: { id: string; label: string }[],
  selected: string,
  onPick: (id: string) => void,
): void {
  container.replaceChildren();
  for (const o of options) {
    const b = h('button', undefined, o.label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(o.id === selected));
    b.addEventListener('click', () => {
      for (const other of Array.from(container.children)) other.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-checked', 'true');
      onPick(o.id);
    });
    container.append(b);
  }
}

// ---------- step-by-step guide (web mode) ----------

function renderGuide(): void {
  const guide = GUIDES.find((g) => g.id === state.app) ?? GUIDES[0];
  const place = guide.places[state.os];
  const list = byId('guide-steps');
  const note = byId('guide-note');
  list.replaceChildren();
  if (!place) {
    const li = h('li');
    li.append(`${guide.label} keeps its files somewhere awkward on this kind of computer. The desktop app finds them by itself: `);
    const a = h('a', undefined, 'get it here');
    a.href = `${__DTR_REPO__}/releases/latest`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    li.append(a, '.');
    list.append(li);
    note.textContent = '';
    return;
  }
  const steps = openSteps(state.os);
  steps.forEach((text, i) => {
    const li = h('li', undefined, text);
    if (i === steps.length - 1) {
      const line = h('div', 'pathline');
      const copy = h('button', undefined, 'Copy');
      copy.type = 'button';
      copy.addEventListener('click', () => void copyText(place.open, copy));
      line.append(h('code', undefined, place.open), copy);
      li.append(line);
    }
    list.append(li);
  });
  const last = h('li');
  if (guide.id === 'app') {
    last.append(`A folder window opens. Find ${place.drag}. That is the one to drop in step 3.`);
  } else {
    last.append('A folder window opens. In it, find the folder called ', h('b', undefined, place.drag), '. That is the one to drop in step 3.');
  }
  list.append(last);
  note.textContent =
    state.os === 'windows'
      ? 'Tip: if you can, use a different browser for this page than the one you were typing in. On Windows a running browser keeps its newest history file locked, and a second browser will not disturb the first.'
      : 'Tip: if you can, use a different browser for this page than the one you were typing in, so its history is not disturbed.';
}

// ---------- scanning ----------

function setProgress(p: ScanProgress, verb = 'Reading file'): void {
  const bar = byId<HTMLProgressElement>('progress-bar');
  bar.max = Math.max(1, p.total);
  bar.value = p.done;
  const name = p.current ? p.current.split('/').slice(-3).join(' / ') : '';
  byId('progress-text').textContent =
    p.total > 0
      ? `${verb} ${num(Math.min(p.done + 1, p.total))} of ${num(p.total)}. ${num(p.found)} pieces of text found so far. ${name}`
      : 'Getting ready…';
}

async function withBusy(job: () => Promise<void>): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  showError(null);
  byId('results').hidden = true;
  byId('progress').hidden = false;
  byId('progress-text').textContent = 'Getting ready…';
  byId('progress').scrollIntoView({ behavior: 'smooth', block: 'center' });
  try {
    await job();
  } catch (err) {
    showError(friendly(err));
  } finally {
    state.busy = false;
    byId('progress').hidden = true;
  }
}

async function scanPicked(getFiles: (count: (n: number) => void) => Promise<Picked> | Picked): Promise<void> {
  await withBusy(async () => {
    const picked = await getFiles((n) => {
      byId('progress-text').textContent = `Looking through the folder. ${num(n)} files checked…`;
    });
    if (picked.files.length === 0 && picked.unreadable.length === 0) {
      showError(
        'I did not find any autosave files in what you dropped. Check that it is the folder named in step 2. You can also drop single files to search inside them.',
      );
      return;
    }
    const summary = await inTab.scan(picked.files, (p) => setProgress(p));
    for (const path of picked.unreadable) summary.locked.push({ path });
    state.summary = summary;
    state.active = inTab;
    state.demo = false;
    await showResults();
  });
}

async function scanComputer(): Promise<void> {
  if (!local) return;
  const days = Number(byId<HTMLSelectElement>('scan-days').value);
  await withBusy(async () => {
    state.summary = await local.scanComputer(days, (p) => setProgress(p));
    state.active = local;
    state.demo = false;
    await showResults();
  });
}

async function scanDemo(): Promise<void> {
  await withBusy(async () => {
    const progress: ProgressFn = (p) => setProgress(p);
    state.summary = await inTab.demo(progress);
    state.active = inTab;
    state.demo = true;
    await showResults();
  });
}

// ---------- results ----------

function renderLocked(summary: ScanSummary): void {
  const box = byId('locked-box');
  box.replaceChildren();
  box.hidden = summary.locked.length === 0;
  if (box.hidden) return;
  const perApp = new Map<string, number>();
  for (const l of summary.locked) {
    const app = l.app ?? 'An app';
    perApp.set(app, (perApp.get(app) ?? 0) + 1);
  }
  for (const [app, count] of perApp) {
    box.append(
      h('p', undefined, `${app} is open, so ${count} of its newest history ${count === 1 ? 'file was' : 'files were'} locked and could not be read.`),
    );
  }
  box.append(
    h(
      'p',
      undefined,
      MODE === 'local'
        ? 'If your text is not below: close every window of that app, do not open it again, then press "Scan again".'
        : 'If your text is not below: close every window of that app, do not open it again, then drop the folder here once more.',
    ),
  );
}

async function showResults(): Promise<void> {
  const s = state.summary;
  if (!s) return;
  byId('results').hidden = false;
  const seconds = s.ms < 1000 ? 'under a second' : `${(s.ms / 1000).toFixed(1)} seconds`;
  byId('summary-line').textContent = state.demo
    ? `This is made-up sample data, so you can see how it works. Read ${num(s.files)} pretend files and found ${num(s.findings)} pieces of text.`
    : `Read ${num(s.files)} files (${sizeText(s.bytes)}) in ${seconds} and found ${num(s.findings)} separate pieces of text. Most of that is ordinary website data. What you typed is usually near the top, and the search box narrows it down fast.`;
  renderLocked(s);
  await refresh();
  byId('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function refresh(): Promise<void> {
  const engine = state.active;
  if (!engine) return;
  const seq = ++state.seq;
  const query: Query = {
    q: state.q,
    minChars: state.minChars,
    limit: 150,
    kinds: state.kind === 'all' ? undefined : [state.kind],
  };
  let result;
  try {
    result = await engine.query(query);
  } catch (err) {
    showError(friendly(err));
    return;
  }
  if (seq !== state.seq) return;
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = byId('findings');
  list.replaceChildren();
  result.findings.forEach((f, i) => list.append(card(f, i, terms, engine)));
  byId('empty').hidden = result.findings.length > 0;
  byId('match-line').textContent =
    result.matched === result.total
      ? `Showing ${num(result.findings.length)} of ${num(result.total)}.`
      : `${num(result.matched)} of ${num(result.total)} match. Showing ${num(result.findings.length)}.`;
}

function excerpt(text: string, terms: string[]): string {
  if (text.length <= EXCERPT_CHARS) return text;
  let start = 0;
  if (terms.length) {
    const idx = text.toLowerCase().indexOf(terms[0]);
    if (idx > 300) start = idx - 200;
  }
  return (start ? '… ' : '') + text.slice(start, start + EXCERPT_CHARS) + ' …';
}

function paint(pre: HTMLElement, text: string, terms: string[]): void {
  pre.replaceChildren();
  const lower = text.toLowerCase();
  if (!terms.length || lower.length !== text.length) {
    pre.textContent = text;
    return;
  }
  let pos = 0;
  for (;;) {
    let best = -1;
    let bestLen = 0;
    for (const t of terms) {
      const i = lower.indexOf(t, pos);
      if (i >= 0 && (best < 0 || i < best)) {
        best = i;
        bestLen = t.length;
      }
    }
    if (best < 0) break;
    if (best > pos) pre.append(text.slice(pos, best));
    pre.append(h('mark', undefined, text.slice(best, best + bestLen)));
    pos = best + bestLen;
  }
  if (pos < text.length) pre.append(text.slice(pos));
}

function metaLine(f: FindingView, chars: number): string {
  const src = f.sources[0];
  const parts = [`${num(chars)} characters`];
  if (src?.app) parts.push(src.profile && src.profile !== src.app ? `${src.app} (${src.profile})` : src.app);
  if (src?.origin) parts.push(src.origin.replace(/^https?:\/\//, '').replace(/\/$/, ''));
  const ago = timeAgo(f.newestMtimeMs);
  if (ago) parts.push(ago);
  return parts.join(' · ');
}

function card(f: FindingView, rank: number, terms: string[], engine: Engine): HTMLElement {
  const art = h('article', 'card finding');
  let full = f.text;
  let expanded = false;

  const head = h('header');
  if (rank === 0 && !terms.length && state.kind === 'all') head.append(h('span', 'badge best', 'Best match'));
  head.append(h('span', `badge ${f.kind}`, KIND_LABEL[f.kind]));
  if (f.versionCount > 1) head.append(h('span', 'badge trail', `${num(f.versionCount)} saved copies`));
  const meta = h('span', 'meta', metaLine(f, full.length));
  head.append(meta);

  const pre = h('pre', 'text');
  pre.tabIndex = 0;

  const copy = h('button', 'primary', 'Copy all of it');
  copy.type = 'button';
  copy.addEventListener('click', () => void copyText(full, copy));
  const save = h('button', undefined, 'Save as a text file');
  save.type = 'button';
  save.addEventListener('click', () => saveText(full));
  const toggle = h('button');
  toggle.type = 'button';

  const show = (): void => {
    paint(pre, expanded ? full : excerpt(full, terms), terms);
    toggle.hidden = full.length <= EXCERPT_CHARS;
    toggle.textContent = expanded ? 'Show less' : `Show all ${num(full.length)} characters`;
    meta.textContent = metaLine(f, full.length);
  };
  toggle.addEventListener('click', () => {
    expanded = !expanded;
    show();
  });

  const actions = h('div', 'actions');
  actions.append(copy, save, toggle);
  const versionsRow = h('div', 'versions');
  versionsRow.hidden = true;

  if (f.versionCount > 1) {
    const more = h('button', undefined, `See the other ${num(f.versionCount - 1)} saved ${f.versionCount === 2 ? 'copy' : 'copies'}`);
    more.type = 'button';
    more.addEventListener('click', () => {
      more.disabled = true;
      void engine
        .versions(f.id)
        .then((versions) => {
          const select = h('select');
          select.setAttribute('aria-label', 'Saved copies of this text');
          const current = f.shownVersion ?? f.primaryIndex;
          for (let i = versions.length - 1; i >= 0; i--) {
            const v = versions[i];
            const label =
              `Copy ${num(i + 1)} of ${num(versions.length)}: ${num(v.chars)} characters` +
              (i === versions.length - 1 ? ' (newest)' : i === 0 ? ' (oldest)' : '');
            const opt = h('option', undefined, label);
            opt.value = String(i);
            if (i === current) opt.selected = true;
            select.append(opt);
          }
          select.addEventListener('change', () => {
            full = versions[Number(select.value)].text;
            show();
          });
          versionsRow.replaceChildren(h('span', undefined, 'Showing:'), select);
          if (versions.length < f.versionCount) {
            versionsRow.append(h('span', 'quiet', `(${num(versions.length)} of ${num(f.versionCount)} copies are kept, spread evenly)`));
          }
          versionsRow.hidden = false;
          more.hidden = true;
        })
        .catch((err: unknown) => {
          more.disabled = false;
          showError(friendly(err));
        });
    });
    actions.append(more);
  }

  const why = h('details', 'why');
  why.append(h('summary', undefined, 'Where this came from'));
  const reasons = h('ul');
  for (const r of f.why) reasons.append(h('li', undefined, r));
  if (f.shownVersion !== undefined) reasons.append(h('li', undefined, 'Your search words were found in an older saved copy, so that copy is shown.'));
  why.append(reasons);
  for (const s of f.sources.slice(0, 3)) {
    const p = h('p');
    p.append(`${s.area}: `, h('code', undefined, s.file));
    why.append(p);
  }

  art.append(head, pre, actions, versionsRow, why);
  show();
  return art;
}

// ---------- wiring ----------

function init(): void {
  document.documentElement.dataset.mode = MODE;
  byId('version').textContent = __DTR_VERSION__;

  chips(
    byId('kind-chips'),
    [
      { id: 'all', label: 'Everything' },
      { id: 'typed', label: KIND_LABEL.typed },
      { id: 'draft', label: KIND_LABEL.draft },
      { id: 'backup', label: KIND_LABEL.backup },
      { id: 'other', label: KIND_LABEL.other },
    ],
    'all',
    (id) => {
      state.kind = id as Kind | 'all';
      void refresh();
    },
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  byId<HTMLInputElement>('search').addEventListener('input', (e) => {
    state.q = (e.target as HTMLInputElement).value;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 160);
  });
  byId<HTMLSelectElement>('minlen').addEventListener('change', (e) => {
    state.minChars = Number((e.target as HTMLSelectElement).value);
    void refresh();
  });

  byId('demo-btn').addEventListener('click', () => void scanDemo());

  byId('again-btn').addEventListener('click', () => {
    if (local) {
      void scanComputer();
    } else {
      byId('start').scrollIntoView({ behavior: 'smooth', block: 'start' });
      byId('dropzone').focus();
    }
  });

  if (local) {
    byId('scan-computer').addEventListener('click', () => void scanComputer());
    byId('quit-btn').addEventListener('click', () => {
      void local.quit().catch(() => undefined);
      document.body.replaceChildren(h('main'));
      const done = h('section', 'card');
      done.append(h('h2', undefined, 'The app has closed.'), h('p', undefined, 'You can close this tab now.'));
      document.querySelector('main')?.append(done);
    });
    const status = byId('local-status');
    if (!localKey) {
      showError('This page needs the private link the app opens for you. Close this tab and start the app again.');
    } else {
      local
        .info()
        .then((info) => {
          status.textContent = `Ready. Running on this computer only (${info.platform}).`;
        })
        .catch(() => showError('The app is not running any more. Start it again.'));
    }
    return;
  }

  // web mode
  chips(byId('app-chips'), GUIDES.map((g) => ({ id: g.id, label: g.label })), state.app, (id) => {
    state.app = id;
    renderGuide();
  });
  chips(
    byId('os-chips'),
    [
      { id: 'windows', label: 'Windows' },
      { id: 'mac', label: 'Mac' },
      { id: 'linux', label: 'Linux' },
    ],
    state.os,
    (id) => {
      state.os = id as Os;
      renderGuide();
    },
  );
  renderGuide();

  byId('reset-btn').addEventListener('click', () => {
    void inTab.reset();
    state.summary = null;
    state.active = null;
    byId('results').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const zone = byId('dropzone');
  const input = byId<HTMLInputElement>('folder-input');
  const pick = (): void => input.click();
  byId('pick-folder').addEventListener('click', (e) => {
    e.stopPropagation();
    pick();
  });
  zone.addEventListener('click', pick);
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick();
    }
  });
  input.addEventListener('change', () => {
    const picked = filesFromInput(input);
    input.value = '';
    void scanPicked(() => picked);
  });
  for (const type of ['dragenter', 'dragover'] as const) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.add('over');
    });
  }
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  // A folder dropped anywhere on the page must never make the browser navigate away.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    if (!e.dataTransfer) return;
    const { entries, loose } = entriesFromDrop(e.dataTransfer);
    if (entries.length === 0 && loose.length === 0) return;
    void scanPicked((count) => filesFromEntries(entries, loose, count));
  });

  if (new URLSearchParams(location.search).has('demo')) void scanDemo();
}

init();

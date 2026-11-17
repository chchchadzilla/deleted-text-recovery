/**
 * Decides, from a path alone, what a file is and whether it may be read.
 *
 * Two safety rules live here:
 *  1. A deny-list of files that hold passwords, cookies, payment data and encryption keys.
 *     The engine refuses them even if a person hands them over directly.
 *  2. Folder scans read only files in recognised autosave locations (`known`).
 */
import type { FileClass, StorageFlavor } from './types';

export const MAX_FILE_BYTES = 256 * 1024 * 1024;

const FORBIDDEN_NAMES = new Set([
  'login data',
  'login data-journal',
  'login data for account',
  'login data for account-journal',
  'cookies',
  'cookies-journal',
  'safe browsing cookies',
  'web data',
  'web data-journal',
  'local state',
  'trust tokens',
  'key3.db',
  'key4.db',
  'cert9.db',
  'logins.json',
  'logins-backup.json',
  'signons.sqlite',
  'cookies.sqlite',
  'cookies.sqlite-wal',
  'formhistory.sqlite',
  'autofill-profiles.json',
]);

const LEGACY_SESSION_NAMES = new Set(['current session', 'last session', 'current tabs', 'last tabs']);

/** Folders that are large and never hold typed text. Skipping them keeps scans fast. */
const SKIP_DIRS = new Set([
  'cache',
  'cache2',
  'code cache',
  'gpucache',
  'dawncache',
  'dawngraphitecache',
  'dawnwebgpucache',
  'grshadercache',
  'graphitedawncache',
  'shadercache',
  'service worker',
  'blob_storage',
  'file system',
  'crashpad',
  'crash reports',
  'component_crx_cache',
  'extensions',
  'safe browsing',
  'pnacl',
  'widevinecdm',
  'node_modules',
  '.git',
  'startupcache',
  'thumbnails',
  'media cache',
  'application cache',
  'optimization_guide_model_store',
  'webrtc_event_logs',
]);

export function shouldSkipDir(name: string): boolean {
  const lower = name.toLowerCase();
  return SKIP_DIRS.has(lower) || lower.endsWith('.indexeddb.blob');
}

const AREAS: { re: RegExp; flavor: StorageFlavor; area: string; marker: string }[] = [
  { re: /\/local storage\//, flavor: 'local-storage', area: 'Website storage', marker: '/local storage/' },
  { re: /\/session storage\//, flavor: 'session-storage', area: 'Website storage (this tab)', marker: '/session storage/' },
  { re: /\/indexeddb\//, flavor: 'indexeddb', area: 'Website database', marker: '/indexeddb/' },
  { re: /\/local extension settings\//, flavor: 'extension', area: 'Browser extension storage', marker: '/local extension settings/' },
  { re: /\/sync extension settings\//, flavor: 'extension', area: 'Browser extension storage', marker: '/sync extension settings/' },
];

const APP_NAMES: [RegExp, string][] = [
  [/\/google\/chrome beta\/|\/google-chrome-beta\//, 'Chrome Beta'],
  [/\/google\/chrome sxs\/|\/google\/chrome canary\/|\/google-chrome-unstable\//, 'Chrome Canary'],
  [/\/google\/chrome\/|\/google-chrome\//, 'Chrome'],
  [/\/microsoft\/edge[^/]*\/|\/microsoft edge[^/]*\/|\/microsoft-edge[^/]*\//, 'Edge'],
  [/\/brave-browser[^/]*\//, 'Brave'],
  [/\/vivaldi\//, 'Vivaldi'],
  [/\/opera gx stable\/|operagx/, 'Opera GX'],
  [/\/opera software\/|\/com\.operasoftware\.opera\/|\/opera\//, 'Opera'],
  [/\/arc\/user data\//, 'Arc'],
  [/\/chromium\//, 'Chromium'],
  [/\/firefox\/|\/\.mozilla\//, 'Firefox'],
  [/microsoft\.windowsnotepad/, 'Windows Notepad'],
  [/\/notepad\+\+\//, 'Notepad++'],
  [/\/code - insiders\//, 'VS Code Insiders'],
  [/\/vscodium\//, 'VSCodium'],
  [/\/cursor\//, 'Cursor'],
  [/\/windsurf\//, 'Windsurf'],
  [/\/code\//, 'VS Code'],
  [/\/office\/unsavedfiles\/|\/microsoft\/word\/|\/microsoft\/excel\/|\/microsoft\/powerpoint\//, 'Microsoft Office'],
];

const VSCODE_FAMILY = /\/(code|code - insiders|vscodium|cursor|windsurf)\//;
const TEXT_EXTENSIONS = /\.(txt|text|md|markdown|rtf|html?|json|csv|tsv|tex|org|rst|bak|sav|yaml|yml|xml)$/;

function appFromPath(lower: string): string | undefined {
  for (const [re, name] of APP_NAMES) if (re.test(lower)) return name;
  return undefined;
}

/** The folder name just before `marker`, in its original capitalisation. */
function segmentBefore(norm: string, lower: string, marker: string): string | undefined {
  const idx = lower.indexOf(marker);
  if (idx <= 0) return undefined;
  const head = norm.slice(0, idx);
  const seg = head.slice(head.lastIndexOf('/') + 1);
  return seg || undefined;
}

function originFromIndexedDbDir(dir: string): string | undefined {
  const m = /^([a-z][a-z0-9+.-]*)_(.+)_(\d+)$/i.exec(dir);
  if (!m) return undefined;
  return `${m[1]}://${m[2]}${m[3] === '0' ? '' : ':' + m[3]}`;
}

export function classifyPath(rawPath: string): FileClass {
  const norm = '/' + rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const lower = norm.toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  const cls: FileClass = {
    type: 'unknown',
    flavor: 'generic',
    area: 'File',
    app: appFromPath(lower),
    known: false,
    forbidden: FORBIDDEN_NAMES.has(base),
  };
  if (cls.forbidden) return cls;

  if (/\/sessions\/(session|tabs|apps)_\d+$/.test(lower) || LEGACY_SESSION_NAMES.has(base)) {
    cls.type = 'chromium-session';
    cls.area = 'Tab-restore history';
    cls.known = true;
    cls.profile = segmentBefore(norm, lower, '/sessions/');
    return cls;
  }

  if (/^\d{6}\.(log|ldb|sst)$/.test(base) || /\.(ldb|sst)$/.test(base)) {
    cls.type = base.endsWith('.log') ? 'leveldb-log' : 'leveldb-table';
    cls.area = 'App storage';
    for (const a of AREAS) {
      if (!a.re.test(lower)) continue;
      cls.flavor = a.flavor;
      cls.area = a.area;
      cls.known = true;
      cls.profile = segmentBefore(norm, lower, a.marker);
      break;
    }
    if (cls.flavor === 'indexeddb') {
      const m = /\/indexeddb\/([^/]+)\.indexeddb\.leveldb\//i.exec(norm);
      if (m) cls.origin = originFromIndexedDbDir(m[1]);
    }
    return cls;
  }

  if (/^(sessionstore|recovery|previous|upgrade)[^/]*\.(jsonlz4|baklz4)(-\d+)?$/.test(base)) {
    cls.type = 'firefox-session';
    cls.area = 'Tab-restore history';
    cls.known = true;
    cls.app = cls.app ?? 'Firefox';
    const m = /\/profiles\/([^/]+)\//i.exec(norm) ?? /\/firefox\/([^/]+)\//i.exec(norm);
    if (m) cls.profile = m[1];
    return cls;
  }

  if (VSCODE_FAMILY.test(lower) && /\/backups\//.test(lower)) {
    cls.type = 'text-backup';
    cls.area = 'Unsaved editor tabs';
    cls.known = base !== 'workspaces.json';
    return cls;
  }
  if (VSCODE_FAMILY.test(lower) && /\/user\/history\//.test(lower)) {
    cls.type = 'text-backup';
    cls.area = 'Editor local history';
    cls.known = base !== 'entries.json';
    return cls;
  }
  if (/\/notepad\+\+\/backup\//.test(lower)) {
    cls.type = 'text-backup';
    cls.area = 'Unsaved editor tabs';
    cls.known = true;
    return cls;
  }
  if (lower.includes('windowsnotepad') && /\/tabstate\/[^/]+\.bin$/.test(lower)) {
    cls.type = 'binary-backup';
    cls.area = 'Unsaved Notepad tabs';
    cls.known = true;
    return cls;
  }
  if (/\/unsavedfiles\//.test(lower) || /\.(asd|wbk)$/.test(base)) {
    cls.type = 'binary-backup';
    cls.area = 'Unsaved Office documents';
    cls.app = cls.app ?? 'Microsoft Office';
    cls.known = true;
    return cls;
  }
  if (TEXT_EXTENSIONS.test(base)) {
    cls.type = 'text-backup';
    cls.area = 'Text file';
  }
  return cls;
}

/** Should a scan read this file? `explicit` means the person picked the file itself. */
export function wantFile(path: string, size: number, explicit = false): boolean {
  if (size <= 0 || size > MAX_FILE_BYTES) return false;
  const cls = classifyPath(path);
  if (cls.forbidden) return false;
  return explicit || cls.known;
}

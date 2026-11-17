/** Shared types for the recovery engine. */

/**
 * typed   the contents of a text box, captured by the browser's tab-restore history
 * draft   text a website or extension saved in its own storage
 * backup  an unsaved-file backup kept by a desktop app
 * other   readable text found some other way
 */
export type Kind = 'typed' | 'draft' | 'backup' | 'other';

export type StorageFlavor = 'local-storage' | 'session-storage' | 'indexeddb' | 'extension' | 'generic';

export type FileType =
  | 'chromium-session'
  | 'leveldb-log'
  | 'leveldb-table'
  | 'firefox-session'
  | 'text-backup'
  | 'binary-backup'
  | 'unknown';

export interface FileClass {
  type: FileType;
  flavor: StorageFlavor;
  /** Plain-language name for the place this file belongs to. */
  area: string;
  app?: string;
  profile?: string;
  origin?: string;
  /** True when the file sits in a recognised autosave location. Folder scans read only these. */
  known: boolean;
  /** True for files that hold passwords, cookies, payment data or keys. These are never read. */
  forbidden: boolean;
}

export interface Passage {
  text: string;
  kind: Kind;
  file: string;
  area: string;
  app?: string;
  profile?: string;
  origin?: string;
  key?: string;
  field?: string;
  /** Position within the source: larger means saved later. */
  order: number;
  mtimeMs?: number;
  /** The storage key looked like a draft or editor field. */
  hinted?: boolean;
  wasHtml?: boolean;
}

export interface SourceRef {
  file: string;
  area: string;
  app?: string;
  profile?: string;
  origin?: string;
  key?: string;
  mtimeMs?: number;
}

export interface Version {
  text: string;
  chars: number;
  file: string;
  mtimeMs?: number;
}

export interface Finding {
  id: string;
  text: string;
  kind: Kind;
  score: number;
  chars: number;
  words: number;
  /** Plain-language reasons this was found and ranked where it is. */
  why: string[];
  sources: SourceRef[];
  /** Saved copies of the same text, oldest first. */
  versions: Version[];
  versionCount: number;
  /** Index into `versions` of the copy shown as `text`. */
  primaryIndex: number;
  newestMtimeMs?: number;
}

export type FindingView = Omit<Finding, 'versions'> & {
  /** Set when the search words were found only in another saved copy, which is shown instead. */
  shownVersion?: number;
};

export interface Query {
  /** Words the person remembers. Every word must appear. */
  q?: string;
  kinds?: Kind[];
  minChars?: number;
  limit?: number;
}

export interface QueryResult {
  total: number;
  matched: number;
  findings: FindingView[];
}

export interface ScanStats {
  files: number;
  bytes: number;
  passages: number;
  errors: number;
}

export interface FileMeta {
  mtimeMs?: number;
  /** Overrides the app name guessed from the path. */
  app?: string;
  /** The person chose this exact file, so read it even outside a recognised location. */
  explicit?: boolean;
}

export interface ExtractOptions {
  /** Shortest passage worth keeping from storage and raw scans. Text-box contents use a lower bar. */
  minChars?: number;
}

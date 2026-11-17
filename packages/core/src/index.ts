/**
 * @deleted-text-recovery/core
 *
 * The recovery engine. It reads the autosave trails that browsers and desktop apps leave on
 * disk and returns the text a person typed. It has no dependencies, performs no I/O of its own,
 * and makes no network requests: callers hand it bytes and get findings back.
 */
export const VERSION = '0.1.0';

export { RecoverySession } from './session';
export { extractPassages, type ExtractResult } from './extract';
export { buildFindings } from './cluster';
export { classifyPath, wantFile, shouldSkipDir, MAX_FILE_BYTES } from './classify';
export { parseLevelDbLog, parseLevelDbTable, isLevelDbTable, type LevelDbEntry } from './leveldb';
export { snappyDecompress, lz4BlockDecompress, decodeMozLz4, isMozLz4 } from './compression';
export { findMojoString16, formControlTypeBefore, findV8Strings, findUtf16Runs, findByteRuns } from './strings';
export { proseScore, isMostlyText, normalizeText, htmlToTextIfHtml, countWords } from './text';
export type {
  ExtractOptions,
  FileClass,
  FileMeta,
  FileType,
  Finding,
  FindingView,
  Kind,
  Passage,
  Query,
  QueryResult,
  ScanStats,
  SourceRef,
  StorageFlavor,
  Version,
} from './types';

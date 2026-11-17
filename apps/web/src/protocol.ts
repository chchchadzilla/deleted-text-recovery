/** Messages and shapes shared by the page, the in-tab worker and the desktop app's local API. */
import type { Query, QueryResult, Version } from '@deleted-text-recovery/core';

export interface PickedFile {
  path: string;
  file: File;
  /** The person dropped this exact file (not just a folder that contains it). */
  explicit: boolean;
}

export interface ScanProgress {
  done: number;
  total: number;
  current?: string;
  found: number;
}

export interface LockedFile {
  path: string;
  app?: string;
}

export interface ScanSummary {
  files: number;
  bytes: number;
  findings: number;
  locked: LockedFile[];
  notes: string[];
  ms: number;
  /** Desktop app only: the places that were looked in. */
  places?: string[];
}

export type ProgressFn = (p: ScanProgress) => void;

export interface Engine {
  query(q: Query): Promise<QueryResult>;
  versions(id: string): Promise<Version[]>;
}

export type WorkerRequest =
  | { id: number; op: 'scan'; files: PickedFile[] }
  | { id: number; op: 'demo' }
  | { id: number; op: 'query'; query: Query }
  | { id: number; op: 'versions'; findingId: string }
  | { id: number; op: 'reset' };

export type WorkerResponse =
  | { id: number; ev: 'progress'; progress: ScanProgress }
  | { id: number; ev: 'done'; result: unknown }
  | { id: number; ev: 'error'; message: string };

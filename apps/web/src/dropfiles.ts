/**
 * Turning a dropped folder into a short list of files worth reading.
 *
 * A browser's data folder can hold hundreds of thousands of cache files. Only files in
 * recognised autosave locations are opened; caches are skipped by folder name, and files that
 * can hold passwords, cookies or payment details are refused by the engine's deny-list.
 */
import { classifyPath, shouldSkipDir, wantFile } from '@deleted-text-recovery/core';
import type { PickedFile } from './protocol';

export interface Picked {
  files: PickedFile[];
  /** Paths that could not be opened at all (usually locked by a running browser). */
  unreadable: string[];
  checked: number;
}

const MAX_DEPTH = 16;

/** Must be called synchronously inside the drop event: the items expire when the handler returns. */
export function entriesFromDrop(dt: DataTransfer): { entries: FileSystemEntry[]; loose: File[] } {
  const entries: FileSystemEntry[] = [];
  const loose: File[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) {
      entries.push(entry);
    } else {
      const file = item.getAsFile();
      if (file) loose.push(file);
    }
  }
  return { entries, loose };
}

export async function filesFromEntries(
  entries: FileSystemEntry[],
  loose: File[],
  onCount: (checked: number) => void,
): Promise<Picked> {
  const out: Picked = { files: [], unreadable: [], checked: 0 };
  for (const file of loose) {
    out.checked++;
    if (wantFile(file.name, file.size, true)) out.files.push({ path: file.name, file, explicit: true });
  }
  for (const entry of entries) await walk(entry, entry.name, 0, out, onCount);
  onCount(out.checked);
  return out;
}

async function walk(
  entry: FileSystemEntry,
  path: string,
  depth: number,
  out: Picked,
  onCount: (checked: number) => void,
): Promise<void> {
  if (entry.isFile) {
    out.checked++;
    if (out.checked % 500 === 0) onCount(out.checked);
    const explicit = depth === 0;
    const cls = classifyPath(path);
    if (cls.forbidden || (!explicit && !cls.known)) return;
    try {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      if (wantFile(path, file.size, explicit)) out.files.push({ path, file, explicit });
    } catch {
      out.unreadable.push(path);
    }
    return;
  }
  if (!entry.isDirectory || depth > MAX_DEPTH) return;
  if (depth > 0 && shouldSkipDir(entry.name)) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    let batch: FileSystemEntry[];
    try {
      batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    } catch {
      return;
    }
    if (batch.length === 0) return;
    for (const child of batch) await walk(child, `${path}/${child.name}`, depth + 1, out, onCount);
  }
}

/** For the "choose a folder" button, which hands over every file with its relative path. */
export function filesFromInput(input: HTMLInputElement): Picked {
  const out: Picked = { files: [], unreadable: [], checked: 0 };
  for (const file of Array.from(input.files ?? [])) {
    out.checked++;
    const path = file.webkitRelativePath || file.name;
    const explicit = !file.webkitRelativePath;
    if (wantFile(path, file.size, explicit)) out.files.push({ path, file, explicit });
  }
  return out;
}

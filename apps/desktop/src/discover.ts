/**
 * Finds autosave files on this computer without being told where to look.
 *
 * Known browsers are listed by name. Everything else built on Chromium (Slack, Discord,
 * Notion, Obsidian, VS Code and hundreds more) keeps the same storage folders, so those are
 * found by probing each app folder for them rather than by keeping a list of apps.
 *
 * Only recognised autosave locations are entered. Password, cookie and payment files are
 * refused by the engine's deny-list even if they sit in the same folder.
 */
import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyPath, shouldSkipDir, wantFile } from '@deleted-text-recovery/core';

export interface FoundFile {
  path: string;
  size: number;
  mtimeMs: number;
  app?: string;
  explicit?: boolean;
}

const STORAGE_DIRS = ['Sessions', 'Local Storage', 'Session Storage', 'IndexedDB', 'Local Extension Settings', 'Sync Extension Settings'];
const EDITORS = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor', 'Windsurf'];

async function list(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

class Collector {
  readonly files: FoundFile[] = [];
  private readonly seenDirs = new Set<string>();
  private readonly seenFiles = new Set<string>();

  constructor(private readonly cutoffMs: number) {}

  private key(p: string): string {
    return process.platform === 'win32' ? p.toLowerCase() : p;
  }

  async addFile(full: string, app: string | undefined, explicit = false): Promise<void> {
    const k = this.key(full);
    if (this.seenFiles.has(k)) return;
    this.seenFiles.add(k);
    const cls = classifyPath(full);
    if (cls.forbidden || (!explicit && !cls.known)) return;
    let info;
    try {
      info = await stat(full);
    } catch {
      return;
    }
    if (!info.isFile() || !wantFile(full, info.size, explicit)) return;
    if (!explicit && this.cutoffMs > 0 && info.mtimeMs < this.cutoffMs) return;
    this.files.push({ path: full, size: info.size, mtimeMs: info.mtimeMs, app: app ?? cls.app, explicit });
  }

  /** Walks a folder that is itself an autosave location, to a small fixed depth. */
  async walk(dir: string, app: string | undefined, depth: number, explicitFiles = false): Promise<void> {
    const k = this.key(dir);
    if (this.seenDirs.has(k)) return;
    this.seenDirs.add(k);
    for (const entry of await list(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) await this.addFile(full, app, explicitFiles);
      else if (entry.isDirectory() && depth > 0 && !shouldSkipDir(entry.name)) await this.walk(full, app, depth - 1);
    }
  }

  /** A Chromium profile folder: enter only its storage folders. */
  async probeProfile(dir: string, app: string | undefined): Promise<boolean> {
    let found = false;
    for (const name of STORAGE_DIRS) {
      const before = this.files.length;
      await this.walk(path.join(dir, name), app, 3);
      if (this.files.length > before) found = true;
    }
    return found;
  }

  /** An app folder: the profile may be the folder itself, or sit under User Data, Default or Partitions. */
  async probeApp(dir: string, app: string | undefined): Promise<void> {
    await this.probeProfile(dir, app);
    await this.probeProfile(path.join(dir, 'Default'), app);
    for (const container of ['User Data', 'Partitions']) {
      for (const entry of await list(path.join(dir, container))) {
        if (entry.isDirectory() && !shouldSkipDir(entry.name)) await this.probeProfile(path.join(dir, container, entry.name), app);
      }
    }
  }

  /** A folder whose children are profiles (Chrome's "User Data", for example). */
  async probeProfilesIn(dir: string, app: string): Promise<void> {
    for (const entry of await list(dir)) {
      if (entry.isDirectory() && !shouldSkipDir(entry.name)) await this.probeProfile(path.join(dir, entry.name), app);
    }
  }

  async probeFirefox(profilesDir: string): Promise<void> {
    for (const entry of await list(profilesDir)) {
      if (!entry.isDirectory()) continue;
      const profile = path.join(profilesDir, entry.name);
      await this.addFile(path.join(profile, 'sessionstore.jsonlz4'), 'Firefox');
      await this.walk(path.join(profile, 'sessionstore-backups'), 'Firefox', 0);
    }
  }
}

function friendlyAppName(dirName: string): string {
  return dirName.replace(/^com\.|^org\.|^io\./i, '').replace(/[-_.]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export async function discover(days: number): Promise<FoundFile[]> {
  const cutoff = days > 0 ? Date.now() - days * 86_400_000 : 0;
  const c = new Collector(cutoff);
  const home = os.homedir();
  const sweep: string[] = [];
  let editorBase = '';

  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    editorBase = roaming;
    await c.probeProfilesIn(path.join(localApp, 'Google', 'Chrome', 'User Data'), 'Chrome');
    await c.probeProfilesIn(path.join(localApp, 'Google', 'Chrome Beta', 'User Data'), 'Chrome Beta');
    await c.probeProfilesIn(path.join(localApp, 'Google', 'Chrome SxS', 'User Data'), 'Chrome Canary');
    await c.probeProfilesIn(path.join(localApp, 'Microsoft', 'Edge', 'User Data'), 'Edge');
    await c.probeProfilesIn(path.join(localApp, 'BraveSoftware', 'Brave-Browser', 'User Data'), 'Brave');
    await c.probeProfilesIn(path.join(localApp, 'Vivaldi', 'User Data'), 'Vivaldi');
    await c.probeProfilesIn(path.join(localApp, 'Chromium', 'User Data'), 'Chromium');
    await c.probeApp(path.join(roaming, 'Opera Software', 'Opera Stable'), 'Opera');
    await c.probeApp(path.join(roaming, 'Opera Software', 'Opera GX Stable'), 'Opera GX');
    for (const entry of await list(path.join(localApp, 'Packages'))) {
      if (entry.isDirectory() && /^TheBrowserCompany\.Arc/i.test(entry.name)) {
        await c.probeProfilesIn(path.join(localApp, 'Packages', entry.name, 'LocalCache', 'Local', 'Arc', 'User Data'), 'Arc');
      }
      if (entry.isDirectory() && /^Microsoft\.WindowsNotepad_/i.test(entry.name)) {
        await c.walk(path.join(localApp, 'Packages', entry.name, 'LocalState', 'TabState'), 'Windows Notepad', 0);
      }
    }
    await c.probeFirefox(path.join(roaming, 'Mozilla', 'Firefox', 'Profiles'));
    await c.walk(path.join(roaming, 'Notepad++', 'backup'), 'Notepad++', 0);
    await c.walk(path.join(localApp, 'Microsoft', 'Office', 'UnsavedFiles'), 'Microsoft Office', 0);
    await c.walk(path.join(roaming, 'Microsoft', 'Word'), 'Microsoft Office', 0);
    sweep.push(roaming, localApp);
  } else if (process.platform === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support');
    editorBase = support;
    await c.probeProfilesIn(path.join(support, 'Google', 'Chrome'), 'Chrome');
    await c.probeProfilesIn(path.join(support, 'Google', 'Chrome Beta'), 'Chrome Beta');
    await c.probeProfilesIn(path.join(support, 'Google', 'Chrome Canary'), 'Chrome Canary');
    await c.probeProfilesIn(path.join(support, 'Microsoft Edge'), 'Edge');
    await c.probeProfilesIn(path.join(support, 'BraveSoftware', 'Brave-Browser'), 'Brave');
    await c.probeProfilesIn(path.join(support, 'Vivaldi'), 'Vivaldi');
    await c.probeProfilesIn(path.join(support, 'Chromium'), 'Chromium');
    await c.probeProfilesIn(path.join(support, 'Arc', 'User Data'), 'Arc');
    await c.probeApp(path.join(support, 'com.operasoftware.Opera'), 'Opera');
    await c.probeFirefox(path.join(support, 'Firefox', 'Profiles'));
    sweep.push(support);
  } else {
    const config = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
    editorBase = config;
    await c.probeProfilesIn(path.join(config, 'google-chrome'), 'Chrome');
    await c.probeProfilesIn(path.join(config, 'google-chrome-beta'), 'Chrome Beta');
    await c.probeProfilesIn(path.join(config, 'chromium'), 'Chromium');
    await c.probeProfilesIn(path.join(config, 'microsoft-edge'), 'Edge');
    await c.probeProfilesIn(path.join(config, 'BraveSoftware', 'Brave-Browser'), 'Brave');
    await c.probeProfilesIn(path.join(config, 'vivaldi'), 'Vivaldi');
    await c.probeApp(path.join(config, 'opera'), 'Opera');
    await c.probeProfilesIn(path.join(home, 'snap', 'chromium', 'common', 'chromium'), 'Chromium');
    await c.probeProfilesIn(path.join(home, '.var', 'app', 'com.google.Chrome', 'config', 'google-chrome'), 'Chrome');
    await c.probeProfilesIn(path.join(home, '.var', 'app', 'org.chromium.Chromium', 'config', 'chromium'), 'Chromium');
    await c.probeProfilesIn(path.join(home, '.var', 'app', 'com.brave.Browser', 'config', 'BraveSoftware', 'Brave-Browser'), 'Brave');
    await c.probeFirefox(path.join(home, '.mozilla', 'firefox'));
    await c.probeFirefox(path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'));
    await c.probeFirefox(path.join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'));
    sweep.push(config);
  }

  for (const editor of EDITORS) {
    await c.walk(path.join(editorBase, editor, 'Backups'), undefined, 4);
    await c.walk(path.join(editorBase, editor, 'User', 'History'), undefined, 2);
  }

  // Everything else built on Chromium: probe each app folder for the same storage folders.
  for (const parent of sweep) {
    for (const entry of await list(parent)) {
      if (!entry.isDirectory() || shouldSkipDir(entry.name)) continue;
      await c.probeApp(path.join(parent, entry.name), friendlyAppName(entry.name));
    }
  }

  c.files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return c.files;
}

/** For --path: files are read as given; folders are searched for autosave locations. */
export async function discoverPaths(paths: string[]): Promise<FoundFile[]> {
  const c = new Collector(0);
  for (const p of paths) {
    const full = path.resolve(p);
    let info;
    try {
      info = await stat(full);
    } catch {
      continue;
    }
    if (info.isFile()) {
      await c.addFile(full, undefined, true);
    } else if (info.isDirectory()) {
      await c.probeApp(full, classifyPath(full + path.sep).app);
      await c.probeProfilesIn(full, classifyPath(full + path.sep).app ?? path.basename(full));
      await c.probeFirefox(full);
      await c.walk(full, undefined, 1, true);
    }
  }
  c.files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return c.files;
}

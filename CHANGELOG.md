# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-17

First release.

### Added

- **Recovery engine** (`packages/core`): zero-dependency TypeScript that runs in browsers and Node.
  - Reads Chromium tab-restore files and recovers the contents of text boxes, including the full history of saved copies.
  - Reads LevelDB journals and Snappy-compressed tables for Local Storage, Session Storage, IndexedDB and extension storage.
  - Reads Firefox session files (LZ4) for form contents and per-tab storage.
  - Reads unsaved-file backups from VS Code-family editors, Notepad++, Windows Notepad and Microsoft Office.
  - Groups saved copies of the same text into one result, detects accidental deletes, and ranks results by how likely they are to be what was typed.
  - Refuses to read files that hold passwords, cookies, payment data or encryption keys.
- **Web app** (`apps/web`): one self-contained page that scans a dropped folder inside the browser tab. Its Content-Security-Policy forbids all network connections. Includes step-by-step directions for Windows, macOS and Linux and a demo on made-up data.
- **Desktop app** (`apps/desktop`): finds every supported browser and app by itself on Windows, macOS and Linux, including other apps built on Chromium. Shows results in a page served only to the local computer, or prints them with `--cli`. JSON and text-file export.
- Standalone downloads for Windows, macOS and Linux, with checksums.
- 23 automated tests, and CI set up for Windows, macOS and Linux.

### Verified

- Real recoveries on Windows 11 with Chrome, Edge and Brave.
- A whole-computer scan (707 files, 586 MB) completes in about 27 seconds on the author's machine.

### Known limits

- Firefox support is tested on synthetic files only.
- The automated tests have so far run on Windows only. The macOS and Linux CI runs are pending, and there is no confirmed real-world recovery on either yet.
- The macOS and Linux downloads were cross-built on Windows and have not yet been run on a real machine.
- The 0.1.0 downloads were built on the maintainer's computer rather than in CI.
- The downloads are not code-signed, so Windows and macOS warn about an unknown developer.
- Safari is not supported.

[Unreleased]: https://github.com/chchchadzilla/deleted-text-recovery/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/chchchadzilla/deleted-text-recovery/releases/tag/v0.1.0

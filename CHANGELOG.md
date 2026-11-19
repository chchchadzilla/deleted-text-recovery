# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Build tools updated: TypeScript 5.9 to 7.0 and esbuild 0.25 to 0.28. All 23 tests pass and both apps were rebuilt and smoke-tested. Node's type definitions stay on the 22 line on purpose, so the type-checker keeps rejecting APIs that older supported Node versions lack.
- The three GitHub Actions workflows are now manual-only. GitHub Actions is not available on the maintainer's account, so every automatic run failed and marked commits with a red cross. Checks, releases and web deploys are done with local scripts instead.
- Dependabot now opens one grouped pull request a month for the build tools, and no longer watches GitHub Actions versions, which cannot be tested here.

### Added

- `scripts/deploy-web.sh` publishes the web app to the `gh-pages` branch.

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

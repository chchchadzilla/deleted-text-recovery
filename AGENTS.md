# AGENTS.md

Instructions for AI coding agents. This file is model-agnostic: it applies to any assistant, from any vendor.

There are two reasons you might be reading it:

1. **A person lost some text and asked you to get it back.** Read [Part 1](#part-1-using-the-tool-to-recover-someones-text).
2. **You are changing this codebase.** Read [Part 2](#part-2-working-on-this-codebase).

---

## Part 1: Using the tool to recover someone's text

### Before you run anything

The person is probably upset and the evidence is perishable. Protect it.

- **Do not close, reload or restart their browser, and do not restart the computer, unless they say so.** Browsers delete old tab-restore files during normal use.
- **Do not open new tabs in the browser they were typing in.** Use the command line.
- Ask at most three quick things if you do not already know them: which browser or app, roughly when, and a few words they remember.
- Everything this tool does is read-only. Keep your own actions read-only too. Never write into a browser profile folder.

### Run it

With a release download (no Node needed):

```bash
./deleted-text-recovery --cli --days 2 --top 5
```

On Windows the file is `DeletedTextRecovery-Windows.exe`. With Node 20 or newer and this repository:

```bash
npm install && npm run build
```

```bash
node apps/desktop/dist/deleted-text-recovery.cjs --cli --days 2 --top 5
```

Useful options:

| Option | Use |
| --- | --- |
| `--search "words they remember"` | Show only text containing all of those words. The fastest way to the right result. |
| `--days <n>` | Only read files changed in the last n days. Default 30. `0` reads everything. |
| `--top <n>` | How many results to print or export. Default 10. |
| `--min <n>` | Shortest text to show, in characters. Default 40. |
| `--save <folder>` | Write each printed result to its own `.txt` file. |
| `--json <file>` | Write the printed results as JSON, with every saved copy of each. `--json -` sends only JSON to stdout. |
| `--all` | With `--json`: include every result instead of the top ones. Can be very large. |
| `--path <file or folder>` | Look only here instead of searching the whole computer. Repeatable. |
| `--verbose` | Report timings and slow files on stderr. |

### Read the output

Each result has a kind. In order of how likely it is to be what the person typed:

| Kind | Meaning |
| --- | --- |
| `typed` | The contents of a text box, captured in the browser's tab-restore history. Strongest evidence. |
| `draft` | Text a website or extension saved in its own storage. |
| `backup` | An unsaved-file backup kept by a desktop app. |
| `other` | Readable text found another way. |

`versionCount` is the number of saved copies of the same text. A high count on a `typed` result means the text was captured repeatedly while it was being typed: that is almost always the lost text. In JSON, `versions` lists the copies oldest first and `primaryIndex` marks the one shown as `text`. If the newest copy is much shorter than an earlier one (an accidental delete), the fullest copy is shown and the reason is in `why`.

JSON shape, abridged:

```json
{
  "tool": "deleted-text-recovery",
  "version": "0.1.0",
  "summary": { "files": 707, "findings": 13361, "locked": [{ "path": "...", "app": "Chrome" }], "places": ["Chrome", "Edge"] },
  "totalFindings": 13361,
  "findings": [
    {
      "id": "f0-abc123",
      "kind": "typed",
      "text": "the recovered text",
      "chars": 7029,
      "words": 1213,
      "versionCount": 101,
      "primaryIndex": 59,
      "why": ["This was the contents of a text box, kept in Chrome's tab-restore history."],
      "sources": [{ "app": "Chrome", "profile": "Default", "area": "Tab-restore history", "file": "..." }],
      "versions": [{ "text": "an earlier copy", "chars": 5705 }]
    }
  ]
}
```

### If the right text is not there

1. **Locked files.** The summary lists files it could not read. On Windows a running browser holds its newest tab-restore file exclusively. Tell the person, and **ask before closing the browser**. Once every window of it is closed (and not reopened), run the scan again.
2. Search with different remembered words, or drop `--search`.
3. Use `--days 0` and `--min 0`.
4. Check other browsers and other profiles: the whole-computer scan already covers all of them.
5. Say plainly when it cannot be found. Rich-text editors, private windows and pages that disable autosave leave little or nothing. Do not invent or reconstruct text and present it as recovered.

### Handling what you find

Recovered text belongs to the person. Show them what they asked for and save it where they asked. Do not paste unrelated results into the conversation, do not send any of it to another service, and do not keep copies in temporary folders after you are done.

---

## Part 2: Working on this codebase

### Layout

```text
packages/core     recovery engine (pure TypeScript, zero dependencies, runs in browsers and Node)
apps/web          the web app, built into one self-contained HTML file
apps/desktop      discovery, local server and CLI, built into one .cjs file
scripts           build.mjs, test.mjs, audit.mjs, serve-web.mjs
docs              HOW_IT_WORKS.md and release notes
assets            logo, mascot, banners
```

### Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install the three development tools (TypeScript, esbuild, Node types). |
| `npm run typecheck` | Strict type-check of every package. |
| `npm test` | Bundle and run every `*.test.ts` on Node's built-in test runner. |
| `npm run build` | Build `apps/web/dist/index.html` and `apps/desktop/dist/deleted-text-recovery.cjs`. |
| `npm run check` | All three of the above. Run this before you say a change is done. |
| `node scripts/audit.mjs` | Fail if credentials, real browser data, personal paths or e-mail addresses are in the tree. |
| `npm start` | Build and open the desktop app. |
| `npm run serve:web` | Serve the built web app at `http://127.0.0.1:4173/` (add `?demo` for sample data). |

### Rules that must never be broken

These are what make the tool safe to hand to a stranger. A change that weakens any of them is wrong even if every test passes.

1. **No network egress.** The engine does no I/O. The web page's Content-Security-Policy has `connect-src 'none'` and a hash-pinned inline script. The desktop server binds to `127.0.0.1` only. Do not add `fetch` calls, analytics, update checks, fonts or any external resource.
2. **Read-only.** Nothing may write into, move or delete a browser or app data file. The desktop app writes only where `--save` or `--json` point.
3. **The deny-list stays.** `FORBIDDEN_NAMES` in `packages/core/src/classify.ts` blocks files that hold passwords, cookies, payment data and keys. Never remove entries. Add new ones when you learn of them.
4. **No real data as fixtures.** Tests and the demo build synthetic files with `packages/core/src/testing.ts`. Never commit a real tab-restore file, LevelDB file or anything recovered from a real machine. `scripts/audit.mjs` enforces this.
5. **No secrets.** The project needs no API keys. `.env` files and key material are git-ignored and the audit rejects them.
6. **Recovered text is untrusted input.** In the page it is placed with `textContent` only, never as HTML.
7. **The local server keeps its guards:** random key on every API call, `Host` and `Origin` checks, no CORS headers.
8. **Zero runtime dependencies.** Development tools are fine when justified. Shipping a third-party package inside the engine or the apps is not.

### Conventions

- TypeScript, `strict`. No `any` unless a comment explains why.
- The engine must run unchanged in a browser, a Web Worker and Node: use `Uint8Array`, `TextDecoder` and nothing platform-specific in `packages/core`.
- Every parser bounds-checks its input and fails soft. Files come straight off disk and may be truncated, locked mid-write or damaged. One bad block must not hide the rest of a file.
- Watch for accidental quadratic work on binary data: validate a candidate cheaply before decoding it in full.
- User-facing words are plain and calm. The reader may be a panicking non-technical person. No jargon in the app or the README without an explanation next to it.
- A new place to look needs: a rule in `classify.ts`, an extractor path in `extract.ts`, discovery in `apps/desktop/src/discover.ts`, a synthetic fixture and a test, and a line in the README's "What it searches" table.
- State what you verified and how. If a format reader has only been tested on synthetic files, say so in the docs.

### Releasing

1. Update `version` in the four `package.json` files, `VERSION` in `packages/core/src/index.ts`, and `CHANGELOG.md`.
2. `npm run check` and `node scripts/audit.mjs`.
3. Tag `vX.Y.Z` and publish a GitHub release. The `Release` workflow compiles the standalone programs for Windows, macOS and Linux and attaches them with checksums.
4. The `Deploy web app` workflow publishes `apps/web/dist` to GitHub Pages on every push to `main`.

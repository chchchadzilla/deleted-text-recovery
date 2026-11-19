# Contributing

Thank you for helping other people get their writing back.

## The most useful thing you can do

**Tell us whether it worked.** The tool has been tried on real lost text on Windows with Chrome, Edge and Brave. Reports from Macs, Linux and Firefox are worth more right now than any code. Post in [Discussions](https://github.com/chchchadzilla/deleted-text-recovery/discussions):

- your operating system and browser (and their versions, if you know them)
- what kind of box you were typing in (a plain box, an editor with formatting buttons, a desktop app)
- whether your text was found, and under which label

**Never post the recovered text itself, and never attach real browser files.** They can contain private things you have forgotten about.

## Ground rules for code

These are the same rules as in [AGENTS.md](AGENTS.md), because they apply to people and AI assistants alike:

1. Nothing may ever send data anywhere. No analytics, no update checks, no remote fonts or images.
2. Read-only. Nothing writes into a browser or app data folder.
3. The deny-list of password, cookie and payment files only ever grows.
4. No real data as test files. Build synthetic ones with `packages/core/src/testing.ts`.
5. No runtime dependencies.
6. Words shown to people are plain and calm. Assume the reader is upset and not technical.

## Getting set up

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
```

```bash
npm run check
```

`npm run check` type-checks, runs the tests and builds both apps. Before opening a pull request, also run:

```bash
node scripts/audit.mjs
```

Useful while working:

| Command | What it does |
| --- | --- |
| `npm test` | Run the tests. |
| `npm start` | Build and open the desktop app. |
| `npm run serve:web` | Serve the web app at `http://127.0.0.1:4173/`. Add `?demo` to load sample data. |
| `node apps/desktop/dist/deleted-text-recovery.cjs --cli --verbose` | Scan from a terminal with timings. |

## Adding a new place to look

1. Teach `packages/core/src/classify.ts` to recognise the files.
2. Add or reuse an extractor in `packages/core/src/extract.ts`.
3. Add the location to `apps/desktop/src/discover.ts` for each operating system you can vouch for.
4. Add a builder for a synthetic version of the file to `packages/core/src/testing.ts`, and a test.
5. Add it to the "What it searches" table in the README, and say honestly how it has been tested.

## Pull requests

- **Nothing checks a pull request automatically here.** GitHub Actions is not available on the maintainer's account, so there are no green ticks to wait for. Please run `npm run check` and `node scripts/audit.mjs` yourself and say that you did. A maintainer runs them again before merging. In your own fork you can run the `CI` workflow by hand from the Actions tab, which also covers macOS and Linux.
- Keep them small and say what you verified and how.
- Add a line to `CHANGELOG.md` under "Unreleased".
- By contributing you agree that your work is released under the [MIT licence](LICENSE).

Please be kind. See the [Code of Conduct](CODE_OF_CONDUCT.md).

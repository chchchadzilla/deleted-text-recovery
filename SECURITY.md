# Security and privacy

This tool reads files that can contain very personal writing. That is taken seriously.

## What the tool does and does not do

| | |
| --- | --- |
| Sends your data anywhere | **Never.** The web page's Content-Security-Policy forbids all network connections. The desktop app talks only to `127.0.0.1`. There is no telemetry, analytics, crash reporting or update check. |
| Changes or deletes files | **Never.** Every file is opened read-only. |
| Reads saved passwords, cookies, payment methods, autofill profiles or encryption keys | **Never.** Those file names are on a deny-list in `packages/core/src/classify.ts`, enforced even if a person hands such a file over directly, and covered by a test. |
| Stores what it finds | **No.** Results live in memory and are gone when the page or the app closes, unless you choose "Save as a text file" or use `--save` / `--json`. |
| Needs an account, a key or a licence | **No.** |
| Third-party code inside the engine or the apps | **None.** Only three development tools are used to build it: TypeScript, esbuild and Node's type definitions. |

## The desktop app's local server

The desktop app shows its results in your browser, so it runs a small web server. It is restricted in every way that matters:

- It listens on `127.0.0.1` only. Other devices on your network cannot reach it.
- Every data request must carry a random 192-bit key created when the app starts. Only the page the app opens knows it.
- It rejects requests whose `Host` or `Origin` is not its own, which blocks other websites (including DNS-rebinding attacks) from reading results through your browser.
- It sends no CORS headers, disables caching and framing, and never writes to disk.

## Downloads

Every release includes a `SHA256SUMS.txt` file. The downloads are built from the tagged source on the maintainer's computer with `scripts/release-local.sh`, because GitHub Actions is not available on the maintainer's account. That means there is no independent build record: you are trusting the maintainer's machine. If that matters to you, build it yourself (`npm install`, then `bash scripts/release-local.sh`), run the `Release` workflow in your own fork, or use the web app, whose single file you can read. The programs are not yet code-signed, so Windows and macOS will warn about an unknown developer. If you would rather not run a download, the web app does the same job with nothing to install.

## Use it on your own data

The tool can only see what the person running it can already open, on the computer it is running on. Please use it on your own computer and account, or with the clear permission of the person whose text you are recovering.

## Reporting a problem

If you find a way this tool could expose, send, alter or delete someone's data, or a way to make it read files it should not, please report it privately:

**<https://github.com/chchchadzilla/deleted-text-recovery/security/advisories/new>**

Please do not open a public issue for security problems, and never attach real recovered text or real browser files to any report. A description and, if you can, a synthetic file built with `packages/core/src/testing.ts` is ideal.

Supported version: the latest release.

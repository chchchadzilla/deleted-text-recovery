# How it works

A plain-language tour first, then the technical detail.

## The short version

When you type into a box on a web page, your browser does two things you never see:

1. **It keeps a running copy of what is in the box**, so that if the browser crashes, or you reopen a closed tab, it can put your words back. These copies are written to a "tab-restore" file on your disk, again and again, while you type.
2. **It lets the website keep small notes of its own** on your disk. Many sites use these to save drafts.

Neither of those is erased the instant you delete your text, reload the page or close the tab. Old copies sit in the files until the browser's housekeeping tidies them away, which can take minutes, hours or days.

Deleted Text Recovery opens those files (read-only), pulls out everything that looks like writing, groups the many copies of the same text into one result, and puts the most likely one first.

## Why "the most likely one" is usually right

A browser saves a text box many times while it is being typed in. The lost message that started this project had been saved 101 times, each copy a little longer than the one before. Nothing else on a computer looks like that: the same text, growing a few words at a time, in the tab-restore history, minutes ago. So results are ranked by:

- **What kind of evidence it is.** The contents of a text box rank above drafts a site stored, which rank above text found by blind scanning.
- **Whether there is a trail.** Three or more saved copies of one text is the strongest signal.
- **How recent the file is.**
- **Whether it reads like writing.** Long machine-made codes sink to the bottom.

When the newest copy is much shorter than an earlier one, the tool assumes an accidental delete and shows the fullest copy first.

## What it reads

### 1. Chromium tab-restore files (Chrome, Edge, Brave, Vivaldi, Opera, Arc)

Location: `<profile>/Sessions/Session_<number>` and `Tabs_<number>`.

These are append-only logs of commands. Each time a page's state changes, the browser appends a fresh copy of that page's state, which includes the value of every form control. Earlier copies stay in the file, which is why a whole typing history can be recovered.

Form values are stored as UTF-16 arrays in Mojo's wire format: a 32-bit byte count, a 32-bit element count, then the characters. The reader (`findMojoString16`) scans for positions where those two numbers agree with each other. That gives exact string boundaries in any language, emoji included, with almost no false matches.

Each form control is written as four strings in a row: its name, its type, how many values it has, and the value. So a string is known to be the contents of a text box when the word `textarea` (or `text`, `search`, `email`, `url`, `tel`, `number`) sits at one exact distance before it: 72 bytes before for `textarea`, 64 for `text`. Those distances were measured on real session files from several browser profiles and versions, then written into `formControlTypeBefore`.

**Limit:** browsers only save real form fields this way. Rich editors built from `contenteditable` (the kind with formatting buttons) are not form fields, so they do not appear here. Fields that a site marks with autocomplete off are generally skipped by the browser too.

### 2. Chromium website storage

Location: `<profile>/Local Storage/leveldb`, `Session Storage`, `IndexedDB/<site>.indexeddb.leveldb`, and the extension settings folders.

All of these are LevelDB databases. Two file types matter:

- `NNNNNN.log` is the write-ahead journal: every recent write, in order, uncompressed.
- `NNNNNN.ldb` are sorted tables whose blocks are compressed with Snappy.

LevelDB never edits a value in place. An overwrite or a delete is a new record, and the old one remains until a background compaction rewrites the file. The readers (`parseLevelDbLog`, `parseLevelDbTable`) return every record they can find, including the superseded ones. A Snappy decompressor is included, written from the format description.

Values are then interpreted by area:

- **Local Storage** values carry a one-byte prefix saying whether the rest is UTF-16 or Latin-1. Keys carry the website's address.
- **Session Storage** values are UTF-16; a separate record maps each storage area to its website.
- **IndexedDB** values are in V8's structured-clone format. `findV8Strings` reads its one-byte, two-byte and UTF-8 string records.

Sites usually store JSON, sometimes JSON inside JSON, so strings are unwrapped until the actual text is reached. HTML drafts are converted to plain text.

Websites also store a great deal of their own wording. To keep that out of the way, a stored string is kept only if its key looks like a draft (`draft`, `autosave`, `comment`, `message` and so on) or it is at least a couple of sentences of real prose.

### 3. Firefox session files

Location: `<profile>/sessionstore.jsonlz4` and `<profile>/sessionstore-backups/*.jsonlz4` / `*.baklz4`.

These are JSON, compressed with LZ4 inside a small Mozilla container. Firefox records form contents explicitly under a `formdata` key for each page in each tab, including recently closed tabs and windows, and records each tab's session storage. An LZ4 decompressor is included.

**Status:** built from the documented format and tested on synthetic files. Not yet confirmed against a real Firefox profile.

### 4. Desktop app backups (desktop app only)

- VS Code, Cursor, VSCodium, Windsurf: `Backups` (unsaved tabs) and `User/History` (local file history).
- Notepad++: `backup`.
- Windows Notepad: the `TabState` files that hold unsaved tabs.
- Microsoft Office: `UnsavedFiles` and Word's AutoRecover files.

Text files are read whole. Binary ones go through a blind scan for runs of readable UTF-16 or UTF-8 text.

### 5. Other apps built on Chromium

Slack, Discord, Notion, Obsidian and hundreds of other desktop apps are built on the same browser engine and keep the same storage folders. The desktop app does not need a list of them: it probes each application folder for those folder names.

## What it deliberately does not read

Saved passwords, cookies, payment methods, autofill profiles and encryption keys. The file names are on a deny-list (`FORBIDDEN_NAMES` in `packages/core/src/classify.ts`). The engine refuses them even when a person hands one over directly, and a test asserts that.

Browser caches are skipped as well. They are large and do not contain what you typed.

## Why it sometimes cannot help

- **The file was already tidied away.** Browsers keep only a few tab-restore files and rotate them as you browse.
- **The newest file is locked.** On Windows, a running Chromium browser holds its current tab-restore file so that nothing else can read it. The tool reports this and asks you to close the browser. On macOS and Linux files are not locked this way.
- **It was a rich editor**, and the site did not save a draft of its own.
- **It was a private window.** Those are designed to write nothing to disk.
- **The text never left the page's memory.** A possible future feature is to look in the memory of a browser that is still running.

## Why you can trust the privacy claims

You do not have to take them on faith.

- **The web app** is one HTML file. Its Content-Security-Policy is `default-src 'none'` with `connect-src 'none'`, and its single inline script is pinned by hash. A page with that policy cannot make a network request, load a remote image or submit a form. Open your browser's developer tools on the Network tab and watch it stay empty.
- **The desktop app** serves its page from `127.0.0.1`, which only your own computer can reach. Every data request needs a random key created at start-up, and the server checks the `Host` and `Origin` headers so that another website cannot read results through your browser. See `apps/desktop/src/server.ts` and its tests.
- **The engine** (`packages/core`) has no dependencies and performs no input or output at all. It is given bytes and returns text.

## Performance notes

- Files are read whole, newest first. Anything over 256 MB is skipped.
- Candidate strings are sanity-checked cheaply before being decoded in full, so that binary data which happens to resemble a length prefix (a stored PDF, an image) cannot turn a linear scan into a quadratic one.
- Identical text from website storage is kept at most four times. Text-box history is never thinned.
- On the author's Windows machine a scan of every browser and app (707 files, 586 MB) takes about 27 seconds.

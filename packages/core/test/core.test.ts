import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RecoverySession,
  classifyPath,
  decodeMozLz4,
  extractPassages,
  findMojoString16,
  findV8Strings,
  formControlTypeBefore,
  htmlToTextIfHtml,
  lz4BlockDecompress,
  parseLevelDbLog,
  parseLevelDbTable,
  proseScore,
  snappyDecompress,
  wantFile,
} from '../src/index';
import {
  fakeChromiumSession,
  fakeLevelDbLog,
  fakeLevelDbTable,
  fakeMozLz4,
  localStorageKey,
  localStorageValue,
  mojoString16,
  snappyLiteral,
  typingSnapshots,
} from '../src/testing';
import { asciiBytes, concatBytes, utf16leBytes, writeVarint } from '../src/bytes';

const enc = new TextEncoder();
const dec = new TextDecoder();

const ESSAY =
  'The lighthouse keeper kept a second logbook that nobody was meant to read. In it she wrote down every ship ' +
  'that passed without signalling, and what the weather had been doing at the time. After forty years the list ' +
  'ran to nine volumes. When the harbour board finally asked why the lamp had been burning two hours early on ' +
  'certain evenings, she handed them volume six and told them to start with the entries for the autumn storms. ' +
  'They read for a week and then they raised her pay.';

const SESSION_PATH = 'C:\\Users\\someone\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Sessions\\Session_13400000000000001';

test('snappy: literals, short copy, overlapping copy', () => {
  // "abcd" literal, then copy 8 bytes from 4 back (overlapping) => abcdabcdabcd
  const overlapping = new Uint8Array([12, 0x0c, 0x61, 0x62, 0x63, 0x64, 0x11, 0x04]);
  assert.equal(dec.decode(snappyDecompress(overlapping)), 'abcdabcdabcd');
  // 2-byte-offset copy: "hello " literal, copy 5 from 6 back => "hello hello"
  const twoByte = new Uint8Array([11, 0x14, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x20, (4 << 2) | 2, 6, 0]);
  assert.equal(dec.decode(snappyDecompress(twoByte)), 'hello hello');
  const big = enc.encode(ESSAY.repeat(400));
  assert.deepEqual(snappyDecompress(snappyLiteral(big)), big);
});

test('snappy: damaged input throws instead of returning garbage', () => {
  assert.throws(() => snappyDecompress(new Uint8Array([12, 0x0c, 0x61, 0x62])));
  assert.throws(() => snappyDecompress(new Uint8Array([4, 0x11, 0x09])));
});

test('lz4: literals and overlapping match; mozLz4 container', () => {
  // token 0x44: 4 literals "abcd", match length 4+4 from offset 4; then token 0x10: 1 literal "e"
  const block = new Uint8Array([0x44, 0x61, 0x62, 0x63, 0x64, 0x04, 0x00, 0x10, 0x65]);
  assert.equal(dec.decode(lz4BlockDecompress(block, 13)), 'abcdabcdabcde');
  const json = JSON.stringify({ hello: ESSAY });
  assert.equal(dec.decode(decodeMozLz4(fakeMozLz4(json))), json);
  assert.throws(() => decodeMozLz4(enc.encode('not a mozlz4 file')));
});

test('leveldb log: round-trips entries, deletions and values that span blocks', () => {
  const bigValue = enc.encode('x'.repeat(100_000));
  const log = fakeLevelDbLog(
    [
      { key: asciiBytes('a'), value: enc.encode('first') },
      { key: asciiBytes('big'), value: bigValue },
      { key: asciiBytes('a'), value: null },
      { key: asciiBytes('z'), value: enc.encode('last') },
    ],
    500,
  );
  const entries = parseLevelDbLog(log);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map((e) => e.seq), [500, 501, 502, 503]);
  assert.equal(dec.decode(entries[0].value!), 'first');
  assert.deepEqual(entries[1].value, bigValue);
  assert.equal(entries[2].value, null);
  assert.equal(dec.decode(entries[3].value!), 'last');
});

test('leveldb log: a damaged block does not hide the blocks after it', () => {
  const log = fakeLevelDbLog([
    { key: asciiBytes('k1'), value: enc.encode('y'.repeat(40_000)) },
    { key: asciiBytes('k2'), value: enc.encode('survivor') },
  ]);
  log[6] = 9; // invalid record type in the first block
  const entries = parseLevelDbLog(log);
  assert.ok(entries.some((e) => e.value && dec.decode(e.value) === 'survivor'));
});

test('leveldb table: plain and snappy-compressed blocks', () => {
  const entries = [
    { key: asciiBytes('alpha'), value: enc.encode('one') },
    { key: asciiBytes('beta'), value: null },
    { key: asciiBytes('gamma'), value: enc.encode(ESSAY) },
  ];
  for (const compress of [false, true]) {
    const parsed = parseLevelDbTable(fakeLevelDbTable(entries, { compress, firstSeq: 70 }));
    assert.equal(parsed.length, 3);
    assert.deepEqual(parsed.map((e) => e.seq), [70, 71, 72]);
    assert.equal(dec.decode(parsed[0].key), 'alpha');
    assert.equal(parsed[1].value, null);
    assert.equal(dec.decode(parsed[2].value!), ESSAY);
  }
  assert.throws(() => parseLevelDbTable(enc.encode('x'.repeat(100))));
});

test('mojo strings: exact boundaries, any language, form-field detection', () => {
  const texts = ['Hello there, this is plain ASCII text.', 'Ünïcödé — “quotes”, emoji 🚀 and 日本語のテキストです。'];
  const buf = concatBytes([
    new Uint8Array(13),
    mojoString16('textarea'),
    new Uint8Array(16),
    mojoString16('1'),
    new Uint8Array(16),
    mojoString16(texts[0]),
    new Uint8Array(700),
    mojoString16(texts[1]),
  ]);
  const found = findMojoString16(buf, 12);
  assert.deepEqual(found.map((f) => f.text), texts);
  assert.equal(formControlTypeBefore(buf, found[0].offset), 'textarea');
  assert.equal(formControlTypeBefore(buf, found[1].offset), null);
});

test('chromium session: a typing trail becomes one finding with full history', () => {
  const snapshots = typingSnapshots(ESSAY, 25);
  const session = new RecoverySession();
  session.addFile(SESSION_PATH, fakeChromiumSession(snapshots, { otherStrings: ['https://example.com/forum/thread/42', 'Reply to thread'] }), {
    mtimeMs: Date.now() - 60_000,
  });
  session.finish();
  const top = session.all[0];
  // copies that differ only by a trailing space count once
  const distinct = new Set(snapshots.map((s) => s.trim())).size;
  assert.ok(distinct >= 20);
  assert.equal(top.text, ESSAY);
  assert.equal(top.kind, 'typed');
  assert.equal(top.versionCount, distinct);
  assert.equal(top.versions[top.primaryIndex].text, ESSAY);
  assert.equal(top.sources[0].app, 'Chrome');
  assert.equal(top.sources[0].profile, 'Default');
  assert.match(top.why.join(' '), new RegExp(`Saved ${distinct} times`));
  // page URLs and short titles stored alongside must not be reported as typed text
  assert.ok(session.all.every((f) => !f.text.startsWith('https://')));
});

test('chromium session: code typed into a text box is kept even though it is not prose', () => {
  const code = 'const f=(a,b)=>{for(let i=0;i<a.length;i++){b[i]=a[i]*2}return b};f([1,2],[]);';
  assert.ok(proseScore(code) < 0.5);
  const r = extractPassages(SESSION_PATH, fakeChromiumSession([code]));
  assert.equal(r.passages.length, 1);
  assert.equal(r.passages[0].kind, 'typed');
  assert.equal(r.passages[0].text, code);
});

test('accidental delete: the fullest copy is shown, the shorter newest copy is kept as a version', () => {
  const snapshots = [...typingSnapshots(ESSAY, 10), ESSAY.slice(0, 40)];
  const session = new RecoverySession();
  session.addFile(SESSION_PATH, fakeChromiumSession(snapshots));
  session.finish();
  const top = session.all[0];
  assert.equal(top.text, ESSAY);
  assert.equal(top.versions[top.versions.length - 1].text, ESSAY.slice(0, 40));
  assert.match(top.why.join(' '), /fullest copy/);
});

test('an edit to the opening line still groups with the earlier copies', () => {
  const edited = 'Listen: ' + ESSAY;
  const session = new RecoverySession();
  session.addFile(SESSION_PATH, fakeChromiumSession([...typingSnapshots(ESSAY, 6), edited]));
  session.finish();
  assert.equal(session.all[0].text, edited);
  assert.equal(session.all[0].versionCount, 7);
});

test('local storage: drafts inside JSON are unwrapped, in journals and in tables', () => {
  const draft = { v: 2, draft: { body: ESSAY, updated: 1700000000 }, ui: { theme: 'dark', token: 'eyJhbGciOiJIUzI1NiJ9.e30.abc' } };
  const entries = [
    { key: asciiBytes('VERSION'), value: asciiBytes('1') },
    { key: localStorageKey('https://forum.example', 'composer-autosave'), value: localStorageValue(JSON.stringify(draft)) },
    { key: localStorageKey('https://forum.example', 'settings'), value: localStorageValue('{"a":1,"b":[1,2,3],"c":"x"}') },
  ];
  const dir = 'C:/Users/someone/AppData/Local/Microsoft/Edge/User Data/Profile 1/Local Storage/leveldb/';
  for (const [name, data] of [
    ['000012.log', fakeLevelDbLog(entries)],
    ['000011.ldb', fakeLevelDbTable(entries, { compress: true })],
  ] as const) {
    const r = extractPassages(dir + name, data);
    assert.equal(r.passages.length, 1, name);
    const p = r.passages[0];
    assert.equal(p.text, ESSAY);
    assert.equal(p.kind, 'draft');
    assert.equal(p.origin, 'https://forum.example');
    assert.equal(p.key, 'composer-autosave.draft.body');
    assert.equal(p.app, 'Edge');
    assert.equal(p.profile, 'Profile 1');
    assert.equal(p.hinted, true);
  }
});

test('local storage: non-Latin text stored as UTF-16 is recovered', () => {
  const text = 'これは下書きです。長い文章を書いていましたが、ページが再読み込みされて消えてしまいました。とても悲しいです。';
  const entries = [{ key: localStorageKey('https://blog.example', 'draft'), value: localStorageValue(text) }];
  const r = extractPassages('x/Default/Local Storage/leveldb/000003.log', fakeLevelDbLog(entries));
  assert.equal(r.passages[0]?.text, text);
});

test('session storage: values are tied back to their website', () => {
  const guid = '59af1e8f_b15c_4b96_a101_d202ff955d18';
  const entries = [
    { key: asciiBytes(`namespace-${guid}-https://github.example/`), value: asciiBytes('67') },
    { key: concatBytes([asciiBytes('map-67-'), utf16leBytes('comment-draft')]), value: utf16leBytes(ESSAY) },
  ];
  const r = extractPassages('/home/someone/.config/google-chrome/Default/Session Storage/000005.log', fakeLevelDbLog(entries));
  assert.equal(r.passages.length, 1);
  assert.equal(r.passages[0].text, ESSAY);
  assert.equal(r.passages[0].origin, 'https://github.example/');
  assert.equal(r.passages[0].key, 'comment-draft');
});

test('indexeddb: one-byte and two-byte V8 strings are found inside a value', () => {
  const wide = 'A two-byte string with “curly quotes” that a chat app stored for a message draft.';
  const narrow = 'A one-byte string that is long enough to be worth keeping as a recovered passage.';
  const value = concatBytes([
    new Uint8Array([0xff, 0x11, 0xff, 0x0d, 0x6f, 0x22, 0x04]),
    asciiBytes('text'),
    new Uint8Array([0x22, ...writeVarint(narrow.length)]),
    asciiBytes(narrow),
    new Uint8Array([0x00, 0x63, ...writeVarint(wide.length * 2)]),
    utf16leBytes(wide),
    new Uint8Array([0x7b, 0x02]),
  ]);
  assert.deepEqual(findV8Strings(value, 20), [narrow, wide]);
  const path = 'User Data/Default/IndexedDB/https_chat.example_0.indexeddb.leveldb/000007.log';
  const r = extractPassages(path, fakeLevelDbLog([{ key: new Uint8Array([0, 1, 1, 1]), value }]));
  assert.deepEqual(r.passages.map((p) => p.text).sort(), [narrow, wide].sort());
  assert.equal(r.passages[0].origin, 'https://chat.example');
});

test('firefox session: form fields from open and closed tabs', () => {
  const state = {
    windows: [
      {
        tabs: [
          {
            entries: [
              {
                url: 'https://forum.example/reply',
                formdata: { id: { 'reply-box': ESSAY, subscribe: true }, xpath: { '/xhtml:html/xhtml:body/xhtml:input': 'short' } },
                children: [{ url: 'https://embed.example/frame', formdata: { id: { note: 'A note typed inside an embedded frame, also kept.' } } }],
              },
            ],
            storage: { 'https://forum.example': { draft: JSON.stringify({ text: 'A second draft the site saved in session storage for this tab only.' }) } },
          },
        ],
        _closedTabs: [{ state: { entries: [{ url: 'https://mail.example/compose', formdata: { innerHTML: '<p>Dear team,</p><p>Here is the update you asked for.</p>' } }] } }],
      },
    ],
  };
  const path = '/home/someone/.mozilla/firefox/abcd1234.default-release/sessionstore-backups/recovery.jsonlz4';
  const r = extractPassages(path, fakeMozLz4(JSON.stringify(state)));
  const typed = r.passages.filter((p) => p.kind === 'typed').map((p) => p.text);
  assert.ok(typed.includes(ESSAY));
  assert.ok(typed.includes('A note typed inside an embedded frame, also kept.'));
  assert.ok(typed.includes('Dear team,\nHere is the update you asked for.'));
  assert.ok(!typed.includes('short'));
  assert.ok(r.passages.some((p) => p.kind === 'draft' && p.text.startsWith('A second draft')));
  assert.equal(r.passages[0].app, 'Firefox');
  assert.equal(r.passages[0].profile, 'abcd1234.default-release');
  assert.equal(r.passages.find((p) => p.text === ESSAY)?.origin, 'https://forum.example');
});

test('safety: password, cookie and payment files are never read, even when handed over directly', () => {
  for (const name of ['Login Data', 'Cookies', 'Web Data', 'Local State', 'key4.db', 'logins.json', 'cookies.sqlite']) {
    const path = `C:/Users/someone/AppData/Local/Google/Chrome/User Data/Default/${name}`;
    assert.equal(classifyPath(path).forbidden, true, name);
    assert.equal(wantFile(path, 5000, true), false, name);
    const r = extractPassages(path, enc.encode(ESSAY), { explicit: true });
    assert.equal(r.passages.length, 0, name);
    assert.match(r.note ?? '', /never read/);
  }
});

test('classifyPath: recognises autosave locations on Windows, macOS and Linux', () => {
  const cases: [string, string, string | undefined][] = [
    ['C:\\Users\\a\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Sessions\\Tabs_1339', 'chromium-session', 'Brave'],
    ['/Users/a/Library/Application Support/Google/Chrome/Profile 3/Local Storage/leveldb/000123.ldb', 'leveldb-table', 'Chrome'],
    ['/home/a/.config/chromium/Default/Session Storage/000009.log', 'leveldb-log', 'Chromium'],
    ['C:/Users/a/AppData/Roaming/Mozilla/Firefox/Profiles/x.default/sessionstore-backups/previous.jsonlz4', 'firefox-session', 'Firefox'],
    ['C:/Users/a/AppData/Roaming/Code/Backups/1a2b/untitled/3c4d', 'text-backup', 'VS Code'],
    ['C:/Users/a/AppData/Local/Packages/Microsoft.WindowsNotepad_8wekyb3d8bbwe/LocalState/TabState/abc.bin', 'binary-backup', 'Windows Notepad'],
    ['C:/Users/a/AppData/Local/Microsoft/Office/UnsavedFiles/Document1((Unsaved-1)).asd', 'binary-backup', 'Microsoft Office'],
  ];
  for (const [path, type, app] of cases) {
    const c = classifyPath(path);
    assert.equal(c.type, type, path);
    assert.equal(c.app, app, path);
    assert.equal(c.known, true, path);
    assert.equal(wantFile(path, 1000), true, path);
  }
  assert.equal(wantFile('C:/Users/a/AppData/Local/Google/Chrome/User Data/Default/Cache/data_1', 1000), false);
  assert.equal(wantFile('C:/Users/a/Documents/notes.txt', 1000), false);
  assert.equal(wantFile('C:/Users/a/Documents/notes.txt', 1000, true), true);
});

test('unknown binary files: UTF-16 and UTF-8 prose is found, noise is not', () => {
  const junk = new Uint8Array(4000);
  for (let i = 0; i < junk.length; i++) junk[i] = (i * 197 + 13) & 0xff;
  const utf8 = 'A plain note that somebody typed into an app which keeps its unsaved tabs in a binary file.';
  const data = concatBytes([junk, new Uint8Array([1, 2, 3]), utf16leBytes(ESSAY), new Uint8Array([0, 0, 7]), junk, new Uint8Array([0]), enc.encode(utf8), new Uint8Array([0])]);
  const path = 'C:/Users/a/AppData/Local/Packages/Microsoft.WindowsNotepad_8wekyb3d8bbwe/LocalState/TabState/tab.bin';
  const texts = extractPassages(path, data).passages.map((p) => p.text);
  assert.ok(texts.includes(ESSAY));
  assert.ok(texts.includes(utf8));
  assert.equal(texts.length, 2);
});

test('text helpers: prose scoring and HTML drafts', () => {
  assert.ok(proseScore(ESSAY) > 0.9);
  assert.ok(proseScore('{"a":1,"b":{"c":[1,2,3],"d":"e"},"f":null,"g":true,"h":"i"}') < 0.45);
  assert.ok(proseScore('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV') < 0.45);
  const html = htmlToTextIfHtml('<p>First line &amp; more</p><p>Second <strong>bold</strong> line</p><ul><li>one</li><li>two</li></ul>');
  assert.equal(html.wasHtml, true);
  assert.equal(html.text, 'First line & more\nSecond bold line\n- one\n- two');
  assert.equal(htmlToTextIfHtml('if (a < b && c > d) { return 1; }').wasHtml, false);
});

test('query: remembered words, kind filter, and matches found only in an older copy', () => {
  const session = new RecoverySession();
  const earlier = ESSAY + ' She also kept a jar of sea glass on the windowsill.';
  session.addFile(SESSION_PATH, fakeChromiumSession([ESSAY.slice(0, 200), earlier, ESSAY]));
  const dir = 'User Data/Default/Local Storage/leveldb/';
  session.addFile(
    dir + '000004.log',
    fakeLevelDbLog([{ key: localStorageKey('https://notes.example', 'note'), value: localStorageValue('Buy oat milk, return the library books, and call the plumber about the kitchen tap before Friday.') }]),
  );
  session.finish();
  assert.equal(session.query().total, 2);
  assert.equal(session.query({ q: 'harbour LAMP' }).matched, 1);
  assert.equal(session.query({ q: 'plumber' }).findings[0].kind, 'draft');
  assert.equal(session.query({ kinds: ['draft'] }).matched, 1);
  assert.equal(session.query({ minChars: 300 }).matched, 1);
  const old = session.query({ q: 'sea glass' });
  assert.equal(old.matched, 1);
  assert.equal(old.findings[0].text, earlier);
  assert.equal(typeof old.findings[0].shownVersion, 'number');
  assert.equal(session.query({ q: 'zebra' }).matched, 0);
  assert.equal(session.versions(session.all[0].id).length, session.all[0].versionCount);
});

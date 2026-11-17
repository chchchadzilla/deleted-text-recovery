/**
 * The "Try a demo" button. Everything here is invented and built in memory with the same
 * builders the tests use, so people can see what a recovery looks like before trusting the
 * tool with a real folder.
 */
import {
  fakeChromiumSession,
  fakeLevelDbLog,
  fakeMozLz4,
  localStorageKey,
  localStorageValue,
  typingSnapshots,
} from '@deleted-text-recovery/core/testing';

export interface DemoFile {
  path: string;
  data: Uint8Array;
  mtimeMs: number;
}

const FORUM_REPLY = `Okay, long reply incoming, because I have made every one of these mistakes myself.

Your starter is not dead. A starter that smells like nail polish remover is hungry, not ruined. Pour off the liquid on top, throw away all but a spoonful, and feed it equal weights of flour and water twice a day for three days. Keep it somewhere that is actually warm. On top of the fridge works. A cold kitchen counter in January does not.

The reason your loaves come out flat is almost certainly timing, not the recipe. You are waiting for the clock instead of watching the dough. When the recipe says "four hours", it means "until it has grown by about half and jiggles when you shake the bowl". In a cool kitchen that can take seven.

Three things that fixed it for me:

1. Use the starter when it has doubled and is just starting to dome, not after it has collapsed.
2. Wet your hands instead of adding more flour. Sticky dough is the right dough.
3. Bake it darker than feels safe. Pale bread is underbaked bread.

Post a photo of the crumb next time and I can tell you more. Do not give up on this one. The first good loaf is worth all the bad ones.`;

const NOTE_DRAFT = `Things to say in the meeting on Thursday: the venue needs the final headcount by the 14th, the caterer can do the vegetarian option but not the vegan one, and somebody has to pick up the banner from the print shop before five. Ask whether we still have the folding tables from last year.`;

const COMMENT = `I think the second chapter is doing too much at once. We meet four new characters in six pages and I could not tell you which of them matters. If the sister is the one the story is about, open on her and let the others arrive one at a time.`;

export function buildDemoFiles(now: number): DemoFile[] {
  const minutes = (m: number): number => now - m * 60_000;
  const trail = typingSnapshots(FORUM_REPLY, 46);
  const session = fakeChromiumSession(trail, {
    otherStrings: ['https://bread-forum.example/thread/8841/reply', 'Reply to: "Is my starter dead?"'],
  });
  const storage = fakeLevelDbLog([
    {
      key: localStorageKey('https://notes.example', 'editor-autosave'),
      value: localStorageValue(JSON.stringify({ version: 3, doc: { title: 'Thursday', body: NOTE_DRAFT }, savedAt: now })),
    },
    { key: localStorageKey('https://notes.example', 'theme'), value: localStorageValue('"dark"') },
  ]);
  const firefox = fakeMozLz4(
    JSON.stringify({
      windows: [
        {
          tabs: [
            {
              entries: [{ url: 'https://writing-group.example/story/212', formdata: { id: { 'comment-box': COMMENT } } }],
            },
          ],
        },
      ],
    }),
  );
  return [
    { path: 'Demo/Google/Chrome/User Data/Default/Sessions/Session_13400000000000001', data: session, mtimeMs: minutes(4) },
    { path: 'Demo/Google/Chrome/User Data/Default/Local Storage/leveldb/000042.log', data: storage, mtimeMs: minutes(95) },
    { path: 'Demo/Firefox/Profiles/demo.default-release/sessionstore-backups/recovery.jsonlz4', data: firefox, mtimeMs: minutes(26 * 60) },
  ];
}

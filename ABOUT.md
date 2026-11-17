# About Deleted Text Recovery

<p align="center">
  <img src="assets/mascot.png" alt="Zee the Text Retriever" width="180">
</p>

## What it is

A free tool that finds text you typed and then lost, by reading the autosave trails your browser and apps already leave on your own computer. It runs entirely on your machine. There are no ads, no accounts and no uploads.

It comes in two forms that share one engine:

- **A web page** you open and drop a folder onto. Nothing to install.
- **A desktop app** that finds every browser and writing app by itself. It also works as a command-line tool.

## Why it exists

One evening, someone typed a message of about 7,000 characters into an AI chat page, attached eight PDFs, and pressed send. The message arrived blank. The box was empty and Undo did nothing. Why the page dropped the text was never worked out.

They had already written it off. More or less out of habit they asked an AI coding assistant whether the text might still be "in the browser cache somewhere".

It was not in the cache. It was somewhere better. The assistant went through the browser's own files and, about ten minutes later, found the complete message in the file the browser uses to restore your tabs after a crash. The browser had been saving the contents of that text box roughly every twenty characters. There were 101 copies of the message on the hard drive, each a little longer than the last, including an earlier draft with a paragraph that had since been deleted.

Two things stood out afterwards.

**First, almost nobody knows this is there.** People lose long pieces of writing to reloads, timeouts and misclicks every day, and the usual advice is "that's gone, type it again".

**Second, it does not stay there.** A couple of hours later, while this tool was being built on the same computer, the browser deleted that file as part of its normal housekeeping. Had the search happened the next morning, there would have been nothing to find.

So the knowledge is useful, the window is short, and the person who needs it is in no state to learn how browser storage works. The fix is a tool that an upset person can use in two minutes.

## What it is trying to be

- **Usable by someone who has never opened a terminal and dislikes GitHub.** The instructions are written like a building-block set: one small move at a time, nothing assumed.
- **Honest.** It cannot save everything. It says where it works well and where it does not, and it says which parts have been tried on real lost text and which have only passed tests.
- **Private by construction, not by promise.** The web page is technically unable to send data anywhere. The desktop app listens only to your own computer. The engine refuses to open password, cookie and payment files.
- **Free, with nothing to sell.** No ads, no "pro" tier, no tracking.

## Zee

The mascot is **Zee, the Text Retriever**, a golden retriever, because a retriever retrieves. The name comes from the keys everybody mashes first: Ctrl + Z.

## How it was built

The idea, the product decisions and the insistence that a non-technical person must be able to use it came from the person who lost the message. The digging, the code, the tests and the artwork were done with an AI coding assistant, which is also why the repository includes an [AGENTS.md](AGENTS.md): any AI assistant, from any company, can pick this tool up and run a recovery for the person it is helping. Nothing in the tool depends on a particular AI model, and the tool itself uses no AI at all. It is ordinary, deterministic code.

## If it helped

Star the repository so other people can find it, and tell one person who writes a lot. That is the whole business model.

- Web app: <https://chchchadzilla.github.io/deleted-text-recovery/>
- Source: <https://github.com/chchchadzilla/deleted-text-recovery>
- Talk to us: <https://github.com/chchchadzilla/deleted-text-recovery/discussions>

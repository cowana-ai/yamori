# Security policy

## Reporting a vulnerability

Please report security problems privately through
[GitHub's private vulnerability reporting](https://github.com/cowana-ai/yamori/security/advisories/new),
not in a public issue. Include the steps to reproduce and the versions involved. You
can expect a first reply within a few days.

## What Yamori does with your code

- Yamori sends source code only to the AI you set up (Claude Code or Codex, running
  on your machine with your own sign-in), and only for requests you start or
  features you leave on, such as automatic AI notes.
- Explanations, notes and drafts are stored locally in VS Code's extension storage.
- In Restricted Mode, Yamori never runs project code and ignores workspace-controlled
  executable paths and settings.
- Running a function with its tests executes your project's test code; Yamori asks
  before the first run in each folder.

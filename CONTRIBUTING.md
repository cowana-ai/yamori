# Contributing to Yamori

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or asking for a feature

Open an [issue](https://github.com/cowana-ai/yamori/issues/new/choose). For a bug,
please include your editor (VS Code or Cursor) and its version, Yamori's version, which
AI you use (Claude Code or Codex) and what you saw. Please don't paste private source
code; a small example that shows the problem is best.

## Working on the code

Yamori is a plain JavaScript VS Code extension with no runtime dependencies. You need
Node.js 20 or newer, and Python 3 for the test-runner tests.

```sh
git clone https://github.com/cowana-ai/yamori.git
cd yamori
npm test          # the full offline test suite; no AI requests
npm run check     # syntax checks for every shipped file
```

Run it in an Extension Development Host:

```sh
code --extensionDevelopmentPath="$PWD"
```

The layout, the generated files and how to rebuild them are described in
[docs/development.md](docs/development.md).

## Pull requests

- Keep each pull request to one change, and describe what a reader of Yamori will notice.
- Add or update tests in `test/extension.test.js`; tests must not call a real AI or
  depend on what is installed on your machine.
- Update the docs in `docs/` when behaviour changes, and add a line to `HISTORY.md`
  under the next version.
- `npm test` and `npm run check` must pass; CI runs both on Linux and macOS.

## Principles

- **Explain, don't decorate.** Every word in the interface should help someone read code.
- **The user's code and accounts stay theirs.** Nothing leaves the machine except the
  requests the user starts or turns on; Restricted Mode never runs project code.
- **Text is data.** Webviews insert text with `textContent`, never HTML; model output is
  validated before it is shown.

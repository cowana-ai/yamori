<p align="center">
  <img src="media/yamori.png" width="180" alt="Yamori, a teal gecko samurai with a white robe and staff">
</p>

<h1 align="center">Yamori</h1>

<p align="center"><strong>Programming context, made explicit.</strong><br>
Read any code as clear pseudocode in VS Code and Cursor, explained by the Claude or ChatGPT plan you already have.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=cowana-ai.yamori"><img alt="VS Code Marketplace" src="https://img.shields.io/visual-studio-marketplace/v/cowana-ai.yamori?label=VS%20Code%20Marketplace&color=161616"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=cowana-ai.yamori"><img alt="Installs" src="https://img.shields.io/visual-studio-marketplace/i/cowana-ai.yamori?label=installs&color=161616"></a>
  <a href="https://open-vsx.org/extension/cowana-ai/yamori"><img alt="Open VSX for Cursor" src="https://img.shields.io/open-vsx/v/cowana-ai/yamori?label=Open%20VSX%20(Cursor)&color=161616"></a>
  <a href="https://github.com/cowana-ai/yamori/actions/workflows/ci.yml"><img alt="Tests" src="https://img.shields.io/github/actions/workflow/status/cowana-ai/yamori/ci.yml?branch=main&label=tests"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-161616"></a>
</p>

<p align="center">
  <img src="media/screenshots/reader.png" width="760" alt="Yamori explaining the gradient-descent loop of a small Python classifier as numbered pseudocode with formulas and Why and Insight notes">
</p>

Yamori is for people who can handle difficult ideas but lose time on programming
conventions: callbacks, mutable state, a training loop's hidden steps. It turns code
into short, navigable pseudocode beside your editor and explains the connections
that make it work. The mathematics stays precise, and the programming context gets
explained where it matters.

## Features

### [Code as pseudocode](docs/reading.md)
Read a file at **Overview** (the goal and main stages) or **Logic** (every meaningful
step, with formulas). Each line links back to the source it stands for. You can edit
a block, ask it to explain better, or make it shorter.

### [Uses the AI you already have](docs/getting-started.md#set-up-an-ai)
Yamori runs **Claude Code** or **Codex** with your own sign-in and plan limits, and
never asks for an API key. It finds them inside **Claude Desktop** and the
**ChatGPT app**, and a one-screen setup installs or signs in whichever you pick.

### [A guide to the whole project](docs/project-guide.md)
**Start here** lists, folder by folder, which files to read first. The **Map** shows
how files connect. AI notes add a purpose to every file and a glossary of project
terms such as IDs, stages and constants.

### [Search a name, see how it flows](docs/project-guide.md)
Search any variable, function or term. Every file that mentions it lights up on the
map, and **Explain how it flows** traces it across those files in the same
pseudocode style.

<p align="center">
  <img src="media/screenshots/guide.png" width="760" alt="The project guide map with the files that mention fastModel highlighted, beside an AI explanation of how fastModel flows from engine.js into extension.js">
</p>

### [Watch a function run](docs/tests.md)
When a unit test calls a function, **Run with a test** shows it like a notebook
cell: **In**, **Out**, and every executed line with the values it changed. Files and
images show as emoji with details on hover. In Restricted Mode, or for JS/TS tests,
an AI simulation stands in, clearly labelled as one.

### [Fast by design](docs/models.md#speed-parallel-parts-and-background-review)
Bigger files are written as parallel parts, so the draft is ready when the slowest
part is: **17 s instead of 50 s** on a 354-line file. Review runs in the background
on a cheaper model, and quick jobs use Haiku or Codex's fast model.

### [Knows your project](docs/project-guide.md)
Explanations use the project map: which file defines a name, what each neighbour is
for, and how other files were explained. Project terms become links and hovers, and
CodeLens shows block titles above the code.

### [Local and private](docs/reading.md)
Explanations, notes and drafts are cached on your machine; cached reads use no AI.
Yamori works in Restricted Mode, where it never runs project code and ignores
workspace-controlled settings.

## Getting started

1. Install **Yamori** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cowana-ai.yamori),
   or from [Open VSX](https://open-vsx.org/extension/cowana-ai/yamori) for Cursor:
   ```sh
   code --install-extension cowana-ai.yamori
   ```
2. Open a code file and click the **gecko** at the top right of the editor, or
   **Yamori** in the status bar.
3. The first time, **Set up Yamori** shows which AI is on your computer, with one
   button each: **Use**, **Sign in** or **Install**. Then your file opens as pseudocode.

<p align="center">
  <img src="media/screenshots/setup.png" width="620" alt="The Set up Yamori screen: Claude is ready through Claude Desktop, ChatGPT is installed but not signed in">
</p>

Try it on [examples/demo.py](examples/demo.py), a small logistic-regression example.
Open **Project guide** to see where to start reading a whole project.

## Documentation

- [Getting started](docs/getting-started.md): installing, setting up an AI, first steps
- [Reading code](docs/reading.md): Overview and Logic, editing, caching, change tracking
- [Project guide](docs/project-guide.md): Start here, the map, AI notes, search and flows
- [Run a function with its tests](docs/tests.md): real runs, AI simulations, values as emoji
- [Models, speed and review](docs/models.md): models and effort, parallel parts, background review
- [Development](docs/development.md): layout, building, testing
- [Release history](HISTORY.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Credits](docs/credits.md)

## License

[MIT](LICENSE). The gecko samurai mascot is separate artwork and not covered by the
code license. Bundled third-party components and their licenses are listed in
[Credits](docs/credits.md).

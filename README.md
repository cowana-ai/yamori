<p align="center">
  <img src="yamori.png" width="210" alt="Yamori, a teal gecko samurai with a white robe and staff">
</p>

<h1 align="center">Yamori</h1>

<p align="center"><strong>Programming context, made explicit.</strong></p>
<p align="center">Cursor &amp; VS Code · Codex &amp; Claude Code · Overview or step-by-step Logic</p>

**Yamori is for someone who can handle difficult ideas but needs the programming context made explicit.**

You might follow the mathematics in a paper and still lose time tracing callbacks,
mutable state or a model's training loop. Yamori turns code into concise,
navigable pseudocode inside your editor, explaining the connections that make the
implementation understandable.

Its mission is to help capable people with less programming experience reason
independently, navigate unfamiliar code and become more efficient. Useful
mathematics stays precise. Programming conventions and consequential details get
a short explanation where they matter.

[See an example](#from-a-call-to-an-idea) · [Get started](#get-started) · [Project guide](#project-guide) · [Choose your model](#models-and-reasoning-effort) · [Develop](#development)

## From a call to an idea

In a teacher–student training loop, the source might say:

```python
states, times, targets = pool.take_and_advance(batch_size)
predictions = student_model(states, times, cluster_labels=labels)
loss = mse_loss(predictions, targets)
return loss
```

Yamori connects those operations:

```text
Choose training examples and get their teacher velocity targets.
Refresh the pool for its next visit.
Predict velocities with the trainable student.
Measure the mean squared difference from the teacher targets.
Return the loss so the training framework can update student weights.

# Insight: the returned inputs and targets describe the state before refresh.
```

This illustrates the style; explanations depend on the supplied source and
available definitions. A function's name alone does not establish its behavior.

## Read at the level you need

| View | What you get |
| --- | --- |
| **Overview** | The goal, main stages and essential insights. |
| **Logic** | Short steps, meaningful decisions, exact constants and boundaries, and useful mathematics. |

Switch between them with the **Detail: Overview | Logic** control. The panel's
other controls say what they do:
- **Switch file…** opens another file: files already open in Yamori first, then
  project files grouped by folder, with "✓ explained" and each file's purpose.
- **Project guide** shows where to start reading.
- **Regenerate** writes the explanation again. It reads **Update from code** when
  the source changed, and **Stop** while a request runs.
- Click the file name at the top to show it in the editor.
- **AI ▾** holds provider, model, effort and refinement.

- **Start with the logic map.** See the script’s named ideas first. Open one block at a time, use Previous/Next, or return to the map. Moving around starts no AI request. Unsaved drafts are marked on the map and reopen in the same editor.
- **Work across files.** Click the Yamori gecko icon in a source editor to open **filename.py · Yamori** beside your code. Each file gets its own tab in the same reader column. Reopening a file reuses its tab and running request. **Switch file…** moves between open and prepared explanations or opens another project file. Each tab keeps its detail level and unsaved block drafts; switching back restores the source file without moving the caret.
- **Stay connected to the source.** Hover over a mapped step to highlight its code. Click to jump to the corresponding lines.
- **Understand custom calls.** Yamori uses available project definitions to explain a call's role, inputs and output.
- **See the reasoning that matters.** Important source comments are preserved. Brief notes explain non-obvious consequences, assumptions and guards.
- **See what is happening.** While a request runs, a progress card names the
  provider, the model that actually answered and the effort. It lists each stage:
  - read the code and its context
  - think it through, with a live estimate of thinking tokens for Claude
  - write the explanation, with a character count
  - review difficult blocks, with the current review round
  Yamori lookups and a timer per stage appear as they happen. Pseudocode streams
  into the panel as it is written, and **Stop** is always available. Afterwards the
  card folds into one line, such as "Done in 0:48 · Claude Code · claude-opus-5-5 ·
  medium effort".
- **Improve a block in one click.** Use **Explain better**, **Make shorter** or **Show example** beneath a block. Each asks your selected provider, model and effort to revise only that explanation. Results are cached; other detail levels update when opened. Buttons are disabled during generation or when that block needs a source refresh.
- **Make an explanation your own.** Copy a block, edit it in place, then ask Codex or Claude to update that block. Approved edits are cached; other views are rebuilt when requested.
- **Move between views quickly.** Generation prepares the lower-detail views too. Returning to them uses memory or disk cache.

- **Follow a reading order without waiting.** Open a file from the guide's
  **Start here** and a tour bar shows where it sits (**pipeline/ · Step 2 of 4**),
  what uses it and what it uses, and **Next: write.py →**. While you read, Yamori
  prepares the next step in the background with your AI settings, one file ahead,
  so Next opens instantly. Files you open some other way show the bar but prepare
  nothing. Turn this off with `yamori.prefetchNext`.
- **Click through to the code a name refers to.** Project names in an
  explanation, such as `plan_loops` or `Script`, are underlined. Hover to see
  where each is defined, the Yamori block that explains it and its file's purpose.
  Click to open that explanation at that block; for a name from the same file,
  Yamori jumps to its block.
- **Get help without leaving the editor.** In a mapped project, hovering a
  project name in your source shows what Yamori knows: a glossary meaning, or
  where the name is defined and which block explains it. Links open it in Yamori
  or go to the definition. Above the code, CodeLens shows Yamori's block titles as
  a table of contents (**Yamori · Plan the loops**). They only appear while the
  explanation still matches the code. A file without an explanation gets one
  **Yamori · Step 1 of 4 · Explain this file** link. Neither uses AI. Turn the
  lenses off with `yamori.codeLens`.
- **Watch a function run.** When a unit test calls a block's function, the block
  offers **Run with a test**. You get a notebook-style cell with **In**, **Out**
  and **◀ Step ▶**, and each step highlights its pseudocode line. Images,
  documents and data files show as emoji with guidance on hover. See
  [Run a function with its tests](#run-a-function-with-its-tests).
- **See the whole project.** **Project guide** shows, folder by folder, which files to read first, plus a map of files grouped in folder boxes. Explanations of mapped files know the file's role, its neighbours and terms defined elsewhere, and the AI can look up more. See [Project guide](#project-guide).

The reading panel uses a minimal black-and-white pixel style: crisp edges, a tiny
pixel gecko samurai and subtle feedback on navigation and loading. One idea stays
in focus. Steps, notes and equations remain clearly spaced and easy to read.
Model, provider and effort choices sit behind one compact settings control.
Keyboard navigation, high-contrast themes and reduced-motion preferences are supported.

## Get started

Yamori is an early preview. Its public extension ID is **`cowana-ai.yamori`**.

1. Open a code file in Cursor or VS Code.
2. Click the **Yamori gecko icon** at the top right of the script, or **Yamori** in the bottom status bar.
3. The first time, **Set up Yamori** shows which AI is on your computer and one button for each:
   **Use Claude** / **Use ChatGPT** when it's ready, otherwise **Sign in** or **Install**.
   Once it's ready, the file you clicked opens.
4. Choose **Overview** or **Logic** in the reading panel, or open **Project guide** to see where to start.

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cowana-ai.yamori),
or search for **Yamori** by **Yamori** (`cowana-ai`) in VS Code’s Extensions panel.
For Cursor, Yamori is published on [Open VSX](https://open-vsx.org/extension/cowana-ai/yamori). New versions may take time to appear through Cursor’s extension search.
For manual installation, download a VSIX from [GitHub Releases](https://github.com/cowana-ai/yamori/releases),
then choose **Extensions → … → Install from VSIX**. If you previously installed
the local `chingis-local.yamori` preview, disable that extension before using
`cowana-ai.yamori` to avoid duplicate commands. The public publisher ID has its
own extension storage; the old preview’s stored explanations remain in its old folder.

The toolbar uses the Yamori samurai logo; the bottom button uses a compact gecko
mark that follows the editor’s text color. Both buttons follow the active script automatically, starting no AI request until
you click. Each file opens its own explanation tab; clicking again reuses it.
The bottom button names its target file on hover and appears after startup,
without first running a command. It hides when no local source editor is active.
The Command Palette action **Yamori: Read as Pseudocode** is still available.
Use **⌘⌥P** on macOS or
**Ctrl+Alt+P** elsewhere. Select a range first to explain only those lines.
After updating an installed version, run **Developer: Reload Window**.

Try the included [demo.py](demo.py), a small logistic-regression example.
Right-click a folder and choose **Yamori: Read a Folder or Project** to select
multiple files. Files are prepared sequentially without opening a stack of tabs. Use **Yamori: Switch Files** or **Switch file…** to open a prepared explanation. Completed results remain cached
if you stop.

On the first install, Yamori opens **Set up Yamori** if no AI is ready yet, and
otherwise shows a one-time **Open current file** action. The gecko in the editor
toolbar adapts to light/dark themes, and **Yamori** stays available in the status bar.

Yamori also works in **Restricted Mode** and with standalone local files; you
do not need to trust a project to see the gecko icon or explain its source.
In Restricted Mode, Yamori ignores workspace-controlled CLI paths and refinement
settings, skips project language-service definition lookups, and uses your user-level
CLI installation through isolated, tool-disabled sessions outside the project.
Custom behavior whose definition is unavailable stays explicitly unknown. VS Code's
workspace trust setting stays unchanged; Yamori does not run project code there
(see [Run a function with its tests](#run-a-function-with-its-tests) for trusted folders).

### Set up an AI

Yamori uses an AI you already have: **Claude** (through Claude Code) or **ChatGPT**
(through Codex), with that tool's own sign-in and your plan's limits. It never asks
for an API key and never copies your tokens.

**Set up Yamori** opens by itself the first time you click the gecko without a ready
AI (or run **Yamori: Set Up AI**, or **AI ▾ → Set up AI…** in a reading tab). For each
AI it checks, without any model request, whether it is installed and signed in
(`claude auth status`, `codex login status`), then offers one button:

| What it finds | Button | What happens |
| --- | --- | --- |
| Installed and signed in | **Use Claude** / **Use ChatGPT** | Saved as your AI; the file you clicked opens. |
| Installed, signed out | **Sign in to Claude** / **Sign in with ChatGPT** | A terminal opens the tool's browser sign-in. When it finishes, or when you come back to VS Code, Yamori checks again and continues by itself. |
| Not installed | **Install Claude Code** / **Install Codex** | A visible terminal runs Anthropic's official installer, or `npm install -g @openai/codex` (Homebrew if npm is missing), then the sign-in. If a step fails, the terminal stays open with its messages. |

It finds the CLIs where people already have them:
- **Claude Desktop** downloads its own copy of Claude Code; Yamori uses it and its
  sign-in, so a separate install isn't needed.
- **The ChatGPT desktop app** and the Codex app include Codex.
- Command-line installs on `PATH`, `~/.local/bin`, Homebrew and npm.

If both are ready, the one you chose is marked **In use**. If your chosen AI stops
working (signed out, uninstalled), opening a file shows the setup screen again, and it
suggests the other AI when that one is ready. Errors caused by sign-in or a missing
CLI show a **Set up AI** button in the reading tab. Optional executable paths are
under **Settings → Yamori** if detection cannot find your CLI. Selecting a model only
chooses the model; it does not sign you in. See Anthropic's
[setup guide](https://code.claude.com/docs/en/setup) and OpenAI's
[Codex CLI](https://github.com/openai/codex) for details.

On Windows, Yamori detects native installs in `%USERPROFILE%\\.local\\bin`,
executables on `PATH`, and standard npm launchers in `%APPDATA%\\npm`, including
paths with spaces. npm launchers are resolved to their package entry point and
run without a command shell. Supported Claude versions use safe mode to preserve
authentication and network settings while excluding customizations; older versions
retain the isolated fallback. Update Claude Code if your older installation needs
user settings to authenticate.

## Project guide

One file rarely explains itself. A planner may use `L1`, `HOOK` and `BRIDGE`
without saying that `L1` is the first loop, opened by the hook, and that the
section names live in another file. The project guide gives you, and the AI,
that context.

Open it with **Project guide** in the reading panel, **Yamori: Open Project Guide**,
or right-click a folder → **Yamori: Open Project Guide**. Opened from a file, it
starts in that file's folder with the file highlighted.

**Start here.** Pick a folder on the left, or **Whole project**. Yamori lists its
files in reading order, one numbered step each, with why that file comes next,
its purpose and "✓ explained" when Yamori already has an explanation. A collapsed
**Details** line holds what it uses, what uses it and its project terms. Each step
has **Explain**, **Open source** and **Show on map**.
- A folder starts where it is entered: files nothing else in the folder imports,
  entry points first, then files the rest of the project uses.
- From there it follows what each file imports, in the order it uses it.
- For the whole project, the main entry point comes first. Entry points are files
  nothing else imports that have a main guard, a `package.json` `main`/`bin` entry
  or a name such as `main`, `app` or `cli`.
- Tests are left out. When AI notes exist, their reading order leads.

**Map.** Files sit inside folder boxes; arrows point from a file to what it uses,
and numbered badges follow the reading order.
- Drag a folder (its title or any file in it) to move the whole box. Positions are
  remembered; **Reset layout** forgets them.
- Click a folder title to fold it into one node; **Expand all** and **Collapse all**
  do every folder. Projects with more than 80 files open folded except the main
  entry point's folder.
- The map takes the whole tab. Click a file to open **Details**: purpose, role,
  terms, what it uses and what uses it (grouped by folder), and definitions, plus the
  searchable project terms. **Details** and **Close** toggle the panel; in a narrow
  column it sits below the map. Double-click a file, or press Enter, to explain it.
- Drag the background to pan. Scroll, pinch or use **− / +** to zoom; **Fit** shows everything.

**How it is built.** Like Aider's repo map, Yamori parses each file with
tree-sitter, records definitions, references and imports, and ranks files with
PageRank over "uses" links. Python, JavaScript, TypeScript/TSX, Go, Java and Rust
use bundled tree-sitter grammars; other languages use lighter pattern matching.
In Python and JavaScript/TypeScript, files are linked only through imports; in Go,
Java and Rust, shared names also link files in the same package. The scan is
local and free: no AI, no project code runs (tests run only when you press Run)
and no language service is used,
so it also works in Restricted Mode. While the guide is open, saves, new files and
deletions trigger an incremental rescan of changed files only.

**AI notes (automatic).** When the guide maps a folder, Yamori asks your selected
provider, model and effort for a one-line purpose and role per file, plus a project
glossary: IDs and naming schemes, section and stage names, enum members, meaningful
constants and domain terms, each with its meaning and defining line. A final request
writes a short project overview, named file groups and a reading order with a reason
per step. Notes make everything richer: the reading order explains itself, terms
become links and hovers, and explanations know each neighbour's purpose.
- It runs in the background with a status-bar spinner and progress in the guide;
  **Stop** pauses it and finished files are kept.
- After a rescan, only new or changed files are noted again. The project overview is
  rewritten only when new files appear.
- They also start when you open a file of a mapped project, so the guide tab doesn't
  need to stay open.
- No AI ready yet (signed out, not installed)? Notes wait instead of failing: the guide
  says "AI notes start once an AI is connected" and its button becomes **Set up AI**.
  When setup finishes, notes start by themselves.
- Projects with more than 120 files without notes ask once first. Other failures are
  shown once and not retried until you press **Write AI notes**.
- Notes are tool-free requests that never run project code, so they also run in
  Restricted Mode. Turn them off with `yamori.autoNotes` (a user setting). Files are
batched (about 40 KB of input per request); large files are sent as an outline.
Notes run with tools disabled, Stop is always available, finished batches are
saved, and only changed files are re-noted later. Notes are model-written
summaries, not guarantees; constants without notes still appear in the glossary
with their location.

**Better explanations.** Once a folder is mapped, new explanations, block updates
and refreshes include a bounded project context (about 6,000 characters):
- the file's purpose, role and reading step
- what it uses and what uses it, with Yamori's one-line summary of each when available
- glossary terms that appear in its code

**Yamori lookups.** For mapped files, the AI writing an explanation can also look
things up itself through Yamori's read-only knowledge server, a local MCP server
started by the CLI for that one request:

| Lookup | Returns |
| --- | --- |
| `project_overview` | Overview, file groups, entry points and reading order. |
| `list_files` | Files grouped by folder, with purposes. |
| `file_info` | One file's purpose, terms, definitions, what it uses and what uses it. |
| `find_symbol` | Where a name is defined and which files use it. |
| `glossary` | Project terms with meanings and locations. |
| `get_explanation` | Yamori's Overview or Logic pseudocode for another file. |
| `read_source` | Up to 200 numbered lines of another mapped file. |

- Lookups only reach files in the map, through real paths inside the mapped
  folder; nothing is written and no command runs. Built-in CLI tools stay off.
- Each lookup appears in the activity trail ("Looked up file · models/script.py").
- The AI decides whether to look anything up; small, well-covered files often need none.
- Claude Code runs these requests with `--setting-sources ""` (safe mode drops
  explicitly passed MCP servers) and allows only `mcp__yamori__*`. Codex runs them
  through `app-server` and approves only Yamori's server.
- If the CLI cannot start the server, Yamori retries once without lookups.
- Lookups add model turns and can send more of your project's source to the
  provider. Turn them off with `yamori.agentTools`. They are always off in Restricted Mode.

Glossary terms in the explanation become dotted links: hover for the meaning, click
to open the definition. Every explanation is also asked to define IDs, labels and
section names at first use, with or without a map. Cached explanations keep the
context they were written with; when the map has newer context for a file, a notice
suggests **Regenerate**. Opening the cache still uses no AI.

## Run a function with its tests

Reading pseudocode tells you what a function does; seeing it run with real values
shows its inputs and outputs. In a mapped project, Yamori links unit tests to the
functions they call: Python `test_*` functions and `test_*` methods of `Test*`
classes, and JS/TS `it(…)` and `test(…)` calls. A block whose functions have tests
shows **Run with a test: ▸ test_first_loop**.

**A real run (Python, trusted folders).** Yamori runs that one test with your
project's interpreter and records how the function ran:
- the arguments it received (**In**)
- every executed line, with the variables that line changed (**Steps**); ◀ ▶ or the
  arrow keys step through, and the current step's pseudocode line is highlighted
- the return value or exception (**Out** or **Raises**), plus the test's own
  result (passed, failed with its message, or error)

If the function runs several times, **Call 1 / 2 / 3** picks one. The interpreter is
`yamori.pythonPath` if set, otherwise the Python extension's interpreter for the
project, then a `.venv`, then `python3`. pytest runs the test when installed;
otherwise plain `test_*` functions and `unittest` cases run directly, and a test that
needs pytest fixtures says so. Runs stop after 60 seconds, and each records at most
3 calls and 300 steps.

This runs your project's code on your machine. Yamori asks before the first run in
each folder (**Run**, **Always run tests in this folder**, or **Simulate with AI
instead**) and never runs anything in Restricted Mode.

**An AI simulation, when a real run isn't possible.** In Restricted Mode, for
JS/TS tests, or on request (**Simulate with AI**), your selected AI traces the
function on the test's inputs without running anything. The cell is dashed and
labelled **Simulated by AI, not a real run**, with any caveats; steps are limited
to the function's own lines. On a small Python function, Claude and Codex both
reproduced the real run's exact steps, but simulated values can be wrong.

**Files, images and data as emoji.** Values that stand for files or media get an
emoji, and hovering explains what they are:

| Emoji | Value | Hover example |
| --- | --- | --- |
| 🖼️ | image path or image in memory | size, width × height, and "A path to an image file. Code usually opens it to read its pixels; the path itself is just text." |
| 📄 | document path or open file | file name, size |
| 📊 | data file, or a table in memory | rows × columns |
| 🎵 🎬 🗜️ 📁 | audio, video, archive, other file | file name, size |
| 📦 | bytes | length |
| 🔢 | array or tensor | shape and dtype |

Real runs check the file on disk (missing files say "not found on disk"); simulated
values are recognised from their text.

## Pixel interface

Click **Theme** beside Refresh, or run **Yamori: Choose Reading Colors**.
Choose **Pixel Light**, **Pixel Dark**, or **Follow editor**. Your existing palette
preference is kept, using the new monochrome look. Switching themes changes no
explanation and uses no provider quota.

The interface uses contrast, typography, spacing and labels to distinguish
control flow, notes and outputs. Motion is limited to a tiny loading step,
button feedback and a short block transition. Reduced motion disables it.
The gecko toolbar logo and status-bar shortcut remain available in the editor.

## Models and reasoning effort

Open the **provider · model ▾** menu for model and effort controls, or use **Yamori:
Choose Model** and **Yamori: Choose Effort**.

- **Codex:** model choices and supported effort levels come from its live catalog.
- **Claude Code:** choose Sonnet, Opus, Haiku or Fable, or enter an exact model ID. Known model families use their documented effort levels.
- **Provider default:** lets the CLI choose. Unrecognized custom models offer default effort until their capabilities are known.

Without an effort choice, Yamori asks both Claude and Codex for **low** effort.
On a dense 162-line file, Opus 5.5 started writing after 2 seconds at low effort
and finished in 50; at medium it thought for 77 seconds first and took 137. Raise
the effort per model in **AI ▾ → Effort**, or pick **Provider default** to let the
CLI decide.

**Quick jobs use a fast model** (`yamori.fastModel`, default `auto`): Claude's
Haiku, or the model Codex's own catalog describes as fast (for example
`gpt-6-luna`). They handle:
- AI notes, three batches at a time (a 4-file batch takes about 10 seconds)
- the Overview level, and the Overview written alongside each Logic explanation
  (it runs in parallel and is usually ready first, so the Logic answer is shorter)
- picking the blocks worth reviewing

Logic explanations and block edits use your main model; reviews use the review
model below. Set `yamori.fastModel` to `off` to use your main model for quick jobs, or to an exact
model ID. Step links are written as compact `[line, start, end]` triples: as
objects they made up 35–42% of every answer.

Model choices are remembered per provider; effort choices are remembered per
provider and model. Choosing either starts no inference. The choice applies to
the next Refresh, new generation or block update.

**Detail controls the explanation. Effort controls the model's reasoning.**
Higher effort can take longer and use more quota without asking for a longer
explanation. The panel distinguishes your next-request settings from the model
that generated the current result. Effort is labeled as requested because CLI
policies can cap or override it.

### Speed: parallel parts and background review

A new Logic explanation of a bigger file is written by several requests at once,
and reviewed after you can already read it. Measured on a 354-line Python file
(Claude, Opus at low effort, one review step):

| | Before | Now |
| --- | --- | --- |
| First block on screen | 3.5 s | 3.4 s |
| Whole draft readable | 49.5 s | **17.4 s** |
| Finished, including review | 85 s (edit and source actions locked until then) | 53 s, in the background |

**Parallel parts** (`yamori.parallelRequests`, default 6):
- Yamori splits the file locally with tree-sitter, no AI, into parts made of whole
  functions and classes. A definition longer than a part splits into its inner
  definitions. Decorators and doc comments stay with their definition.
- Each request explains one part with the whole file as context, and is told which
  other parts exist so it names them instead of re-explaining them. Part 1 also
  writes the title and summary.
- Blocks appear as each part finishes; the draft is ready about when the slowest part is.
- A section that strays outside its part is trimmed to it. A failed part is retried
  once; if it fails again, Yamori writes the whole file in one request as before.
- Used for Logic on Python, JavaScript/TypeScript, Go, Java and Rust files big
  enough for two parts (about 50 lines). Set 1 to always use one request. Parts
  read the whole file each, so they use more of your plan for the same output.

**Background review:**
- Once the draft is shown, the review runs on its own: picking difficult blocks, two
  reviewers, and a rewrite. A line in the tab says "Reviewing difficult blocks in the
  background…", and you can read, scroll and switch levels meanwhile.
- Improved blocks swap in when it finishes ("Review improved 2 blocks: …"), and the
  cache is updated.
- If you edit a block, refresh or regenerate first, the review result is dropped.
  Changed code also drops it.
- If the reviewers find inaccuracies they can't fix, the draft stays with a warning
  and **Retry review**.
- Closing VS Code mid-review is fine: the draft is cached as pending and reviewed
  again the next time you open it.

**Cheaper review model** (`yamori.reviewModel`, default `auto`): the reviewers and
the rewrite run one tier below your writer, never above it. That's Sonnet under Opus
or Claude's default, and Codex's balanced catalog model (`gpt-6.1-terra` today) under
its default. If you already chose a smaller writer, reviews use it. `main` uses your
writer's model, or enter an exact model ID. A stray step link in the rewrite is
dropped instead of discarding the whole rewrite.

## Refine the difficult parts

Yamori can improve a new explanation after showing it (see
[Speed](#speed-parallel-parts-and-background-review)); block edits and
refreshes are still reviewed before they replace the text:

1. A selector picks only blocks with difficult reasoning: a numerical identity,
   subtle state changes, a complex algorithm or a missing conceptual bridge.
   Straightforward functions stay untouched. It selects at most six blocks, or none.
2. Two independent evaluator sessions run in parallel on those selected blocks.
   One estimates remaining uncertainty; the other estimates reading cost.
3. A writer revises only those blocks using both reviews. The evaluators check
   each revision again, and Yamori keeps the lowest-scoring candidate that passes
   both fidelity checks. Easy blocks retain their exact text and links.

The working objective is `uncertainty + 0.5 × reading cost`, with fidelity as a
hard constraint. Both scores use a 0–10 anchored rubric. They are **LLM judgments,
not measured entropy or a proof of correctness**. Reviews cover the selected
blocks; skipping an easy block does not certify it as correct.

Open the AI menu → **Refine**, or run **Yamori: Choose Refinement Steps**.
The default is **1 step**, configurable from **0–5** through
`yamori.refinementSteps`. Setting 0 skips selection and review. A new explanation
uses two model requests when nothing needs refinement, or up to **3N + 4** when
blocks are selected. More steps use more time and subscription capacity. A malformed evaluator response may add one bounded repair request for that evaluator. All
sessions use your chosen provider with tools disabled; reviewers and the rewrite use
`yamori.reviewModel`, and picking blocks uses the fast model.

The first draft streams immediately so you can start reading while selection
and reviews run. It stays labeled as a draft, with source/edit actions disabled
until final validation. The activity trail shows selection, review and refinement
progress. Review prompts use compact source context instead of repeating the
full writing guide. The loop stops early when both reviewers report no actionable
changes with low rubric scores, or a revision fails to improve an already faithful
candidate. N remains an upper bound, not a requirement to spend every pass. Stop cancels the writer and both evaluators.
If a later pass fails, an already reviewed candidate can be kept with a visible
notice. If fidelity problems remain unresolved, no new explanation is promoted.
An evaluator pass is a useful second opinion, not a correctness guarantee.

Evaluator output is constrained to the views and zero-based blocks actually
being reviewed. Ajv validates explanation, selector and evaluator structures
without coercing types or supplying defaults. Errors identify the failing field,
such as `/issues/0/section`. Separate contextual checks verify source ranges,
step links and references to actual candidate blocks. Schema validation does
not establish whether an explanation is correct. If feedback is malformed, Yamori asks only that evaluator to
repair it once. If review still cannot finish, the valid generated explanation
stays visible and cached with **Draft · review incomplete** and a **Retry review**
action. Retrying unchanged code reuses that cached draft instead of paying for
another generation. This fallback does not mark the draft as reviewed or bypass
a known fidelity rejection. Error screens show a retry action rather than the
first-use welcome screen, and empty activity entries are omitted.

Final text and review metrics are cached locally, separated by refinement setting.
Cached reads make no model requests. Existing pre-refinement caches stay readable;
use **Regenerate** to apply the new setting. When a selected block changes, old
companion views are not silently reused; other detail levels are derived from the
final explanation when requested.

## Edit the explanation

Click **Edit** to work in a CodeMirror editor with line numbers, normal selection,
Tab/Shift+Tab indentation, continued indentation on Enter, find, undo and redo.
Emphasized text appears emphasized, without the Markdown markers. Equations stay
typeset until you click one to edit its formula. Blank lines and indentation are
preserved. The underlying text still supports `**emphasis**` and `$LaTeX$`.

Add an optional instruction, then click **Update with Codex/Claude Code** or press
**⌘/Ctrl+Enter**. Only that explanation is revised and cached. The editor keeps
its draft, cursor and undo history through theme changes, map navigation and
provider status updates. Failed or cancelled requests keep the approved result
and your editable draft. Your text is locked while a request is running.

Edits change the pseudocode; the source file stays unchanged. Other detail levels
rebuild from your approved explanation when requested, preserving your intent.

<details>
<summary><strong>How Yamori explains code</strong></summary>

The generation and block-edit prompts explicitly use this communication objective:

$$
\min_X H(B \mid X,K) + \lambda\,\mathrm{ReadCost}(X)
$$

Here **B** is relevant code behavior, **X** is the explanation and **K** is the reader's existing knowledge. Reading cost includes length, jargon, nested clauses and visual clutter. Semantic fidelity is a hard constraint. The agent uses this as a qualitative criterion: keep details that distinguish behavior, add short definitions when they remove confusion, and cut low-value wording. It does not estimate entropy numerically.

Short numerical code can hide the whole idea. Yamori’s shared generation and editing prompts include an `agreements` example that connects an all-pairs sign dot product to a count: each matching sign contributes +1 and each opposite sign contributes −1, so $d=m-(n-m)=2m-n$ and $m=(n+d)/2$. The example explains zeros, ties-to-even rounding and the 0–255 output range, and distinguishes the intended count from unchecked assumptions such as `n` matching the row width. The prompt asks models to transfer this explanation pattern to relevant code, without copying unrelated details. Brief derivations are allowed at Logic level when they unlock the computation.

The central objective also governs how background knowledge is used. For technical algorithms, the LLM actively uses its established internal mathematical and programming knowledge to explain **what the method accomplishes, how its steps fit together, and why its mechanism helps**. It identifies standard methods only when the visible operations support the identification. A compact `# Context:` or `# Why:` note can explain a predictor–corrector update, for example, without turning the block into a textbook essay.

Source code remains the evidence for this implementation's behavior. Standard algorithm rationale is distinguished from author intent, unseen custom-function bodies and implementation-specific guarantees. Accuracy or stability claims retain necessary assumptions. The extension does not enable browsing or file tools to add this background; it uses the selected model's internal knowledge and the provided code context.

Blocks group coherent ideas at a consistent level of abstraction. Necessary
concepts such as callbacks, mutable state, smoothed model copies and detached
snapshots are explained briefly where they matter. Names and mathematics stay
consistent, and control-flow indentation shows what happens when.

Important comments stay beside the relevant step. Added notes use these labels:

| Note | Meaning |
| --- | --- |
| `# Insight:` | A non-obvious consequence supported by the operations. |
| `# Context:` | Relevant established background that helps explain the code. |
| `# Inferred:` | A necessary interpretation whose intent is uncertain. |
| `# Unresolved:` | Missing information that affects the meaning or correctness of an explanation. |

Yamori's prompts draw on [University of Washington pseudocode guidance](https://courses.cs.washington.edu/courses/cse421/24au/resources/pseudocode.pdf),
[MIT/Broad's code communication guidance](https://mitcommlab.mit.edu/broad/commkit/coding-and-comment-style/)
and [MIT's Missing Semester](https://missing.csail.mit.edu/2026/beyond-code/).
The style is adapted for capable readers with less programming experience.

For custom calls, Yamori asks the editor's definition and type-definition
providers about up to ten call sites. It collects bounded excerpts from local
workspace sources, prioritizing model-related calls, and includes a Python
model's `forward` or `__call__` body when found. Dependency folders and symlinks
outside the workspace are excluded.

Lookup adds up to 1.6 seconds on an initial read or refresh and contributes at
most about 18,000 characters of supporting excerpts. A language extension with
working Go to Definition support is needed. When definitions are unavailable,
Yamori explains the visible data flow and identifies consequential gaps.
It does not build a full call graph or recursively inspect every callee.

Source associations and generated explanations still need review. Valid line
bounds do not guarantee a semantically correct explanation.

</details>

<details>
<summary><strong>Storage, privacy and limits</strong></summary>

The selected file or range, bounded supporting definitions and your explanation
edits/instructions are sent through the selected provider. Nothing is sent
until you request generation, refresh, folder processing or a block update.

Explanations stay in local VS Code/Cursor extension storage, outside your
project, under `globalStorage/cowana-ai.yamori/cache/`. Completed views, approved
revisions, source snapshots, supporting definitions, modification dates and
content fingerprints are saved on this device. Block drafts, instructions,
cursor position and undo history are autosaved too. There is no automatic
100-response eviction; entries remain until you run **Yamori: Clear Cached
Explanations**, which also removes revisions and drafts. Local cache write
failures are shown instead of silently claiming a save succeeded.

**When code changes:** Yamori watches editor changes and filesystem events,
including Git checkouts and files outside the current workspace. It uses dates
and file sizes for cheap checks, then content hashes and a bounded line diff to
identify affected blocks and rebase source links. A timestamp-only change needs
no AI. Opening a previously cached file after an offline change shows the old
explanation with a dated warning; it does not silently start generation.

Choose **Refresh block** to update one block from its current code, supporting
definitions and cached explanation. **Update from code** updates the cached document
in context. When only some blocks changed, it requests patches and preserves
untouched blocks exactly. New, removed or shared code calls for a whole-map
refresh so the structure can change. Known helper changes flag their callers
conservatively; this is not a complete dynamic call graph. Review whole-file
refreshes when dependencies are ambiguous. Other detail levels are updated
when opened or explicitly refreshed, not all regenerated in the background.

Cached text stays visible while refreshing. Stale blocks lose source links and
editing actions until refreshed; unaffected blocks remain usable. A later
source change cancels the request, and a result based on older code cannot
replace the current view. Large rewrites or deleted selections require a new
selection instead of guessing where the code went. Legacy caches are indexed
when opened against matching source; an old unindexed cache cannot recover an
unknown earlier source version.

Yamori has no telemetry or account service. Translation requests run in temporary
directories with tools disabled. Partial output is never cached, and source
links activate after final validation. The activity trail shows connection,
writing and validation phases rather than private reasoning.

Project guides are stored beside explanations under
`globalStorage/cowana-ai.yamori/cache/projects/`: the static graph, AI notes,
folded folders and moved boxes, and an index of Yamori's explanations that the
lookups read. **Add AI notes** sends the source of the mapped files that
need notes (outlines for large files) through the selected provider after you
confirm. The map never reads through symlinks outside the mapped folder.

Files or selections are limited to 120 KB. Folder discovery and project maps are
limited to 500 source files; map files over 500 KB are skipped. Each model request allows up to three minutes at Low, five at Medium/default,
and ten at higher effort, with Stop available throughout. Local files and VS Code 1.90+ or a compatible Cursor version are required.

</details>

## Development

The packaged extension needs no dependency installation. CodeMirror, KaTeX,
jsdiff and precompiled Ajv validators are local bundles; no CDN is used.
Use Node.js 20+ to run the checks:

```sh
npm test
npm run check
```

When changing a schema, install the pinned development dependencies and rebuild
the standalone validators before running the checks:

```sh
npm ci
npm run build:validation
```

The tree-sitter runtime and grammars in `grammars/` are copied from the pinned
`@vscode/tree-sitter-wasm` package. After updating it, run `npm run build:parser`
and commit `grammars/`. They are about 4.4 MB unpacked; the packaged VSIX grows to about 1 MB.

Only trusted, repository-owned schemas are compiled during the build. The
extension does not load Ajv or compile schemas at runtime. Commit the generated
`validation.min.js` alongside schema changes.

Launch an extension development host with:

```sh
code --extensionDevelopmentPath=/absolute/path/to/yamori
```

Build the installer with the VS Code packaging CLI:

```sh
npx @vscode/vsce package --no-dependencies
```

| File | Purpose |
| --- | --- |
| [extension.js](extension.js) | Editor integration, model/effort pickers, source context and cache. |
| [cache.js](cache.js) | Atomic local storage, source alignment and change analysis. |
| [engine.js](engine.js) | Translation prompts, provider processes and response validation. |
| [schemas.js](schemas.js) | Shared JSON Schemas and build-time validator generation. |
| [validation.min.js](validation.min.js) | Standalone Ajv validators used by the extension. |
| [panel.js](panel.js) | Reading panel, block editing, source navigation, glossary links and math rendering. |
| [project.js](project.js) | Project scan, import resolution, ranking, reading path, layout and explanation context. |
| [map.js](map.js) | Project guide: Start here steps and the folder-box map. |
| [mcp.js](mcp.js) | Read-only Yamori knowledge server (MCP) for the AI's lookups. |
| [grammars/](grammars/) | Bundled tree-sitter runtime and grammars (generated). |
| [test.js](test.js) | Offline provider, UI and extension-workflow checks. |
| [demo.py](demo.py) | A small example to read with Yamori. |

**Validation:** 106 automated tests cover the project guide and lookups (tree-sitter extraction for
every bundled grammar, import resolution per language, entry points and reading
paths, incremental rescans, deterministic layouts, bounded explanation context,
note validation, folder reading orders, folder boxes that stay structured at any
size, Start here and map messages, glossary links, the MCP server over stdio with
mapped-only and bounded reads, Claude and Codex lookup flags and approvals, the
no-lookup fallback, unit-test discovery and association, the Python runner on real tests (inputs, every executed line, outputs, failures, unittest, fixtures that need pytest, file and image descriptions), real runs gated by trust and a once-per-folder question, AI simulations limited to the function's lines, the notebook cell with emoji values and step highlighting, fast models for quick jobs (a parallel Overview, compact step links, three note batches at a time, Codex's catalog fast model), parallel parts (local part planning from whole definitions, at most N requests at once, sections kept inside their part, one retry then a whole-file fallback, a draft that never waits long for a slow Overview), background review (draft readable at once, improved blocks swapped in and cached, dropped after edits or refreshes, kept through level switches, fidelity warnings with Retry review, pending drafts resumed), the review model one tier below the writer, the setup screen (Claude Desktop's bundled Claude Code, sign-in status from each CLI without a model request, one action per AI, visible install and sign-in terminals, continuing by itself once sign-in works, setup before the first explanation, switching open readers), automatic AI notes (quiet, changed files only, asks first for large projects, no retry loops, waiting for setup instead of failing, also in Restricted Mode), the map-first guide with Details on demand, the reader's tour bar and one-step-ahead preparation (only in a tour, only when not cached, off with its setting), project-name links that open the defining block, editor hovers with escaped text and only Yamori's commands trusted, CodeLens that hides on changed code, the plain-language reader controls, the live progress card and its stages (thinking token counts, never thinking text), effort defaults, the folder-grouped file
picker and an end-to-end guide → notes → explanation flow that rejects symlinked
files outside the project), strict schema validation, field-path errors,
cache compatibility, loading without development dependencies or runtime schema
compilation, evaluator-reference repair, incomplete-review caching/retry, meaningful error states, streaming before review, compact context, early completion/plateau stops, Restricted Mode TypeScript opening,
user-only CLI settings, blocked definition lookups, first-use provider selection,
parallel reviewers, fidelity gating, scoped refinement, local caching/drafts,
source changes and cancellation. An isolated native VS Code profile opened and
explained a TypeScript file while remaining untrusted, ignored project-controlled
CLI/usage settings, and activated Yamori automatically. A separate native VS Code check reproduced persistently malformed evaluator
feedback, retained both explanation blocks as an incomplete-review draft, and
reopened them from cache with no inference. Earlier native checks covered file
watching, independent tabs and cache reuse.

Browser fixture checks cover narrow panels, math, editing/undo, navigation,
cache warnings and retained drafts. A live Codex check selected an agreement-count
identity, skipped a seed getter and retained the improved result after one
refinement step. Live Codex also verified DKDM explanations, model/effort selection
and block edits. Live Claude Code 2.1.325 (Haiku) and Codex 0.169 runs generated
explanations with Yamori's lookup server loaded, and forced lookups returned
glossary data through both; the same Claude check confirmed that `--safe-mode`
drops the server. Windows discovery is tested with fixtures; live Windows
sign-in remains unverified.

## Credits and license

Application code is [MIT licensed](LICENSE). Bundled [KaTeX](https://katex.org/)
0.19.1 is MIT licensed, with its full notice retained in `katex.min.js`. It runs
locally to produce MathML without font downloads or network requests.

The bundled [tree-sitter](https://tree-sitter.github.io/) runtime and the Python,
JavaScript, TypeScript, Go, Java and Rust grammars come from Microsoft's
[`@vscode/tree-sitter-wasm`](https://github.com/microsoft/vscode-tree-sitter-wasm)
0.3.1 and are MIT licensed; the notice is in `grammars/LICENSE`. The project map's
ranking approach follows [Aider's repo map](https://aider.chat/2023/10/22/repomap.html);
its tag queries were written for Yamori.

Bundled [jsdiff](https://github.com/kpdecker/jsdiff) is BSD-3-Clause licensed, with its notice retained in `diff.min.js`; bounded line alignment runs locally.

[Ajv](https://ajv.js.org/standalone.html) 8.20.0 is MIT licensed; its full notice is
retained in the generated `validation.min.js` bundle.

Bundled CodeMirror 6 and its dependencies are MIT licensed, with their notices retained in `editor.min.js`. The editor adapter is in `panel.js`. The gecko samurai mascot was adapted from a user-supplied illustration using
image generation. The mascot is separate artwork and is not included in the
application-code MIT license.

Provider integration references: [Codex app-server](https://learn.chatgpt.com/docs/app-server)
and [Claude Code model configuration](https://code.claude.com/docs/en/model-config).

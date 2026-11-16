# Project guide

[← Yamori](../README.md) · [Getting started](getting-started.md) · [Reading](reading.md) · [Project guide](project-guide.md) · [Tests](tests.md) · [Models & speed](models.md) · [Development](development.md)

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

**Search a name.** The box in the guide's header (always visible; ⌘F / Ctrl+F) finds a
variable, function or term across the mapped files, locally and without AI. Names match
as whole words with exact capitals; other text matches anywhere. The map switches into
view with every file that mentions it highlighted and a count badge, and other files
fade. A folded folder shows the total for its files. A side panel lists the hits by
folder, defining files first, with each matching line; click a line to open it.
**Explain how it flows** asks your AI how the name moves through those files: where it
is defined or set, where it is passed, read, changed or returned, and which file hands
it to which. It sends excerpts around each mention (up to 12 files), plus their AI
notes and import links. The answer is a short summary, then the flow as reading blocks
that look and read like the reader's own: one block per stop in a file, titled with what
happens there and its file and line range. Each block holds numbered pseudocode written
with the same rules, with notes, **emphasis** and formulas. Click a line to open the
source lines it stands for; hover it to find its file on the map. The side panel widens
while a flow is shown. On `plan_loops` in a real project, Opus answered in about 15 seconds. Steps that point outside the
searched files are dropped.

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

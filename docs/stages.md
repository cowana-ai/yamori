# System map

The **System** tab (in Yamori's project panel, or the **System** button in Read) shows how the whole project works: its **parts** (each workflow, agent, server or tool), the few **steps** each part goes through, and how the parts work together. It is written in plain words; the code is there when you ask for it.

## Map it

Open the System tab and click **Map my system**. The tab says up front about how many small AI calls and tokens that takes. You never pick entry points:

1. Without AI, Yamori looks in every folder (two levels deep, so `agents/email` and `agents/sales` count separately) for functions that could start something: a function nothing else in its file calls, that reaches the most of the project, runs at startup, or is named like a starter (`main`, `run_*`, `*_loop`, handlers).
2. One cheap AI call reads those candidates with the files' AI notes, decides which are real parts, names them, and says how they connect ("the web server starts the email helper"). It can only choose among the candidates, so it cannot invent code.
3. One cheap AI call per part splits it into 3–7 steps, each with a sentence on what it does, and says in a few words what each function behind it does.

Mapping again with the same files makes no AI call. When files are added or removed, the tab offers **Update the map**; parts whose code did not change are reused. **Map the system again** at the bottom redoes the parts.

## Read it

- Each part shows what it does, its steps in order, and what it starts or is started by. Click a part for its steps; click a step for what it does, what it takes and gives, and how, in plain steps.
- **Show code** lists the functions behind a step, with links to the line, **Read** (the file in Yamori Read), its pseudocode and **Move to…** another step.
- **Rename**, **Merge with…** and **Keep as is** fix how the code is grouped; updates keep your changes.

## Steer it

Type what should change in **What should change?** and click **Find where** (one small AI call). Yamori says which steps of which parts it touches and why; untick any you disagree with. Then:

- **Preview the change**: one AI call with your main model. It sends only those steps' code, and your notes (system, part and step) as rules. **Apply** writes every file or none; **Undo** puts them back. The change then shows up in Review.
- **Give it to my agent**: no AI call. The request is saved as a to-do in those steps' notes, which Claude Code, Codex and Cursor read before they touch that code.

From a step, **Change this step…** skips the search.

## Review

When an update finds that what a step does changed, it adds one plain sentence to the review (for example "Replies are now sent twice when the first try fails"). The part and step show a **±** badge, and the bar on top says how many changes wait and in which parts.

**Review** lists each change: the sentence first, then **Show what changed in detail** (the pseudocode in red and green) and **code diff**, which opens the file at the map's base commit beside the working copy. **Keep it** or **Reject it** asks for an optional why, saved with the decision and in the change log. Either way the next change is compared with this version. **Mark all seen** counts everything so far as seen without deciding. Renames, formatting and refactors that keep behavior do not enter the review.

## Notes and Obsidian

Notes connect to Obsidian with nothing to set up:

- If the project folder is inside an Obsidian vault, notes go there.
- Otherwise, if Obsidian is installed, they go to the vault Obsidian has open (or opened last), found in Obsidian's own list of vaults.
- Otherwise they go to `.yamori/notes/` in the project. Notes written there move into the vault once Yamori finds one; nothing in the vault is overwritten.

The top of the System tab says where notes are. `yamori.obsidian.vaultPath` picks a vault by hand; `yamori.obsidian.auto` turns the search off.

In the vault, under `Yamori/<repo>/`:

- `System.md`: how the whole system works, its parts and how they work together. Your notes here are rules for every change.
- `<Part>/<Part>.md`: what the part does and its steps in order.
- `<Part>/<Step>.md`: what the step does, what it takes and gives, how, and the steps before and after. The code references are in a folded "Where this is in the code" box.
- `Changes/YYYY-MM-DD.md`: what changed, where, whether you kept or rejected it, and why.

Yamori rewrites only its own description, between `<!-- yamori:start -->` and `<!-- yamori:end -->`; everything under **Your notes** is yours and is never overwritten. Renaming a step in its note's front matter renames it in Yamori. Notes of steps that no longer exist move to `_archive/`; notes you created yourself are never touched. Writing and reading notes never calls AI.

## Updates and cost

Looking at the map, a step, its code or notes never calls AI: it reads `.yamori/yamori.db`, the pseudocode cache and the notes.

After you save a file, Yamori compares its content hash. Only steps with code in that file are marked as changed. About two seconds after saves stop (longer while an agent edits several files, or at once when it says it is done), each affected step gets one cheap AI call with the step and the before/after of its changed functions, never the whole system. A source excerpt of one function is sent only when that file has neither current pseudocode nor a current AI note. Nothing runs during a git rebase or merge.

- `yamori.stages.autoUpdate` (default on): turn off to wait for **Update**.
- `yamori.tokenBudget` (`{ "perRun": 60000, "perDay": 400000 }`): a call that would go over is not made; the step stays marked as changed.
- **AI use** (top right) lists every call today: what it was for, model, input, cached and output tokens, and cost.

Changing the AI model or Yamori's prompts does not redo the map by itself.

## Agents (MCP)

**Yamori: Connect Claude Code & Codex** registers Yamori's MCP server with Claude Code and Codex, and with Cursor (`~/.cursor/mcp.json`) when Cursor is installed. Agents get these tools:

| Tool | What it returns | Cost |
|---|---|---|
| `list_stages(workflow?)` | Without arguments: what the system does, its parts, how they connect, and the system notes. With a part: its steps in order | no AI |
| `get_stage(workflow?, stage)` | A step's functions with current lines and cached pseudocode, plus the system, part and step notes as constraints | no AI |
| `what_changed(workflow?, since_review?)` | Change sentences since the last review, with status and why | no AI |
| `add_note(workflow?, stage, text)` | Appends to the step's notes | file IO |
| `done()` | Tells Yamori the editing run finished, so it updates each changed step once | file IO |
| `propose_change(workflow?, stage, intent)` | Functions to touch for an intent, with the notes as constraints | one cheap AI call, at most one per 30 s and 20 a day, counted against `yamori.tokenBudget` |

## Storage

`.yamori/yamori.db` (SQLite, git-ignored) holds the parts, their steps, how parts connect, file hashes, the review queue and the AI-use log. It is derived from code and can be deleted; your renames and merges are the only edits it keeps. The System tab needs the editor's built-in SQLite (VS Code 1.101 or newer).

Links from notes into the code use `vscode://cowana-ai.yamori/open?file=<path>&line=<n>`.

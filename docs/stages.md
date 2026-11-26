# System map

The **System** tab (in Yamori's project panel, or the **System** button in Read) shows how the whole project works: its **parts** (each workflow, agent, server or tool), the few **steps** each part goes through, and how the parts work together. It is written in plain words; the code is there when you ask for it.

## Map it

Open the System tab and click **Map my system**. The tab says up front about how many small AI calls and tokens that takes. You never pick entry points:

1. Without AI, Yamori looks in every folder (two levels deep, so `agents/email` and `agents/sales` count separately) for functions that could start something: a function nothing else in its file calls, that reaches the most of the project, runs at startup, or is named like a starter (`main`, `run_*`, `*_loop`, handlers).
2. One cheap AI call reads those candidates with the files' AI notes, decides which are real parts, names them, and says how they connect ("the web server starts the email helper"). It can only choose among the candidates, so it cannot invent code.
3. For each part, Yamori builds its call tree without AI: from where the part starts, what each function calls and defines inside itself (tools registered in a function, handlers), across files, with each function's docstring. Then a small team of cheap AI calls, at low reasoning effort:
   - a **planner** reads the part's README and call tree (no code) and splits the part into 3–8 stages in the order the work happens, with the functions that do each one. A part driven from outside (an MCP server's tools, a CLI's commands) is ordered by the workflow its docs and tool descriptions describe;
   - **step writers**, one per stage and in parallel, read only that stage's code (saved pseudocode where Yamori has it) and say what each function does, with up to four details that matter when steering: decisions and limits ("keeps at most 5 sources"), fallbacks ("if the AI call fails, keeps every source"), which AI or prompt it uses, what it reads and writes.

   What each function does is saved against a hash of its code, so mapping again or updating reuses every unchanged function without a call. At most 4 AI calls run at once (`yamori.parallelRequests`).

   On a 49-file research agent (153 functions, 62 steps): 36 seconds and $0.017 to map, against 114 seconds and $0.016 for one big call; mapping it again reused 51 functions' descriptions and cost $0.014.

Mapping again with the same files makes no AI call. When files are added or removed, the tab offers **Update the map**; parts whose code did not change are reused. **Map the system again** at the bottom redoes the parts.

## Read it

The map is a graph you can pan, zoom (scroll or + / −) and **Fit**. Drag any box to move it; its arrows follow, and it stays there (per graph) until **Reset layout**. **⤢ Enlarge** fills the panel with it (Esc or **Exit full view** to go back), **✕** closes it, and dragging its bottom edge makes it taller:

- **Parts** are boxes with what they do and their steps in order. Arrows say how parts work together ("asks to research each topic"); dashed arrows are code one part uses from another.
- **Shared code** (for example a contracts package several parts import) is its own dashed box, linked to every part that uses it. Click it for its files and how they use each other.
- Parts with no links sit in a row underneath.

Click a part to open it below the map, which stays in view:

- **Its files, step by step**: one column per step in the order the work happens, then the code it uses from other folders. The helper files the steps use are folded into one box; click it to show them. Colors are steps. Click a file and its links light up.
- **A file** shows what it is for, which steps of which parts use it, its pseudocode block by block when Yamori already wrote it (no AI call; each block's line range opens Read there), what it uses and what uses it, and its functions.
- **A step** shows what it does, takes and gives, and how; **Show functions** lists the code behind it, with **Move to…** another step. **Rename**, **Merge with…** and **Keep as is** fix the grouping; updates keep your changes.

## Chat, plan and change things in the terminal

Opening Yamori's project panel starts one agent session for the project in the VS Code terminal by itself, in the background (`yamori.chatAutoStart`); it uses no AI until you write to it. **Chat** (top of the System tab), **Show chat** (in System and in Plan), or **Yamori: Chat with Your Agent in the Terminal** brings it up: Claude Code or Codex, whichever Yamori uses. It stays open while you work; with Claude Code the same conversation resumes after VS Code restarts. You can enlarge the System map and chat beside it.

The session is connected to Yamori and knows what you are looking at: the file, line and selected text in the editor, the file open in Read, the Yamori tab, and the part, step or file you selected in the System map (MCP `get_view`). So "why does this retry?" works without naming the file. It reads the map and your notes (`list_stages`, `get_stage`), writes plans onto Yamori's **Plan** canvas (`save_plan`), and can bring a part, step, file or plan into view in Yamori (`show_in_yamori`). **Ask in terminal…** on a step or file opens the session with that step or file already on the prompt.

`yamori.chatInTerminal` (default on): turn it off to use the chat inside the Plan tab and the **What should change** box in System instead.

## Review

When an update finds that what a step does changed, it adds one plain sentence to the review (for example "Replies are now sent twice when the first try fails"). The part and step show a **±** badge, and the bar on top says how many changes wait and in which parts.

**Review** lists each change: the sentence first, then **Show what changed in detail** (the pseudocode in red and green) and **code diff**, which opens the file at the map's base commit beside the working copy. **Keep it** or **Reject it** asks for an optional why, saved with the decision and in the change log. Either way the next change is compared with this version. **Mark all seen** counts everything so far as seen without deciding. Renames, formatting and refactors that keep behavior do not enter the review.

## Notes and Obsidian

Notes connect to Obsidian with nothing to set up:

- If the project folder is inside an Obsidian vault, notes go there.
- Otherwise, if Obsidian is installed, they go to the vault Obsidian has open (or opened last), found in Obsidian's own list of vaults.
- Otherwise they go to `.yamori/notes/` in the project. Notes written there move into the vault once Yamori finds one; nothing in the vault is overwritten.

Notes update by themselves: when you open Yamori, save code, map, review, or ask your agent. The top of the System tab says where they are and when they last synced; click it for the folder, **Open in Obsidian** and **Show the folder**. **Update** also says what it did, including when nothing changed. `yamori.obsidian.vaultPath` picks a vault by hand; `yamori.obsidian.auto` turns the search off.

In the vault, under `Yamori/<repo>/`:

- `System.md`: how the whole system works, a diagram of the parts and how they work together, and what happened lately. Rules you add here apply to every change.
- `<Part>/<Part>.md`: what the part does, a diagram of its steps, and what it works with.
- `<Part>/<Step>.md`: what the step does, takes and gives, how, its files, and its **History**: every change Yamori found, what you decided and why, and every request you made there. The code references are in a folded box.
- `Code/<path>.md`: one note per file the map uses, with what it is for, which steps use it, what it uses and what uses it. Obsidian's graph view then shows the real structure of the project.
- `Changes/YYYY-MM-DD.md`: what changed, what you asked for, what you decided, and why.

You do not have to write anything: Yamori records changes, decisions and requests by itself. Notes you add are kept and read by your agents.

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

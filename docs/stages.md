# Your System (system map)

The panel's tabs: **Files** (which files to read first), **File links** (which files use which, grouped by folder; formerly Map), **Your System** (formerly How it works, before that System) and **Chat & plan**.

The **Your System** tab (in Yamori's project panel, or the **Your System** button in Read) shows how the whole project works: its **parts** (each workflow, agent, server or tool), the few **steps** each part goes through, and how the parts work together. It is written in plain words; the code is there when you ask for it.

## Map it

Open the Your System tab and click **Map my system**. The tab says up front about how many small AI calls and tokens that takes. You never pick entry points:

1. Without AI, Yamori looks in every folder (two levels deep, so `agents/email` and `agents/sales` count separately) for functions that could start something: a function nothing else in its file calls, that reaches the most of the project, runs at startup, or is named like a starter (`main`, `run_*`, `*_loop`, handlers).
2. One cheap AI call reads those candidates with the files' AI notes, decides which are real parts, names them, and says how they connect ("the web server starts the email helper"). It can only choose among the candidates, so it cannot invent code.
3. For each part, Yamori builds its call tree without AI: from where the part starts, what each function calls and defines inside itself (tools registered in a function, handlers), across files, with each function's docstring. Then a small team of cheap AI calls, at low reasoning effort:
   - a **planner** reads the part's README and call tree (no code) and splits the part into 3–8 stages in the order the work happens, with the functions that do each one. A part driven from outside (an MCP server's tools, a CLI's commands) is ordered by the workflow its docs and tool descriptions describe;
   - **step writers**, one per stage and in parallel, read only that stage's code (saved pseudocode where Yamori has it) and say what each function does, with up to four details that matter when steering: decisions and limits ("keeps at most 5 sources"), fallbacks ("if the AI call fails, keeps every source"), which AI or prompt it uses, what it reads and writes.

   - **sub-steps**, built from the call tree without AI: under each step, the functions it calls (two levels deep), so inner logic such as a ranking or a judge is on the map even when the planner lists only the function that calls it. Plumbing (logging, tracing, settings, helper folders such as `utils` and `config`) is left out.

   - **scripts**: a Python file (or notebook) that does its work in top-level code rather than in functions is split into sections at its comments (`# download the data`, `# training loop`), and those sections are its steps, in the order they run. A small part may have just one or two stages.

   Every key behavior has a kind: **Decides** (a rule or threshold), **AI** (asks a model, and what for), **Asks you** (waits for a person), **Writes** and **Reads** (files, folders, services), **Loops**, **Fallback**, **Stops on error**, **Limit**.

   What each function does is saved against a hash of its code, so mapping again or updating reuses every unchanged function without a call. At most 4 AI calls run at once (`yamori.parallelRequests`).

   On a 49-file research agent (153 functions, 62 steps): 36 seconds and $0.017 to map, against 114 seconds and $0.016 for one big call; mapping it again reused 51 functions' descriptions and cost $0.014.

Mapping again with the same files makes no AI call. When files are added or removed, the tab offers **Update the map**; parts whose code did not change are reused. **Map the system again** at the bottom redoes the parts.

## Read it

The map is a graph you can pan, zoom (scroll or + / −) and **Fit**. Drag any box to move it; its arrows follow, and it stays there (per graph) until **Reset layout**. **⤢ Enlarge** fills the panel with it (Esc or **Exit full view** to go back), **✕** closes it, and dragging its bottom edge makes it taller. In full view, whatever you click (a step, a file) opens beside the diagram, and the search bar comes along:

- **Parts** are boxes with what they do and their steps in order. Arrows say how parts work together ("asks to research each topic"); dashed arrows are code one part uses from another.
- **Shared code** (for example a contracts package several parts import) is its own dashed box, linked to every part that uses it. Click it for its files and how they use each other.
- Parts with no links sit in a row underneath.

Click a part to open it below the map. It opens on **Steps**: every stage as a column, its steps top to bottom with what they call indented under them, and key behaviors on every box (◆ decisions and ⚠ stop conditions written out, badges for AI calls, files written, fallbacks and more). Code shows what it is: a **class** is a rounded, tinted box headed by its name in large highlighted type (`LayerNorm`, `CausalSelfAttention`, so a model's layers are easy to spot) that holds its methods (those in the same stage) as rows you can click, with what it is built from ("Built from LayerNorm · Block") and dashed **part of** arrows from the classes it is made of, so a model's architecture reads as blocks inside blocks. Click a class (it says **▦ Made of N parts · click to look inside**) to see **Inside** it: the parts its constructor creates, top to bottom in the order its main method runs them (`forward`/`call` in a model, otherwise the method that uses the most parts), from **Goes in** to **Comes out**. Each part is headed by its type in highlighted type, with plain words for what it does: the step's description, the class docstring, a built-in note for common layers (PyTorch, Keras, Flax: Embedding, Linear, Conv, norms, dropout, attention, pooling, RNNs) or else what it is made of. A part repeated in a loop (`ModuleList([Block() for _ in range(n)])`) is drawn as a stack marked **× n**; a shortcut (`x = x + part(x)`, `out += identity`) is a **+ shortcut** arrow; key math between parts (softmax, attention, the loss) shows as small ∑ boxes; parts the main method never uses are listed last. A part that is itself one of the project's classes shows its own parts inside it, with **Look inside** to open it on its own (**GPT › Block**). It works for any Python or JavaScript/TypeScript class, not only models, and is read from the code without AI. **What it calls** switches to the step's call path.

For Python, **Inside** draws how data moves through the main method, read from its code: arrows show what feeds each part, a value combined with another (`a + b`, a shortcut like `x = x + attn(x)`) gets a small **+ add** box where two paths join, a part called under an `if` says **◇ Only when …** with the condition from the code (the other branch gets its opposite), a part called in a loop says **↻ Runs for each …**, a loop over a list of parts is that part, repeated, and a part read rather than called (a weight) says so. Reading a value's size or shape (`x.size()`, `len(x)`) is not counted as using its data. Arrows that skip rows go round the boxes. Each part shows the arguments it was made with, worked out where the code allows: the constructor's locals and default arguments, the class's fields, module constants, and a field of another class in the part's files when only one has that name (`config.n_embd` → 768 from `GPTConfig`), so **Linear (768, 3072)** and **Block × 12**; the toolbar says which defaults it used, since a run can pass other values. Click a part for where it is made and used (links to the lines); **▶ Step through** follows the data one box at a time with a sentence for each, built from the graph. A box that holds a project class lists that class's own steps in the order they run, with their conditions. JavaScript and TypeScript classes show their parts in the order they are used, with dashed arrows since only the order is known. A method elsewhere is headed by its class, highlighted, and its name (**ƒ GPT.generate**); script sections say **§ script section**; plain functions have no label.

Click a box and the diagram becomes that step's path, read left to right with arrows: the steps that lead to it (from any stage), the step itself, and what it calls, each box labeled with its stage. Its behaviors are listed below (beside it in full view). Clicking along the path only selects that box, so the layout stays where it is; **Show the path of …** re-centers on the selected box when you want its own path, and **← Whole part** goes back.

The search bar above the diagram finds steps as you type, for example `angle selection`: it reads what each step does, its key behaviors, function and file names, forgives word endings and one typo, and knows a few verbs that mean the same thing (select, pick, choose). Matched words are marked on the boxes, matching steps are outlined, and the diagram centers on the best one and traces how the part gets there. **Enter** (or ↓) goes to the next match, **Shift+Enter** (or ↑) back, **Esc** or **Clear** ends the search. Which step calls which comes from the part's call tree, built without AI.

**Files** is the second tab.

A part mapped by an older version of Yamori says so, with **Map this part again**; the top of the tab offers **Upgrade all parts**. Functions whose code did not change keep their saved descriptions, so this is mostly the planner's cost.

Inside a part:

- **Files** (the part's second tab): one column per step of the part, in the order the work happens, then the code it uses from other folders. The columns are the part's own mapped steps, not a fixed list; each file sits under the step that runs most of its functions, and its color strip shows every step it serves. The helper files the steps use are folded into one box; click it to show them. Colors are steps. Click a file and its links light up.
- **A file** shows what it is for, which steps of which parts use it, its pseudocode block by block when Yamori already wrote it (no AI call; each block's line range opens Read there), what it uses and what uses it, and its functions.
- **Documents and data** sit on a part's diagram: files its steps only read on the left, files they write on the right, each with its format (MD, CSV, PDF, JSON…) and a path pattern such as `{research_root}/{month}/brief.md`, where `{name}` is filled in when the code runs. Yamori finds them in each step's code and the helpers it calls, with no AI. Click one for the steps that read and write it, the code lines, and real files in the project that fit the pattern; a step's details list the files it reads and writes.
- **A step** shows **How it works** as a diagram: its steps left to right, what each calls stacked under it, every box with its behavior badges and up to three decisions or stop conditions written on it. Click a box for all of that step's behaviors, with links to the line, Read and your terminal agent. The same steps are also listed in full under **All steps and behaviors as a list**.
- Part boxes on the map count their key behaviors, for example "14 AI calls · 49 decisions · 19 writes".
- **A step card** also shows what the stage does, takes and gives, and how; **Show functions** lists the code behind it, with **Move to…** another step. **Rename**, **Merge with…** and **Keep as is** fix the grouping; updates keep your changes.

## Chat, plan and change things in the terminal

Opening Yamori's project panel starts one agent session for the project in the VS Code terminal by itself, in the background (`yamori.chatAutoStart`); it uses no AI until you write to it. **Chat** (top of the Your System tab), **Show chat** (in Your System and in Plan), or **Yamori: Chat with Your Agent in the Terminal** brings it up: Claude Code or Codex, whichever Yamori uses. It stays open while you work; with Claude Code the same conversation resumes after VS Code restarts. You can enlarge a diagram and chat beside it.

The session is connected to Yamori and knows what you are looking at: the file, line and selected text in the editor, the file open in Read, the Yamori tab, and the part, step or file you selected in Your System (MCP `get_view`). So "why does this retry?" works without naming the file. It reads the map and your notes (`list_stages`, `get_stage`), writes plans onto Yamori's **Plan** canvas (`save_plan`), and can bring a part, step, file or plan into view in Yamori (`show_in_yamori`). **Ask in terminal…** on a step or file opens the session with that step or file already on the prompt.

**Plan mode works too.** A plan made in the agent's own plan mode (`/plan` in Claude Code, Plan mode in Codex) appears on the **Plan** canvas by itself, and Yamori brings the Plan tab into view. This covers the session Yamori started and any other Claude Code or Codex session in this project folder. Neither agent calls `save_plan` in plan mode. Claude Code ends with `ExitPlanMode` carrying the plan, and Codex with a `<proposed_plan>` block. Yamori reads the new lines of those sessions' logs on this computer (`~/.claude/projects`, `~/.codex/sessions`) every few seconds. It then turns the plan's Markdown into steps without AI:
- each item that names a mapped file (`model.py`, `src/a.js:40-60`) becomes a step on that file;
- items under a heading that names a file belong to that file;
- a function or class the item names (`Block.forward`, **GPTConfig**) gives the lines;
- a new file the plan creates is a proposed file;
- items that say to leave code alone are kept but marked skipped;
- context, assumptions and verification sections are not steps.

The full plan text is in the conversation, with any items that name no mapped file. A plan the agent also saved with `save_plan` is not added twice. Turn this off with `yamori.agentPlanMode`.

`yamori.chatInTerminal` (default on): turn it off to use the chat inside the Plan tab and the **What should change** box in Your System instead.

## Review

When an update finds that what a step does changed, it adds one plain sentence to the review (for example "Replies are now sent twice when the first try fails"). The part and step show a **±** badge, and the bar on top says how many changes wait and in which parts.

**Review** lists each change: the sentence first, then **Show what changed in detail** (the pseudocode in red and green) and **code diff**, which opens the file at the map's base commit beside the working copy. **Keep it** or **Reject it** asks for an optional why, saved with the decision and in the change log. Either way the next change is compared with this version. **Mark all seen** counts everything so far as seen without deciding. Renames, formatting and refactors that keep behavior do not enter the review.

## Notes and Obsidian

Notes connect to Obsidian with nothing to set up:

- If the project folder is inside an Obsidian vault, notes go there.
- Otherwise, if Obsidian is installed, they go to the vault Obsidian has open (or opened last), found in Obsidian's own list of vaults.
- Otherwise they go to `.yamori/notes/` in the project. Notes written there move into the vault once Yamori finds one; nothing in the vault is overwritten.

Notes update by themselves: when you open Yamori, save code, map, review, or ask your agent. The top of the Your System tab says where they are and when they last synced; click it for the folder, **Open in Obsidian** and **Show the folder**. **Update** also says what it did, including when nothing changed. `yamori.obsidian.vaultPath` picks a vault by hand; `yamori.obsidian.auto` turns the search off.

In the vault, under `Yamori/<repo>/`:

- `System.md`: how the whole system works, a diagram of the parts and how they work together, and what happened lately. Rules you add here apply to every change.
- `<Part>/<Part>.md`: what the part does, a diagram of its steps, and what it works with.
- `<Part>/<Step>.md`: what the step does, takes and gives, how, its files, and its **History**: every change Yamori found, what you decided and why, and every request you made there. The code references are in a folded box.
- `Code/<path>.md`: one note per file the map uses, with what it is for, which steps use it, what it uses and what uses it, and its classes. Obsidian's graph view then shows the real structure of the project.
- `Inside/<Class>.md`: one note per class made of parts (up to 80, the map's own first), read from the code without AI, the same as **Inside** in the panel: a top-to-bottom Mermaid diagram of how data moves through it (parts with the arguments they were made with, joins as circles, conditions on the arrows), the flow step by step in sentences with links to the lines, its parts linking to their own Inside notes, and the classes it is part of. Part notes list the Inside notes of their classes. The notes follow the code: what classes are made of is read again in the background when the mapped files change (cached by their content), then the notes are written again.
- `Changes/YYYY-MM-DD.md`: what changed, what you asked for, what you decided, and why.

You do not have to write anything: Yamori records changes, decisions and requests by itself. Notes you add are kept and read by your agents.

Yamori rewrites only its own description, between `<!-- yamori:start -->` and `<!-- yamori:end -->`; everything under **Your notes** is yours and is never overwritten. Renaming a step in its note's front matter renames it in Yamori. Notes of steps that no longer exist move to `_archive/`; notes you created yourself are never touched. Writing and reading notes never calls AI.

## Updates and cost

Looking at the map, a step, its code or notes never calls AI: it reads `.yamori/yamori.db`, the pseudocode cache and the notes.

After you save a file, Yamori compares its content hash. Only steps with code in that file are marked as changed. About two seconds after saves stop (longer while an agent edits several files, or at once when it says it is done), each affected step gets one cheap AI call with the step and the before/after of its changed functions, never the whole system. A source excerpt of one function is sent only when that file has neither current pseudocode nor a current AI note. Nothing runs during a git rebase or merge.

- `yamori.stages.autoUpdate` (default on): turn off to wait for **Update**.
- **AI use** (top right) lists every call today: what it was for, model, input, cached and output tokens, and cost.

Changing the AI model or Yamori's prompts does not redo the map by itself.

## Agents (MCP)

**Yamori: Connect Claude Code & Codex** registers Yamori's MCP server with Claude Code and Codex, and with Cursor (`~/.cursor/mcp.json`) when Cursor is installed. Agents see a short list of tools (13, about 7k characters of definitions), built to replace a search-then-read loop rather than add to it:

| Tool | What it returns | Cost |
|---|---|---|
| `find(query, limit?, code?)` | Where or how something happens, in one call: the best-matching functions, classes or script sections, each with file:lines, what it does, its part and step, and its source lines. A question in plain words or an exact name | no AI |
| `list_stages(workflow?, detail?)` | Without arguments: what the system does, its parts, how they connect, and the system notes. With a part: its steps in order | no AI |
| `get_stage(workflow?, stage, detail?)` | A step's functions (file:lines, what each does) and the system, part and step notes as constraints | no AI |
| `read_source(path, start_line?, end_line?, symbol?)` | Numbered source lines; `symbol` reads one function or class | no AI |
| `file_info`, `get_pseudocode`, `get_view` | One file's definitions and links; its pseudocode; what you are looking at | no AI |
| `add_note(workflow?, stage, text)` | Appends to the step's notes | file IO |
| `save_plan`, `show_in_yamori`, `done()`, `save_pseudocode` | Plans onto the canvas, bring something into view, end of an editing run (each changed step updates once), pseudocode for files with none | file IO |

`list_stages` and `get_stage` answer in brief text by default. `detail: "full"` returns every field as JSON, including behaviors and cached pseudocode. Long answers are cut at a line with a hint on how to ask for less. Read tools are marked read-only (`readOnlyHint`), so clients can run them without asking.

Older tools stay callable by name but are not listed: `what_changed`, `propose_change` (one cheap AI call, rate-limited), `search_name`, `find_symbol`, `search_pseudocode`, `project_map`, `start_here` and the git and conversation tools.

**Measuring it.** `scripts/bench-mcp/` runs the same read-only questions with Claude Code and Codex in three setups: without Yamori, with it, and told to start with `find`. Each answer is graded against expected file and function names, and the report gives tokens, time, tool calls and accuracy for each. It spends real tokens on your own sign-ins and is not part of `npm test`:
```bash
node scripts/bench-mcp/run.js --tasks my-tasks.json --reps 2
node scripts/bench-mcp/report.js
```

## Storage

`.yamori/yamori.db` (SQLite, git-ignored) holds the parts, their steps, how parts connect, file hashes, the review queue and the AI-use log. It is derived from code and can be deleted; your renames and merges are the only edits it keeps. The Your System tab needs the editor's built-in SQLite (VS Code 1.101 or newer).

Links from notes into the code use `vscode://cowana-ai.yamori/open?file=<path>&line=<n>`.

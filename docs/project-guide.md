# Project guide

[← Yamori](../README.md) · [Getting started](getting-started.md) · [Reading](reading.md) · [Project guide](project-guide.md) · [Tests](tests.md) · [Models & speed](models.md) · [Agents](agents.md) · [Development](development.md)

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

## Plan a change

Open **Plan** directly from the Yamori reader header or the editor title's **Yamori: Plan Changes** action. The shortcut is **Cmd+Option+Shift+P** on macOS or **Ctrl+Alt+Shift+P** on Windows/Linux. You can also find **Yamori: Plan Changes** in the Command Palette.

**New plan**, **Fit canvas**, **Copy plan**, and **Export** stay above the canvas; **Stop** appears while planning. In a file's details, use the visible change picker and previous/next buttons, then **Close** to return to the canvas. Model and effort selectors stay beside the conversation.

Open **Project guide → Plan**, describe your goal, and choose starting files on the map. Matching starts locally; if matches are weak, Yamori may ask the quick model to rank files. Check the displayed context estimate and model route before pressing **Draft plan**.

Drag steps to reorder them, or use the up/down buttons. Edit the title, file, source range, intended change, reason and personal notes. Click **On map** to locate a step's file; affected files and related tests help you inspect the scope. Undo/redo works within the plan. Mark steps done or skip them as you work.

**Show before → after** explains one step on demand. **Copy as agent prompt** hands the plan to your coding agent; **Export Markdown** saves a readable copy. Planning does not execute code changes. Plans are saved locally, and starting over retains recent plans in history.

Draft context uses bounded outlines and relevant current pseudocode, falling back to definitions when explanations are stale. Automatic model selection starts small only for narrow changes, and escalates a rejected quick draft once. Editing during an AI request stops that request so a late response cannot overwrite your changes.

### Canvas planning

In **Plan**, enter a goal and press **Create plan**. The agent chooses files using the project index, cached explanations and read-only project tools. You do not need to pick starting files. The canvas shows only files with proposed changes; drag them to arrange the plan. Click a file to inspect and edit its steps and see numbered current source snippets. Before/after pseudocode remains available on demand. These are proposals, not applied patches.

Claude planning requests use its `--permission-mode plan` setting with only Yamori project tools available. Codex uses its native Plan collaboration mode in an isolated read-only session with the same tools. Clarification questions appear in Yamori and resume the waiting turn when answered. The selected model and effort are preserved. These modes apply inside Yamori; they do not toggle Plan in a separate Codex or Claude window. Restricted workspaces do not expose project tools. The initial context, including the file index, shares the configured budget; additional agent lookups can increase usage.

### Review and discuss proposals

Proposed changes are readable text by default. **Edit** opens a monospace terminal-style editor; **Done editing** returns to the reading view. Click any proposed file to leave a comment or **Reject file**. Rejection skips every step for that file, excludes it from copied agent instructions, and prevents it from returning in an improved draft. **Restore file** includes it again.

The Plan AI, model and effort controls are independent of the reading provider. An explicitly selected planning model takes precedence over automatic routing. Activity shows reported stages and project lookups, plus provider token updates where available. Initial context and thinking counts are labelled estimates; completed usage is shown when reported. This is progress reporting, not private internal reasoning. If the agent returns a clarification question, planning pauses for your answer; **Not now** dismisses the question.

### Planning conversation

Plan opens with a terminal-style composer. Press Enter to send and Shift+Enter for another line. Your goal, clarification questions, answers and plan summaries are stored as separate messages locally; the goal is not rewritten to include the conversation. Send another message to revise the current plan. Recent plans retain their conversations in history. Only a bounded tail of the conversation is sent to the model.

Click a proposed file to open its inspector; use **×** to close it without clearing the plan. New proposals use short action sentences. **Show full proposal** reveals longer existing text, and **Generate pseudocode** creates a before/after snippet only when requested. Source snippets remain labelled as current code, and proposals remain unapplied.

Proposed changes use green **+ Addition**, red **− Removal**, and yellow **~ Change / refactor** labels. Cached proposals are classified conservatively from their action wording; mixed or unclear file changes use yellow. These colors describe proposed work, not an applied source diff. Rejected files remain muted and struck through.

### Terminal and focused review

Planning uses a locally bundled xterm terminal renderer. Enter submits a planning message; left/right arrows edit it, up/down recall user messages, and pasted multiline text waits for Enter. This surface sends messages to the selected planning AI; it does not execute shell commands. Conversation messages remain in local plan storage.

Click a file to inspect one change at a time. Use the change picker to jump directly, or Previous/Next. Edit and Generate pseudocode are next to the change. Current source and impact checks expand on demand. Select readable proposal text, choose **Add comment**, and save your note; the selected quote is kept with the step and included when revising or exporting the plan. There is no permanent file-comment form.


### Lower-cost plan conversations

Planning keeps a read-only agent session while the plan is open. Follow-ups reuse the investigation and return only changed steps; questions can be answered without rewriting the plan. Unchanged steps keep their IDs, comments, status and cached pseudocode. A changed step's old pseudocode is cleared so it cannot be mistaken for the new proposal.

Codex keeps a live ephemeral thread and closes it after 20 minutes idle. Claude resumes the same CLI session; its normal local session history is used. New plan, a provider/model/effort change, or a changed project source snapshot starts a fresh investigation. Sessions are separate from the locally saved plan, so reopening a plan after restart can need a new session.

Patch output is checked with the same compiled Ajv approach as other AI responses, then validated against current step IDs and exact source bounds. Invalid updates leave the saved steps unchanged. **Improve with default model** remains available for an explicit full-plan rewrite. Local navigation, comments, and manual edits do not invoke the model.

Planning keeps a stable provider output schema across draft and patch turns so changing the response format does not invalidate the prompt-cache prefix. If a session expires or source changes, its replacement receives the current plan, project context and bounded recent conversation. Cache hits and costs still depend on the provider.

### Approve a plan

Select your AI, model and effort, then press **Approve & implement** above the canvas. This starts a coding run in the project folder, saves open files, applies active steps and asks the agent to run relevant checks. Rejected files, skipped steps and completed steps are excluded. Planning itself stays read-only.

The terminal shows activity and reported token usage. **Stop** cancels the run; it keeps the plan and any edits already made. Claude uses its normal edit permission mode: a command that needs additional permission can block completion, in which case the plan stays available. No permission bypass flags are used.

After the agent confirms completion and checks, the active plan clears automatically. Its completed copy stays in local history and the terminal shows the result. Failed or incomplete runs keep the plan for review and retry.

### Project access during planning

Planning automatically supplies read-only project tools, including in Restricted Mode. The agent can find scripts, Markdown audience profiles and writer prompts, read text/configuration, and inspect local branch changes. You do not need to attach files already inside the open project. Text-file discovery is local and does not generate extra AI notes for those files. If a requested profile is absent, the agent can propose creating one. The original request stays in the planning context across follow-ups.

Planning does not execute project code. If you approve implementation while the workspace is restricted, Yamori opens VS Code’s Workspace Trust screen and continues the approved plan after you grant trust. It does not grant trust automatically.

### One project conversation

Open **Chat & plan**. The canvas is the default, with the conversation below it. The highlighted **< > Focus chat** button expands the conversation; **Back to canvas** restores the map. Replies appear as the provider generates text, without another AI request. Streaming updates do not rebuild the canvas or replace the typing field.

- **Chat:** ask questions and inspect the project without changing files.
- **Plan:** draft and discuss changes on the canvas. **New plan** clears the active plan and keeps the conversation.
- **Work:** talk to the coding agent normally. It answers questions or carries out explicitly requested tests and edits.

After an approved plan completes, its changes leave the canvas and the conversation continues in Work. You can immediately ask “What changed?”, “Run the relevant tests”, or request another task. Messages, reviewed plan details, activity, results and native session references are cached locally per project and survive reopening VS Code. Earlier messages remain available through **Earlier messages** and the `get_conversation` agent tool; long messages can be read in chunks.

### Move between Yamori and native agents

Press **Continue from…** and select a local Codex or Claude Code conversation for the current project. Yamori imports its visible messages and retains the original session ID, so subsequent agent work can resume the provider's own context. Finish the current external turn before continuing here. External updates sync when you return to the Yamori view; **Sync linked conversation** requests a local refresh. **Open current conversation in agent terminal** resumes the same session outside Yamori.

Planning stays in a separate read-only native session and shares its reviewed proposals and conversation through Yamori history. Coding/chat session references are kept separately so importing a plan cannot accidentally grant write access. If a native session was deleted, coding resumes from saved project context in a fresh session.

Ordinary web-only chats are not automatically available as local CLI sessions. Use **Copy project context** or **Paste a conversation handoff** to bridge those clients or switch providers. This transfers visible context, not another provider's private reasoning or cache. Yamori does not import unrelated account chats automatically.

The Git badge shows the current branch directly from local metadata, including worktrees and detached HEAD. Its updates and native-session discovery/import do not call an AI model.

### Ask about highlighted code

Highlight source code to open a native inline question field. Type your question and press **Ask Yamori**. Yamori opens project chat beside the editor and includes the file, line range and exact selected snapshot, including unsaved edits. This is a read-only question; no AI request happens until you submit. The field stays open when you click into it or the source highlight collapses. Use Dismiss to close it, or select another code range to replace it.

Right-click → **Yamori: Ask About Selected Code** and **⌘⌥Q** / **Ctrl+Alt+Q** are alternatives. Turn off `yamori.selectionQuestions` if you prefer opening the field manually. Selections are limited to 12,000 characters. A failed send keeps a retryable question with its original code snapshot.

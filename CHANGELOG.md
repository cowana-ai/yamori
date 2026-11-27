# Changelog

### Unreleased

- **Code before docs in big projects.** Over the 500-file map limit, code files now come before Markdown and data files, so a large content folder no longer pushes whole services out of the map. Python packages that live elsewhere in a monorepo (`packages/x/src/pkg`) now resolve, so their imports show up as links.
- **System map.** The **System** tab in Yamori's project panel (and the **System** button in Read) shows how the whole project works: every part (workflow, agent, server, tool), found automatically; its few steps in plain words; and how the parts connect. One click maps it: candidates are found without AI, one cheap AI call picks and names the parts among them, and one more per part writes its steps. It is a graph you can drag and zoom, with shared code as its own boxes; click a part for its files arranged by step and how they use each other, and click a file for what it does, where it is used and what it uses. Looking at anything calls no AI; saving a file updates only the steps whose code changed, with one cheap call per step. `yamori.tokenBudget` caps each run and each day, and **AI use** lists every call with its tokens and cost. See [docs/stages.md](docs/stages.md).
- **Complete maps, fair limits.** Cache reads count a tenth toward `yamori.tokenBudget` (default now 1.5M a day), and mapping you start yourself is not capped, so a whole-system map no longer stops halfway. If step descriptions are ever left out, the part says so with **Describe the missing steps**, which fills them in without re-planning. A step that only passes through to one function (a thin MCP tool wrapper) is replaced by the function that does the work, keeping the wrapper's name as a note.
- **Classes look like classes.** On a part's Steps diagram a class is a tinted container holding its methods, says what it is built from, and has dashed "part of" arrows from the classes it is made of (a model from its layers). Methods elsewhere are labeled with their class (`GPT.generate`), and classes that share a method name (`forward`) are told apart by line.
- **Scripts map too.** Python scripts and notebooks that do their work in top-level code (data prep, training scripts) are split into sections named by their comments, and those sections become steps, so parts like these no longer fail with "incomplete JSON". Small parts may have fewer stages, replies with text around the JSON are read, and notebooks are read as their code. Projects are indexed again once on open.
- **Clearer names, bigger diagrams.** The panel's **System** tab is now **How it works** and **Map** is now **File links**; inside a part the tabs are **Steps** and **Files**. In an enlarged diagram, a clicked step or file opens beside it instead of hidden below, and the step search stays at hand. A part's Files columns are its own steps; each file now sits under the step that runs most of its code, so no step is left without a column.
- **Find and trace in How it works.** A search bar above a part's diagram finds steps as you type ("angle selection" finds the steps that pick and rank angles), forgiving word endings, one typo and same-meaning verbs; matched words are marked, and the diagram centers on each match with Enter. The current match lights up its path; clicking a box turns the diagram into that step's path laid out left to right with arrows (what leads to it, the step, what it calls, each labeled with its stage), with **← Whole part** to go back. Clicks along a path only select, so the layout stays put. In full view the tools sit in one thin strip on top and details in a slim panel on the right.
- **A part opens on how it works.** One diagram of the whole part: stages as columns, steps and inner steps down each, with decisions and behaviors on the boxes; files are a second tab. Parts mapped by an older Yamori say so, with **Map this part again** or **Upgrade all parts**.
- **Every inner step, with its key behaviors on the diagram.** Steps carry the functions they call as sub-steps (from the call tree, without AI), so logic like a ranking rule is on the map even inside another step. Each behavior has a kind (decides, AI, asks you, writes, reads, loops, fallback, stops on error, limit). A stage shows as a diagram with badges and its decisions written on the boxes; click a box for everything about that step. Part boxes count AI calls, decisions and writes.
- **Faster, cheaper deep maps.** A planner reads the call tree and docs; step writers, one per stage, read only their stage's code in parallel; all at low reasoning effort, at most 4 calls at once. What each function does is cached against its code, so remaps and updates reuse unchanged functions. On a 49-file research agent: 36 s and $0.017, against 114 s and $0.016 for one big call; a remap reused 51 functions and cost $0.014.
- **Nothing to press.** Notes sync by themselves when you open Yamori, save, map, review or ask your agent. Your agent session starts in the background with the project panel, so **Chat** opens at once (`yamori.chatAutoStart`).
- **Deeper maps.** Each part is mapped from its call tree (built locally), its README and the code of the functions it reaches, so internal steps, tools and decisions show up: each step lists what it does and up to four details such as limits, fallbacks, the AI or prompt it uses, and what it reads and writes. **Map the system again** upgrades an existing map.
- **Chat in the terminal.** One persistent Claude Code or Codex session per project in the VS Code terminal replaces the chat inside Plan and the request box in System. It knows what you are looking at (editor file, line and selection, Read, the System part, step or file you selected), saves plans onto Yamori's Plan canvas, and can show things in Yamori. With Claude Code the same conversation resumes after a restart. `yamori.chatInTerminal` turns it off.
- **Draggable map.** Drag any box in the System graphs; arrows follow and the place is kept until **Reset layout**.
- **Steer from the system view.** Say what should change; Yamori finds the parts and steps it touches, then previews the change across files (main model, only that code, your notes as rules), applies it all or nothing, and can undo it. Or give it to your agent as a to-do in the notes.
- **Review across parts.** Behavior changes appear as one plain sentence each, with the detail and code diff a click away. Keep or reject them with an optional why; the next change is compared with what you kept.
- **Notes in Obsidian, no setup.** Notes go to the vault the project is in, or the vault Obsidian has open; otherwise `.yamori/notes/`. A system note and part notes with diagrams, a note per step with its history, and a note per code file, so Obsidian's graph view shows the project. Changes, decisions and requests are recorded by themselves; your own notes are never overwritten.
- **The system map for agents.** The MCP server adds `list_stages` (the whole system without arguments), `get_stage` (with system, part and step notes as constraints), `what_changed`, `add_note`, `done`, and a rate-limited, budgeted `propose_change`. Connect also registers Yamori with Cursor when it is installed.
- **Stage token benchmark.** On the sample agentic repo in `test/fixtures/agent-repo` (6 files, Plan → Act → Evaluate), with Claude Code and Haiku for stage work, measured 2026-11-26:

  | Run | Model calls | Input | Cached | Output | Reported cost |
  |---|---|---|---|---|---|
  | First run: AI notes + stage generation | 2 | 2,873 | 8,808 | 4,288 | $0.0028 |
  | Rerun, no code change | 0 | 0 | 0 | 0 | $0 |
  | Incremental: 1 file used by 1 stage | 1 | 2,642 | 8,522 | 894 | $0.0011 |

  The incremental update cost 61% less than the first run. On a repo this small, most input tokens are the Claude Code CLI's own fixed, cached prompt, so total tokens fell only 25%; the gap grows with the number of files a workflow covers, because an update sends one stage and its changed functions, not the workflow.

### 0.27.1 · 2026-11-26

- **Saving updates changed pseudocode.** About two seconds after you save, Yamori rewrites only the blocks whose code changed and reuses the rest from the cache. You see removed steps in red and new steps in green without clicking **Update all**.
- **Visible progress.** Blocks being updated show a spinner in File Flow and in their card. Opening a changed block shows it under File Flow, so the graph stays in view.
- **Cost safety.** Rapid saves are combined into one update, and a newer save cancels an update in progress. Nothing runs automatically for files over 200 KB, during a git rebase or merge, or when it would exceed your daily token budget.
- **Setting.** `yamori.autoRefresh` is `changedBlocks` by default. Use `off` to update only when you click **Update all**, or `wholeFile` to rewrite every block after a change.

### 0.27.0 · 2026-11-25

- **Pseudocode generation uses fewer tokens.** In a pre-release comparison with Open VSX 0.26.19, generating pseudocode for a 302-line Python file used **59% fewer input tokens** (77,028 vs. 186,404, including cache reads and writes). Total tokens fell **51%**, and reported generation cost fell **36%** ($0.384 vs. $0.598). The benchmark used Sonnet for pseudocode, Haiku for the overview or gist, low effort, and refinement off.
- **Smaller updates.** Yamori reuses unchanged pseudocode and starts with the affected blocks and edited lines. File gist and card generation use a smaller prompt with bounded source context. Per-block estimates show how many tokens source and pseudocode would use with the selected model.
- **File Flow in Read.** See how blocks connect, hover to focus on direct dependencies, and open a card for its purpose, steps, and source links. Closing the card brings back the flow.
- **Review and edit beside the source.** See added and removed behavior in cached pseudocode and jump to the matching editor diff. Preview, apply, cancel, or undo an edit from a step.
- **Continue in the editor terminal.** Start a persistent Codex or Claude Code conversation from Read. The terminal displays your question, and Yamori passes the file and block context separately.

### 0.26.17 · 2026-11-22
- **Instant reopen:** explanations and their line links are stored on this computer, keyed by workspace, file path and content hash. Reopening an unchanged file shows the saved pseudocode with no model request. A git commit is kept as metadata and does not change the key.
- **Freshness:** a changed file, a different model or provider, or a new prompt or cache format is never shown as the current explanation. Unchanged blocks keep their pseudocode and their line links move with the code; changed blocks are regenerated when you update.
- **Cache controls:** `yamori.cache` turns saving off. **Yamori: Clear Cached Explanations** still clears it. Saved explanations and name flows stay under about 64 MB, dropping the least recently opened ones. Name-flow answers are cached the same way. The reading-order tour stays local and does not call a model.

### 0.26.16 · 2026-11-22
- **Refresh retries:** keep successful blocks fresh when reconciling mixed historical snapshots against identical current source and dependency context; preserve sub-block boundaries instead of widening them. Older unfinished blocks cannot invalidate completed batches again.
- **Visible batch progress:** show batch number, saved blocks and remaining work, with elapsed time for the whole refresh instead of restarting the timer per batch.

### 0.26.15 · 2026-11-22
- **Review lifecycle:** source changes and Stop cancel background review, retain cached text and mark review as stopped. Discarded results and setup failures always leave a terminal status; late completion cannot replace newer review state. Cancelled drafts no longer restart review just from switching levels.

### 0.26.14 · 2026-11-22
- **Preview validation:** inline formatting alone no longer turns ordinary prose into an unverified source name. Identifier-shaped names and explicit calls/member references still receive source checks; failed checks keep the saved preview without automatic retries.

### 0.26.13 · 2026-11-20
- **Planning reconnect:** a saved Codex thread owned by another writer is left alone; start a new read-only planning thread with saved context before sending one model turn. Other provider failures still stop without retrying inference.
- **Chat-to-plan continuity:** plan revisions receive bounded recent shared conversation, so requests referring to the previous chat carry their context across modes. Saved steps remain intact on failure.

### 0.26.12 · 2026-11-20
- **Selective source refresh:** match cached explanations to parsed current definitions and previously fresh source, remove obsolete blocks, preserve unchanged explanations, and update affected blocks in bounded batches. Successful batches are cached even when another fails fidelity review.
- **Precise dependencies:** invalidate actual callers, not every block; dependency signatures include reachable helpers and module context. Patch writers and reviewers receive affected source, with stable boundaries enforced locally. No project-specific exceptions or automatic generation on file changes.

### 0.26.11 · 2026-11-20
- **Visible implementation activity:** show newer Codex tool events and completion, provider retry notices and waiting states. Report long periods without new activity instead of silently looking frozen. Non-retryable provider errors stop with the saved plan intact. No automatic implementation retry.

### 0.26.10 · 2026-11-20
- **Action-first plans:** explain proposed work as “I’ll do this, so this happens” using everyday words, short sentences and concrete reasons. Explain source names by their role and preserve important constraints without turning proposals into compressed checklists. Applies to drafts and revisions without an extra model request.

### 0.26.9 · 2026-11-20
- **Single-pass planning:** use the selected model once by default; legacy auto is an alias. No paid starting-file ranking, automatic second draft or preview fallback. Validation preserves the saved plan for explicit retry.
- **Retained investigation:** source edits send changed-file notices instead of replacing the planning session. Keep the separate implementation permission boundary and remove duplicate plan context from its bounded handoff.
- **Workflow usage:** persist planning response usage and duration even when validation rejects it, and deduplicate shared call IDs in the display.

### 0.26.8 · 2026-11-20
- **Understandable change proposals:** drafts and revisions explain the current situation, proposed difference and concrete consequence before implementation names. Preserve meaningful constraints, distinguish intended refactoring from behavior changes, and check clarity in the existing request.

### 0.26.7 · 2026-11-20
- **Quiet chat:** working updates and command output stay in collapsed Activity instead of the conversation. Native session imports distinguish interim updates from answers, including previously imported updates.
- **Clear speakers:** blue user messages and green Yamori labels, with explicit names in the terminal and accessible fallback.

### 0.26.6 · 2026-11-19
- **Stable inline questions:** ignore selections and focus changes from embedded comment editors. Keep drafts when the source highlight collapses; dismiss explicitly or replace the selection instead. Add a visible Dismiss action.
- **Complete plan canvas:** render every affected file even before its map metadata arrives. Fit planning independently of the project map, with a readable initial zoom centred on the most affected file.

### 0.26.5 · 2026-11-19
- **Ask from a selection:** highlighting source code opens a native inline question field. Ask Yamori sends the question, file/range and frozen selected code to project chat. Deselecting dismisses an unsent field; context-menu and keyboard actions are also available. No AI request is made until Submit.

### 0.26.4 · 2026-11-19
- **Complete saved plans:** verify referenced source directly when the overview index is capped. Targeted tool reads can index a missing source file, and drafts with unverifiable steps keep the previous plan instead of silently saving a partial plan.
- **Current editor context:** chat, planning and work receive the current source tab, cursor, selected lines and a bounded unsaved excerpt. Retain the last source editor while Yamori has focus; exclude files outside the current project.
- **Commit evidence:** read-only git_history lets planning inspect local authorship before attributing a change to someone. Broader-plan requests can investigate missing scope.

### 0.26.3 · 2026-11-19
- **Live branch in focused chat:** redraw the conversation header when local Git HEAD changes, even if the plan and messages stay unchanged. Refresh local branch metadata on webview focus as well; no model call is needed.

### 0.26.2 · 2026-11-19
- **Clean conversation handoffs:** session titles derived from internal prompts use the actual user request instead. Picker labels and handoff messages never print Yamori context wrappers. Existing cached handoff labels are repaired locally without changing native sessions or removing chat history.

### 0.26.1 · 2026-11-19
- **Live replies:** Codex and Claude chat/work responses appear as provider text arrives, without a second AI request. JSON transport and private reasoning remain hidden; completion is still validated before saving the final reply.
- **Stable canvas:** streaming updates the reply in place, preserving the canvas, input and cursor. The canvas is the default, with a highlighted < > Focus chat control to expand the conversation and return.

### 0.26.0 · 2026-11-19
- **One project conversation:** Chat, Plan and Work share durable local history, including reviewed changes, execution activity and outcomes. Completed plans leave the canvas while the discussion remains. New plans preserve the transcript.
- **Native continuation:** coding and chat turns retain Codex/Claude Code session references. Continue from an existing local conversation, sync external updates on return, or reopen the same native session in an agent terminal. Copy/paste handoffs support web-only chats and other providers.
- **Focused chat:** use the conversation as the main view before and after a plan, with an explicit return to the canvas. Older messages can be loaded locally, and agents can retrieve complete earlier context using get_conversation.
- **AI-free branch indicator:** read Git HEAD directly, including worktrees and detached HEAD; refresh on local Git changes and focus without a model call.

### 0.25.1 · 2026-11-19
- **Autonomous planning access:** provide bundled read-only project tools in Restricted Mode, and start native planning sessions in the actual project folder. Preserve the initial request as later conversation grows; ask about missing intent rather than requesting project attachments.
- **Profiles, prompts and configuration:** discover Markdown, text, JSON, YAML, TOML and INI/CFG files; search and read them with source line numbers. Text context has no invented code definitions or dependency edges.
- **Branch evidence:** a read-only git_changes tool reports the current branch, changed paths and optional patches without fetching or modifying the repository.
- **Trust handoff:** approving an implementation in Restricted Mode opens Workspace Trust and resumes the approved plan after the user grants trust. MCP startup failures become access errors rather than repeated attachment requests.

### 0.25.0 · 2026-11-19
- **Approve & implement:** start a separate coding run with the selected Codex or Claude model and effort. The planning agent remains read-only until approval. Active steps and notes are passed to the coding agent; rejected and finished changes are excluded.
- **Completion cleanup:** successful implementations leave the canvas and are retained in local history, with a completion summary and token report. Errors, blocked operations, missing completion reports and cancellation retain the plan.
- **Execution activity:** see file/tool activity and provider-reported token usage, stop a run, and prevent duplicate approvals or late plan edits during implementation.

### 0.24.7 · 2026-11-19
- **Visible plan details:** selected changes render directly, without a hidden disclosure controlling their text. The inspector uses available window height above the terminal, with its own scroll area; file rejection follows the description.

### 0.24.6 · 2026-11-19
- **Recover invalid step links:** keep readable pseudocode and valid links when an AI returns duplicate, blank-line or out-of-range step links. Disabled links are reported and the notice is cached. No automatic second model request is needed.
- **Notebook numbering:** generation prompts explicitly use extracted code-view line marks rather than notebook JSON or cell-local numbers. Block ranges remain strictly validated.

### 0.24.5 · 2026-11-19
- **Reliable terminal input:** a wrapping prompt editor preserves multiline text, Unicode, selection and caret position without repeated terminal redraws. Enter sends; Shift+Enter adds a line.
- **Resizable planning terminal:** drag its top edge up or down, or focus it and use arrow keys. Double-click resets; the webview remembers the height and the inspector adjusts with it.

### 0.24.4 · 2026-11-19
- **Fresh planning context:** discover files after pulls before planning; scoped agent tools rescan too and retry discovery for previously unknown paths.
- **Notebook support:** map and explain notebook code cells, excluding outputs and execution metadata from prompts and source hashes. Source links open the notebook cell.
- **Efficient cached refresh:** incremental requests send affected source blocks, keep untouched cached sections, and add independent new functions without invalidating the rest of the file.
- **Cache consistency:** project-context updates no longer suggest regenerating unchanged code, and shutdown waits for pending cache writes.

### 0.24.3 · 2026-11-19
- **Paths on the plan canvas:** affected and proposed files show their project-relative locations, wrapping long paths.
- **Open affected source:** click an existing file to open it in the editor at the first affected line. Expanded change rows still open plan details; proposed new files are not created or opened as existing source.

### 0.24.2 · 2026-11-19
- **Readable plan details:** show the complete change description without a three-line clamp or yellow text box.
- **Stable inspector layout:** fixed file/change navigation and a separate scrolling body prevent actions from overlapping text. Change type remains visible as a small colored label.

### 0.24.1 · 2026-11-19
- **Plan inspector repair:** saved plans with token usage render their change descriptions, actions and pseudocode again.
- **Visible planning activity:** current agent action and expandable recent activity stay visible in the terminal.
- **Clear token accounting:** input, output and cached reads are shown separately, with pending usage and context estimates labeled. Revisions and pseudocode previews retain their reported usage.

### 0.24.0 · 2026-11-19
- **Direct planning:** open Plan from the editor title or the reader header, without navigating through the project guide.
- **Clearer navigation:** persistent plan actions, visible change picker, previous/next navigation and a labeled Close button.
- **Native Plan modes:** Codex uses native Plan collaboration mode; Claude keeps Plan mode when resuming. Codex clarification questions pause and resume the same turn inside Yamori.
- **One pseudocode preview:** green additions, yellow changes, and unchanged context together, with no repeated before section.
- **Clearer proposals:** short, concrete change descriptions explain inputs, results and essential programming context.
- **Proposed new files:** visible on the canvas without fictional source lines; details stay open through updates.
- **Efficient plan conversations:** retained provider sessions, focused plan patches and local pseudocode comparisons reuse previous investigation.

### 0.23.0
- **A knowledge server for your own agents.** One command registers it with Claude Code
  and Codex: the project map, Start here, search, tests, the glossary and pseudocode by
  outline, block or line, in every project, even with VS Code closed. It only registers
  the server; your settings and instruction files are not changed.
- **Agents share what they learn:** a file with no pseudocode can get it from the
  agent's own reading; Yamori validates it and shows it labelled, with no AI request.
- **Pseudocode is checked against its source** with fixed rules, no AI: invented names,
  numbers the source doesn't contain, and side effects left unsaid. The reader shows a
  note on an affected block; an agent's save with an invented name is refused with the
  cause (inspired by Skill-as-Pseudocode's deterministic verification).
- Optional `.yamori/` text copies of pseudocode (`yamori.pseudocodeMirror`, off by default).

### 0.22.0 · 2026-11-16
- **Search a name in the project guide.** A search box in the guide's header highlights
  every file that mentions a variable, function or term, with counts on the map and a
  side panel of matching lines.
- **Explain how it flows.** The selected AI traces the name across those files and
  answers as reader-style blocks: the same writing rules, styles and line links as
  explanations.

### 0.21.0 · 2026-11-16
- **Guided AI setup.** A setup screen shows which AI is installed and signed in, with
  one button each: Use, Sign in or Install. Claude Code bundled with Claude Desktop and
  Codex bundled with the ChatGPT app are found automatically.
- **Parallel parts.** Bigger files are explained by several requests at once, split
  locally into whole functions and classes: a 354-line file's draft went from 49.5 s to 17.4 s.
- **Background review** on a cheaper model (Sonnet under Opus, Codex's balanced model
  under its default). The draft is readable at once; improved blocks swap in later.
- AI notes start on their own, wait for setup instead of failing, and run in Restricted Mode.
- Refinement defaults to 1 step.

### 0.20.0 · 2026-11-16
- **Project guide**: Start here reading order by folder, a draggable folder-box map,
  AI notes and a project glossary, built with a tree-sitter repo map.
- The AI can look up project knowledge while writing (a read-only MCP server).
- Guided tours with the next file prepared ahead, project-name links, hovers and CodeLens.
- **Run a function with its tests** as a notebook cell, with an AI simulation fallback.
- Live progress, low effort by default, fast models for quick jobs, compact step links.
- Detail levels are now Overview and Logic.

### 0.19.4 · 2026-11-15
- Model responses are validated with compiled Ajv schemas.

### 0.19.3 · 2026-11-15
- Evaluator references are repaired, and drafts are kept when review cannot finish.

### 0.19.2 · 2026-11-14
- Drafts stream during review; redundant refinement passes stop early.

### 0.19.1 · 2026-11-14
- Discoverable on first install and usable in Restricted Mode.

### 0.19.0 · 2026-11-14
- Difficult blocks are refined with independent uncertainty and reading-cost reviews.

### 0.18.0 · 2026-11-14
- Explanations and drafts are cached locally, with selective refresh when source changes.

### 0.17.0 · 2026-11-14
- Redesign: a logic map, rich block editing and the pixel interface.

### 0.16.0 – 0.16.1 · 2026-11-14
- A file-aware one-click launcher in the editor toolbar and status bar, with Yamori branding.

### 0.15.0 · 2026-11-13
- Windows CLI discovery and Claude connection onboarding.

### 0.12.0 · 2026-11-13
- High-contrast Paper and Slate reading palettes.

### 0.11.0 · 2026-11-13
- Focused reading boxes and grounded algorithm explanations.

### 0.10.0 · 2026-11-13
- Denser pseudocode and a better reading layout.

### 0.9.0 · 2026-11-13
- First release: programming context, made explicit.

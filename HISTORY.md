# Release history

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

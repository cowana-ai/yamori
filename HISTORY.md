# Release history

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

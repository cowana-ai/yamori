# Reading code with Yamori

[← Yamori](../README.md) · [Getting started](getting-started.md) · [Reading](reading.md) · [Project guide](project-guide.md) · [Tests](tests.md) · [Models & speed](models.md) · [Development](development.md)

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
  [Run a function with its tests](tests.md).
- **See the whole project.** **Project guide** shows, folder by folder, which files to read first, plus a map of files grouped in folder boxes. Explanations of mapped files know the file's role, its neighbours and terms defined elsewhere, and the AI can look up more. See [Project guide](project-guide.md).

The reading panel uses a minimal black-and-white pixel style: crisp edges, a tiny
pixel gecko samurai and subtle feedback on navigation and loading. One idea stays
in focus. Steps, notes and equations remain clearly spaced and easy to read.
Model, provider and effort choices sit behind one compact settings control.
Keyboard navigation, high-contrast themes and reduced-motion preferences are supported.

## Pixel interface

Click **Theme** beside Refresh, or run **Yamori: Choose Reading Colors**.
Choose **Pixel Light**, **Pixel Dark**, or **Follow editor**. Your existing palette
preference is kept, using the new monochrome look. Switching themes changes no
explanation and uses no provider quota.

The interface uses contrast, typography, spacing and labels to distinguish
control flow, notes and outputs. Motion is limited to a tiny loading step,
button feedback and a short block transition. Reduced motion disables it.
The gecko toolbar logo and status-bar shortcut remain available in the editor.

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

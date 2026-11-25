# Models, speed and review

[← Yamori](../README.md) · [Getting started](getting-started.md) · [Reading](reading.md) · [Project guide](project-guide.md) · [Tests](tests.md) · [Models & speed](models.md) · [Agents](agents.md) · [Development](development.md)

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

Reopening an unchanged file does not call the model. The saved explanation and its line links are read from this computer; in tests that lookup is a few local file reads, against 17 seconds for a new draft of a 354-line file. A change keeps the saved pseudocode for blocks whose source is the same and moves their line links. Updating asks the model only for the blocks that changed. `yamori.cache` turns this off.

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
- Each request receives its assigned source, supporting context and an outline marking which
  other parts exist so it names them instead of re-explaining them. Part 1 also
  writes the title and summary.
- Blocks appear as each part finishes; the draft is ready about when the slowest part is.
- A section that strays outside its part is trimmed to it. A failed part is retried
  once, using the same source scope.
- Used for Logic on Python, JavaScript/TypeScript, Go, Java and Rust files big
  enough for two parts (about 50 lines). Set 1 to always use one request.

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

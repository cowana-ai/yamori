<p align="center">
  <img src="yamori.png" width="210" alt="Yamori, a teal gecko samurai with a white robe and staff">
</p>

<h1 align="center">Yamori</h1>

<p align="center"><strong>Programming context, made explicit.</strong></p>
<p align="center">Cursor &amp; VS Code · Codex &amp; Claude Code · Three levels of detail</p>

**Yamori is for someone who can handle difficult ideas but needs the programming context made explicit.**

You might follow the mathematics in a paper and still lose time tracing callbacks,
mutable state or a model's training loop. Yamori turns code into concise,
navigable pseudocode inside your editor, explaining the connections that make the
implementation understandable.

Its mission is to help capable people with less programming experience reason
independently, navigate unfamiliar code and become more efficient. Useful
mathematics stays precise. Programming conventions and consequential details get
a short explanation where they matter.

[See an example](#from-a-call-to-an-idea) · [Get started](#get-started) · [Choose your model](#models-and-reasoning-effort) · [Develop](#development)

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
| **Logic** | Short steps, meaningful decisions and useful mathematics. |
| **Detailed** | Closer explanations of operations, boundaries and side effects. |

- **Stay connected to the source.** Hover over a mapped step to highlight its code. Click to jump to the corresponding lines.
- **Understand custom calls.** Yamori uses available project definitions to explain a call's role, inputs and output.
- **See the reasoning that matters.** Important source comments are preserved. Brief notes explain non-obvious consequences, assumptions and guards.
- **Follow generation live.** Pseudocode streams into the panel, with activity updates and a Stop button.
- **Make an explanation your own.** Copy a block, edit it in place, then ask Codex or Claude to update that block. Approved edits are cached; other views are rebuilt when requested.
- **Move between views quickly.** Generation prepares the lower-detail views too. Returning to them uses memory or disk cache.

Blocks use short, casual action lines, phase breaks and sparse emphasis on behavior-defining phrases. Terms such as state and level get a short definition note on first use. Ordinary connective words stay plain; definition notes are visually subordinate and are not numbered as actions. Wrapped lines align beneath their own text. Useful equations render as math.
Simple actions stay in words. Light and dark editor themes, keyboard navigation
and reduced-motion preferences are supported.

## Get started

Yamori is an early personal extension, currently distributed as a VSIX.

1. Download **yamori-0.10.0.vsix** from the [latest prerelease](https://github.com/cowana-ai/yamori/releases/tag/v0.10.0).
2. In Cursor or VS Code, open **Extensions → … → Install from VSIX** and select it.
3. Open a code file, then run **Yamori: Read as Pseudocode** from the Command Palette.
4. Choose **Overview**, **Logic** or **Detailed** in the reading panel.

The editor toolbar's book button opens Yamori too. Use **⌘⌥P** on macOS or
**Ctrl+Alt+P** elsewhere. Select a range first to explain only those lines.
After updating an installed version, run **Developer: Reload Window**.

Try the included [demo.py](demo.py), a small logistic-regression example.
Right-click a folder and choose **Yamori: Read a Folder or Project** to select
multiple files. Files are processed sequentially; completed results remain cached
if you stop.

### Connect a provider

Yamori uses a local CLI's existing sign-in. It does not request or copy your
subscription tokens.

| Provider | Setup |
| --- | --- |
| **Codex** | Install Codex and sign in with `codex login`. Yamori also detects the macOS app-bundled CLI. |
| **Claude Code** | Install Claude Code and sign in by running `claude` in a terminal. |

Choose the provider at the top of the panel. Existing eligible subscription access
uses the provider's allowance; API-key authentication can use API billing.
Account limits still apply. Optional executable paths are available under
**Settings → Yamori** if automatic detection cannot find your CLI.

## Models and reasoning effort

Use the **model ▾** and **Effort: … ▾** controls, or the commands **Yamori:
Choose Model** and **Yamori: Choose Effort**.

- **Codex:** model choices and supported effort levels come from its live catalog.
- **Claude Code:** choose Sonnet, Opus, Haiku or Fable, or enter an exact model ID. Known model families use their documented effort levels.
- **Provider default:** lets the CLI choose. Unrecognized custom models offer default effort until their capabilities are known.

Model choices are remembered per provider; effort choices are remembered per
provider and model. Choosing either starts no inference. The choice applies to
the next Refresh, new generation or block update.

**Detail controls the explanation. Effort controls the model's reasoning.**
Higher effort can take longer and use more quota without asking for a longer
explanation. The panel distinguishes your next-request settings from the model
that generated the current result. Effort is labeled as requested because CLI
policies can cap or override it.

## Edit the explanation

Click **Edit** on a block, change its pseudocode and optionally add an instruction. Use `**key phrases**` for emphasis and `$...$` for LaTeX equations.
Press **Update with Codex/Claude Code** to revise and cache that block. Neighboring
blocks retain their text. Failed or cancelled updates keep the approved result
and leave the draft editable.

Edits change the pseudocode. The underlying source file stays unchanged. Other
detail levels derive from your approved explanation when selected, preserving
your intended changes across views and editor restarts.

<details>
<summary><strong>How Yamori explains code</strong></summary>

The generation and block-edit prompts explicitly use this communication objective:

$$
\min_X H(B \mid X,K) + \lambda\,\mathrm{ReadCost}(X)
$$

Here **B** is relevant code behavior, **X** is the explanation and **K** is the reader's existing knowledge. Reading cost includes length, jargon, nested clauses and visual clutter. Semantic fidelity is a hard constraint. The agent uses this as a qualitative criterion: keep details that distinguish behavior, add short definitions when they remove confusion, and cut low-value wording. It does not estimate entropy numerically.

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

Explanations are saved in Cursor/VS Code extension storage, outside your project,
under `globalStorage/chingis-local.yamori/cache/`. Generated views are separated
by source, location, provider, model, effort and approved revision. Up to 100
generated responses are retained. Approved user edits are stored separately in
`cache/revisions/` until cleared.

Run **Yamori: Clear Cached Explanations** to remove both generated views and
approved revisions. Changes to source or collected definitions invalidate
explanations; source links are disabled when the displayed version is stale.

Yamori has no telemetry or account service. Translation requests run in temporary
directories with tools disabled. Partial output is never cached, and source
links activate after final validation. The activity trail shows connection,
writing and validation phases rather than private reasoning.

Files or selections are limited to 120 KB. Folder discovery is limited to 500
source files. Requests allow up to three minutes at Low, five at Medium/default,
and ten at higher effort, with Stop available throughout. A trusted local
workspace and VS Code 1.90+ or a compatible Cursor version are required.

</details>

## Development

The extension has no dependency-install or build step for its application code.
Use Node.js 20+ to run the checks:

```sh
npm test
npm run check
```

Launch an extension development host with:

```sh
cursor --extensionDevelopmentPath=/absolute/path/to/yamori
```

Build the installer with the VS Code packaging CLI:

```sh
npx @vscode/vsce package --no-dependencies
```

| File | Purpose |
| --- | --- |
| [extension.js](extension.js) | Editor integration, model/effort pickers, source context and cache. |
| [engine.js](engine.js) | Translation prompts, provider processes and response validation. |
| [panel.js](panel.js) | Reading panel, block editing, source navigation and math rendering. |
| [test.js](test.js) | Offline provider, UI and extension-workflow checks. |
| [demo.py](demo.py) | A small example to read with Yamori. |

**Validation:** 27 offline tests passed. Live Codex checks cover model selection,
Medium effort, block edits and full-file DKDM explanations. Claude CLI flags and
response handling are tested with a mock executable; live Claude generation has
not yet been verified.

## Credits and license

Application code is [MIT licensed](LICENSE). Bundled [KaTeX](https://katex.org/)
0.19.1 is MIT licensed, with its full notice retained in `katex.min.js`. It runs
locally to produce MathML without font downloads or network requests.

The gecko samurai mascot was adapted from a user-supplied illustration using
image generation. The mascot is separate artwork and is not included in the
application-code MIT license.

Provider integration references: [Codex app-server](https://learn.chatgpt.com/docs/app-server)
and [Claude Code model configuration](https://code.claude.com/docs/en/model-config).

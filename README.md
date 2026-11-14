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

- **Start with the logic map.** See the script’s named ideas first. Open one block at a time, use Previous/Next, or return to the map. Moving around starts no AI request. Unsaved drafts are marked on the map and reopen in the same editor.
- **Work across files.** Click the book icon in a source editor to open **filename.py · Yamori** beside your code. Each file gets its own tab in the same reader column. Reopening a file reuses its tab and running request. The **▤ Files** button switches between open/prepared explanations or opens another project file. Each tab keeps its detail level and unsaved block drafts; switching back restores the source file without moving the caret.
- **Stay connected to the source.** Hover over a mapped step to highlight its code. Click to jump to the corresponding lines.
- **Understand custom calls.** Yamori uses available project definitions to explain a call's role, inputs and output.
- **See the reasoning that matters.** Important source comments are preserved. Brief notes explain non-obvious consequences, assumptions and guards.
- **Follow generation live.** Pseudocode streams into the panel, with activity updates and a Stop button.
- **Improve a block in one click.** Use **Explain better**, **Make shorter** or **Show example** beneath a block. Each asks your selected provider, model and effort to revise only that explanation. Results are cached; other detail levels update when opened. Buttons are disabled during generation or when the source is stale.
- **Make an explanation your own.** Copy a block, edit it in place, then ask Codex or Claude to update that block. Approved edits are cached; other views are rebuilt when requested.
- **Move between views quickly.** Generation prepares the lower-detail views too. Returning to them uses memory or disk cache.

The reading panel uses a minimal black-and-white pixel style: crisp edges, a tiny
pixel gecko samurai and subtle feedback on navigation and loading. One idea stays
in focus. Steps, notes and equations remain clearly spaced and easy to read.
Model, provider and effort choices sit behind one compact settings control.
Keyboard navigation, high-contrast themes and reduced-motion preferences are supported.

## Get started

Yamori is an early preview. Its public extension ID is **`cowana-ai.yamori`**.

1. Open a code file in Cursor or VS Code.
2. Click the **Yamori gecko icon** at the top right of the script, or **Yamori** in the bottom status bar.
3. Choose **Overview**, **Logic** or **Detailed** in the reading panel.

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cowana-ai.yamori),
or search for **Yamori** by **Yamori** (`cowana-ai`) in VS Code’s Extensions panel.
For Cursor, Yamori is published on [Open VSX](https://open-vsx.org/extension/cowana-ai/yamori). New versions may take time to appear through Cursor’s extension search.
For manual installation, download a VSIX from [GitHub Releases](https://github.com/cowana-ai/yamori/releases),
then choose **Extensions → … → Install from VSIX**. If you previously installed
the local `chingis-local.yamori` preview, disable that extension before using
`cowana-ai.yamori` to avoid duplicate commands. The public publisher ID has its
own extension storage; the old preview’s stored explanations remain in its old folder.

The toolbar uses the Yamori samurai logo; the bottom button uses a compact gecko
mark that follows the editor’s text color. Both buttons follow the active script automatically, starting no AI request until
you click. Each file opens its own explanation tab; clicking again reuses it.
The bottom button names its target file on hover and appears after startup,
without first running a command. It hides when no local source editor is active.
The Command Palette action **Yamori: Read as Pseudocode** is still available.
Use **⌘⌥P** on macOS or
**Ctrl+Alt+P** elsewhere. Select a range first to explain only those lines.
After updating an installed version, run **Developer: Reload Window**.

Try the included [demo.py](demo.py), a small logistic-regression example.
Right-click a folder and choose **Yamori: Read a Folder or Project** to select
multiple files. Files are prepared sequentially without opening a stack of tabs. Use **Yamori: Switch Files** or **▤ Files** to open a prepared explanation. Completed results remain cached
if you stop.

### Connect a provider

Yamori uses a local CLI's existing sign-in. It does not request or copy your
subscription tokens.

| Provider | Setup |
| --- | --- |
| **Codex** | Install Codex and sign in with `codex login`. Yamori also detects the macOS app-bundled CLI. |
| **Claude Code** | Run **Yamori: Connect Claude**. It opens Claude Code’s browser sign-in in a visible editor terminal. If the CLI is missing, choose **Install and sign in** to run Anthropic’s official installer first. |

Choose the provider at the top of the panel. Existing eligible subscription access
uses the provider's allowance; API-key authentication can use API billing.
Account limits still apply. Optional executable paths are available under
**Settings → Yamori** if automatic detection cannot find your CLI.

For Claude, a **Connect Claude** button also appears on an empty reading panel
or after an error. Finish the browser sign-in, then press **Refresh**. Selecting
a Claude model only chooses the model; it does not sign you in.

**Claude Desktop alone is not enough:** Yamori needs the separate Claude Code
CLI for programmatic generation. The connection action can install it with your
approval, then let Claude handle the account sign-in. See Anthropic’s
[setup guide](https://code.claude.com/docs/en/setup) and
[CLI reference](https://code.claude.com/docs/en/cli-reference).

On Windows, Yamori detects native installs in `%USERPROFILE%\\.local\\bin`,
executables on `PATH`, and standard npm launchers in `%APPDATA%\\npm`, including
paths with spaces. npm launchers are resolved to their package entry point and
run without a command shell. Supported Claude versions use safe mode to preserve
authentication and network settings while excluding customizations; older versions
retain the isolated fallback. Update Claude Code if your older installation needs
user settings to authenticate.

## Pixel interface

Click **Theme** beside Refresh, or run **Yamori: Choose Reading Colors**.
Choose **Pixel Light**, **Pixel Dark**, or **Follow editor**. Your existing palette
preference is kept, using the new monochrome look. Switching themes changes no
explanation and uses no provider quota.

The interface uses contrast, typography, spacing and labels to distinguish
control flow, notes and outputs. Motion is limited to a tiny loading step,
button feedback and a short block transition. Reduced motion disables it.
The gecko toolbar logo and status-bar shortcut remain available in the editor.

## Models and reasoning effort

Open the **provider · model ▾** menu for model and effort controls, or use **Yamori:
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

Explanations are saved in Cursor/VS Code extension storage, outside your project,
under `globalStorage/cowana-ai.yamori/cache/`. Generated views are separated
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

The extension has no dependency-install or build step for its application code. CodeMirror and KaTeX are vendored as local bundles; no CDN is used.
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

**Validation:** 35 offline tests passed, including real CodeMirror formatting transactions, map-to-block navigation, correct block indexes, draft retention, startup launcher visibility, file-targeted one-click opening without automatic inference, simulated Windows executable/npm discovery, literal-argument JS launching, explicit install/login actions, Claude safe-mode compatibility, stream parsing, independent file tabs, concurrent requests, cache reuse, block reactions and source restoration. Windows filesystem discovery is simulated on macOS; a live Windows sign-in has not been verified. Browser checks cover 360 px and 480 px panels, normal typing, Tab and continued indentation, undo/redo, deletion around emphasized text, equation editing, map navigation with retained undo history, theme changes and a failed update retaining the draft. No provider inference was used for these UI checks. Live Codex checks include recognition of DKDM’s Heun-style predictor–corrector update and a brief explanation of why it averages velocities, plus model selection,
Medium effort, block edits and full-file DKDM explanations. Claude CLI flags and
response handling are tested with a mock executable; live Claude generation has
not yet been verified.

## Credits and license

Application code is [MIT licensed](LICENSE). Bundled [KaTeX](https://katex.org/)
0.19.1 is MIT licensed, with its full notice retained in `katex.min.js`. It runs
locally to produce MathML without font downloads or network requests.

Bundled CodeMirror 6 and its dependencies are MIT licensed, with their notices retained in `editor.min.js`. The editor adapter is in `panel.js`. The gecko samurai mascot was adapted from a user-supplied illustration using
image generation. The mascot is separate artwork and is not included in the
application-code MIT license.

Provider integration references: [Codex app-server](https://learn.chatgpt.com/docs/app-server)
and [Claude Code model configuration](https://code.claude.com/docs/en/model-config).

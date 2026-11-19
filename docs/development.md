# Development

[← Yamori](../README.md) · [Getting started](getting-started.md) · [Reading](reading.md) · [Project guide](project-guide.md) · [Tests](tests.md) · [Models & speed](models.md) · [Agents](agents.md) · [Development](development.md)

The packaged extension needs no dependency installation. CodeMirror, KaTeX,
jsdiff and precompiled Ajv validators are local bundles; no CDN is used.
Use Node.js 20+ to run the checks:

```sh
npm test
npm run check
```

When changing a schema, install the pinned development dependencies and rebuild
the standalone validators before running the checks:

```sh
npm ci
npm run build:validation
```

The tree-sitter runtime and grammars in `vendor/tree-sitter/` are copied from the pinned
`@vscode/tree-sitter-wasm` package. After updating it, run `npm run build:parser`
and commit `vendor/tree-sitter/`. They are about 4.4 MB unpacked; the packaged VSIX grows to about 1 MB.

Only trusted, repository-owned schemas are compiled during the build. The
extension does not load Ajv or compile schemas at runtime. Commit the generated
`src/ai/validation.min.js` alongside schema changes.

Launch an extension development host with:

```sh
code --extensionDevelopmentPath=/absolute/path/to/yamori
```

Build the installer with the VS Code packaging CLI:

```sh
npx @vscode/vsce package --no-dependencies
```

```
src/
  extension.js        Entry point: activation, readers, commands, setup gate, test runs
  ai/
    engine.js         Prompts, Claude Code and Codex processes, parallel parts, review
    schemas.js        JSON Schemas; builds validation.min.js
    verify.js         Fixed-rule checks of pseudocode against its source (no AI)
    validation.min.js Standalone Ajv validators (generated)
  views/
    reader.js         The reading panel and the shared reading styles
    guide.js          Project guide: Start here, the map, search and flows
    setup.js          The Set up Yamori screen
  project/
    graph.js          Scan, imports, ranking, reading paths, layouts, parts, tests
    mcp.js            Read-only knowledge server the AI can query (MCP)
  storage/
    cache.js          Atomic local storage, source alignment, change analysis
  runner/
    trace.py          Runs one unit test and records how a function ran
vendor/               KaTeX, CodeMirror, jsdiff and tree-sitter/ (runtime + grammars)
media/                Icon, toolbar glyph font, README screenshots
test/                 Offline test suite (no AI requests)
examples/             demo.py to try Yamori on
docs/                 User and developer documentation
```

**Validation:** 107 automated tests cover the project guide and lookups (tree-sitter extraction for
every bundled grammar, import resolution per language, entry points and reading
paths, incremental rescans, deterministic layouts, bounded explanation context,
note validation, folder reading orders, folder boxes that stay structured at any
size, Start here and map messages, glossary links, the MCP server over stdio with
mapped-only and bounded reads, Claude and Codex lookup flags and approvals, the
no-lookup fallback, unit-test discovery and association, the Python runner on real tests (inputs, every executed line, outputs, failures, unittest, fixtures that need pytest, file and image descriptions), real runs gated by trust and a once-per-folder question, AI simulations limited to the function's lines, the notebook cell with emoji values and step highlighting, fast models for quick jobs (a parallel Overview, compact step links, three note batches at a time, Codex's catalog fast model), guide search (whole-word name hits, defining files first, highlighted map nodes with counts, the AI flow explanation as reader-style blocks with links clamped to the searched files, setup first when no AI is ready), parallel parts (local part planning from whole definitions, at most N requests at once, sections kept inside their part, one retry then a whole-file fallback, a draft that never waits long for a slow Overview), background review (draft readable at once, improved blocks swapped in and cached, dropped after edits or refreshes, kept through level switches, fidelity warnings with Retry review, pending drafts resumed), the review model one tier below the writer, the setup screen (Claude Desktop's bundled Claude Code, sign-in status from each CLI without a model request, one action per AI, visible install and sign-in terminals, continuing by itself once sign-in works, setup before the first explanation, switching open readers), automatic AI notes (quiet, changed files only, asks first for large projects, no retry loops, waiting for setup instead of failing, also in Restricted Mode), the map-first guide with Details on demand, the reader's tour bar and one-step-ahead preparation (only in a tour, only when not cached, off with its setting), project-name links that open the defining block, editor hovers with escaped text and only Yamori's commands trusted, CodeLens that hides on changed code, the plain-language reader controls, the live progress card and its stages (thinking token counts, never thinking text), effort defaults, the folder-grouped file
picker and an end-to-end guide → notes → explanation flow that rejects symlinked
files outside the project), strict schema validation, field-path errors,
cache compatibility, loading without development dependencies or runtime schema
compilation, evaluator-reference repair, incomplete-review caching/retry, meaningful error states, streaming before review, compact context, early completion/plateau stops, Restricted Mode TypeScript opening,
user-only CLI settings, blocked definition lookups, first-use provider selection,
parallel reviewers, fidelity gating, scoped refinement, local caching/drafts,
source changes and cancellation. An isolated native VS Code profile opened and
explained a TypeScript file while remaining untrusted, ignored project-controlled
CLI/usage settings, and activated Yamori automatically. A separate native VS Code check reproduced persistently malformed evaluator
feedback, retained both explanation blocks as an incomplete-review draft, and
reopened them from cache with no inference. Earlier native checks covered file
watching, independent tabs and cache reuse.

Browser fixture checks cover narrow panels, math, editing/undo, navigation,
cache warnings and retained drafts. A live Codex check selected an agreement-count
identity, skipped a seed getter and retained the improved result after one
refinement step. Live Codex also verified DKDM explanations, model/effort selection
and block edits. Live Claude Code 2.1.325 (Haiku) and Codex 0.169 runs generated
explanations with Yamori's lookup server loaded, and forced lookups returned
glossary data through both; the same Claude check confirmed that `--safe-mode`
drops the server. Windows discovery is tested with fixtures; live Windows
sign-in remains unverified.

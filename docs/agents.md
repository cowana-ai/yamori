# Yamori for your own agents

[← Yamori](../README.md) · [Getting started](getting-started.md) · [Reading](reading.md) · [Project guide](project-guide.md) · [Tests](tests.md) · [Models & speed](models.md) · [Agents](agents.md) · [Development](development.md)

Your own Claude Code and Codex sessions can look things up in Yamori's project map and its pseudocode. When they read a file to understand it, they can also save pseudocode for it, so you see that explanation in Yamori without pressing a button.

## Connect once

Run **Yamori: Connect Claude Code & Codex**, or press **Connect agents** in the Project guide. Yamori asks first. It only registers its knowledge server with each CLI:

- Claude Code: `claude mcp add --scope user yamori …`
- Codex: `codex mcp add yamori …`

It does not edit your settings, hooks or instruction files (`CLAUDE.md`, `AGENTS.md`). A small launcher in Yamori's storage folder starts the server from the installed extension, so updating Yamori never breaks the registration. **Yamori: Disconnect Claude Code & Codex** removes it. If an earlier version of Yamori added hooks or a rules block, connecting or disconnecting removes those too, and leaves everything of yours alone.

The server finds the project from the agent's working folder and maps it by itself if needed, so it works with VS Code closed. Files that changed since the last scan are rescanned before it answers.

## What agents can ask

Everything below is what you see in Yamori:

- **Map and reading order:** `project_overview`, `start_here`, `project_map`, `list_files`, `file_info`
- **Names and text:** `find_symbol`, `search_name`, `glossary`, `tests_for`
- **Pseudocode, by the piece needed:** `get_pseudocode` returns an outline (block titles, source ranges and sizes), the block covering a line or a function, or the whole file. Every step is marked with the source lines it stands for (`L120–124`), and each answer states its size next to the source's. `search_pseudocode` searches all of it.
- **Source:** `read_source`

Answers are marked as untrusted project data. The server never runs project code or reads outside the project folder.

## Agents share what they learn

When an agent reads a whole file to understand it and Yamori has no pseudocode for it, the agent can write pseudocode with Yamori's own writing rules (`pseudocode_guide`) and save it (`save_pseudocode`):

- Yamori validates it like any explanation: blocks and line links must fit the file.
- It then appears in the Project guide and in the reader, labelled "Written by Claude Code during an agent session". Opening it uses no AI.
- An agent never replaces current pseudocode that Yamori wrote. It may replace outdated pseudocode, or its own.
- **Names are checked against the source.** A save that uses a name found nowhere in the file or the project is refused, and the answer names the block and the name, so the agent can fix it and save again. Other findings (a number the source doesn't contain, a side effect left unsaid) are reported with the saved result. See [Checked against the source](reading.md#checked-against-the-source).

## Does it save agent tokens?

Not on the work we measured. On coding tasks and "how does this work" questions in this repo and in a 114-file project, Claude Code (Sonnet) answered correctly at about the same cost with or without Yamori: the agents found what they needed with a few greps and one targeted read, and never called Yamori. We found no benefit and no cost, so Yamori doesn't push agents to use it. It offers its tools and leaves the choice to the agent.

Where it should help, and we haven't shown it yet: questions that cut across many files without a keyword to search for, and codebases much larger than these. The main benefit today is the one above: agents' explanations reaching you.

## Optional: text copies in the project

Turn on `yamori.pseudocodeMirror` to keep plain-text pseudocode in `<project>/.yamori/pseudocode/<path>.md`, plus `.yamori/INDEX.md` listing each file with its size and purpose. It's off by default because Yamori's tools don't need it; it's there for agents or scripts that read files directly. When on, Yamori adds `.yamori/` to `.git/info/exclude`, which stays on your machine.

## Read the human's current plan

`get_plan` reads the saved Plan canvas directly from extension storage: the goal, proposed steps and source ranges, comments, statuses, and rejected files. Rejected/skipped steps are excluded by default. Use `include_skipped: true` to inspect them, `path` to focus on one file, and `include_pseudocode: true` for generated before/proposed snippets. Plans are proposals, not evidence that code has been changed. Inspect current source before acting on a range.

The `.yamori` folder is an optional grep-friendly mirror. It is not required for MCP plan access; disabling the mirror does not delete the plan or explanations in extension storage. A running agent may need to reconnect/restart its MCP session to discover a newly installed tool.

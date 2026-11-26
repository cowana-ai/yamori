# Stages

Stages show a workflow as a few named boxes (for example **Plan → Act → Evaluate**) instead of files. Each stage lists the functions that implement it, across files, with a link to each line and the cached pseudocode.

## Start

Run **Yamori: Map Stages from Entry Point** and pick the function where the workflow starts (the one at your cursor is suggested first). Yamori shows how many files the workflow reaches and about how many tokens one mapping call uses. Choose **Only these files…** to narrow it. Files without AI notes get notes first, and Yamori asks before writing them.

**Yamori: Open Stages** opens the stage screen again. The graph stays on top; a stage card opens below it.

## What a stage card shows

- **In / Then / Out:** what goes in, what the stage does, and what comes out.
- **Steps across files:** each function, a chip that opens the source line, **File Flow** (the file in Read, at that step), and its cached pseudocode.
- **Rename, Pin, Merge, Move to…:** your changes pin the stage. Regeneration keeps pinned stages exactly as you left them. **Move to… → New stage** splits a stage.

## Updates and cost

Opening the screen, a card or pseudocode never calls a model: it reads `.yamori/yamori.db` and the pseudocode cache.

After you save a file, Yamori compares its content hash. Only unpinned stages with a step in that file are marked **Needs update**. About two seconds after saves stop (longer while an agent edits several files), each affected stage gets one cheap-model call. The call sends the stage, its steps, and the before/after pseudocode of the changed steps, never the whole workflow. A source excerpt of one function is sent only when that file has neither current pseudocode nor a current AI note. Nothing runs during a git rebase or merge.

- `yamori.stages.autoUpdate` (default on): turn off to wait for **Update changed**.
- `yamori.tokenBudget` (`{ "perRun": 60000, "perDay": 400000 }`): a call that would go over is not made; the stage stays **Needs update**.
- **Activity** (top right) lists every call today: trigger, model, input, cached and output tokens, and cost.

**Regenerate all** re-clusters every unpinned stage with one call. Rerunning with no code change makes no call. Changing the model or the prompt marks the stages as made by an older version, but does not regenerate them.

## Review

When a stage update finds that behavior changed, it adds one plain sentence to the review queue (for example "Evaluate now retries twice before failing"). The graph shows a **±** badge on the stage, and the bar on top says how many changes wait.

**Review** lists each change: the sentence first, then the pseudocode of each changed step in red and green, then **code diff**, which opens the file at the map's base commit beside the working copy. **Approve** or **Reject** asks for an optional "why", saved with the decision. Either way the next change of that step is compared with this version. When the queue is empty the workflow counts as reviewed; **Mark all seen** does that without deciding.

Renames, formatting and refactors that keep behavior do not enter the queue.

## Notes and Obsidian

Each stage card has a note box (**Save note**). Write why a stage works the way it does, constraints ("never store PII") and decisions. Agents read these notes before they edit the stage.

Set `yamori.obsidian.vaultPath` to your vault folder to keep the notes in Obsidian under `Yamori/<repo>/`; without it they go to `.yamori/notes/` in the project.

- `Stages/<workflow>/<Stage>.md`: front matter (`type`, `workflow`, `stage_id`, `name`, `files`, `updated`), then a managed section with the gist, In/Out and the ordered steps. Each step links to its file note (`[[Files/<file>#^step]]`) and back to the code (`vscode://…` and `cursor://…`).
- `Files/<path>.md`: the file's AI note, the stages that use it, and backlinks.
- `Changes/YYYY-MM-DD.md`: every approved or rejected change with its sentence, stage link and why.
- `Index.md`: workflows → stages → files.

Yamori rewrites only the text between `<!-- yamori:start -->` and `<!-- yamori:end -->`; edits inside it are restored on the next update. Everything else in the note is yours and is never overwritten. Changing `name:` in a stage note's front matter renames the stage in Yamori and pins it. Notes of stages that no longer exist move to `_archive/`; notes you created yourself are never touched. Writing and reading notes is file IO only: a note edit never triggers a model call.

## Storage

`.yamori/yamori.db` (SQLite, git-ignored) holds workflows, stages, steps, file hashes, the review queue and the token ledger. It is derived from code and can be deleted; pinned stages are the only founder edits it keeps. Stages need the editor's built-in SQLite (VS Code 1.101 or newer).

Deep links into the code use `vscode://cowana-ai.yamori/open?file=<path>&line=<n>`.

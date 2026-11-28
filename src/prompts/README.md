# Prompts

Every instruction Yamori sends to a model or to the founder's terminal agent.

- `<area>/<name>.md` is one prompt (or one reusable piece of one). It is sent
  exactly as written, except that `{{name}}` is replaced by a value the code
  supplies; the file's final newline is not sent.
- `<area>/tools.json` holds MCP tool descriptions, keyed by tool name.
- `index.js` loads them: `render(name, values)`, `text(name)`, and
  `descriptions(file)` for tool lists. A missing value throws, so a renamed
  placeholder cannot silently send `{{name}}` to a model.

Areas: `engine` (pseudocode, reviews, plans, flows), `planning` (project chat
and implementation runs), `stages` (Your System mapping and steering),
`reader` (step edits and questions in Read), `agent` (the terminal agent
session), `mcp` and `session` (the MCP server's tools and rules).

Changing wording changes what models see; cached pseudocode is keyed by
`PROMPT_FORMAT_VERSION` in `src/ai/engine.js`, so bump it for changes that
should regenerate explanations.

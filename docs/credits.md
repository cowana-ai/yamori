# Credits and licenses

[← Yamori](../README.md) · [Getting started](getting-started.md) · [Reading](reading.md) · [Project guide](project-guide.md) · [Tests](tests.md) · [Models & speed](models.md) · [Development](development.md)

Application code is [MIT licensed](../LICENSE). Bundled [KaTeX](https://katex.org/)
0.19.1 is MIT licensed, with its full notice retained in `vendor/katex.min.js`. It runs
locally to produce MathML without font downloads or network requests.

The bundled [tree-sitter](https://tree-sitter.github.io/) runtime and the Python,
JavaScript, TypeScript, Go, Java and Rust grammars come from Microsoft's
[`@vscode/tree-sitter-wasm`](https://github.com/microsoft/vscode-tree-sitter-wasm)
0.3.1 and are MIT licensed; the notice is in `vendor/tree-sitter/LICENSE`. The project map's
ranking approach follows [Aider's repo map](https://aider.chat/2023/10/22/repomap.html);
its tag queries were written for Yamori.

Bundled [jsdiff](https://github.com/kpdecker/jsdiff) is BSD-3-Clause licensed, with its notice retained in `vendor/diff.min.js`; bounded line alignment runs locally.

[Ajv](https://ajv.js.org/standalone.html) 8.20.0 is MIT licensed; its full notice is
retained in the generated `src/ai/validation.min.js` bundle.

Bundled CodeMirror 6 and its dependencies are MIT licensed, with their notices retained in `vendor/editor.min.js`. The editor adapter is in `src/views/reader.js`. The gecko samurai mascot was adapted from a user-supplied illustration using
image generation. The mascot is separate artwork and is not included in the
application-code MIT license.

Provider integration references: [Codex app-server](https://learn.chatgpt.com/docs/app-server)
and [Claude Code model configuration](https://code.claude.com/docs/en/model-config).

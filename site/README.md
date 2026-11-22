# Yamori Learn

A static site that reads like [Yamori](https://github.com/cowana-ai/yamori) in the browser. Lessons are prepared ahead of time: pseudocode with line links, file notes, a reading order, and a few name traces. The site does not call a model, and it does not generate or edit explanations.

The first path is **Transformers through nanoGPT**, using an unmodified copy of [karpathy/nanoGPT](https://github.com/karpathy/nanoGPT) at commit [`3adf61e154c3fe3fca428ad6bc3818b27a3b8291`](https://github.com/karpathy/nanoGPT/commit/3adf61e154c3fe3fca428ad6bc3818b27a3b8291) (12 Nov 2025). That snapshot is MIT licensed, copyright 2022 Andrej Karpathy. The license file is in `public/content/nanogpt/source/LICENSE`.

## Run locally

From this directory, with Node 20+:

```sh
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

## Build

```sh
npm run build
npm run preview
```

`npm run build` checks every line link against the pinned source, then writes `dist/`. `dist/404.html` is a copy of `index.html`, which is what GitHub Pages uses for client-side routes.

The content check is also part of the extension test suite (`npm test` from the repository root).

## Deploy

Do not publish from a pull request unless you mean to. When you do:

**GitHub Pages.** Build with the site's path as the base, then publish `dist/`:

```sh
VITE_BASE=/yamori/ npm run build
```

Use `/` instead of `/yamori/` if the site is served from a domain root. In the repository settings, set Pages to deploy that `dist/` directory (GitHub Actions is the usual way; this repo does not add a workflow).

**Vercel.** Set the project root to `site`. The included `vercel.json` rewrites every path to `index.html`. Leave `VITE_BASE` unset so assets stay at `/`.

## How a lesson is stored

Each repository lives in `public/content/<id>/`:

| File | Yamori shape |
| --- | --- |
| `source/` | The pinned tree the line numbers refer to |
| `meta.json` | Commit, upstream URL, license, copyright |
| `explanations/<path>.json` | `{ overview, logic }`, each `{ title, summary, hash, sections }` |
| `notes.json` | `{ overview, clusters, readingPath, files }` |
| `flows.json` | One flow per name: `{ summary, sections, caveats }` |
| `course.json` | The path's title, intro, and lesson order |
| `graph.json` | Output of Yamori's scanner and `layoutGrouped` |

A section is `{ title, startLine, endLine, pseudocode, lineMap }`. Each `lineMap` entry is `{ pseudocodeLine, startLine, endLine }`: `pseudocodeLine` counts from 1 in that block's string, including blank lines. This is the object form Yamori stores after a model reply (models emit `[pseudocodeLine, startLine, endLine]` triples; both are accepted).

The page renders those blocks with the same functions as the extension (`src/views/reader.js`: tokenization, emphasis, math, glossary) and lays the map out with `layoutGrouped` from `src/project/graph.js`.

`npm run validate` runs Yamori's explanation, notes, map-summary and flow schemas, then the fixed pseudocode checks (unknown names, invented numbers, unstated side effects).

## Add another repository

1. Copy a pinned tree and record the commit:

   ```sh
   node scripts/import-repo.mjs <id> /path/to/source <commit> https://github.com/owner/repo
   ```

2. Write `course.json`, `notes.json`, `flows.json`, and `explanations/<file>.json` in the shapes above. `scripts/author-nanogpt.mjs` is the nanoGPT example: it builds sections with accurate line links and fills each view's source hash.

3. Scan the tree with Yamori's parser (this reads `notes.json` so map badges follow `readingPath`):

   ```sh
   npm run scan
   ```

4. Check links, then build:

   ```sh
   npm run validate
   npm run build
   ```

5. Add a card to `public/content/catalog.json`.

Keep the upstream license and copyright in `meta.json`, and keep the copied source unmodified.

## What this site leaves out

There is no Generate, Regenerate, chat, or plan action. Those stay in the extension, which runs on your own Claude or Codex login: [Marketplace](https://marketplace.visualstudio.com/items?itemName=cowana-ai.yamori), [GitHub](https://github.com/cowana-ai/yamori).

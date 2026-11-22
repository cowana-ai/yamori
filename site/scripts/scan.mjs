// Rebuild graph.json with Yamori's own scanner and folder layout.
// Run after author-nanogpt.mjs so reading-order badges follow the course.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const project = require('../../src/project/graph.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'content', 'nanogpt');
const notes = JSON.parse(readFileSync(path.join(root, 'notes.json'), 'utf8'));
const indexer = new project.Indexer();
const graph = await project.scanFolder(path.join(root, 'source'), undefined, indexer);
const order = notes.readingPath.map(step => step.file);
const layout = project.layoutGrouped(graph, { order });
const slim = file => ({
  hash: file.hash, lines: file.lines, language: file.language, entry: !!file.entry, test: !!file.test, rank: file.rank,
  defs: (file.defs || []).map(({ name, kind, line, end }) => ({ name, kind, line, ...(end ? { end } : {}) })),
  imports: (file.imports || []).map(({ spec, line, names }) => ({ spec, line, names })),
  refs: file.refs || []
});
const out = {
  version: graph.version,
  entries: graph.entries,
  readingPath: graph.readingPath,
  files: Object.fromEntries(Object.entries(graph.files).map(([rel, file]) => [rel, slim(file)])),
  edges: graph.edges,
  layout,
  tree: project.folderTree(graph)
};
writeFileSync(path.join(root, 'graph.json'), JSON.stringify(out));
const files = Object.keys(out.files).length;
console.log('Scanned ' + files + ' files, ' + out.edges.length + ' edges, layout ' + out.layout.boxes.length + ' folders.');

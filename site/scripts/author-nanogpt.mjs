// Write nanoGPT lessons in the JSON shape Yamori stores: one explanation
// file per source file (overview + logic), plus notes, the course, and flows.
// This does not call a model. Line links are checked by scripts/validate.mjs.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sourceView } = require('../../src/project/graph.js');
import { model } from './content/model.mjs';
import { train } from './content/train.mjs';
import { sample } from './content/sample.mjs';
import { configurator } from './content/configurator.mjs';
import { prepareChar } from './content/prepare-char.mjs';
import { shorts } from './content/shorts.mjs';
import { notesBody, course as courseBase } from './content/notes.mjs';
import { blog } from './content/blog.mjs';
import { platform, steps as stepGuidance } from './content/guidance.mjs';
import { flows } from './content/flows.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'content', 'nanogpt');
const sourceRoot = path.join(root, 'source');
const hash = text => createHash('sha256').update(text).digest('hex');
// Notebooks are hashed and line-numbered as Yamori's code view, not raw JSON.
const sourceText = rel => sourceView(rel, readFileSync(path.join(sourceRoot, rel), 'utf8')).text;

const explanations = {
  'model.py': model,
  'train.py': train,
  'sample.py': sample,
  'configurator.py': configurator,
  'data/shakespeare_char/prepare.py': prepareChar,
  ...shorts
};

const commit = '3adf61e154c3fe3fca428ad6bc3818b27a3b8291';
writeFileSync(path.join(root, 'meta.json'), JSON.stringify({
  id: 'nanogpt',
  title: 'nanoGPT',
  commit,
  committedAt: '2025-11-12',
  upstream: 'https://github.com/karpathy/nanoGPT',
  commitUrl: 'https://github.com/karpathy/nanoGPT/commit/' + commit,
  treeUrl: 'https://github.com/karpathy/nanoGPT/tree/' + commit,
  license: 'MIT',
  copyright: 'Copyright (c) 2022 Andrej Karpathy',
  attribution: 'The files in source/ are an unmodified copy of karpathy/nanoGPT at this commit, included under the MIT license. Yamori did not generate them.',
  prepared: 'Pseudocode, file notes, and flow traces were written to Yamori\'s stored JSON shape from that source. This site does not call a model.'
}, null, 2) + '\n');

const course = {
  ...courseBase,
  platform,
  steps: courseBase.steps.map(step => ({ ...step, ...(stepGuidance[step.file] || {}) }))
};
writeFileSync(path.join(root, 'course.json'), JSON.stringify(course, null, 2) + '\n');

const notes = { overview: notesBody.overview, clusters: notesBody.clusters, readingPath: notesBody.readingPath, files: {} };
for (const [rel, note] of Object.entries(notesBody.files)) {
  notes.files[rel] = { hash: hash(sourceText(rel)), ...note };
}
writeFileSync(path.join(root, 'notes.json'), JSON.stringify(notes, null, 2) + '\n');
writeFileSync(path.join(root, 'flows.json'), JSON.stringify(flows, null, 2) + '\n');

const asides = {};
for (const [rel, views] of Object.entries(explanations)) {
  const digest = hash(sourceText(rel));
  const out = {};
  const notes = blog[rel];
  if (!notes) throw new Error('No blog copy for ' + rel);
  asides[rel] = {};
  for (const level of ['overview', 'logic']) {
    const sections = views[level].sections;
    const copy = notes[level];
    if (!copy || copy.length !== sections.length) {
      throw new Error(rel + ' ' + level + ' has ' + sections.length + ' blocks and ' + (copy ? copy.length : 0) + ' blog notes.');
    }
    asides[rel][level] = copy.map((item, index) => ({
      title: sections[index].title,
      digest: item.digest,
      next: item.next
    }));
    out[level] = {
      title: views[level].title,
      summary: views[level].summary,
      hash: digest,
      sections: sections.map(({ title, startLine, endLine, pseudocode, lineMap }) => ({ title, startLine, endLine, pseudocode, lineMap }))
    };
  }
  const dest = path.join(root, 'explanations', rel + '.json');
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
}
writeFileSync(path.join(root, 'asides.json'), JSON.stringify(asides, null, 2) + '\n');

console.log('Wrote ' + Object.keys(explanations).length + ' explanations, notes, course, and flows.');

// Check committed lessons against the pinned nanoGPT source and Yamori's schemas.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseResult } = require('../../src/ai/engine.js');
const { verifyPseudocode } = require('../../src/ai/verify.js');
const { projectNames } = require('../../src/project/graph.js');
const validators = require('../../src/ai/validation.min.js');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'content', 'nanogpt');
const sourceRoot = path.join(root, 'source');
const notes = JSON.parse(readFileSync(path.join(root, 'notes.json'), 'utf8'));
const graph = JSON.parse(readFileSync(path.join(root, 'graph.json'), 'utf8'));
const flows = JSON.parse(readFileSync(path.join(root, 'flows.json'), 'utf8'));
const course = JSON.parse(readFileSync(path.join(root, 'course.json'), 'utf8'));
const asides = JSON.parse(readFileSync(path.join(root, 'asides.json'), 'utf8'));
const meta = JSON.parse(readFileSync(path.join(root, 'meta.json'), 'utf8'));
const problems = [];
const fail = message => problems.push(message);

function walk(dir, base = '') {
  const found = [];
  for (const name of readdirSync(dir)) {
    const rel = base ? base + '/' + name : name;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full, rel));
    else if (name.endsWith('.json')) found.push(rel);
  }
  return found;
}

const names = projectNames(graph, notes);
const words = text => String(text).trim().split(/\s+/).filter(Boolean).length;

if (!/^[0-9a-f]{40}$/.test(meta.commit)) fail('meta.commit is not a full commit id.');
if (meta.license !== 'MIT') fail('meta.license should record nanoGPT\'s MIT license.');
if (words(notes.overview) > 80) fail('Project overview is longer than three short sentences.');
if (!validators.mapSummary({ overview: notes.overview, clusters: notes.clusters, readingPath: notes.readingPath })) {
  fail('Map summary failed Yamori\'s schema: ' + JSON.stringify(validators.mapSummary.errors?.[0]));
}

const courseFiles = course.steps.map(step => step.file);
if (JSON.stringify(courseFiles) !== JSON.stringify(notes.readingPath.map(step => step.file))) {
  fail('Course steps and notes.readingPath name different files or a different order.');
}
for (const step of notes.readingPath) if (words(step.why) > 25) fail(step.file + ' reading-path why is over 25 words.');

if (!course.platform?.studyGuide?.length) fail('course.platform.studyGuide is missing.');
for (const step of course.steps) {
  if (!step.objectives?.length) fail('Lesson ' + step.file + ' is missing objectives.');
  if (step.objectives.length < 2 || step.objectives.length > 5) fail('Lesson ' + step.file + ' should have 2–5 objectives.');
  for (const line of step.objectives) if (words(line) > 22) fail(step.file + ' objective is over 22 words.');
  if (!step.checks?.length) fail('Lesson ' + step.file + ' is missing checks.');
  for (const line of step.checks) if (words(line) > 18) fail(step.file + ' check is over 18 words.');
  if (step.primer && words(step.primer) > 25) fail(step.file + ' primer is over 25 words.');
  if (step.takeaway && words(step.takeaway) > 25) fail(step.file + ' takeaway is over 25 words.');
}

const explained = new Set();
for (const rel of walk(path.join(root, 'explanations'))) {
  const file = rel.slice(0, -'.json'.length);
  explained.add(file);
  const text = readFileSync(path.join(sourceRoot, file), 'utf8');
  const saved = JSON.parse(readFileSync(path.join(root, 'explanations', rel), 'utf8'));
  const lines = text.split('\n').length;
  for (const level of ['overview', 'logic']) {
    const view = saved[level];
    if (!view) { fail(file + ' is missing ' + level); continue; }
    if (view.hash !== graph.files[file]?.hash) fail(file + ' ' + level + ' hash does not match the scanned source.');
    let parsed;
    try { parsed = parseResult(JSON.stringify(view), { text, startLine: 1, name: file, language: 'python' }); }
    catch (error) { fail(file + ' ' + level + ': ' + error.message); continue; }
    for (const section of parsed.sections) {
      const body = section.pseudocode.split('\n');
      const linked = new Set(section.lineMap.map(link => link.pseudocodeLine));
      body.forEach((line, index) => {
        if (!line.trim()) return;
        if (!linked.has(index + 1)) fail(file + ' ' + level + ' / ' + section.title + ' line ' + (index + 1) + ' has no source link.');
      });
      for (const link of section.lineMap) {
        if (link.startLine < section.startLine || link.endLine > section.endLine) {
          fail(file + ' ' + level + ' / ' + section.title + ' links L' + link.startLine + '–' + link.endLine + ' outside the block range.');
        }
      }
    }
    const aside = asides[file]?.[level];
    if (!aside || aside.length !== parsed.sections.length) {
      fail(file + ' ' + level + ' blog notes do not match the block count.');
    } else {
      aside.forEach((item, index) => {
        if (item.title !== parsed.sections[index].title) fail(file + ' ' + level + ' blog note ' + index + ' has a stale title.');
        if (words(item.digest) < 40) fail(file + ' ' + level + ' / ' + item.title + ' digest is under 40 words.');
        if (words(item.next) < 20) fail(file + ' ' + level + ' / ' + item.title + ' next-preview is under 20 words.');
      });
    }
    const report = verifyPseudocode({ source: { text, startLine: 1 }, sections: parsed.sections, known: names, level, complete: level === 'logic' });
    for (const finding of report.findings) {
      const where = file + ' ' + level + ' section ' + finding.section + ': ' + finding.text;
      if (finding.severity === 'warn') fail(where);
      else console.log('note: ' + where);
    }
  }
}

for (const file of courseFiles) if (!explained.has(file)) fail('Course file has no explanation: ' + file);

for (const [rel, note] of Object.entries(notes.files)) {
  if (!graph.files[rel]) fail('Note for a file the scanner did not see: ' + rel);
  if (note.hash !== graph.files[rel]?.hash) fail('Note hash is stale for ' + rel);
  if (words(note.purpose) > 20) fail(rel + ' purpose is over 20 words.');
  const text = readFileSync(path.join(sourceRoot, rel), 'utf8').split('\n');
  for (const term of note.terms || []) {
    if (term.line < 1 || term.line > text.length) fail(rel + ' term ' + term.term + ' has a bad line.');
    else if (!text[term.line - 1].includes(term.term)) fail(rel + ' line ' + term.line + ' does not contain term ' + term.term);
    if (words(term.meaning) > 30) fail(rel + ' meaning for ' + term.term + ' is over 30 words.');
  }
}

const noteFiles = Object.entries(notes.files).map(([file, note]) => ({ file, purpose: note.purpose, role: note.role, terms: note.terms }));
for (let i = 0; i < noteFiles.length; i += 12) {
  const batch = { files: noteFiles.slice(i, i + 12) };
  if (!validators.notes(batch)) fail('Notes batch failed Yamori\'s schema: ' + JSON.stringify(validators.notes.errors?.[0]));
}

for (const [query, flow] of Object.entries(flows)) {
  if (!validators.flow({
    summary: flow.summary,
    caveats: flow.caveats,
    sections: flow.sections.map(section => ({
      ...section,
      lineMap: section.lineMap.map(link => [link.pseudocodeLine, link.startLine, link.endLine])
    }))
  })) fail('Flow ' + query + ' failed Yamori\'s schema: ' + JSON.stringify(validators.flow.errors?.[0]));
  const byFile = new Map();
  for (const section of flow.sections) {
    if (!byFile.has(section.file)) byFile.set(section.file, []);
    byFile.get(section.file).push(section);
    const total = graph.files[section.file]?.lines;
    if (!total) fail('Flow ' + query + ' names an unknown file ' + section.file);
    if (section.startLine < 1 || section.endLine > total) fail('Flow ' + query + ' ' + section.file + ' range is outside the file.');
  }
  for (const [file, sections] of byFile) {
    const text = readFileSync(path.join(sourceRoot, file), 'utf8');
    const report = verifyPseudocode({ source: { text, startLine: 1 }, sections, known: names, level: 'logic', complete: false });
    for (const finding of report.findings) if (finding.severity === 'warn') fail('Flow ' + query + ' ' + file + ': ' + finding.text);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('Validated ' + explained.size + ' explained files and ' + Object.keys(flows).length + ' flows against ' + meta.commit.slice(0, 12) + '.');

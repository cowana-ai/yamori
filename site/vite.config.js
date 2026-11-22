import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const reader = require(path.join(repo, 'src/views/reader.js'));
const guide = require(path.join(repo, 'src/views/guide.js'));
const project = require(path.join(repo, 'src/project/graph.js'));
const contentRoot = path.join(here, 'public', 'content');

function readingModule() {
  const pure = ['tokenize', 'pseudocodeLines', 'mathParts', 'emphasisParts', 'glossaryMatcher', 'glossaryParts']
    .map(name => reader[name].toString()).join('\n');
  const layout = ['folderOf', 'folderDepth', 'layoutView', 'layoutGrouped', 'readingPathFor', 'folderTree']
    .map(name => project[name].toString()).join('\n');
  return `export const BASE_STYLES = ${JSON.stringify(reader.BASE_STYLES)};
export const READING_STYLES = ${JSON.stringify(reader.READING_STYLES)};
export const LOGO = ${JSON.stringify(reader.LOGO)};
${pure}
export { tokenize, pseudocodeLines, mathParts, emphasisParts, glossaryMatcher, glossaryParts };
export const edgePath = ${guide.edgePath.toString()};
export const fitTransform = ${guide.fitTransform.toString()};
export const neighbourSet = ${guide.neighbourSet.toString()};
export const byFolder = ${guide.byFolder.toString()};
export function layoutApi(posix) {
${layout}
function outgoing(graph) {
  const map = new Map();
  for (const edge of graph.edges) {
    if (!map.has(edge.from)) map.set(edge.from, []);
    map.get(edge.from).push(edge);
  }
  return map;
}
return { layoutGrouped, readingPathFor, folderTree, folderOf };
}
export const searchProject = ${project.searchProject.toString()};
`;
}

function loadCourse(id) {
  const dir = path.join(contentRoot, id);
  const read = name => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
  const notes = read('notes.json');
  const graph = read('graph.json');
  const explanations = {};
  const sources = {};
  for (const rel of Object.keys(graph.files)) {
    const raw = readFileSync(path.join(dir, 'source', rel), 'utf8');
    sources[rel] = project.sourceView(rel, raw).text;
    const saved = path.join(dir, 'explanations', rel + '.json');
    if (existsSync(saved)) explanations[rel] = JSON.parse(readFileSync(saved, 'utf8'));
  }
  const license = path.join(dir, 'source', 'LICENSE');
  if (existsSync(license)) sources.LICENSE = readFileSync(license, 'utf8');
  const symbols = {};
  for (const rel of Object.keys(graph.files)) symbols[rel] = project.symbolLinks(graph, rel, explanations, notes);
  return {
    meta: read('meta.json'),
    course: read('course.json'),
    notes,
    graph,
    flows: read('flows.json'),
    explanations,
    sources,
    glossary: project.glossaryOf(graph, notes),
    symbols
  };
}

function coursesModule() {
  const courses = {};
  if (existsSync(contentRoot)) {
    for (const name of readdirSync(contentRoot)) {
      const dir = path.join(contentRoot, name);
      if (!statSync(dir).isDirectory()) continue;
      if (!existsSync(path.join(dir, 'graph.json')) || !existsSync(path.join(dir, 'course.json'))) continue;
      courses[name] = loadCourse(name);
    }
  }
  return 'export const courses = ' + JSON.stringify(courses) + ';\n';
}

function yamoriLearn() {
  return {
    name: 'yamori-learn',
    resolveId(id) {
      if (id === 'yamori:reading' || id === 'yamori:courses') return '\0' + id;
    },
    load(id) {
      if (id === '\0yamori:reading') return readingModule();
      if (id === '\0yamori:courses') return coursesModule();
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split('?')[0].endsWith('/katex.min.js')) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(path.join(repo, 'vendor', 'katex.min.js')));
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'katex.min.js',
        source: readFileSync(path.join(repo, 'vendor', 'katex.min.js'))
      });
    },
    closeBundle() {
      const dist = path.join(here, 'dist');
      const index = path.join(dist, 'index.html');
      if (existsSync(index)) copyFileSync(index, path.join(dist, '404.html'));
    }
  };
}

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [yamoriLearn()],
  build: { chunkSizeWarningLimit: 2000, outDir: 'dist' }
});

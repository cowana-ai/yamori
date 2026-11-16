'use strict';
// Project map: a local, deterministic code graph in the spirit of Aider's repo
// map. Tree-sitter finds definitions, references and imports; PageRank finds
// the files the rest of the project leans on. Nothing here calls a model, runs
// project code or asks a language service, so it also works in Restricted Mode.
// AI notes (purposes and a project glossary) are layered on top by the extension.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const GRAMMAR_DIR = path.join(__dirname, '..', '..', 'vendor', 'tree-sitter');
const GRAMMARS = ['python', 'javascript', 'tsx', 'go', 'java', 'rust'];
// TypeScript files use the TSX grammar: one 1.4 MB grammar instead of two.
const GRAMMAR_FOR = { '.py': 'python', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.ts': 'tsx', '.tsx': 'tsx', '.mts': 'tsx', '.cts': 'tsx', '.go': 'go', '.java': 'java', '.rs': 'rust' };
const MAX_FILE_BYTES = 500000, MAX_FILES = 500, MAX_REFS = 600, MAX_PATH_STEPS = 15;
// Version 2 adds definition end lines and test cases; older scans rebuild once.
const GRAPH_VERSION = 2;
const IMPORT_WEIGHT = 3, MAX_LINKS_PER_FILE = 12;
const TEST_PATH = /(^|\/)(tests?|__tests__|specs?)\/|(^|\/)(test_[^/]*|tests?\.[^/.]+|conftest\.py)$|_test\.[^/.]+$|\.(test|spec)\.[^/.]+$/i;
// In these languages a file must import what it uses, so shared names only
// describe an import edge. Package-scoped languages also link by names.
const MODULE_LANGUAGES = new Set(['python', 'javascript', 'tsx']);
const ENTRY_NAME = /(^|\/)(main|__main__|cli|app|index|server|run|train|manage|start)\.[^/.]+$/i;
// Names too generic to connect two files on their own.
const COMMON_NAMES = new Set('self this cls super args kwargs init main run get set put add update data value values key keys item items result results name names id type types index path file files text config options opts error err log logger print len range list dict str int float bool object string number array map filter reduce push append extend copy deepcopy format join split strip replace lower upper open close read write next iter call apply bind then catch resolve reject response request req res ctx context state props model models test tests setup teardown default module exports require import from return true false none null undefined new delete'.split(' '));

const QUERIES = {
  python: [
    '(class_definition name: (identifier) @def.class)',
    '(function_definition name: (identifier) @def.function)',
    '(module (expression_statement (assignment left: (identifier) @def.constant)))',
    '(class_definition body: (block (expression_statement (assignment left: (identifier) @def.field))))',
    '(import_from_statement module_name: (_) @import.module)',
    '(import_from_statement name: (dotted_name) @import.name)',
    '(import_from_statement name: (aliased_import name: (dotted_name) @import.name))',
    '(import_statement name: (dotted_name) @import.module)',
    '(import_statement name: (aliased_import name: (dotted_name) @import.module))',
    '(identifier) @ref'
  ],
  javascript: [
    '(function_declaration name: (identifier) @def.function)',
    '(generator_function_declaration name: (identifier) @def.function)',
    '(class_declaration name: (_) @def.class)',
    '(method_definition name: (property_identifier) @def.method)',
    '(program (lexical_declaration (variable_declarator name: (identifier) @def.constant)))',
    '(program (variable_declaration (variable_declarator name: (identifier) @def.constant)))',
    '(program (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @def.constant))))',
    '(import_statement source: (string (string_fragment) @import.module))',
    '(export_statement source: (string (string_fragment) @import.module))',
    '(import_specifier name: (identifier) @import.name)',
    '((call_expression function: (identifier) @_fn arguments: (arguments . (string (string_fragment) @import.module))) (#eq? @_fn "require"))',
    '(call_expression function: (import) arguments: (arguments . (string (string_fragment) @import.module)))',
    '((call_expression function: (identifier) @_test arguments: (arguments . (string (string_fragment) @test.name))) @test.case (#match? @_test "^(it|test)$"))',
    '(identifier) @ref', '(property_identifier) @ref', '(shorthand_property_identifier) @ref'
  ],
  go: [
    '(function_declaration name: (identifier) @def.function)',
    '(method_declaration name: (field_identifier) @def.method)',
    '(type_spec name: (type_identifier) @def.type)',
    '(source_file (const_declaration (const_spec name: (identifier) @def.constant)))',
    '(source_file (var_declaration (var_spec name: (identifier) @def.constant)))',
    '(import_spec path: (interpreted_string_literal) @import.module)',
    '(identifier) @ref', '(field_identifier) @ref', '(type_identifier) @ref'
  ],
  java: [
    '(class_declaration name: (identifier) @def.class)',
    '(interface_declaration name: (identifier) @def.interface)',
    '(enum_declaration name: (identifier) @def.enum)',
    '(record_declaration name: (identifier) @def.class)',
    '(method_declaration name: (identifier) @def.method)',
    '(enum_constant name: (identifier) @def.constant)',
    '(field_declaration declarator: (variable_declarator name: (identifier) @def.field))',
    '(import_declaration (scoped_identifier) @import.module)',
    '(identifier) @ref', '(type_identifier) @ref'
  ],
  rust: [
    '(function_item name: (identifier) @def.function)',
    '(struct_item name: (type_identifier) @def.class)',
    '(enum_item name: (type_identifier) @def.enum)',
    '(trait_item name: (type_identifier) @def.interface)',
    '(type_item name: (type_identifier) @def.type)',
    '(const_item name: (identifier) @def.constant)',
    '(static_item name: (identifier) @def.constant)',
    '(enum_variant name: (identifier) @def.constant)',
    '(mod_item name: (identifier) @import.mod !body)',
    '(use_declaration argument: (_) @import.module)',
    '(identifier) @ref', '(field_identifier) @ref', '(type_identifier) @ref'
  ]
};
QUERIES.tsx = [...QUERIES.javascript,
  '(interface_declaration name: (type_identifier) @def.interface)',
  '(type_alias_declaration name: (type_identifier) @def.type)',
  '(enum_declaration name: (identifier) @def.enum)',
  '(abstract_class_declaration name: (type_identifier) @def.class)',
  '(type_identifier) @ref'];
const IMPORT_STATEMENTS = new Set(['import_statement', 'import_from_statement', 'export_statement', 'import_declaration', 'use_declaration', 'call_expression', 'import_spec', 'mod_item']);

const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const posix = path.posix;
const lineCount = text => text.split('\n').length;
const isTest = rel => TEST_PATH.test(rel);
function join(...parts) {
  const joined = posix.normalize(parts.filter(part => part && part !== '.').join('/') || '.');
  return joined.startsWith('..') ? undefined : joined.replace(/^\.\//, '');
}

// ---- Extraction ---------------------------------------------------------

class Indexer {
  constructor(grammarDir = GRAMMAR_DIR) { this.dir = grammarDir; this.runtime = undefined; this.languages = new Map(); }
  init() {
    this.runtime ||= (async () => {
      const runtime = require(path.join(this.dir, 'tree-sitter.js'));
      await runtime.Parser.init({ locateFile: file => path.join(this.dir, file) });
      return runtime;
    })();
    return this.runtime;
  }
  language(grammar) {
    if (!this.languages.has(grammar)) this.languages.set(grammar, (async () => {
      const runtime = await this.init();
      const language = await runtime.Language.load(path.join(this.dir, `tree-sitter-${grammar}.wasm`));
      // Compile patterns one by one so a grammar update drops one pattern, not the file.
      const valid = QUERIES[grammar].filter(pattern => { try { new runtime.Query(language, pattern); return true; } catch { return false; } });
      const parser = new runtime.Parser(); parser.setLanguage(language);
      return { parser, query: new runtime.Query(language, valid.join('\n')), patterns: valid.length };
    })());
    return this.languages.get(grammar);
  }
  async extract(rel, text) {
    const grammar = GRAMMAR_FOR[posix.extname(rel).toLowerCase()];
    if (!grammar) return regexExtract(rel, text);
    let tree;
    try {
      const { parser, query } = await this.language(grammar);
      tree = parser.parse(text);
      return fromCaptures(grammar, query.captures(tree.rootNode), rel, text);
    } catch { return regexExtract(rel, text); }
    finally { tree?.delete?.(); }
  }
}

function statementOf(node) {
  for (let current = node; current; current = current.parent) if (IMPORT_STATEMENTS.has(current.type)) return current;
  return node;
}
// Where a definition's code ends: the defining node, not just its name.
const DEFINITION_NODES = /definition|declaration|_item$|^method_definition$|^class_body$|^type_spec$|^variable_declarator$|^assignment$|^const_spec$|^var_spec$|^enum_constant$|^enum_variant$/;
function definitionEnd(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (DEFINITION_NODES.test(current.type)) return (current.parent?.type === 'decorated_definition' ? current.parent : current).endPosition.row + 1;
    if (current.type === 'block' || current.type === 'program' || current.type === 'module' || current.type === 'source_file') break;
  }
  return node.endPosition.row + 1;
}
function fromCaptures(grammar, captures, rel, text) {
  const defs = [], refs = new Map(), statements = new Map(), seen = new Set();
  // Test files also keep where each name is used, to find what each test calls.
  const testFile = isTest(rel), uses = [], cases = [];
  for (const { name, node } of captures) {
    if (name.startsWith('_')) continue;
    const value = node.text, line = node.startPosition.row + 1;
    if (name === 'ref') {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || value.length < 2) continue;
      const ref = refs.get(value);
      if (ref) ref.count++; else refs.set(value, { count: 1, line });
      if (testFile && uses.length < 20000) uses.push([value, line]);
      continue;
    }
    if (name === 'test.case') { cases.push({ line, end: node.endPosition.row + 1 }); continue; }
    if (name === 'test.name') { const open = cases.findLast(item => item.line <= line && item.end >= line && !item.name); if (open) open.name = value.slice(0, 120); continue; }
    if (name.startsWith('def.')) {
      const key = value + ':' + line;
      if (!seen.has(key)) { seen.add(key); defs.push({ name: value, kind: name.slice(4), line, end: definitionEnd(node) }); }
      continue;
    }
    const statement = statementOf(node), id = statement.id ?? statement.startIndex;
    if (!statements.has(id)) statements.set(id, { spec: undefined, line: statement.startPosition.row + 1, kind: 'module', names: [] });
    const record = statements.get(id);
    if (name === 'import.name') record.names.push(value.split('.').at(-1));
    else {
      record.spec = grammar === 'go' ? value.replace(/^"|"$/g, '') : value;
      record.kind = name === 'import.mod' ? 'mod' : 'module';
      if (grammar === 'java' && /\.\*\s*;?\s*$/.test(statement.text)) record.wildcard = true;
    }
  }
  const imports = [...statements.values()].filter(record => record.spec);
  const record = finishRecord(defs, refs, imports, rel, text);
  if (testFile) record.tests = testCases(grammar, defs, cases, uses);
  return record;
}
// Python: test_* functions, and test_* methods of Test* classes (Class::method).
// JS/TS: it('…') and test('…') calls. Each lists the names used inside it.
function testCases(grammar, defs, cases, uses) {
  const found = [];
  if (grammar === 'python') {
    const classes = defs.filter(def => def.kind === 'class');
    for (const def of defs) {
      if (def.kind !== 'function' || !/^test/.test(def.name)) continue;
      const owner = classes.filter(cls => cls.line < def.line && cls.end >= def.end).sort((a, b) => b.line - a.line)[0];
      if (owner && !/^Test/.test(owner.name)) continue;
      found.push({ name: owner ? owner.name + '::' + def.name : def.name, line: def.line, end: def.end });
    }
  } else for (const item of cases) if (item.name) found.push({ name: item.name, line: item.line, end: item.end });
  return found.slice(0, 300).map(test => {
    const calls = new Set();
    for (const [name, line] of uses) if (line >= test.line && line <= test.end && !COMMON_NAMES.has(name.toLowerCase()) && name !== test.name.split('::').at(-1)) calls.add(name);
    return { ...test, calls: [...calls].slice(0, 80) };
  });
}
function finishRecord(defs, refs, imports, rel, text) {
  // Stored references stay bounded; the most used names carry the edges.
  const ranked = [...refs].sort((a, b) => b[1].count - a[1].count || a[1].line - b[1].line).slice(0, MAX_REFS);
  return { defs: defs.slice(0, 400), refs: ranked.map(([name, ref]) => [name, ref.count, ref.line]), imports: imports.slice(0, 200), main: entrySignal(rel, text) };
}
function entrySignal(rel, text) {
  return /^\s*if\s+__name__\s*==\s*['"]__main__['"]/m.test(text) || /^#!/.test(text) || /require\.main\s*===\s*module/.test(text)
    || (/^package\s+main\b/m.test(text) && /^func\s+main\s*\(/m.test(text)) || /\bstatic\s+void\s+main\s*\(/.test(text)
    || /(^|\/)src\/main\.rs$/.test(rel) || /(^|\/)src\/bin\/[^/]+\.rs$/.test(rel);
}
// Languages without a bundled grammar keep useful file links and names.
function regexExtract(rel, text) {
  const defs = [], refs = new Map(), imports = [];
  const lines = text.split('\n');
  lines.forEach((source, index) => {
    const line = index + 1;
    const def = source.match(/^\s*(?:export\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:def|function|class|func|fn|sub|procedure|struct|interface|enum|object|trait)\s+([A-Za-z_]\w*)/);
    if (def) defs.push({ name: def[1], kind: 'function', line });
    const constant = source.match(/^(?:export\s+)?(?:const\s+|static\s+|final\s+)*([A-Z][A-Z0-9_]{2,})\s*[:=]/);
    if (constant) defs.push({ name: constant[1], kind: 'constant', line });
    const spec = source.match(/^\s*#\s*include\s+"([^"]+)"/)?.[1] || source.match(/\brequire_relative\s+['"]([^'"]+)['"]/)?.[1]
      || source.match(/\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+\.php)['"]/)?.[1] || source.match(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/)?.[1]
      || source.match(/\brequire\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/)?.[1] || source.match(/^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/)?.[1]
      || source.match(/^\s*(?:source|\.)\s+(\.{1,2}\/\S+\.(?:sh|bash))/)?.[1];
    if (spec) imports.push({ spec, line, kind: 'path', names: [] });
    const dotted = source.match(/^\s*import\s+([a-z][\w]*(?:\.[\w]+)+)\s*$/)?.[1];
    if (dotted) imports.push({ spec: dotted, line, kind: 'dotted', names: [] });
    for (const match of source.matchAll(/\b[A-Za-z_]\w+\b/g)) {
      const ref = refs.get(match[0]);
      if (ref) ref.count++; else refs.set(match[0], { count: 1, line });
    }
  });
  return finishRecord(defs, refs, imports, rel, text);
}

// ---- Import resolution ---------------------------------------------------

function resolveImport(from, imp, ctx) {
  const language = GRAMMAR_FOR[posix.extname(from).toLowerCase()];
  const found = new Set(), hit = rel => rel && ctx.files.has(rel) && rel !== from && found.add(rel);
  const dir = posix.dirname(from);
  if (language === 'python') {
    const dots = imp.spec.match(/^\.*/)[0].length, rest = imp.spec.slice(dots).split('.').filter(Boolean);
    const module = (base, parts) => {
      for (let size = parts.length; size >= 1; size--) {
        const stem = join(base, ...parts.slice(0, size));
        if (stem && (ctx.files.has(stem + '.py') || ctx.files.has(stem + '/__init__.py'))) return ctx.files.has(stem + '.py') ? stem + '.py' : stem + '/__init__.py';
      }
    };
    const bases = dots ? [join(dir, ...Array(dots - 1).fill('..'))] : pythonRoots(from, ctx);
    for (const base of bases) {
      if (base === undefined) continue;
      const target = rest.length ? module(base, rest) : undefined;
      // `from pkg import name` may name a submodule rather than an attribute.
      const submodules = imp.names.map(name => module(base, [...rest, name])).filter(rel => rel && rel !== target && rel.split('/').length > (target || '').split('/').length - 1);
      if (target || submodules.length) { hit(target); submodules.forEach(hit); break; }
    }
  } else if (language === 'javascript' || language === 'tsx' || imp.kind === 'path') {
    // Package imports stay outside the map; C includes and Ruby/PHP/shell paths are file-relative.
    if (imp.kind !== 'path' && !/^\.{1,2}\//.test(imp.spec)) return [];
    const base = join(dir, imp.spec);
    if (base) {
      const stems = [base, base.replace(/\.(?:[cm]?js|jsx)$/, '')];
      const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.rb'];
      let done = false;
      for (const stem of stems) { for (const ext of extensions) if (hit(stem + ext)) { done = true; break; } if (done) break; }
      if (!done) for (const ext of extensions.slice(1)) if (hit(base + '/index' + ext)) break;
    }
  } else if (language === 'go') {
    for (const { dir: root, module } of ctx.goModules) {
      if (imp.spec !== module && !imp.spec.startsWith(module + '/')) continue;
      const pkg = join(root, imp.spec.slice(module.length + 1));
      for (const rel of ctx.dirs.get(pkg || '.') || []) if (rel.endsWith('.go') && !rel.endsWith('_test.go')) hit(rel);
    }
  } else if (language === 'java' || imp.kind === 'dotted') {
    const suffix = imp.spec.replace(/\./g, '/');
    for (const rel of ctx.files) {
      if (imp.wildcard ? posix.dirname(rel).endsWith(suffix) : /\.(?:java|kt|scala)$/.test(rel) && rel.replace(/\.(?:java|kt|scala)$/, '').endsWith(suffix)) hit(rel);
    }
  } else if (language === 'rust') {
    const stem = posix.basename(from, '.rs');
    if (imp.kind === 'mod') {
      const base = ['mod', 'lib', 'main'].includes(stem) ? dir : join(dir, stem);
      hit(join(base, imp.spec + '.rs')) || hit(join(base, imp.spec, 'mod.rs'));
    } else {
      const segments = imp.spec.split('{')[0].split('::').map(part => part.trim()).filter(Boolean);
      const moduleDir = ['mod', 'lib', 'main'].includes(stem) ? dir : join(dir, stem);
      let base;
      if (segments[0] === 'crate') base = ctx.cargoRoots.filter(root => from.startsWith(root ? root + '/' : '')).map(root => join(root, 'src')).sort((a, b) => b.length - a.length)[0];
      else if (segments[0] === 'super') base = posix.dirname(moduleDir);
      else if (segments[0] === 'self') base = moduleDir;
      if (base !== undefined) {
        const parts = segments.slice(1);
        for (let size = parts.length; size >= 1; size--) {
          const stemPath = join(base, ...parts.slice(0, size));
          if (hit(stemPath + '.rs') || hit(join(stemPath, 'mod.rs'))) break;
        }
      }
    }
  }
  if (imp.kind === 'path' && !found.size) {
    // C/C++ headers are often included relative to an include root.
    const tail = imp.spec.replace(/^(\.\.?\/)+/, '');
    for (const rel of ctx.files) if (rel.endsWith('/' + tail) || rel === tail) { hit(rel); break; }
  }
  return [...found];
}
function pythonRoots(from, ctx) {
  // Nearest enclosing folders first: monorepos import `src.app.x` relative to
  // each sub-project (where pyproject.toml and pytest's pythonpath live).
  const roots = [];
  for (let dir = posix.dirname(from); ; dir = posix.dirname(dir)) { roots.push(dir === '.' ? '' : dir); if (dir === '.' || roots.length > 12) break; }
  for (const extra of ['src', 'lib', 'python']) roots.push(extra);
  let top = posix.dirname(from);
  while (top !== '.' && ctx.files.has(top + '/__init__.py')) top = posix.dirname(top);
  roots.push(top === '.' ? '' : top);
  return [...new Set(roots)];
}
function resolutionContext(rels, manifests = {}) {
  const files = new Set(rels), dirs = new Map();
  for (const rel of rels) { const dir = posix.dirname(rel); if (!dirs.has(dir)) dirs.set(dir, []); dirs.get(dir).push(rel); }
  const goModules = [], cargoRoots = [], packageEntries = new Set();
  for (const [file, text] of Object.entries(manifests)) {
    const dir = posix.dirname(file) === '.' ? '' : posix.dirname(file);
    if (posix.basename(file) === 'go.mod') { const module = String(text).match(/^\s*module\s+(\S+)/m)?.[1]; if (module) goModules.push({ dir, module }); }
    if (posix.basename(file) === 'Cargo.toml') cargoRoots.push(dir);
    if (posix.basename(file) === 'package.json') {
      try {
        const manifest = JSON.parse(text);
        const entries = [manifest.main, ...(typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin || {}))];
        for (const entry of entries) if (typeof entry === 'string') { const rel = join(dir, entry); if (rel) packageEntries.add(rel); }
      } catch { /* An invalid manifest adds no entries. */ }
    }
  }
  return { files, dirs, goModules, cargoRoots, packageEntries };
}

// ---- Graph -----------------------------------------------------------------

function buildGraph(records, manifests = {}) {
  const rels = Object.keys(records).sort();
  const ctx = resolutionContext(rels, manifests);
  const definers = new Map();
  for (const rel of rels) if (!isTest(rel)) for (const def of records[rel].defs) {
    if (!definers.has(def.name)) definers.set(def.name, new Set());
    definers.get(def.name).add(rel);
  }
  const links = new Map();
  const link = (from, to, weight, name, line, imported, nameWeight = weight) => {
    const key = from + '\0' + to;
    if (!links.has(key)) links.set(key, { from, to, weight: 0, imported: false, line, names: new Map() });
    const edge = links.get(key);
    edge.weight += weight; edge.line = Math.min(edge.line, line);
    if (imported && !edge.imported) { edge.imported = true; edge.weight += IMPORT_WEIGHT; }
    if (name) edge.names.set(name, (edge.names.get(name) || 0) + Math.max(nameWeight, 0.01));
  };
  for (const rel of rels) {
    const record = records[rel];
    for (const imp of record.imports) {
      let targets = resolveImport(rel, imp, ctx);
      // A Go package spans files: link to the files that define what this file uses.
      if (targets.length > 1 && GRAMMAR_FOR[posix.extname(rel)] === 'go') {
        const used = new Set(record.refs.map(([name]) => name));
        const narrowed = targets.filter(target => records[target].defs.some(def => used.has(def.name)));
        targets = narrowed.length ? narrowed : targets.slice(0, 1);
      }
      for (const target of targets) {
        link(rel, target, 0, undefined, imp.line, true);
        for (const name of imp.names) link(rel, target, 0, name, imp.line, true, 100);
      }
    }
    const own = new Set(record.defs.map(def => def.name));
    const moduleScoped = MODULE_LANGUAGES.has(GRAMMAR_FOR[posix.extname(rel).toLowerCase()]) || record.imports.some(imp => imp.kind === 'path');
    for (const [name, count, line] of record.refs) {
      if (own.has(name) || COMMON_NAMES.has(name.toLowerCase())) continue;
      const owners = definers.get(name);
      if (!owners || owners.size > 5) continue;
      const strength = (name.length >= 8 && /[_A-Z]/.test(name.slice(1)) ? 2 : 1) * (name.startsWith('_') ? 0.3 : 1);
      const weight = strength * Math.sqrt(count) / owners.size;
      for (const target of owners) {
        if (target === rel || moduleScoped && !links.has(rel + '\0' + target)) continue;
        link(rel, target, weight, name, line, false);
      }
    }
  }
  const byFile = new Map();
  for (const edge of links.values()) {
    if (!edge.imported && edge.weight < 0.3) continue;
    if (!byFile.has(edge.from)) byFile.set(edge.from, []);
    byFile.get(edge.from).push(edge);
  }
  const edges = [];
  for (const list of byFile.values()) {
    const imported = list.filter(edge => edge.imported), inferred = list.filter(edge => !edge.imported).sort((a, b) => b.weight - a.weight);
    for (const edge of [...imported, ...inferred.slice(0, Math.max(0, MAX_LINKS_PER_FILE - imported.length))]) {
      edges.push({ from: edge.from, to: edge.to, weight: Math.round(edge.weight * 100) / 100, imported: edge.imported, line: edge.line,
        names: [...edge.names].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name) });
    }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const ranks = pageRank(rels, edges);
  const inbound = new Map(rels.map(rel => [rel, 0])), outbound = new Map(rels.map(rel => [rel, 0]));
  for (const edge of edges) {
    if (!isTest(edge.from)) inbound.set(edge.to, inbound.get(edge.to) + 1);
    outbound.set(edge.from, outbound.get(edge.from) + 1);
  }
  const files = {}, entries = [];
  for (const rel of rels) {
    const record = records[rel], test = isTest(rel);
    // A main guard in a file others import is usually a self-test or build step.
    const imported = inbound.get(rel) > 0;
    const score = (imported ? 0 : 2) + (record.main ? (imported ? 1 : 3) : 0) + (ctx.packageEntries.has(rel) ? 3 : 0) + (ENTRY_NAME.test(rel) ? 1 : 0) + (outbound.get(rel) > 0 ? 1 : 0);
    const entry = !test && score >= 3;
    if (entry) entries.push({ rel, score });
    files[rel] = { ...record, test, entry, rank: Math.round(ranks[rel] * 1e6) / 1e6 };
  }
  const graph = { version: GRAPH_VERSION, files, edges };
  graph.entries = entries.sort((a, b) => b.score - a.score || reach(graph, b.rel) - reach(graph, a.rel) || ranks[b.rel] - ranks[a.rel] || a.rel.localeCompare(b.rel)).map(entry => entry.rel);
  graph.readingPath = readingPath(graph);
  return graph;
}
function outgoing(graph) {
  const map = new Map();
  for (const edge of graph.edges) { if (!map.has(edge.from)) map.set(edge.from, []); map.get(edge.from).push(edge); }
  return map;
}
function reach(graph, start) {
  const out = outgoing(graph), seen = new Set([start]), queue = [start];
  while (queue.length) for (const edge of out.get(queue.shift()) || []) if (!seen.has(edge.to)) { seen.add(edge.to); queue.push(edge.to); }
  return seen.size;
}
function pageRank(nodes, edges, { damping = 0.85, iterations = 50 } = {}) {
  const count = nodes.length;
  if (!count) return {};
  const index = new Map(nodes.map((id, i) => [id, i])), out = nodes.map(() => []), total = new Float64Array(count);
  for (const edge of edges) {
    const i = index.get(edge.from), j = index.get(edge.to);
    if (i === undefined || j === undefined || edge.weight <= 0) continue;
    out[i].push([j, edge.weight]); total[i] += edge.weight;
  }
  let rank = new Float64Array(count).fill(1 / count);
  for (let step = 0; step < iterations; step++) {
    const next = new Float64Array(count).fill((1 - damping) / count);
    let dangling = 0;
    for (let i = 0; i < count; i++) {
      if (!total[i]) { dangling += rank[i]; continue; }
      for (const [j, weight] of out[i]) next[j] += damping * rank[i] * weight / total[i];
    }
    for (let i = 0; i < count; i++) next[i] += damping * dangling / count;
    rank = next;
  }
  return Object.fromEntries(nodes.map((id, i) => [id, rank[i]]));
}
// Top-down reading: the entry point, then the stages it uses in the order it
// uses them, then their helpers. A guide, not an exhaustive list.
function readingPath(graph) {
  const out = outgoing(graph), seen = new Set(), steps = [];
  for (const entry of graph.entries.slice(0, 3)) {
    const queue = [{ id: entry, via: undefined, names: [] }];
    while (queue.length && steps.length < MAX_PATH_STEPS) {
      const step = queue.shift();
      if (seen.has(step.id) || graph.files[step.id]?.test) continue;
      seen.add(step.id); steps.push(step);
      const children = (out.get(step.id) || []).filter(edge => edge.imported || edge.weight >= 1).sort((a, b) => a.line - b.line || b.weight - a.weight);
      for (const edge of children) queue.push({ id: edge.to, via: step.id, names: edge.names.slice(0, 3) });
    }
    if (steps.length >= MAX_PATH_STEPS) break;
  }
  return steps;
}

// ---- Views and layout --------------------------------------------------------

function folderOf(rel, depth) {
  const parts = posix.dirname(rel).split('/').filter(part => part !== '.');
  return parts.length ? parts.slice(0, depth).join('/') : '(root)';
}
function folderDepth(rels, limit = 40) {
  let best = 1;
  for (let depth = 1; depth <= 6; depth++) {
    const groups = new Set(rels.map(rel => folderOf(rel, depth))).size;
    if (groups > limit) break;
    best = depth;
    if (groups === new Set(rels.map(rel => folderOf(rel, 99))).size) break;
  }
  return best;
}
// The visible part of the graph: every file, every folder, or one folder plus
// the files it touches.
function graphView(graph, scope = {}) {
  const rels = Object.keys(graph.files);
  const steps = new Map(graph.readingPath.map((step, index) => [step.id, index + 1]));
  const fileNode = (rel, external = false) => {
    const file = graph.files[rel];
    return { id: rel, kind: 'file', label: posix.basename(rel), folder: posix.dirname(rel) === '.' ? '' : posix.dirname(rel), entry: file.entry, test: file.test, rank: file.rank, step: steps.get(rel), external };
  };
  if (scope.mode === 'folders') {
    const depth = folderDepth(rels), groups = new Map();
    for (const rel of rels) { const key = folderOf(rel, depth); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(rel); }
    const nodes = [...groups].map(([key, members]) => ({ id: 'folder:' + key, kind: 'folder', label: key === '(root)' ? '(root)' : key + '/', folder: key, count: members.length,
      entry: members.some(rel => graph.files[rel].entry), test: members.every(rel => graph.files[rel].test), rank: members.reduce((sum, rel) => sum + graph.files[rel].rank, 0),
      step: Math.min(...members.map(rel => steps.get(rel) || Infinity)) }));
    nodes.forEach(node => { if (!Number.isFinite(node.step)) delete node.step; });
    const merged = new Map();
    for (const edge of graph.edges) {
      const from = 'folder:' + folderOf(edge.from, depth), to = 'folder:' + folderOf(edge.to, depth);
      if (from === to) continue;
      const key = from + '\0' + to;
      if (!merged.has(key)) merged.set(key, { from, to, weight: 0, imported: false, names: [], count: 0 });
      const item = merged.get(key);
      item.weight += edge.weight; item.imported ||= edge.imported; item.count++;
      for (const name of edge.names) if (item.names.length < 5 && !item.names.includes(name)) item.names.push(name);
    }
    return { scope: 'folders', depth, nodes, edges: [...merged.values()].map(edge => ({ ...edge, weight: Math.round(edge.weight * 100) / 100 })) };
  }
  if (scope.mode === 'folder' && typeof scope.folder === 'string') {
    const depth = scope.depth || folderDepth(rels);
    const inside = new Set(rels.filter(rel => folderOf(rel, depth) === scope.folder));
    const edges = graph.edges.filter(edge => inside.has(edge.from) || inside.has(edge.to));
    const outside = new Set(edges.flatMap(edge => [edge.from, edge.to]).filter(rel => !inside.has(rel)));
    return { scope: 'folder:' + scope.folder, nodes: [...[...inside].map(rel => fileNode(rel)), ...[...outside].map(rel => fileNode(rel, true))], edges };
  }
  return { scope: 'files', nodes: rels.map(rel => fileNode(rel)), edges: graph.edges };
}
// Deterministic layered layout: entry points on top, what they use below.
function layoutView(view, saved = {}, { gap = 28, rowGap = 68 } = {}) {
  const ids = view.nodes.map(node => node.id), known = new Set(ids);
  const edges = view.edges.filter(edge => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to);
  const out = new Map(ids.map(id => [id, []])), into = new Map(ids.map(id => [id, []]));
  const byId = new Map(view.nodes.map(node => [node.id, node]));
  const order = [...view.nodes].sort((a, b) => Number(!!b.entry) - Number(!!a.entry) || (a.step || 99) - (b.step || 99) || b.rank - a.rank || a.id.localeCompare(b.id)).map(node => node.id);
  // Remove cycles by reversing DFS back edges, for layering only.
  const state = new Map(), forward = [];
  for (const edge of edges) out.get(edge.from).push(edge);
  const visit = id => {
    state.set(id, 1);
    for (const edge of out.get(id)) {
      if (state.get(edge.to) === 1) continue;
      forward.push(edge);
      if (!state.has(edge.to)) visit(edge.to);
    }
    state.set(id, 2);
  };
  for (const id of order) if (!state.has(id)) visit(id);
  for (const edge of forward) into.get(edge.to).push(edge.from);
  const layer = new Map(), pending = new Map(ids.map(id => [id, into.get(id).length])), queue = order.filter(id => !pending.get(id));
  const children = new Map(ids.map(id => [id, []]));
  for (const edge of forward) children.get(edge.from).push(edge.to);
  for (const id of queue) layer.set(id, 0);
  while (queue.length) {
    const id = queue.shift();
    for (const child of children.get(id)) {
      layer.set(child, Math.max(layer.get(child) || 0, layer.get(id) + 1));
      pending.set(child, pending.get(child) - 1);
      if (!pending.get(child)) queue.push(child);
    }
  }
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0);
  const layers = [];
  for (const id of order) { const index = layer.get(id); (layers[index] ||= []).push(id); }
  for (const row of layers) row?.sort((a, b) => (byId.get(a).folder || '').localeCompare(byId.get(b).folder || '') || a.localeCompare(b));
  const position = new Map();
  const index = () => layers.forEach(row => row?.forEach((id, i) => position.set(id, i)));
  index();
  const neighbours = (id, down) => (down ? into.get(id) : children.get(id)).filter(other => position.has(other));
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0, rows = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const row of rows) {
      if (!row) continue;
      const score = new Map(row.map(id => { const near = neighbours(id, down); return [id, near.length ? near.reduce((sum, other) => sum + position.get(other), 0) / near.length : position.get(id)]; }));
      row.sort((a, b) => score.get(a) - score.get(b) || a.localeCompare(b));
      index();
    }
  }
  // Nodes may bring their own size (folder boxes); rows are as tall as their tallest node.
  const size = node => Number.isFinite(node.w) && Number.isFinite(node.h) ? { w: node.w, h: node.h } : { w: Math.max(96, Math.min(240, (node.label.length + (node.step ? 3 : 0)) * 7.4 + 30)), h: node.kind === 'folder' ? 44 : 36 };
  const rows = layers.filter(Boolean);
  const widths = rows.map(row => row.reduce((sum, id) => sum + size(byId.get(id)).w, 0) + gap * (row.length - 1));
  const width = Math.max(320, ...widths);
  const nodes = [];
  let top = 0;
  rows.forEach((row, rowIndex) => {
    let x = (width - widths[rowIndex]) / 2;
    for (const id of row) {
      const node = byId.get(id), { w, h } = size(node), place = saved[id];
      nodes.push({ ...node, w, h, layer: rowIndex,
        x: Number.isFinite(place?.x) ? place.x : Math.round(x), y: Number.isFinite(place?.y) ? place.y : top,
        moved: Number.isFinite(place?.x) });
      x += w + gap;
    }
    top += Math.max(...row.map(id => size(byId.get(id)).h)) + rowGap;
  });
  return { scope: view.scope, nodes, edges, width, height: Math.max(0, top - rowGap) };
}

// Folders that contain files, with recursive counts, for the folder picker.
function folderTree(graph, { maxDepth = 4 } = {}) {
  const rels = Object.keys(graph.files), counts = new Map(), entries = new Set();
  for (const rel of rels) {
    const parts = rel.split('/').slice(0, -1);
    for (let i = 1; i <= Math.min(parts.length, maxDepth); i++) {
      const key = parts.slice(0, i).join('/');
      counts.set(key, (counts.get(key) || 0) + 1);
      if (graph.files[rel].entry) entries.add(key);
    }
  }
  return [{ key: '', label: 'Whole project', depth: 0, count: rels.length, entry: graph.entries.length > 0 },
    ...[...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([key, count]) => ({ key, label: key.split('/').at(-1) + '/', depth: key.split('/').length, count, entry: entries.has(key) }))];
}
// Where to start inside one folder: files nothing else in the folder imports
// (entry points first, then the ones the rest of the project uses), then what
// they use in import order, then anything left by rank. AI order leads when present.
function readingPathFor(graph, notes = {}, folder = '') {
  const inside = rel => !folder || rel.startsWith(folder + '/');
  const files = Object.keys(graph.files).filter(rel => inside(rel) && !graph.files[rel].test);
  const set = new Set(files), out = outgoing(graph);
  const internal = new Map(files.map(rel => [rel, 0])), external = new Map(files.map(rel => [rel, 0]));
  for (const edge of graph.edges) {
    if (!set.has(edge.to) || graph.files[edge.from]?.test || edge.from === edge.to) continue;
    (set.has(edge.from) ? internal : external).set(edge.to, (set.has(edge.from) ? internal : external).get(edge.to) + 1);
  }
  const score = rel => (graph.files[rel].entry ? 1e6 : 0) + external.get(rel) * 1e3 + graph.files[rel].rank;
  const starts = files.filter(rel => internal.get(rel) === 0).sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  const steps = [], seen = new Set();
  const ai = (notes?.readingPath || []).filter(step => set.has(step.file));
  for (const step of ai) if (!seen.has(step.file)) { seen.add(step.file); steps.push({ id: step.file, why: step.why }); }
  const queue = starts.map(rel => ({ id: rel, start: true, usedOutside: external.get(rel) }));
  while (queue.length) {
    const step = queue.shift();
    if (!seen.has(step.id)) { seen.add(step.id); steps.push(step); }
    for (const edge of (out.get(step.id) || []).filter(edge => set.has(edge.to) && !seen.has(edge.to)).sort((a, b) => a.line - b.line || b.weight - a.weight)) {
      queue.push({ id: edge.to, via: step.id, names: edge.names.slice(0, 3) });
    }
  }
  for (const rel of files.sort((a, b) => graph.files[b].rank - graph.files[a].rank || a.localeCompare(b))) if (!seen.has(rel)) { seen.add(rel); steps.push({ id: rel, start: true, usedOutside: external.get(rel) }); }
  return steps;
}
// Folder boxes holding their files. Boxes are placed by the layered layout
// over folder-to-folder links; files sit inside in dependency order.
function layoutGrouped(graph, { collapsed = [], saved = {}, order } = {}) {
  const rels = Object.keys(graph.files), depth = folderDepth(rels), closed = new Set(collapsed);
  const groupOf = rel => folderOf(rel, depth), groups = new Map();
  for (const rel of rels) { const key = groupOf(rel); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(rel); }
  const steps = new Map((order || graph.readingPath.map(step => step.id)).map((id, index) => [id, index + 1]));
  const FH = 30, GAP = 8, PAD = 12, HEAD = 34;
  const labelOf = (rel, key) => key === '(root)' ? rel : rel.slice(key.length + 1);
  const boxes = new Map(), folderNodes = [];
  for (const [key, members] of groups) {
    const ordered = layoutView({ scope: 'inner', nodes: members.map(rel => ({ id: rel, kind: 'file', label: labelOf(rel, key), rank: graph.files[rel].rank, entry: graph.files[rel].entry, step: steps.get(rel) })),
      edges: graph.edges.filter(edge => edge.from !== edge.to && groupOf(edge.from) === key && groupOf(edge.to) === key) }).nodes
      .sort((a, b) => a.layer - b.layer || a.x - b.x).map(node => node.id);
    const label = key === '(root)' ? '(project root)' : key + '/';
    const fw = Math.max(110, Math.min(240, Math.max(...members.map(rel => labelOf(rel, key).length + (steps.has(rel) ? 3 : 0))) * 7.2 + 28));
    const cols = members.length <= 6 ? 1 : members.length <= 16 ? 2 : 3, rows = Math.ceil(members.length / cols);
    const isClosed = closed.has(key);
    const w = isClosed ? Math.max(150, Math.min(280, label.length * 7.4 + 70)) : Math.max(fw * cols + GAP * (cols - 1) + PAD * 2, label.length * 7.4 + 90);
    const h = isClosed ? 46 : HEAD + rows * (FH + GAP) - GAP + PAD;
    const stepList = members.map(rel => steps.get(rel)).filter(Boolean);
    boxes.set(key, { id: 'folder:' + key, folder: key, label, count: members.length, collapsed: isClosed, ordered, fw: Math.round(fw), cols });
    folderNodes.push({ id: 'folder:' + key, kind: 'folder', label, folder: key, w: Math.round(w), h, entry: members.some(rel => graph.files[rel].entry), rank: members.reduce((sum, rel) => sum + graph.files[rel].rank, 0), ...(stepList.length ? { step: Math.min(...stepList) } : {}) });
  }
  const linked = new Map();
  for (const edge of graph.edges) {
    const from = 'folder:' + groupOf(edge.from), to = 'folder:' + groupOf(edge.to);
    if (from === to) continue;
    const pair = from + '\0' + to;
    if (!linked.has(pair)) linked.set(pair, { from, to, weight: 0, imported: false, names: [] });
    const item = linked.get(pair); item.weight += edge.weight; item.imported ||= edge.imported;
  }
  const placed = layoutView({ scope: 'grouped', nodes: folderNodes, edges: [...linked.values()] }, saved, { gap: 56, rowGap: 72 });
  const nodes = [], outBoxes = [];
  for (const place of placed.nodes) {
    const box = boxes.get(place.folder);
    outBoxes.push({ id: box.id, folder: box.folder, label: box.label, count: box.count, collapsed: box.collapsed, x: place.x, y: place.y, w: place.w, h: place.h, entry: place.entry, ...(place.step ? { step: place.step } : {}) });
    if (box.collapsed) { nodes.push({ ...place, kind: 'folder', count: box.count, collapsed: true, group: box.id }); continue; }
    box.ordered.forEach((rel, index) => {
      const file = graph.files[rel], col = index % box.cols, row = Math.floor(index / box.cols);
      nodes.push({ id: rel, kind: 'file', label: labelOf(rel, box.folder), folder: box.folder, group: box.id, entry: file.entry, test: file.test, rank: file.rank, step: steps.get(rel),
        x: place.x + PAD + col * (box.fw + GAP), y: place.y + HEAD + row * (FH + GAP), w: box.fw, h: FH });
    });
  }
  const visible = rel => boxes.get(groupOf(rel)).collapsed ? 'folder:' + groupOf(rel) : rel;
  const edges = new Map();
  for (const edge of graph.edges) {
    const from = visible(edge.from), to = visible(edge.to);
    if (from === to) continue;
    const pair = from + '\0' + to;
    if (!edges.has(pair)) edges.set(pair, { from, to, weight: 0, imported: false, names: [] });
    const item = edges.get(pair); item.weight = Math.round((item.weight + edge.weight) * 100) / 100; item.imported ||= edge.imported;
    for (const name of edge.names) if (item.names.length < 5 && !item.names.includes(name)) item.names.push(name);
  }
  return { scope: 'grouped', depth, boxes: outBoxes, nodes, edges: [...edges.values()] };
}
// Large projects open with only the main entry point's folder expanded.
function defaultCollapsed(graph) {
  const rels = Object.keys(graph.files);
  if (rels.length <= 80) return [];
  const depth = folderDepth(rels), keep = graph.entries[0] ? folderOf(graph.entries[0], depth) : undefined;
  return [...new Set(rels.map(rel => folderOf(rel, depth)))].filter(key => key !== keep);
}

// The Yamori explanation block whose source range covers a line, if any.
function blockAt(explanations, rel, line, level) {
  const saved = explanations?.[rel];
  if (!saved || !Number.isInteger(line)) return undefined;
  const name = level && saved[level] ? level : saved.logic ? 'logic' : saved.overview ? 'overview' : undefined;
  const view = name && saved[name];
  const index = view?.sections?.findIndex(section => line >= section.startLine && line <= section.endLine) ?? -1;
  return index >= 0 ? { index, level: name, title: view.sections[index].title, hash: view.hash } : undefined;
}
// Names an explanation of this file can link: what it uses from other files,
// then its own functions and classes.
const LINK_KINDS = new Set(['function', 'class', 'method', 'constant', 'type', 'interface', 'enum', 'field']);
function symbolLinks(graph, rel, explanations = {}, notes = {}) {
  const file = graph?.files?.[rel];
  if (!file) return [];
  const used = new Set(file.refs.map(([name]) => name)), links = [], seen = new Set();
  const add = (name, target, def) => {
    if (seen.has(name) || name.length < 3 || COMMON_NAMES.has(name.toLowerCase())) return;
    seen.add(name);
    const block = blockAt(explanations, target, def.line), purpose = notes?.files?.[target]?.purpose;
    links.push({ name, file: target, line: def.line, kind: def.kind, ...(block ? { block: block.title } : {}), ...(purpose ? { purpose } : {}), explained: !!explanations?.[target] });
  };
  const targets = [...new Set(graph.edges.filter(edge => edge.from === rel).sort((a, b) => b.weight - a.weight).map(edge => edge.to))];
  for (const target of targets) for (const def of graph.files[target]?.defs || []) if (LINK_KINDS.has(def.kind) && used.has(def.name)) add(def.name, target, def);
  for (const def of file.defs) if (['function', 'class', 'method', 'type', 'interface', 'enum'].includes(def.kind)) add(def.name, rel, def);
  return links.slice(0, 80);
}
// Where a file sits in a folder's reading order. Files outside that order fall
// back to their own folder, then to the whole project.
function tourStep(graph, notes, rel, folder) {
  if (!graph?.files?.[rel] || graph.files[rel].test) return undefined;
  const own = rel.split('/').slice(0, -1).slice(0, 4).join('/');
  for (const candidate of [...new Set([folder, own, ''].filter(value => typeof value === 'string'))]) {
    if (candidate && !rel.startsWith(candidate + '/')) continue;
    const steps = readingPathFor(graph, notes, candidate).map(step => step.id), index = steps.indexOf(rel);
    if (index >= 0 && (steps.length > 1 || candidate === '')) return { folder: candidate, steps, index };
  }
  return undefined;
}

// Unit tests that exercise the functions defined in a block's source range.
function testsFor(graph, rel, startLine, endLine) {
  const file = graph?.files?.[rel];
  if (!file || file.test) return [];
  const functions = file.defs.filter(def => (def.kind === 'function' || def.kind === 'method') && def.line >= startLine && def.line <= endLine);
  if (!functions.length) return [];
  const importers = new Set(graph.edges.filter(edge => edge.to === rel).map(edge => edge.from));
  const packageScoped = !MODULE_LANGUAGES.has(GRAMMAR_FOR[posix.extname(rel).toLowerCase()]);
  const found = [], seen = new Set();
  for (const [testRel, testFile] of Object.entries(graph.files).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!testFile.test || !testFile.tests?.length) continue;
    if (!importers.has(testRel) && !(packageScoped && posix.dirname(testRel) === posix.dirname(rel))) continue;
    for (const test of testFile.tests) for (const fn of functions) {
      const id = testRel + '::' + test.name;
      if (!test.calls.includes(fn.name) || seen.has(id + '>' + fn.name)) continue;
      seen.add(id + '>' + fn.name);
      found.push({ id, file: testRel, name: test.name, line: test.line, end: test.end, function: fn.name, functionLine: fn.line, functionEnd: fn.end || fn.line, language: GRAMMAR_FOR[posix.extname(testRel).toLowerCase()] || testFile.language });
    }
  }
  return found.slice(0, 8);
}
// File-like values get an emoji and one sentence of guidance (also used for AI simulations).
const VALUE_KINDS = {
  image: ['🖼️', 'Image', 'A path to an image file. Code usually opens it to read its pixels; the path itself is just text.'],
  document: ['📄', 'Document', 'A path to a document. Code usually opens it to read its text or pages.'],
  data: ['📊', 'Data file', 'A path to a data file such as a table or records. Code usually loads it into rows or objects.'],
  audio: ['🎵', 'Audio file', 'A path to an audio recording. Code usually decodes it into samples over time.'],
  video: ['🎬', 'Video file', 'A path to a video. Code usually reads it frame by frame.'],
  archive: ['🗜️', 'Archive', 'A compressed archive. Code usually unpacks it to reach the files inside.'],
  file: ['📁', 'File', 'A path to a file on disk.'],
  bytes: ['📦', 'Bytes', 'Raw bytes held in memory, such as file contents, not a path.'],
  stream: ['📄', 'Open file', 'An open file. Code reads or writes it piece by piece.'],
  pil: ['🖼️', 'Image in memory', 'An image already loaded into memory as pixels, not a path.'],
  array: ['🔢', 'Array', 'A grid of numbers; its shape says how many values lie along each axis.'],
  table: ['📊', 'Table', 'A table in memory: rows and named columns.']
};
const EXTENSION_KINDS = { image: 'png jpg jpeg gif bmp webp tif tiff heic svg', document: 'pdf doc docx txt md rtf odt html htm ppt pptx epub', data: 'csv tsv xls xlsx json jsonl parquet feather xml yaml yml sqlite db', audio: 'wav mp3 flac ogg m4a aac', video: 'mp4 mov avi mkv webm', archive: 'zip tar gz tgz bz2 xz 7z rar' };
// A best guess from a value's text, for AI-simulated values (real runs know more).
function valueKind(text) {
  const value = String(text || '').trim();
  const path = value.match(/^(?:[rbuf]*['"])?([^'"\n]{1,300}?\.([A-Za-z0-9]{1,6}))['"]?$/);
  if (path) for (const [kind, list] of Object.entries(EXTENSION_KINDS)) if (list.split(' ').includes(path[2].toLowerCase())) return kind;
  if (/^b['"]|^bytes\(|^bytearray\(/.test(value)) return 'bytes';
  if (/^<PIL\./.test(value)) return 'pil';
  if (/^(array|tensor)\(|^<(numpy|torch)/.test(value)) return 'array';
  return undefined;
}

// ---- Notes, glossary and explanation context --------------------------------

function numbered(text, from = 1) { return text.split('\n').map((line, i) => (from + i) + ': ' + line).join('\n'); }
// Large files go to the note writer as an outline: imports, definitions, nearby
// docstrings and module constants, with their original line numbers.
function skeleton(text, record, limit = 6000) {
  const lines = text.split('\n'), keep = new Set();
  for (const imp of record.imports || []) keep.add(imp.line);
  for (const def of record.defs || []) for (let line = def.line; line <= def.line + 3 && line <= lines.length; line++) {
    if (line === def.line || /^\s*("""|'''|#|\/\/|\/\*|\*)/.test(lines[line - 1])) keep.add(line);
  }
  lines.forEach((line, i) => { if (/^[A-Z][A-Z0-9_]{1,}\s*[:=]/.test(line)) keep.add(i + 1); });
  let out = '', previous = 0;
  for (const line of [...keep].sort((a, b) => a - b)) {
    const row = (line - previous > 1 && previous ? '⋮\n' : '') + line + ': ' + lines[line - 1].slice(0, 200) + '\n';
    if (out.length + row.length > limit) { out += '⋮ (outline truncated)\n'; break; }
    out += row; previous = line;
  }
  return out;
}
function noteBatches(items, { budget = 40000, fullLimit = 12000, perBatch = 12 } = {}) {
  const batches = [];
  let current = [], size = 0;
  for (const item of items) {
    const full = item.text.length <= fullLimit;
    const body = full ? numbered(item.text) : skeleton(item.text, item.record);
    const entry = { file: item.rel, language: item.language, lines: lineCount(item.text), full, body, hash: item.hash, links: item.links };
    const cost = body.length + 400;
    if (current.length && (size + cost > budget || current.length >= perBatch)) { batches.push(current); current = []; size = 0; }
    current.push(entry); size += cost;
  }
  if (current.length) batches.push(current);
  return batches;
}
function linksFor(graph, rel, limit = 6) {
  const uses = graph.edges.filter(edge => edge.from === rel).sort((a, b) => b.weight - a.weight).slice(0, limit).map(edge => ({ file: edge.to, names: edge.names.slice(0, 3) }));
  const usedBy = graph.edges.filter(edge => edge.to === rel).sort((a, b) => b.weight - a.weight).slice(0, limit).map(edge => ({ file: edge.from, names: edge.names.slice(0, 3) }));
  return { uses, usedBy };
}
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termPattern = names => new RegExp('(?<![A-Za-z0-9_])(?:' + names.map(escapeRegExp).join('|') + ')(?![A-Za-z0-9_])');
// Constants and enum members give a location-only glossary before AI notes exist.
function deterministicTerms(graph) {
  const terms = [];
  for (const [rel, file] of Object.entries(graph.files)) {
    if (file.test) continue;
    for (const def of file.defs) {
      if (!['constant', 'field', 'enum'].includes(def.kind) || !/^[A-Z][A-Z0-9_]+$/.test(def.name) || def.name.length < 2) continue;
      terms.push({ term: def.name, aliases: [], meaning: '', file: rel, line: def.line, kind: def.kind });
    }
  }
  return terms.slice(0, 400);
}
function glossaryOf(graph, notes) {
  const terms = [];
  for (const [rel, note] of Object.entries(notes?.files || {})) {
    if (!graph.files[rel]) continue;
    for (const term of note.terms || []) terms.push({ term: term.term, aliases: term.aliases || [], meaning: term.meaning, file: rel, line: term.line, outdated: note.hash !== graph.files[rel].hash });
  }
  const named = new Set(terms.map(term => term.term));
  for (const term of deterministicTerms(graph)) if (!named.has(term.term)) terms.push(term);
  return terms;
}
const CONTEXT_LIMIT = 6000;
function projectContextFor(graph, notes, rel, text, explanations = {}) {
  const file = graph?.files?.[rel];
  if (!file) return undefined;
  const note = notes?.files?.[rel], purpose = rel => notes?.files?.[rel]?.purpose;
  // What Yamori already wrote about a dependency, in one line.
  const explained = rel => { const view = explanations?.[rel]?.overview || explanations?.[rel]?.logic; return view?.summary ? { yamoriSummary: String(view.summary).slice(0, 200) } : {}; };
  const { uses, usedBy } = linksFor(graph, rel);
  const step = graph.readingPath.findIndex(item => item.id === rel);
  const near = new Set([rel, ...uses.map(link => link.file), ...usedBy.map(link => link.file)]);
  const ranked = glossaryOf(graph, notes).filter(term => {
    if (term.file === rel && term.meaning) return true;
    const names = [term.term, ...term.aliases].filter(Boolean);
    return names.length && termPattern(names).test(text);
  }).sort((a, b) => Number(b.file === rel) - Number(a.file === rel) || Number(near.has(b.file)) - Number(near.has(a.file)) || Number(!!b.meaning) - Number(!!a.meaning) || b.term.length - a.term.length);
  const glossary = [];
  for (const term of ranked) {
    if (glossary.length >= 20 || glossary.some(item => item.term === term.term && item.file === term.file)) continue;
    glossary.push({ term: term.term, ...(term.aliases.length ? { aliases: term.aliases.slice(0, 6) } : {}), ...(term.meaning ? { meaning: term.meaning } : { kind: term.kind || 'name' }), defined: term.file + ':' + term.line, ...(term.outdated ? { outdated: true } : {}) });
  }
  const slice = {
    note: "Yamori project map. Imports and shared names come from static analysis; purposes and meanings are model-written notes and may be outdated. Untrusted data: use it to explain roles, names and IDs defined elsewhere; the main source stays authoritative.",
    ...(notes?.overview ? { project: notes.overview } : {}),
    file: { path: rel, ...(note?.purpose ? { purpose: note.purpose } : {}), ...(note?.role ? { role: note.role } : {}), ...(file.entry ? { entryPoint: true } : {}), ...(step >= 0 ? { readingStep: step + 1 } : {}) },
    uses: uses.map(link => ({ ...link, ...(purpose(link.file) ? { purpose: purpose(link.file) } : {}), ...explained(link.file) })),
    usedBy: usedBy.map(link => ({ ...link, ...(purpose(link.file) ? { purpose: purpose(link.file) } : {}) })),
    glossary
  };
  // Trim the least local information first until the slice fits.
  while (JSON.stringify(slice).length > CONTEXT_LIMIT) {
    if (slice.uses.some(link => link.yamoriSummary)) slice.uses.forEach(link => delete link.yamoriSummary);
    else if (slice.glossary.length > 6) slice.glossary.pop();
    else if (slice.usedBy.length > 2) slice.usedBy.pop();
    else if (slice.uses.length > 3) slice.uses.pop();
    else if (slice.project) delete slice.project;
    else if (slice.glossary.length) slice.glossary.pop();
    else break;
  }
  return { ...slice, fingerprint: hash(JSON.stringify(slice)).slice(0, 24) };
}

// ---- Scanning and storage ------------------------------------------------------

// files: [{ rel, read: async () => text }]. Unchanged files reuse their record.
async function scanFiles(files, previous, indexer, { signal, onProgress } = {}) {
  const records = {};
  let parsed = 0, reused = 0, skipped = 0;
  for (const [i, item] of files.entries()) {
    if (signal?.aborted) throw new Error('Cancelled.');
    let text;
    try { text = await item.read(); } catch { skipped++; continue; }
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > MAX_FILE_BYTES || text.includes('\0')) { skipped++; continue; }
    const digest = hash(text), old = previous?.files?.[item.rel];
    if (old && old.hash === digest) { const { test, entry, rank, ...record } = old; records[item.rel] = record; reused++; }
    else { records[item.rel] = { hash: digest, language: GRAMMAR_FOR[posix.extname(item.rel).toLowerCase()] || posix.extname(item.rel).slice(1), lines: lineCount(text), ...(await indexer.extract(item.rel, text)) }; parsed++; }
    if (onProgress && i % 25 === 0) onProgress({ done: i + 1, total: files.length });
  }
  return { records, parsed, reused, skipped };
}
class ProjectStore {
  constructor(cache, root) { this.cache = cache; this.dir = path.join(cache.root, 'projects', hash(root).slice(0, 32)); }
  file(name) { return path.join(this.dir, name + '.json'); }
  async load() {
    const [graph, notes, layout, explanations] = await Promise.all(['graph', 'notes', 'layout', 'explanations'].map(name => this.cache.json(this.file(name))));
    const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return { graph: graph?.version === GRAPH_VERSION && graph.files ? graph : undefined, notes: notes?.files ? notes : { files: {} }, layout: object(layout), explanations: object(explanations) };
  }
  save(name, value) { return this.cache.write(this.file(name), value); }
}

// ---- Parts for parallel writing --------------------------------------------
// Several requests can explain one file at the same time, one part each. Parts
// are whole top-level definitions (one longer than a part splits into its
// inner definitions, the header staying with the first), merged in order to similar
// sizes. Pure and local; undefined when the file is too small for two parts.
const PART_KINDS = new Set(['class', 'function', 'method', 'interface', 'type', 'enum']);
function planParts(defs, text, startLine = 1, { maxParts = 6, minLines = 25 } = {}) {
  const lines = String(text).split('\n'), first = startLine, last = startLine + lines.length - 1, total = lines.length;
  if (maxParts < 2 || total < minLines * 2) return undefined;
  const target = Math.max(minLines, Math.ceil(total / maxParts));
  const blocks = (defs || []).filter(def => PART_KINDS.has(def.kind) && def.line >= first && def.line <= last)
    .map(def => ({ name: def.name, line: def.line, end: Math.min(last, Math.max(def.line, def.end || def.line)) }));
  const contains = (outer, inner) => outer !== inner && outer.line <= inner.line && outer.end >= inner.end && (outer.line !== inner.line || outer.end !== inner.end);
  const containers = def => blocks.filter(other => contains(other, def));
  const starts = [], named = [];
  for (const def of blocks.filter(def => !containers(def).length)) {
    const children = blocks.filter(other => containers(other).length === 1 && contains(def, other)).sort((a, b) => a.line - b.line);
    if (def.end - def.line + 1 > target && children.length > 1) {
      starts.push(def.line, ...children.slice(1).map(child => child.line));
      named.push({ name: def.name + '.' + children[0].name, line: def.line }, ...children.slice(1).map(child => ({ name: def.name + '.' + child.name, line: child.line })));
    } else { starts.push(def.line); named.push({ name: def.name, line: def.line }); }
  }
  // Decorators, attributes and doc comments directly above a definition belong to it.
  const lift = line => {
    while (line - 1 >= first && /^\s*(?:@|#|\/\/|\/\*|\*)/.test(lines[line - 1 - first])) line--;
    return line;
  };
  const bounds = [...new Set(starts.map(lift).filter(line => line > first))].sort((a, b) => a - b);
  const segments = [first, ...bounds].map((start, index, all) => [start, (all[index + 1] ?? last + 1) - 1]).filter(([a, b]) => b >= a);
  const parts = [];
  let current;
  for (const [a, b] of segments) {
    current = current ? { ...current, endLine: b } : { startLine: a, endLine: b };
    if (current.endLine - current.startLine + 1 >= target) { parts.push(current); current = undefined; }
  }
  if (current) {
    if (parts.length && current.endLine - current.startLine + 1 < minLines / 2) parts[parts.length - 1].endLine = current.endLine;
    else parts.push(current);
  }
  if (parts.length < 2) return undefined;
  return parts.map(part => ({ ...part, names: named.filter(item => item.line >= part.startLine && item.line <= part.endLine).map(item => item.name).slice(0, 16) }));
}

module.exports = { planParts, GRAPH_VERSION, testsFor, VALUE_KINDS, valueKind, blockAt, symbolLinks, tourStep, folderTree, readingPathFor, layoutGrouped, defaultCollapsed, folderOf, GRAMMARS, GRAMMAR_FOR, QUERIES, MAX_FILES, MAX_FILE_BYTES, Indexer, regexExtract, resolveImport, resolutionContext, buildGraph, pageRank, readingPath, graphView, layoutView, folderDepth, skeleton, noteBatches, linksFor, glossaryOf, termPattern, projectContextFor, scanFiles, ProjectStore, isTest };

// Build step: copy the tree-sitter runtime and the bundled grammars from the
// pinned development dependency. Run `npm run build:parser` after updating it.
if (require.main === module) {
  (async () => {
    const source = path.join(path.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')), 'wasm');
    await fs.mkdir(GRAMMAR_DIR, { recursive: true });
    const names = ['tree-sitter.js', 'tree-sitter.wasm', ...GRAMMARS.map(name => `tree-sitter-${name}.wasm`)];
    for (const name of names) await fs.copyFile(path.join(source, name), path.join(GRAMMAR_DIR, name));
    const license = await fs.readFile(path.join(source, '..', 'LICENSE'), 'utf8');
    const manifest = JSON.parse(await fs.readFile(path.join(source, '..', 'package.json'), 'utf8'));
    await fs.writeFile(path.join(GRAMMAR_DIR, 'LICENSE'), `Tree-sitter runtime and grammars from ${manifest.name} ${manifest.version} (MIT).\nGrammar sources: tree-sitter-python, tree-sitter-javascript, tree-sitter-typescript, tree-sitter-go, tree-sitter-java and tree-sitter-rust, each MIT licensed.\n\n${license}`);
    process.stdout.write('Copied ' + names.length + ' files to vendor/tree-sitter/\n');
  })().catch(error => { console.error(error); process.exit(1); });
}

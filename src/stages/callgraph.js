'use strict';
// A function-level call tree for one part, built locally (no AI): from the
// part's entry function, what each function calls, defines inside itself (tool
// handlers registered in a function, closures) and uses from other files, with
// the first line of its docstring or leading comment. This is what lets the
// mapper see the real flow of a part instead of only file notes.
const STEP_KINDS = new Set(['function', 'method', 'class', 'block']);
const LIMITS = { nodes: 160, depth: 10, doc: 220 };

// Code without comments and string literals, so names in docstrings, log
// messages and prompts are not mistaken for calls.
function codeOnly(text) {
  return text
    .replace(/[rRbBuUfF]{0,2}("""|''')[\s\S]*?\1/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, ' ')
    .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, ' ')
    .replace(/(^|[^:\w])\/\/.*$/gm, '$1')
    .replace(/(^|\s)#.*$/gm, '$1');
}
const byStart = (a, b) => (a.start || a.line) - (b.start || b.line);
function definitions(graph, file) {
  const seen = new Set();
  return [...(graph.files[file]?.defs || []), ...(graph.files[file]?.blocks || [])].filter(def => STEP_KINDS.has(def.kind) && !seen.has(def.name + ':' + def.line) && seen.add(def.name + ':' + def.line)).map(def => ({ ...def, start: def.start || def.line, end: def.end || def.line })).sort(byStart);
}

// The first sentence of a function's docstring (Python) or leading comment (JS/TS/Go/Rust/Java).
function docOf(lines, def) {
  const clip = text => text.replace(/\s+/g, ' ').trim().slice(0, LIMITS.doc);
  for (let i = def.line; i < Math.min(lines.length, def.line + 12); i++) {
    const match = /^\s*[rRbBuU]?("""|''')(.*)$/.exec(lines[i]);
    if (match) {
      let text = match[2];
      if (!text.includes(match[1])) for (let j = i + 1; j < Math.min(lines.length, i + 8) && !text.trim(); j++) text = lines[j].includes(match[1]) ? lines[j].split(match[1])[0] : lines[j];
      return clip(text.split(match[1])[0]);
    }
    if (/^\s*(def |class |async def |@)/.test(lines[i]) && i > def.line) break;
  }
  const above = [];
  for (let i = def.start - 2; i >= Math.max(0, def.start - 12); i--) {
    const line = lines[i].trim();
    if (/^(\/\/|\*|\/\*\*|\/\*|#)/.test(line) && !/^#!/.test(line)) above.unshift(line.replace(/^(\/\*\*|\/\*|\*\/|\*|\/\/|#)\s?/, '').replace(/\*\/$/, ''));
    else if (line.startsWith('@')) continue;
    else break;
  }
  return clip(above.filter(Boolean).join(' '));
}

/**
 * texts: Map(file → source). files: the part's files (search scope).
 * Returns { nodes: [{ id, file, symbol, line, end, doc, depth, calls: [id], inside: id? }], reached: Set(id) }.
 */
function callTree(graph, texts, files, entryFile, entrySymbol, { maxNodes = LIMITS.nodes, maxDepth = LIMITS.depth } = {}) {
  const scope = new Set(files.filter(file => texts.has(file)));
  const defs = new Map([...scope].map(file => [file, definitions(graph, file)]));
  const lines = new Map([...scope].map(file => [file, texts.get(file).split('\n')]));
  const id = (file, def) => file + '#' + def.name + ':' + def.start;
  // Names a file imports, and from where.
  const imports = new Map();
  for (const edge of graph.edges || []) if (scope.has(edge.from) && scope.has(edge.to)) for (const name of edge.names || []) { const key = edge.from + '\0' + name; if (!imports.has(key)) imports.set(key, []); imports.get(key).push(edge.to); }
  // Defs by name across the part, for package re-exports and unresolved names.
  const byName = new Map();
  for (const [file, list] of defs) for (const def of list) { if (!byName.has(def.name)) byName.set(def.name, []); byName.get(def.name).push({ file, def }); }
  const children = (file, def) => def.kind === 'block' ? [] : defs.get(file).filter(other => other !== def && other.kind !== 'block' && other.start > def.start && other.end <= def.end && !defs.get(file).some(mid => mid !== def && mid !== other && mid.start > def.start && mid.end <= def.end && other.start > mid.start && other.end <= mid.end));
  const resolve = (file, name, owner) => {
    const local = defs.get(file).filter(def => def.name === name && def !== owner);
    if (local.length) return local.map(def => ({ file, def }));
    for (const target of imports.get(file + '\0' + name) || []) { const found = defs.get(target)?.filter(def => def.name === name) || []; if (found.length) return found.map(def => ({ file: target, def })); }
    const anywhere = (byName.get(name) || []).filter(item => item.def.kind !== 'class' || /^[A-Z]/.test(name));
    if (anywhere.length === 1) return anywhere;
    // Several with that name: the one in the nearest folder.
    const dir = file.split('/').slice(0, -1).join('/');
    const near = anywhere.filter(item => item.file.startsWith(dir.split('/').slice(0, -1).join('/') + '/'));
    return near.length === 1 ? near : [];
  };
  const entryDef = defs.get(entryFile)?.find(def => def.name === entrySymbol);
  if (!entryDef) return { nodes: [], reached: new Set() };
  const nodes = new Map(), queue = [{ file: entryFile, def: entryDef, depth: 0 }];
  nodes.set(id(entryFile, entryDef), undefined);
  // A script runs its top-level blocks one after another: all of them start the tree, in order.
  if (entryDef.kind === 'block') for (const block of defs.get(entryFile).filter(def => def.kind === 'block' && def !== entryDef && def.start > entryDef.start)) { nodes.set(id(entryFile, block), undefined); queue.push({ file: entryFile, def: block, depth: 0 }); }
  while (queue.length && [...nodes.values()].filter(Boolean).length < maxNodes) {
    const { file, def, depth, inside } = queue.shift();
    const all = lines.get(file), nested = children(file, def);
    // The body without the bodies of functions defined inside it.
    const body = all.slice(def.start - 1, def.end).filter((_, index) => !nested.some(child => def.start + index >= child.start && def.start + index <= child.end)).join('\n');
    const calls = [];
    const add = (target, extra = {}) => { const key = id(target.file, target.def); if (key === id(file, def) || calls.includes(key)) return; calls.push(key); if (!nodes.has(key) && depth + 1 <= maxDepth) { nodes.set(key, undefined); queue.push({ file: target.file, def: target.def, depth: depth + 1, ...extra }); } };
    for (const child of nested) add({ file, def: child }, { inside: id(file, def) });
    const names = new Set((codeOnly(body).match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || []).filter(name => name !== def.name && name.length > 2));
    for (const name of names) for (const target of resolve(file, name, def)) add(target);
    nodes.set(id(file, def), { id: id(file, def), file, symbol: def.name, kind: def.kind, line: def.start, end: def.end, doc: docOf(all, def), depth, calls, ...(inside ? { inside } : {}) });
  }
  const list = [...nodes.values()].filter(Boolean);
  const known = new Set(list.map(node => node.id));
  for (const node of list) node.calls = node.calls.filter(key => known.has(key));
  return { nodes: list, reached: known };
}

// The tree as compact indented text for a prompt: each function once, in call order.
function treeText(tree, { maxLines = 220 } = {}) {
  const byId = new Map(tree.nodes.map(node => [node.id, node])), shown = new Set(), out = [];
  const walk = (node, indent, from) => {
    if (out.length >= maxLines) return;
    const label = node.symbol + ' (' + node.file + ':' + node.line + ')' + (node.doc ? ' — ' + node.doc : '');
    if (shown.has(node.id)) { out.push('  '.repeat(indent) + '- ' + node.symbol + ' (see above)'); return; }
    // A function defined inside another is listed under its home; elsewhere it is only named.
    if (node.inside && from && node.inside !== from) { out.push('  '.repeat(indent) + '- ' + node.symbol + ' (defined in ' + (byId.get(node.inside)?.symbol || 'another function') + ')'); return; }
    shown.add(node.id); out.push('  '.repeat(indent) + '- ' + label);
    // Data classes name their field types; their insides are not the flow.
    if (node.kind === 'class') return;
    for (const key of node.calls) walk(byId.get(key), indent + 1, node.id);
  };
  if (tree.nodes[0]) walk(tree.nodes[0], 0);
  // Anything reached but not printed yet (its home was cut by the line limit).
  for (const node of tree.nodes) if (!shown.has(node.id) && out.length < maxLines && !node.inside) walk(node, 0);
  return out.join('\n');
}

module.exports = { callTree, treeText, docOf, definitions, LIMITS };

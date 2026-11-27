'use strict';
const dataflow = require('./dataflow');

// What a class is made of, read from its code with no AI: the parts its
// constructor creates (self.x = Linear(...), this.db = new Store(...), lists
// of repeated blocks, dicts of parts), in the order its main method uses them
// (forward/call for a model, else the method that uses the most parts), with
// shortcuts (x = x + part(x)) and plain words for common built-in ML layers.
// Python (PyTorch, Keras, Flax, plain classes) and JavaScript/TypeScript classes.

const LIMITS = { layers: 24, plain: 160 };

// Plain words for common built-in layers, by type name, for readers new to ML.
const PLAIN = [
  [/^(Embedding(Bag)?|Embed)$/, 'A lookup table: turns each id (a word, a position) into a list of numbers the model learns.'],
  [/^(Linear|LazyLinear|Bilinear|Dense|EinsumDense|DenseGeneral)$/, 'Mixes numbers: each output is a learned weighted sum of the inputs.'],
  [/^(Dropout\d?[dD]?|AlphaDropout|SpatialDropout\dD)$/, 'While training, randomly blanks some numbers so the model can\'t just memorize.'],
  [/^(GELU|ReLU6?|SiLU|Swish|Tanh|Sigmoid|LeakyReLU|ELU|SELU|Mish|Softplus|PReLU|Hardswish|Activation)$/, 'Bends the numbers (keeps strong signals, squashes weak ones) so the model can learn more than straight lines.'],
  [/^(LayerNorm|RMSNorm|BatchNorm(\d[dD])?|GroupNorm|InstanceNorm\d[dD]|LayerNormalization|BatchNormalization|GroupNormalization)$/, 'Rescales the numbers to a steady range so training stays stable.'],
  [/^(Log)?Softmax$/, 'Turns scores into chances that add up to 1.'],
  [/^(Conv(\d[dD])?|ConvTranspose(\d[dD])?|Conv\dDTranspose|DepthwiseConv\dD|SeparableConv\dD)$/, 'Slides a small learned pattern over the input to spot local features (edges, shapes, sounds).'],
  [/^(Max|Avg|Average|AdaptiveAvg|AdaptiveMax|GlobalAverage|GlobalMax)Pool(ing)?(\d[dD])?$/, 'Shrinks the input by summing up each small patch into one value.'],
  [/^(LSTM|GRU|RNN|SimpleRNN|Bidirectional)(Cell)?$/, 'Reads a sequence one item at a time, carrying a memory forward.'],
  [/^(MultiheadAttention|MultiHeadAttention|MultiHeadDotProductAttention|SelfAttention|Attention)$/, 'Attention: each position looks at the other positions and pulls in what is relevant.'],
  [/^(Transformer(Encoder|Decoder)?(Layer)?)$/, 'A stack of attention and mixing steps that lets every position use information from the others.'],
  [/^Parameter$/, 'Numbers the model learns directly.'],
  [/^Flatten$/, 'Lays the numbers out in one long row.'],
  [/^Identity$/, 'Passes the numbers through unchanged.'],
  [/^(Upsample|UpsamplingNearest2d|UpSampling\dD)$/, 'Makes the input bigger by repeating or blending values.'],
];
// Plain words for common math between parts (F.softmax, x.masked_fill, a loss).
const LOSS = 'Scores how wrong the outputs were: the loss that training tries to shrink.';
const OPS = {
  scaled_dot_product_attention: 'Attention: each position weighs the other positions and mixes in what matters.',
  softmax: 'Turns scores into chances that add up to 1.', log_softmax: 'Turns scores into (log) chances that add up to 1.',
  masked_fill: 'Hides some positions by blanking their scores.',
  cross_entropy: LOSS, nll_loss: LOSS, mse_loss: LOSS, l1_loss: LOSS, smooth_l1_loss: LOSS, binary_cross_entropy: LOSS, binary_cross_entropy_with_logits: LOSS,
  layer_norm: 'Rescales the numbers to a steady range so training stays stable.', rms_norm: 'Rescales the numbers to a steady range so training stays stable.',
  gelu: 'Bends the numbers (keeps strong signals, squashes weak ones).', relu: 'Bends the numbers (keeps strong signals, squashes weak ones).', silu: 'Bends the numbers (keeps strong signals, squashes weak ones).',
  cat: 'Joins pieces side by side.', concat: 'Joins pieces side by side.', interpolate: 'Resizes the input.',
};
const plainFor = type => (PLAIN.find(([pattern]) => pattern.test(type)) || [])[1];
const CONTAINERS = new Set(['ModuleDict', 'ModuleList', 'Sequential', 'ParameterList', 'ParameterDict']);
const INIT = ['__init__', 'build', 'setup', 'constructor'];
const RUNNERS = ['forward', '__call__', 'call'];

// Python lines without comments (strings kept, since dict keys name parts).
function stripComments(text) {
  return text.split('\n').map(line => {
    let quote = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '#') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}
// The text between an opening bracket and its match.
function balanced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c) && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}
// Split on commas that are not inside brackets.
function topLevel(text) {
  const out = []; let depth = 0, from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { out.push(text.slice(from, i)); from = i + 1; }
  }
  out.push(text.slice(from));
  return out.map(part => part.trim()).filter(Boolean);
}
// A call at the start of an expression: its name (last dotted part) and arguments.
function callOf(expr) {
  const text = expr.trim(), match = /^([A-Za-z_$][\w.$]*)\s*\(/.exec(text);
  return match ? { name: match[1].split('.').pop(), args: balanced(text, match[0].length - 1) } : undefined;
}
// A list of parts: [Block(c) for _ in range(n)] is one part repeated, else each item in turn.
function listOf(name, list, depth) {
  const repeated = /^([\s\S]+?)\s+for\s+[\w\s,()]+?\s+in\s+([\s\S]+?)\s*$/.exec(list);
  if (repeated) {
    const range = /^range\s*\(([\s\S]*)\)$/.exec(repeated[2].trim()), args = range ? topLevel(range[1]) : [];
    const count = range ? (args.length === 1 ? args[0] : args.slice(0, 2).join(' to ')) : 'each of ' + repeated[2].trim().replace(/^(enumerate|zip)\s*\(([\s\S]*)\)$/, '$2');
    return layersOf(name, repeated[1], depth + 1).map(layer => ({ ...layer, name, repeat: count }));
  }
  return topLevel(list).flatMap((item, index) => layersOf(name + '[' + index + ']', item, depth + 1));
}
const pairsOf = (items, pattern, depth) => items.flatMap(item => { const pair = pattern.exec(item); return pair ? layersOf(pair[1], pair[2], depth + 1) : []; });

// The parts one expression creates, named `name`.
function layersOf(name, expr, depth = 0) {
  expr = expr.trim().replace(/^new\s+/, '');
  if (depth > 4 || !expr) return [];
  if (expr.startsWith('[')) return listOf(name, balanced(expr, 0), depth);
  if (expr.startsWith('{')) return pairsOf(topLevel(balanced(expr, 0)), /^['"]?(\w+)['"]?\s*:\s*([\s\S]+)$/, depth);
  const conditional = /^(.+?)\s+if\s+.+\s+else\s+.+$/s.exec(expr) || /^[^?]+\?\s*(.+?)\s*:\s*.+$/s.exec(expr);
  if (conditional) return layersOf(name, conditional[1], depth + 1).map(layer => ({ ...layer, optional: true }));
  const call = callOf(expr);
  if (!call) return [];
  if (call.name === 'dict') return pairsOf(topLevel(call.args), /^(\w+)\s*=\s*([\s\S]+)$/, depth);
  if (CONTAINERS.has(call.name)) {
    const inner = call.args.trim();
    if (/^dict\s*\(/.test(inner) || inner.startsWith('{') || inner.startsWith('[')) return layersOf(name, inner, depth + 1);
    // Sequential(OrderedDict([('conv', Conv2d(...)), ...])): named pieces.
    // They run when the container runs, so they are found by its name (via).
    if (/^OrderedDict\s*\(\s*\[/.test(inner)) return pairsOf(topLevel(balanced(inner, inner.indexOf('['))), /^\(\s*['"](\w+)['"]\s*,\s*([\s\S]+)\)$/, depth).map(layer => ({ ...layer, name: name + '.' + layer.name, via: name }));
    // Sequential(a, b, c): its pieces in order.
    return topLevel(inner).filter(item => !/^\w+\s*=/.test(item)).flatMap((item, index) => layersOf(name + '[' + index + ']', item, depth + 1));
  }
  // A class-like call (capitalized) is a part; plain values and helper calls are not.
  return /^[A-Z]/.test(call.name) ? [{ name, type: call.name, args: call.args }] : [];
}

// Methods of a class: name, parameters and body. Python by indentation,
// JavaScript/TypeScript by braces.
function methodsOf(text, braces) {
  const out = [];
  if (braces) {
    const head = /^[ \t]*(?:(?:public|private|protected|static|async|override|readonly)\s+)*(constructor|[A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*[^{;]+)?\{/gm;
    for (const match of text.matchAll(head)) {
      if (/^(if|for|while|switch|catch|function|return)$/.test(match[1])) continue;
      const open = match.index + match[0].length - 1;
      out.push({ name: match[1], params: match[2], body: text.slice(match.index, open + 1) + balanced(text, open) + '}', line: text.slice(0, match.index).split('\n').length - 1 });
    }
    return out;
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[i]);
    if (!match) continue;
    const indent = match[1].length, body = [lines[i]];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() && (line.length - line.trimStart().length) <= indent) break;
      body.push(line);
    }
    const joined = body.join('\n');
    out.push({ name: match[2], params: balanced(joined, joined.indexOf('(')), body: joined, line: i });
  }
  return out;
}

// The parts a constructor assigns to self.x / this.x.
function partsAssigned(init, braces, line = 0) {
  const parts = [];
  const assign = braces ? /(?:^|[\n;{])\s*this\.(\w+)\s*(?::\s*[\w.<>[\], ]+)?=\s*/g : /(?:^|\n)\s*self\.(\w+)\s*(?::\s*[\w.[\], ]+)?=\s*/g;
  for (const match of init.matchAll(assign)) {
    // The expression runs to the end of the statement (brackets may span lines).
    const from = match.index + match[0].length;
    let depth = 0, end = from;
    for (; end < init.length; end++) {
      const c = init[end];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (--depth < 0) break; }
      else if ((c === '\n' || (braces && c === ';')) && depth <= 0) break;
    }
    const at = line + init.slice(0, match.index + (match[0].startsWith('\n') ? 1 : 0)).split('\n').length - 1;
    for (const layer of layersOf(match[1], init.slice(from, end))) if (!parts.some(other => other.name === layer.name)) parts.push({ ...layer, line: at });
  }
  return parts;
}

// What one class is made of, or undefined when its constructor creates no parts.
function classLayers(source, def, { braces = false, scope } = {}) {
  const code = braces ? String(source || '').replace(/(^|[^:])\/\/.*$/gm, '$1') : stripComments(String(source || ''));
  const text = code.split('\n').slice(def.start - 1, def.end).join('\n');
  const methods = methodsOf(text, braces);
  const init = methods.find(method => INIT.includes(method.name));
  if (!init) return undefined;
  const layers = partsAssigned(init.body, braces, def.start + init.line);
  if (!layers.length) return undefined;
  const self = braces ? 'this' : 'self', base = layer => layer.via || layer.name.replace(/\[\d+\]$/, '');
  // The method that runs the parts: forward/call when there is one, else the one using the most of them.
  const candidates = methods.filter(method => !INIT.includes(method.name));
  const count = method => layers.filter(layer => new RegExp('\\b' + self + '\\.(?:\\w+\\.)*' + base(layer) + '\\b').test(method.body)).length;
  const runner = candidates.find(method => RUNNERS.includes(method.name))
    || candidates.map(method => ({ method, uses: count(method) })).filter(item => item.uses >= 2).sort((a, b) => b.uses - a.uses)[0]?.method;
  const body = runner?.body || '';
  // Where a part is used; a call counts where it closes, so in a(b(x)) b comes first.
  const used = layer => {
    const found = new RegExp('\\.' + base(layer) + '\\b(\\s*\\()?').exec(body);
    if (!found) return Infinity;
    const open = found.index + found[0].length - 1;
    return (found[1] ? open + balanced(body, open).length + 1 : found.index) + (Number(/\[(\d+)\]$/.exec(layer.name)?.[1]) || 0) / 1000;
  };
  const steps = layers.map((layer, index) => ({ layer, at: used(layer), index }));
  if (runner) for (const step of steps) if (step.at === Infinity) step.layer.unused = true;
  // Known math between parts (softmax, a loss), placed where it happens.
  for (const found of body.matchAll(/(?:\b(?:F|functional|torch|tf|jnp|nn|ops)\.|\.)(\w+)\s*\(/g)) {
    const name = found[1];
    if (!Object.prototype.hasOwnProperty.call(OPS, name) || layers.some(layer => base(layer) === name) || steps.some(step => step.layer.op && step.layer.type === name)) continue;
    const open = found.index + found[0].length - 1;
    steps.push({ layer: { name, type: name, op: true, plain: OPS[name] }, at: open + balanced(body, open).length + 1, index: steps.length });
  }
  steps.sort((a, b) => a.at - b.at || a.index - b.index);
  const ordered = steps.map(step => step.layer);
  const inputs = topLevel(runner?.params || '').map(param => param.split(/[:=]/)[0].trim().replace(/^[*.]+/, '').replace(/\?$/, '')).filter(param => param && param !== self);
  const returns = [...body.matchAll(/^\s*return\s+(.+?);?\s*$/gm)].pop()?.[1].trim().replace(/^\((.*)\)$/, '$1');
  const shown = ordered.slice(0, LIMITS.layers);
  // How data moves through the main method (Python): what feeds each part, merges, conditions, loops.
  // Elsewhere, the parts in order.
  let flow;
  if (runner && !braces) flow = dataflow.methodFlow(runner.body, { self, parts: layers, ops: OPS, params: inputs, line: def.start + runner.line });
  if (!flow || !flow.nodes.some(node => node.kind === 'part')) {
    const chain = shown.filter(layer => !layer.unused);
    flow = { nodes: [...inputs.map(name => ({ kind: 'in', name })), ...chain.map(layer => layer.op ? { kind: 'op', name: layer.type } : { kind: 'part', name: layer.name, line: layer.line }), ...(runner ? [{ kind: 'out', names: returns ? topLevel(returns) : [] }] : [])].map((node, index) => ({ ...node, id: 'f' + index })) };
    flow.edges = flow.nodes.slice(1).map((node, index) => [flow.nodes[inputs.length && index < inputs.length ? 0 : index].id, node.id]).filter(([from, to]) => from !== to);
    if (inputs.length > 1) flow.edges = [...inputs.map((_, index) => ['f' + index, 'f' + inputs.length]), ...flow.edges.filter(([from]) => Number(from.slice(1)) >= inputs.length)];
    // Only the order is known here, not what feeds what.
    flow.order = true;
  }
  for (const node of flow.nodes) if (node.kind === 'op') node.plain = OPS[node.name];
  // A part's arguments, worked out from defaults where possible (768 rather than n_embd).
  const resolve = scope ? scope(init) : undefined, from = new Set();
  const layersOut = shown.map(layer => {
    if (layer.op) return layer;
    const out = { ...layer, plain: plainFor(layer.type) };
    delete out.args;
    if (resolve && layer.args !== undefined) {
      const call = dataflow.parseExpr('f(' + layer.args + ')');
      if (call.k === 'call') out.args = call.args.slice(0, 6).map(arg => {
        const found = arg.star ? undefined : dataflow.evaluate(arg.value, resolve), code = dataflow.show(arg.value);
        for (const item of found?.from || []) from.add(item);
        return { name: arg.name, code: code.length > 40 ? code.slice(0, 39) + '…' : code, value: found && typeof found.value !== 'object' || found && Array.isArray(found.value) ? dataflow.format(found.value) : undefined };
      });
    }
    if (resolve && layer.repeat && !/^each of /.test(layer.repeat)) {
      const found = dataflow.evaluate(dataflow.parseExpr(layer.repeat), resolve);
      if (found && typeof found.value === 'number') { out.times = found.value; for (const item of found.from || []) from.add(item); }
    }
    return out;
  });
  return {
    runs: runner?.name, runsLine: runner ? def.start + runner.line : undefined, initLine: def.start + init.line, inputs, outputs: returns ? topLevel(returns).filter(item => /^[\w.]+$/.test(item)) : [],
    layers: layersOut, flow, defaults: [...from],
  };
}

// Words for a class's flow, shared by the Inside view and its Obsidian note:
// what each step is called and one sentence per step, built from the graph.
// Self-contained, so the webview can use it as is.
function flowWords() {
  const OPERATOR = { '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '//': 'divide (whole)', '%': 'remainder', '@': 'matrix product' };
  const times = layer => layer.times !== undefined ? layer.times : String(layer.repeat || '').replace(/^(self|this|config|cfg|args)\./, '');
  const nameOf = node => !node ? '' : node.kind === 'in' ? node.name : node.kind === 'out' ? 'the result' : node.kind === 'merge' ? 'the ' + (OPERATOR[node.name] || node.name) + ' result' : node.kind === 'op' ? node.name : node.name + (node.method ? '.' + node.method + '()' : '');
  const list = items => items.length > 1 ? items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1] : items[0] || '';
  // Who feeds a step and whom it feeds.
  function links(flow) {
    const at = new Map(flow.nodes.map(node => [node.id, node])), into = new Map(), out = new Map();
    for (const [from, to] of flow.edges || []) { if (!at.has(from) || !at.has(to)) continue; (into.get(to) || into.set(to, []).get(to)).push(at.get(from)); (out.get(from) || out.set(from, []).get(from)).push(at.get(to)); }
    return { into: id => into.get(id) || [], outOf: id => out.get(id) || [] };
  }
  // name: the class; whatOf(layer): what a part does in plain words.
  function sentence(anatomy, node, { name, whatOf = layer => layer.plain || '', graph = links(anatomy.flow) }) {
    const from = [...new Set(graph.into(node.id).map(nameOf))], to = [...new Set(graph.outOf(node.id).map(next => next.kind === 'out' ? 'what comes out' : nameOf(next)))];
    const layer = node.kind === 'part' ? anatomy.layers.find(item => !item.op && item.name === node.name) : undefined, what = layer ? whatOf(layer) : node.plain;
    const parts = [];
    if (node.kind === 'in') parts.push(name + ' is given ' + node.name + '.');
    else if (node.kind === 'out') parts.push(name + ' gives back ' + (node.names?.length ? list(node.names) : 'the result') + (from.length ? ', from ' + list(from) : '') + '.');
    else if (node.kind === 'merge') parts.push(list(from) + ' are combined: ' + (OPERATOR[node.name] || node.name) + ' (' + node.name + ').');
    else parts.push((layer ? node.name + ' (' + layer.type + ')' : node.name) + (node.value ? ' is read as a value' : from.length ? ' takes ' + list(from) : ' starts a path of its own: nothing earlier feeds it') + '.', what || '');
    if (layer?.repeat) parts.push('It runs ' + times(layer) + ' times, each copy taking what the one before gave.');
    for (const when of node.when || []) parts.push('This only happens ' + when + '.');
    for (const loop of node.loop || []) parts.push('It runs ' + loop + '.');
    if (to.length && node.kind !== 'out') parts.push('Next: ' + list(to) + '.');
    return parts.filter(Boolean).join(' ');
  }
  return { OPERATOR, times, nameOf, list, links, sentence };
}

// The first sentence of a class's docstring (Python) or the comment above it (JS/TS).
function classDoc(source, def, braces) {
  const lines = String(source || '').split('\n');
  const clip = text => { const clean = text.replace(/\s+/g, ' ').trim(); return (/^(.+?[.!?])(\s|$)/.exec(clean)?.[1] || clean).slice(0, LIMITS.plain) || undefined; };
  if (braces) {
    const above = [];
    for (let i = def.start - 2; i >= 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[i]); i--) above.unshift(lines[i].replace(/^\s*(\/\/+|\/\*\*?|\*\/?)\s?/, '').replace(/\*\/\s*$/, ''));
    return above.length ? clip(above.filter(line => !/^\s*@/.test(line)).join(' ')) : undefined;
  }
  const quotes = '"'.repeat(3) + '|' + "'".repeat(3);
  // Decorators come first in the range: start after the class line.
  let start = def.start - 1;
  while (start < def.end && !/^\s*class\b/.test(lines[start] || '')) start++;
  const match = new RegExp('^\\s*[rRuU]?(' + quotes + ')([\\s\\S]*?)\\1').exec(lines.slice(start + 1, Math.min(def.end, start + 13)).join('\n'));
  return match ? clip(match[2]) : undefined;
}

// Every class in these files that is made of parts, keyed 'file#Class'.
// A part whose type is one of these classes points at it (own), so a view can open it.
// Names a class's constructor can resolve to values: its locals, its parameters'
// defaults, the class's own fields, module constants, and a field of another
// class in these files (config.n_embd -> a config class's default) when only one has it.
function scopes(classes, texts) {
  const statementsOf = new Map(), constants = new Map(), fields = new Map();
  const tree = file => { if (!statementsOf.has(file)) { try { statementsOf.set(file, dataflow.statements(stripComments(texts.get(file)))); } catch { statementsOf.set(file, []); } } return statementsOf.get(file); };
  const assigned = list => { const out = new Map(); for (const st of list || []) if (st.k === 'assign') for (const target of st.targets) { if (target.k === 'name') out.set(target.v, st.value); } return out; };
  for (const { file, def } of classes) {
    if (!texts.has(file) || !/\.(py|ipynb)$/i.test(file)) continue;
    if (!constants.has(file)) constants.set(file, assigned(tree(file)));
    const text = stripComments(texts.get(file)).split('\n').slice(def.start - 1, def.end).join('\n');
    let body = [];
    try { body = dataflow.statements(text).find(st => st.k === 'class')?.body || []; } catch { /* Left out. */ }
    fields.set(def.name, { file, values: assigned(body) });
  }
  return (file, def) => init => {
    const own = fields.get(def.name), params = new Map(), types = new Map(), locals = new Map(), selfs = new Map();
    for (const param of topLevel(init.params || '')) {
      const match = /^\*{0,2}(\w+)\s*(?::\s*([^=]+?))?\s*(?:=\s*([\s\S]+))?$/.exec(param);
      if (!match) continue;
      if (match[2]) types.set(match[1], match[2].trim().split('.').pop());
      if (match[3]) params.set(match[1], dataflow.parseExpr(match[3]));
    }
    try {
      for (const st of dataflow.statements(init.body)[0]?.body || []) if (st.k === 'assign') for (const target of st.targets) {
        if (target.k === 'name') locals.set(target.v, st.value);
        else if (target.k === 'attr' && target.obj.k === 'name' && target.obj.v === 'self') selfs.set(target.name, st.value);
      }
    } catch { /* Left out. */ }
    const visiting = new Set();
    const resolve = chain => {
      const key = chain.join('.');
      if (visiting.has(key) || visiting.size > 30) return undefined;
      visiting.add(key);
      try {
        const ev = (expr, tag) => { const found = expr && dataflow.evaluate(expr, resolve); return found && tag ? { ...found, from: [...new Set([...(found.from || []), tag])] } : found; };
        if (chain.length === 1) { const name = chain[0]; return locals.has(name) ? ev(locals.get(name)) : params.has(name) ? ev(params.get(name), 'default arguments') : constants.get(file)?.has(name) ? ev(constants.get(file).get(name)) : undefined; }
        const name = chain[chain.length - 1], holder = chain.slice(0, -1);
        if (holder.length === 1 && holder[0] === 'self') { if (own?.values.has(name)) return ev(own.values.get(name), def.name + ' defaults'); if (selfs.has(name)) return ev(selfs.get(name)); }
        const typed = holder.length === 1 && types.get(holder[0]);
        if (typed && fields.get(typed)?.values.has(name)) return ev(fields.get(typed).values.get(name), typed);
        const having = [...fields].filter(([, item]) => item.values.has(name));
        if (having.length === 1 && having[0][0] !== def.name) return ev(having[0][1].values.get(name), having[0][0]);
        return undefined;
      } finally { visiting.delete(key); }
    };
    return resolve;
  };
}

function partLayers(classes, texts) {
  const out = {}, bracesFor = file => /\.(m?[jt]sx?|cjs)$/i.test(file), scopeOf = scopes(classes, texts);
  for (const { file, def } of classes) {
    if (!texts.has(file) || !(bracesFor(file) || /\.(py|ipynb)$/i.test(file))) continue;
    let found;
    try { found = classLayers(texts.get(file), def, { braces: bracesFor(file), scope: bracesFor(file) ? undefined : scopeOf(file, def) }); } catch { found = undefined; }
    if (found) out[file + '#' + def.name] = { ...found, doc: classDoc(texts.get(file), def, bracesFor(file)) };
  }
  const known = new Map(classes.map(({ file, def }) => [def.name, { key: file + '#' + def.name, doc: texts.has(file) ? classDoc(texts.get(file), def, bracesFor(file)) : undefined }]));
  for (const found of Object.values(out)) for (const layer of found.layers) {
    const own = !layer.op && known.get(layer.type);
    if (!own) continue;
    layer.own = own.key;
    if (own.doc) layer.doc = own.doc;
  }
  return out;
}

module.exports = { classLayers, classDoc, partLayers, flowWords, plainFor, OPS, LIMITS };

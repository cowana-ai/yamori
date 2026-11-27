'use strict';

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
  return /^[A-Z]/.test(call.name) ? [{ name, type: call.name }] : [];
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
      out.push({ name: match[1], params: match[2], body: text.slice(match.index, open + 1) + balanced(text, open) + '}' });
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
    out.push({ name: match[2], params: balanced(joined, joined.indexOf('(')), body: joined });
  }
  return out;
}

// The parts a constructor assigns to self.x / this.x.
function partsAssigned(init, braces) {
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
    for (const layer of layersOf(match[1], init.slice(from, end))) if (!parts.some(other => other.name === layer.name)) parts.push(layer);
  }
  return parts;
}

// What one class is made of, or undefined when its constructor creates no parts.
function classLayers(source, def, { braces = false } = {}) {
  const code = braces ? String(source || '').replace(/(^|[^:])\/\/.*$/gm, '$1') : stripComments(String(source || ''));
  const text = code.split('\n').slice(def.start - 1, def.end).join('\n');
  const methods = methodsOf(text, braces);
  const init = methods.find(method => INIT.includes(method.name));
  if (!init) return undefined;
  const layers = partsAssigned(init.body, braces);
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
  const ordered = steps.map(step => step.layer), at = new Map(steps.map(step => [step.layer, step.at]));
  // Shortcuts: x = x + part(...) adds a part's result back to its input;
  // out += saved adds back a value saved before some parts ran.
  const lines = body.split('\n'), starts = [];
  lines.reduce((offset, line) => { starts.push(offset); return offset + line.length + 1; }, 0);
  lines.forEach((line, row) => {
    const match = /^\s*(\w+)\s*(?:=\s*\1\s*\+|\+=)\s*(.+?);?\s*$/.exec(line);
    if (!match) return;
    const from = starts[row], to = from + line.length;
    let group = ordered.filter(layer => !layer.op && at.get(layer) >= from && at.get(layer) <= to);
    if (!group.length) {
      const saved = /^\s*([A-Za-z_]\w*)\s*$/.exec(match[2])?.[1];
      if (!saved) return;
      // From where it was first saved (identity = x), or from the start when it is an input.
      let since = 0;
      for (let r = 1; r < row; r++) if (new RegExp('^\\s*(?:(?:const|let|var)\\s+)?' + saved + '\\s*=[^=]').test(lines[r])) { since = starts[r]; break; }
      group = ordered.filter(layer => !layer.op && at.get(layer) >= since && at.get(layer) < from);
    }
    const last = group[group.length - 1];
    if (last) { last.residual = true; last.residualFrom = group[0].name; }
  });
  const inputs = topLevel(runner?.params || '').map(param => param.split(/[:=]/)[0].trim().replace(/^[*.]+/, '').replace(/\?$/, '')).filter(param => param && param !== self);
  const returns = [...body.matchAll(/^\s*return\s+(.+?);?\s*$/gm)].pop()?.[1].trim().replace(/^\((.*)\)$/, '$1');
  return {
    runs: runner?.name, inputs, outputs: returns ? topLevel(returns).filter(item => /^[\w.]+$/.test(item)) : [],
    layers: ordered.slice(0, LIMITS.layers).map(layer => layer.op ? layer : { ...layer, plain: plainFor(layer.type) }),
  };
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
  const match = new RegExp('^\\s*[rRuU]?(' + quotes + ')([\\s\\S]*?)\\1').exec(lines.slice(def.start, Math.min(def.end, def.start + 12)).join('\n'));
  return match ? clip(match[2]) : undefined;
}

// Every class in these files that is made of parts, keyed 'file#Class'.
// A part whose type is one of these classes points at it (own), so a view can open it.
function partLayers(classes, texts) {
  const out = {}, bracesFor = file => /\.(m?[jt]sx?|cjs)$/i.test(file);
  for (const { file, def } of classes) {
    if (!texts.has(file) || !(bracesFor(file) || /\.(py|ipynb)$/i.test(file))) continue;
    const found = classLayers(texts.get(file), def, { braces: bracesFor(file) });
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

module.exports = { classLayers, classDoc, partLayers, plainFor, OPS, LIMITS };

'use strict';

// How data moves through one Python method, read from the code with no AI:
// which parts (self.x) are called, what feeds each one, where values are
// combined (a + b), which calls only run under a condition or in a loop, and
// what is returned. Also works out simple values (numbers, strings) of
// expressions from defaults, for showing a part's arguments.
// Nothing here knows about a framework: parts are whatever the class's
// constructor created, and the only names it knows are Python's own.

// --- tokens ---
const TOKEN = /([ \t\f\r]+|\\\r?\n)|(\n)|(#[^\n]*)|([rRbBuUfF]{0,2}("""|'''|"|')(?:\\[\s\S]|(?!\5)[\s\S])*?\5)|(\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?j?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_]\w*)|(\*\*=?|\/\/=?|<<=?|>>=?|[-+*/%@&|^]=|==|!=|<=|>=|->|:=|\.\.\.|[-+*/%@&|^~<>=.,:;()[\]{}!?])/y;
function tokenize(text) {
  const out = [];
  let line = 0, lineStart = 0;
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const start = TOKEN.lastIndex, match = TOKEN.exec(text);
    if (!match) { TOKEN.lastIndex = start + 1; continue; }
    const [all, space, newline, comment, string, , number, name, op] = match;
    if (newline) { out.push({ t: 'nl', v: '\n', s: start, e: start + 1, line, col: start - lineStart }); line++; lineStart = start + 1; continue; }
    if (space || comment) { if (space && space.includes('\n')) { line++; lineStart = start + space.lastIndexOf('\n') + 1; } continue; }
    const token = { t: string ? 'str' : number ? 'num' : name ? 'name' : 'op', v: string || number || name || op, s: start, e: start + all.length, line, col: start - lineStart };
    out.push(token);
    if (string && string.includes('\n')) { line += string.split('\n').length - 1; lineStart = start + string.lastIndexOf('\n') + 1; }
  }
  return out;
}

// --- expressions ---
const BINARY = { or: 1, and: 2, '|': 5, '^': 6, '&': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '@': 10, '/': 10, '//': 10, '%': 10, '**': 12 };
const COMPARE = new Set(['<', '>', '==', '!=', '<=', '>=', 'in', 'is', 'not']);
const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'if', 'else', 'for', 'lambda', 'await', 'yield', 'async']);
// Parses tokens into a small tree; anything it can't read becomes { k: 'opaque' }.
function parseTokens(tokens, text = '') {
  let p = 0;
  const peek = (offset = 0) => tokens[p + offset];
  const is = (v, offset = 0) => peek(offset) && peek(offset).v === v && peek(offset).t !== 'str';
  const take = v => { if (v !== undefined && !is(v)) throw new Error('expected ' + v); return tokens[p++]; };
  const span = (from, to) => text ? text.slice(tokens[from]?.s ?? 0, tokens[to - 1]?.e ?? 0) : tokens.slice(from, to).map(token => token.v).join(' ');
  function test() {
    if (is('lambda')) { while (peek() && !is(':')) p++; take(':'); test(); return { k: 'lambda' }; }
    if (is('yield')) { p++; return peek() && !is(')') ? test() : { k: 'const', v: null }; }
    const a = binary(1);
    if (is('if') && !is('else', 1)) { p++; const cond = binary(1); take('else'); return { k: 'ifexp', a, cond, b: test() }; }
    return a;
  }
  function binary(min) {
    let left = unary(min);
    for (;;) {
      const token = peek();
      if (!token || token.t === 'str' || token.t === 'num') break;
      if (min <= 4 && (COMPARE.has(token.v)) && !(token.v === 'not' && !is('in', 1))) {
        const items = [left], ops = [];
        while (peek() && COMPARE.has(peek().v) && peek().t !== 'str' && !(peek().v === 'not' && !is('in', 1))) {
          let op = take().v; if ((op === 'is' && is('not')) || (op === 'not' && is('in'))) op += ' ' + take().v;
          ops.push(op); items.push(unary(5));
        }
        left = { k: 'cmp', ops, items };
        continue;
      }
      const prec = BINARY[token.v];
      if (!prec || prec < min || (token.t === 'name' && !['and', 'or'].includes(token.v))) break;
      p++;
      const right = prec === 12 ? unary(12) : binary(prec + 1);
      left = token.v === 'and' || token.v === 'or' ? { k: 'bool', op: token.v, items: [left, right] } : { k: 'bin', op: token.v, l: left, r: right };
    }
    return left;
  }
  function unary(min) {
    if (is('not') && min <= 3) { p++; return { k: 'un', op: 'not', e: binary(3) }; }
    if ((is('-') || is('+') || is('~')) && peek().t === 'op') { const op = take().v; return { k: 'un', op, e: unary(11) }; }
    if (is('await')) { p++; return unary(min); }
    let e = postfix(primary());
    if (is('**')) { p++; e = { k: 'bin', op: '**', l: e, r: unary(11) }; }
    return e;
  }
  function args(close) {
    const out = [];
    while (peek() && !is(close)) {
      if (is('*') || is('**')) { p++; out.push({ value: test(), star: true }); }
      else if (peek().t === 'name' && is('=', 1)) { const name = take().v; p++; out.push({ name, value: test() }); }
      else {
        const value = test();
        if (is('for')) out.push({ value: comprehension(value, close) }); else out.push({ value });
      }
      if (!is(',')) break;
      p++;
    }
    take(close);
    return out;
  }
  function comprehension(elt, close) {
    const loops = [];
    while (is('for') || is('async')) {
      if (is('async')) p++;
      p++;
      const from = p; while (peek() && !is('in')) p++;
      const target = parseTokens(tokens.slice(from, p), text);
      p++;
      const iter = binary(1), conds = [];
      while (is('if')) { p++; conds.push(binary(1)); }
      loops.push({ target, iter, conds });
      if (close && !is('for') && !is('async')) break;
    }
    return { k: 'comp', elt, loops };
  }
  function seq(close, kind) {
    const items = [];
    if (is(close)) { p++; return { k: kind, items }; }
    const first = is('*') || is('**') ? (p++, test()) : test();
    if (is(':') && kind === 'set') { p++; const value = test(); if (is('for')) { const comp = comprehension(value, close); take(close); return comp; } items.push(first, value); while (is(',')) { p++; if (is(close)) break; if (is('**')) { p++; items.push(test()); continue; } items.push(test()); take(':'); items.push(test()); } take(close); return { k: 'dict', items }; }
    if (is('for')) { const comp = comprehension(first, close); take(close); return comp; }
    items.push(first);
    let trailing = false;
    while (is(',')) { p++; trailing = true; if (is(close)) break; trailing = false; items.push(is('*') ? (p++, test()) : test()); }
    take(close);
    if (kind === 'paren') return items.length === 1 && !trailing ? items[0] : { k: 'tuple', items };
    return { k: kind === 'set' ? 'set' : 'list', items };
  }
  function primary() {
    const token = take();
    if (!token) throw new Error('end');
    if (token.t === 'num') return { k: 'num', v: Number(token.v.replace(/_/g, '').replace(/j$/, '')) };
    if (token.t === 'str') { let v = token.v; while (peek()?.t === 'str') v += take().v; const body = /^[rRbBuUfF]*("""|'''|"|')([\s\S]*)\1$/.exec(v); return { k: 'str', v: body ? body[2] : v, f: /^[rRbBuU]*[fF]/.test(v) }; }
    if (token.t === 'name') {
      if (token.v === 'None') return { k: 'const', v: null };
      if (token.v === 'True' || token.v === 'False') return { k: 'const', v: token.v === 'True' };
      return { k: 'name', v: token.v };
    }
    if (token.v === '(') return seq(')', 'paren');
    if (token.v === '[') return seq(']', 'list');
    if (token.v === '{') return seq('}', 'set');
    if (token.v === '...') return { k: 'const', v: '...' };
    throw new Error('unexpected ' + token.v);
  }
  function postfix(e) {
    for (;;) {
      if (is('.') && peek(1)?.t === 'name') { p++; e = { k: 'attr', obj: e, name: take().v }; continue; }
      if (is('(')) { p++; e = { k: 'call', fn: e, args: args(')') }; continue; }
      if (is('[')) {
        p++;
        const items = [];
        let depth = 0;
        const from = p;
        while (peek() && !(depth === 0 && is(']'))) { if (['(', '[', '{'].includes(peek().v)) depth++; if ([')', ']', '}'].includes(peek().v)) depth--; p++; }
        // Slices and indexes: read each piece between ',' and ':' on its own.
        let start = from;
        for (let i = from; i <= p; i++) {
          const token = tokens[i];
          if (i === p || (token && (token.v === ',' || token.v === ':') && depthAt(from, i) === 0)) { if (i > start) items.push(parseTokens(tokens.slice(start, i), text)); start = i + 1; }
        }
        take(']');
        e = { k: 'sub', obj: e, items };
        continue;
      }
      return e;
    }
  }
  function depthAt(from, at) { let depth = 0; for (let i = from; i < at; i++) { const v = tokens[i].v; if (tokens[i].t === 'op') { if ('([{'.includes(v)) depth++; else if (')]}'.includes(v)) depth--; } } return depth; }
  try {
    if (!tokens.length) return { k: 'const', v: null };
    const first = is('*') ? (p++, test()) : test();
    let result = first;
    if (is(',')) { const items = [first]; while (is(',')) { p++; if (!peek()) break; items.push(is('*') ? (p++, test()) : test()); } result = { k: 'tuple', items }; }
    if (p < tokens.length) throw new Error('left over');
    return result;
  } catch {
    return { k: 'opaque', names: tokens.filter(token => token.t === 'name' && !KEYWORDS.has(token.v)).map(token => token.v), text: span(0, tokens.length) };
  }
}
const parseExpr = text => parseTokens(tokenize(text).filter(token => token.t !== 'nl'), text);

// --- statements ---
// Logical lines (brackets and backslashes join physical lines), with indent and line number.
function logicalLines(text) {
  const tokens = tokenize(text), lines = [];
  let current = [], depth = 0;
  for (const token of tokens) {
    if (token.t === 'nl') { if (depth > 0 || !current.length) continue; lines.push(current); current = []; continue; }
    if (token.t === 'op') { if ('([{'.includes(token.v)) depth++; else if (')]}'.includes(token.v)) depth = Math.max(0, depth - 1); }
    current.push(token);
  }
  if (current.length) lines.push(current);
  return lines.map(tokens => ({ tokens, indent: tokens[0].col, line: tokens[0].line }));
}
const COMPOUND = new Set(['if', 'elif', 'else', 'for', 'while', 'with', 'try', 'except', 'finally', 'def', 'class', 'async', 'match', 'case']);
// The index of the ':' that ends a compound statement's header.
function headerEnd(tokens) {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const v = tokens[i].v;
    if (tokens[i].t !== 'op') { if (tokens[i].v === 'lambda') depth += 100; continue; }
    if ('([{'.includes(v)) depth++; else if (')]}'.includes(v)) depth--;
    else if (v === ':' && depth >= 100) depth -= 100;
    else if (v === ':' && depth === 0) return i;
  }
  return tokens.length;
}
// Statements as a tree: { k, line, ... , body } by indentation.
function statements(text) {
  const lines = logicalLines(text);
  let i = 0;
  function block(indent) {
    const out = [];
    while (i < lines.length && lines[i].indent >= indent) {
      const { tokens, line } = lines[i++];
      const head = tokens[0].v;
      if (COMPOUND.has(head) && tokens[0].t === 'name' && !(head === 'match' || head === 'case') || (head === 'async' && ['for', 'with', 'def'].includes(tokens[1]?.v))) {
        const parts = head === 'async' ? tokens.slice(1) : tokens, colon = headerEnd(parts), header = parts.slice(1, colon), inline = parts.slice(colon + 1);
        const body = inline.length ? [simple(inline, line)] : (i < lines.length && lines[i].indent > indent ? block(lines[i].indent) : []);
        out.push({ k: parts[0].v, header, body, line });
      } else out.push(simple(tokens, line));
    }
    return out;
  }
  function simple(tokens, line) {
    const head = tokens[0];
    if (head.t === 'name' && head.v === 'return') return { k: 'return', value: tokens.length > 1 ? parseTokens(tokens.slice(1), text) : undefined, line };
    if (head.t === 'name' && ['pass', 'break', 'continue', 'raise', 'assert', 'del', 'global', 'nonlocal', 'import', 'from'].includes(head.v)) return { k: head.v, line };
    // Assignments: a = b = value, a += value, a: T = value.
    let depth = 0;
    const cuts = [];
    for (let j = 0; j < tokens.length; j++) {
      const v = tokens[j].v;
      if (tokens[j].t !== 'op') continue;
      if ('([{'.includes(v)) depth++; else if (')]}'.includes(v)) depth--;
      else if (depth === 0 && v === '=') cuts.push(j);
      else if (depth === 0 && /^(\+|-|\*|\/|\/\/|%|@|&|\||\^|\*\*|<<|>>)=$/.test(v)) return { k: 'aug', target: parseTokens(tokens.slice(0, j), text), op: v.slice(0, -1), value: parseTokens(tokens.slice(j + 1), text), line };
    }
    if (cuts.length) {
      const targets = [];
      let from = 0;
      for (const cut of cuts) {
        let target = tokens.slice(from, cut);
        const colon = target.findIndex(token => token.v === ':' && token.t === 'op');
        if (colon > 0) target = target.slice(0, colon);
        targets.push(parseTokens(target, text));
        from = cut + 1;
      }
      return { k: 'assign', targets, value: parseTokens(tokens.slice(from), text), line };
    }
    return { k: 'expr', value: parseTokens(tokens, text), line };
  }
  return block(lines.length ? lines[0].indent : 0);
}

// --- reading code as text again (for conditions and arguments) ---
function show(e) {
  if (!e) return '';
  switch (e.k) {
    case 'name': return e.v;
    case 'num': return String(e.v);
    case 'str': return JSON.stringify(e.v.length > 24 ? e.v.slice(0, 23) + '…' : e.v);
    case 'const': return e.v === null ? 'None' : e.v === true ? 'True' : e.v === false ? 'False' : String(e.v);
    case 'attr': return show(e.obj) + '.' + e.name;
    case 'call': return show(e.fn) + '(' + e.args.map(arg => (arg.name ? arg.name + '=' : arg.star ? '*' : '') + show(arg.value)).join(', ') + ')';
    case 'sub': return show(e.obj) + '[' + e.items.map(show).join(', ') + ']';
    case 'bin': return show(e.l) + ' ' + e.op + ' ' + show(e.r);
    case 'un': return e.op === 'not' ? 'not ' + show(e.e) : e.op + show(e.e);
    case 'cmp': return e.items.map((item, index) => (index ? e.ops[index - 1] + ' ' : '') + show(item)).join(' ');
    case 'bool': return e.items.map(show).join(' ' + e.op + ' ');
    case 'ifexp': return show(e.a) + ' if ' + show(e.cond) + ' else ' + show(e.b);
    case 'tuple': return e.items.map(show).join(', ');
    case 'list': return '[' + e.items.map(show).join(', ') + ']';
    case 'opaque': return e.text || '…';
    default: return '…';
  }
}
// The opposite of a condition, written the way code would say it.
function negate(e) {
  const FLIP = { is: 'is not', 'is not': 'is', '==': '!=', '!=': '==', in: 'not in', 'not in': 'in', '<': '>=', '>=': '<', '>': '<=', '<=': '>' };
  if (e?.k === 'un' && e.op === 'not') return show(e.e);
  if (e?.k === 'cmp' && e.ops.length === 1 && FLIP[e.ops[0]]) return show(e.items[0]) + ' ' + FLIP[e.ops[0]] + ' ' + show(e.items[1]);
  return 'not ' + (e?.k === 'bool' || e?.k === 'cmp' ? '(' + show(e) + ')' : show(e));
}
const chainOf = e => e?.k === 'attr' ? [...(chainOf(e.obj) || []), e.name] : e?.k === 'name' ? [e.v] : undefined;

// --- data flow through one method ---
// parts: [{ name, type, via?, repeat? }] from the constructor; ops: names of known
// library functions worth showing (with plain words), passed in by the caller.
function methodFlow(body, { self = 'self', parts = [], ops = {}, params = [], line = 1 } = {}) {
  const nodes = [], edges = new Set(), env = new Map(), aliases = new Map();
  const add = node => { node.id = 'f' + nodes.length; nodes.push(node); return node.id; };
  const link = (sources, to) => { for (const from of sources) if (from !== to) edges.add(from + '>' + to); };
  for (const param of params) env.set(param, new Set([add({ kind: 'in', name: param })]));
  const context = { when: [], loop: [] };
  const stamp = node => { if (context.when.length) node.when = [...context.when]; if (context.loop.length) node.loop = [...context.loop]; return node; };
  // Parts reached through self: self.a, self.box.a, a part group (Sequential) by its name.
  const partsNamed = name => { const exact = parts.filter(part => part.name === name); return exact.length ? exact : parts.filter(part => part.via === name || part.name.replace(/\[\d+\]$/, '') === name); };
  // Reading what a value is like (its length, shape, type) is not using its data.
  const DESCRIBES = new Set(['shape', 'size', 'ndim', 'dtype', 'device', 'len', 'type', 'isinstance', 'hasattr', 'id']);
  // A part read as a value (self.weight) is a source of its own, once.
  const valueNodes = new Map();
  const union = (...sets) => { const out = new Set(); for (const set of sets) for (const item of set || []) out.add(item); return out; };
  function call(e, at) {
    const chain = chainOf(e.fn);
    if (chain && DESCRIBES.has(chain[chain.length - 1]) && !(chain[0] === self && chain.length === 2)) return new Set();
    const argsIn = union(...e.args.map(arg => value(arg.value, at)));
    // self.part(...) or self.box.part.method(...)
    if (chain && chain[0] === self) {
      for (let i = chain.length - 1; i >= 1; i--) {
        const found = partsNamed(chain[i]);
        if (!found.length) continue;
        const method = chain.slice(i + 1).join('.');
        let sources = argsIn;
        // A group of parts (a Sequential) runs its pieces in turn.
        for (const part of found) { const id = add(stamp({ kind: 'part', name: part.name, method: method || undefined, line: at })); link(sources, id); sources = new Set([id]); }
        return sources;
      }
    }
    // A loop variable bound to a list of parts: for block in self.blocks: block(x)
    if (chain && chain.length >= 1 && aliases.has(chain[0])) {
      const part = aliases.get(chain[0]), method = chain.slice(1).join('.');
      const id = add(stamp({ kind: 'part', name: part.name, method: method || undefined, line: at }));
      link(argsIn, id);
      return new Set([id]);
    }
    const last = chain ? chain[chain.length - 1] : e.fn.k === 'attr' ? e.fn.name : undefined;
    const object = e.fn.k === 'attr' ? value(e.fn.obj, at) : new Set();
    if (last && Object.prototype.hasOwnProperty.call(ops, last) && !(chain && chain[0] === self)) {
      const id = add(stamp({ kind: 'op', name: last, line: at }));
      link(union(object, argsIn), id);
      return new Set([id]);
    }
    // Any other call passes its inputs through (x.view(...), helper(x)).
    return union(object, argsIn, e.fn.k === 'name' ? new Set() : new Set());
  }
  function value(e, at) {
    if (!e) return new Set();
    switch (e.k) {
      case 'name': return env.get(e.v) || new Set();
      case 'attr': {
        if (DESCRIBES.has(e.name)) return new Set();
        const chain = chainOf(e);
        if (!chain || chain[0] !== self) return value(e.obj, at);
        for (let i = chain.length - 1; i >= 1; i--) {
          const found = partsNamed(chain[i]);
          if (found.length !== 1) continue;
          if (!valueNodes.has(found[0].name)) valueNodes.set(found[0].name, add(stamp({ kind: 'part', name: found[0].name, value: true, line: at })));
          return new Set([valueNodes.get(found[0].name)]);
        }
        return new Set();
      }
      case 'call': return call(e, at);
      case 'sub': return union(value(e.obj, at), ...e.items.map(item => value(item, at)));
      case 'bin': {
        const left = value(e.l, at), right = value(e.r, at);
        // Two different values combined: a node of its own (a + b).
        if (left.size && right.size && ['+', '-', '*', '/', '@', '//', '%'].includes(e.op) && [...right].some(item => !left.has(item)) && [...left].some(item => !right.has(item))) {
          const id = add(stamp({ kind: 'merge', name: e.op, line: at }));
          link(union(left, right), id);
          return new Set([id]);
        }
        return union(left, right);
      }
      case 'un': return value(e.e, at);
      case 'cmp': case 'bool': case 'tuple': case 'list': case 'set': case 'dict': return union(...e.items.map(item => value(item, at)));
      case 'ifexp': value(e.cond, at); return union(value(e.a, at), value(e.b, at));
      case 'comp': {
        const saved = new Map(env);
        for (const loop of e.loops) bind(loop.target, loop.iter, value(loop.iter, at));
        const out = union(value(e.elt, at), ...e.loops.map(loop => value(loop.iter, at)));
        env.clear(); for (const [k, v] of saved) env.set(k, v);
        return out;
      }
      case 'opaque': return union(...e.names.map(name => env.get(name)));
      default: return new Set();
    }
  }
  // A loop or comprehension target: over a list of parts it names that part; else it carries the list's sources.
  function bind(target, iter, sources) {
    const chain = chainOf(iter) || (iter?.k === 'call' && ['enumerate', 'zip', 'reversed'].includes(chainOf(iter.fn)?.[0]) ? chainOf(iter.args[iter.args.length - 1]?.value) : undefined);
    const names = target?.k === 'name' ? [target.v] : target?.k === 'tuple' ? target.items.filter(item => item.k === 'name').map(item => item.v) : [];
    if (chain && chain[0] === self) {
      const found = partsNamed(chain[chain.length - 1]);
      if (found.length) { aliases.set(names[names.length - 1], found[0]); return true; }
    }
    if (sources) for (const name of names) env.set(name, sources);
    return false;
  }
  function assign(target, sources) {
    if (!target) return;
    if (target.k === 'name') env.set(target.v, sources);
    else if (target.k === 'tuple' || target.k === 'list') for (const item of target.items) assign(item, sources);
    else if (target.k === 'sub' && target.obj.k === 'name') env.set(target.obj.v, union(env.get(target.obj.v), sources));
  }
  const fileLine = statement => line + statement.line;
  function run(list) {
    for (let i = 0; i < list.length; i++) {
      const st = list[i], at = fileLine(st);
      if (st.k === 'assign') { const sources = value(st.value, at); for (const target of st.targets) assign(target, sources); }
      else if (st.k === 'aug') {
        const left = st.target.k === 'name' ? env.get(st.target.v) || new Set() : new Set(), right = value(st.value, at);
        if (left.size && right.size && [...right].some(item => !left.has(item))) { const id = add(stamp({ kind: 'merge', name: st.op, line: at })); link(union(left, right), id); assign(st.target, new Set([id])); }
        else assign(st.target, union(left, right));
      }
      else if (st.k === 'expr') value(st.value, at);
      else if (st.k === 'return') { if (st.value) { const sources = value(st.value, at); returns.push({ sources, names: (st.value.k === 'tuple' ? st.value.items : [st.value]).filter(item => item.k === 'name' || item.k === 'attr').map(show) }); } }
      else if (st.k === 'if') {
        // An if/elif/else chain: each branch runs under its condition; values from any branch flow on.
        const branches = [st];
        while (list[i + 1] && (list[i + 1].k === 'elif' || list[i + 1].k === 'else')) branches.push(list[++i]);
        const before = new Map(env), results = [], previous = [];
        for (const branch of branches) {
          for (const [k, v] of before) env.set(k, v);
          for (const k of [...env.keys()]) if (!before.has(k)) env.delete(k);
          const cond = branch.k === 'else' ? undefined : parseTokens(branch.header, body);
          if (cond) value(cond, fileLine(branch));
          const said = branch.k === 'else' ? (previous.length === 1 ? 'when ' + negate(previous[0]) : 'otherwise') : (previous.length ? 'otherwise, when ' : 'when ') + show(cond);
          context.when.push(said);
          run(branch.body);
          context.when.pop();
          results.push(new Map(env));
          if (cond) previous.push(cond);
        }
        if (branches[branches.length - 1].k !== 'else') results.push(before);
        env.clear();
        for (const result of results) for (const [k, v] of result) env.set(k, union(env.get(k), v));
      }
      else if (st.k === 'for' || st.k === 'while') {
        let label;
        if (st.k === 'for') {
          const cut = st.header.findIndex(token => token.v === 'in' && token.t === 'name');
          const target = parseTokens(st.header.slice(0, cut), body), iter = parseTokens(st.header.slice(cut + 1), body);
          const overParts = bind(target, iter, undefined) || (bind(target, iter, value(iter, at)), false);
          label = overParts ? undefined : 'for each ' + show(target) + ' in ' + show(iter);
        } else { const cond = parseTokens(st.header, body); value(cond, at); label = 'while ' + show(cond); }
        if (label) context.loop.push(label);
        run(st.body);
        if (label) context.loop.pop();
        const k = list[i + 1]?.k === 'else' ? (i++, list[i]) : undefined;
        if (k) run(k.body);
      }
      else if (st.k === 'with') { for (const item of [parseTokens(st.header, body)]) value(item, at); run(st.body); }
      else if (st.k === 'try') {
        run(st.body);
        while (list[i + 1] && ['except', 'else', 'finally'].includes(list[i + 1].k)) {
          const next = list[++i];
          if (next.k === 'except') { context.when.push('if it fails' + (next.header.length ? ' (' + show(parseTokens(next.header, body)) + ')' : '')); run(next.body); context.when.pop(); }
          else run(next.body);
        }
      }
    }
  }
  const returns = [];
  const tree = statements(body);
  run(tree.length === 1 && tree[0].k === 'def' ? tree[0].body : tree);
  // What comes out: one node fed by every return.
  if (returns.length) {
    const id = add({ kind: 'out', names: [...new Set(returns.flatMap(item => item.names))].slice(0, 6) });
    for (const item of returns) link(item.sources, id);
  }
  // Drop inputs nothing reads.
  const used = new Set([...edges].map(edge => edge.split('>')[0]));
  const kept = nodes.filter(node => node.kind !== 'in' || used.has(node.id));
  const keep = new Set(kept.map(node => node.id));
  return { nodes: kept, edges: [...edges].map(edge => edge.split('>')).filter(([from, to]) => keep.has(from) && keep.has(to)) };
}

// --- simple values ---
// Works out an expression's value from names it can resolve (defaults, constants);
// undefined when it can't. resolve(chain) returns { value, from } or undefined.
function evaluate(e, resolve, depth = 0) {
  if (!e || depth > 20) return undefined;
  const ev = item => evaluate(item, resolve, depth + 1);
  switch (e.k) {
    case 'num': return { value: e.v };
    case 'str': return e.f ? undefined : { value: e.v };
    case 'const': return { value: e.v };
    case 'name': case 'attr': { const chain = chainOf(e); return chain ? resolve(chain) : undefined; }
    case 'un': { const inner = ev(e.e); if (!inner) return undefined; if (e.op === '-' && typeof inner.value === 'number') return { ...inner, value: -inner.value }; if (e.op === 'not') return { ...inner, value: !inner.value }; return e.op === '+' ? inner : undefined; }
    case 'bin': {
      const a = ev(e.l), b = ev(e.r);
      if (!a || !b) return undefined;
      const x = a.value, y = b.value, from = [...new Set([...(a.from || []), ...(b.from || [])])];
      const out = value => value === undefined || Number.isNaN(value) ? undefined : { value, from };
      if (typeof x === 'number' && typeof y === 'number') {
        switch (e.op) {
          case '+': return out(x + y); case '-': return out(x - y); case '*': return out(x * y); case '/': return y ? out(x / y) : undefined;
          case '//': return y ? out(Math.floor(x / y)) : undefined; case '%': return y ? out(((x % y) + y) % y) : undefined; case '**': return out(x ** y);
          default: return undefined;
        }
      }
      if (typeof x === 'string' && typeof y === 'string' && e.op === '+') return out(x + y);
      return undefined;
    }
    case 'ifexp': { const cond = ev(e.cond); if (!cond) return undefined; return cond.value ? ev(e.a) : ev(e.b); }
    case 'tuple': case 'list': { const items = e.items.map(ev); return items.every(Boolean) ? { value: items.map(item => item.value), from: [...new Set(items.flatMap(item => item.from || []))] } : undefined; }
    default: return undefined;
  }
}
const format = value => Array.isArray(value) ? '(' + value.map(format).join(', ') + ')' : typeof value === 'string' ? JSON.stringify(value.length > 32 ? value.slice(0, 31) + '…' : value) : value === null ? 'None' : value === true ? 'True' : value === false ? 'False' : typeof value === 'number' && !Number.isInteger(value) ? String(Math.round(value * 1e6) / 1e6) : String(value);

module.exports = { tokenize, parseExpr, parseTokens, statements, methodFlow, evaluate, format, show, negate, chainOf };

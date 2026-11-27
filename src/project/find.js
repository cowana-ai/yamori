'use strict';
// One-call answers to "where / how does X happen" for agents. Ranks the
// project's functions, classes and script sections against the question
// using everything Yamori already knows about them (the How it works steps,
// names, pseudocode and the code itself) and returns the best few with their
// source lines, so an agent can answer without a search-then-read loop.
// No model calls; plain text out, sized to a budget.
const { stepSearch } = require('../views/stages');

const { queryWords, close, tokensOf } = stepSearch();
// Question words carry no meaning for ranking.
const STOP = new Set(('how does do did doing what where which when why who whom whose the an is are was were be been being it its in of to for and or from this that these those each at on by with into there their they them we our my me you your '
  + 'happen happens happened code function functions file files project work works working done make makes made use uses used out up about all any also then than so if not no has have had can could would should will already since still just only get gets tell tells find finds look looks way ways thing things part parts').split(/\s+/));
const UNIT_KINDS = new Set(['function', 'method', 'class', 'block']);
const MAX_BODY = 400, CODE_LINES = 24, FULL_LINES = 80, BUDGET = 12000;

// Units of code: functions, methods, classes and script sections, with the
// class a method belongs to.
function unitsOf(graph) {
  const units = [];
  for (const [file, info] of Object.entries(graph.files || {})) {
    if (info.test) continue;
    const defs = [...(info.defs || []), ...(info.blocks || [])];
    const classes = defs.filter(def => def.kind === 'class');
    for (const def of defs) {
      const start = def.start || def.line, end = def.end || start;
      if (!UNIT_KINDS.has(def.kind) && def.kind !== 'constant') continue;
      const owner = def.kind === 'class' ? undefined : classes.filter(item => item !== def && (item.start || item.line) <= start && (item.end || item.line) >= end).sort((a, b) => (b.start || b.line) - (a.start || a.line))[0];
      units.push({ file, name: def.name, kind: def.kind, start, end, label: (owner ? owner.name + '.' : '') + def.name });
    }
  }
  return units;
}

// Weighted texts per unit: steps (what it does in plain words) count most,
// then its name, then pseudocode, then the code itself.
function fieldsFor(unit, { steps, explanations, sourceOf }) {
  const fields = [{ weight: 2, text: unit.label }];
  // Same-named methods (forward) are told apart by the step's saved line.
  const ours = step => step.file === unit.file && (step.symbol === unit.name || step.symbol === unit.label) && (!step.line || (step.line >= unit.start && step.line <= unit.end));
  // What the step does is specific; its part and stage names are shared by many.
  for (const step of steps) if (ours(step)) fields.push({ weight: 3, text: [step.what, ...(step.details || []).map(item => item.text)].filter(Boolean).join(' '), step }, { weight: 1, text: [step.part, step.stage, step.gist].filter(Boolean).join(' ') });
  const view = explanations?.[unit.file]?.logic || explanations?.[unit.file]?.overview;
  if (view?.sections && unit.kind !== 'class') for (const section of view.sections) if (section.startLine <= unit.end && section.endLine >= unit.start) fields.push({ weight: 1.5, text: section.title + ' ' + section.pseudocode });
  if (unit.kind !== 'class' && unit.kind !== 'constant' && unit.end - unit.start < MAX_BODY) { const lines = sourceOf(unit.file); if (lines) fields.push({ weight: 1, text: lines.slice(unit.start - 1, unit.end).join('\n') }); }
  return fields;
}

// Per-file index, kept while the file, its pseudocode and its steps are unchanged.
const INDEX = new Map();
function indexOf({ graph, explanations, steps, sourceOf }) {
  const byFile = new Map();
  for (const step of steps) (byFile.get(step.file) || byFile.set(step.file, []).get(step.file)).push(step);
  const units = [];
  for (const unit of unitsOf(graph)) (units[unit.file] ||= []).push(unit);
  const out = [];
  for (const file of Object.keys(graph.files || {})) {
    const list = units[file]; if (!list) continue;
    const fileSteps = byFile.get(file) || [], view = explanations?.[file]?.logic || explanations?.[file]?.overview;
    const key = graph.files[file].hash + '|' + (view?.hash || '') + '|' + JSON.stringify(fileSteps.map(step => [step.symbol, step.line, step.what, step.stage]));
    let entry = INDEX.get(file);
    if (entry?.key !== key) {
      entry = { key, units: list.map(unit => ({ unit, fields: unit.kind === 'constant' ? [] : fieldsFor(unit, { steps: fileSteps, explanations, sourceOf }).map(field => ({ weight: field.weight, step: field.step, tokens: new Set(tokensOf(field.text)) })) })) };
      INDEX.set(file, entry);
    }
    out.push(...entry.units);
  }
  if (INDEX.size > 20000) INDEX.clear();
  return out;
}

// Code-like words in the question (snake_case, camelCase, dotted, or a lone
// word) are names to look up exactly.
function namesIn(raw) {
  const tokens = raw.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) || [];
  const lone = tokens.length === 1;
  const codeLike = name => lone || /[_.]|[a-z][A-Z]|^[A-Z][a-z]+[A-Z]/.test(name) || /^[A-Z][A-Z0-9_]+$/.test(name);
  // train.py is a file, not a name; Class.method stays a name.
  const fileLike = name => /\.[A-Za-z]{1,6}$/.test(name) && !/^[A-Z]\w*\.\w+$/.test(name);
  return new Set(tokens.filter(name => name.length > 2 && codeLike(name) && !fileLike(name)));
}

function rank({ graph, explanations, steps = [], sourceOf, query, limit = 5 }) {
  const raw = String(query || '').trim();
  const words = [...new Set(raw.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1 && !STOP.has(word)).flatMap(word => queryWords(word)))].filter(word => !STOP.has(word));
  const identifiers = namesIn(raw);
  const items = indexOf({ graph, explanations, steps, sourceOf });
  const scored = new Map();
  if (words.length) {
    // Which project words each question word stands for (endings, one typo, same-meaning verbs).
    const vocabulary = new Set();
    for (const item of items) for (const field of item.fields) for (const token of field.tokens) vocabulary.add(token);
    const meaning = new Map(words.map(word => [word, [...vocabulary].filter(token => close(word, token))]));
    const has = (field, word) => meaning.get(word).some(token => field.tokens.has(token));
    const live = items.filter(item => item.fields.length);
    // Rare words say more than common ones.
    const idf = new Map(words.map(word => [word, Math.log(1 + live.length / (1 + live.filter(item => item.fields.some(field => has(field, word))).length))]));
    for (const item of live) {
      let score = 0, matched = 0;
      for (const word of words) { const best = Math.max(0, ...item.fields.filter(field => has(field, word)).map(field => field.weight)); if (best) { matched++; score += best * idf.get(word); } }
      if (matched >= Math.max(1, Math.ceil(words.length / 2))) scored.set(item, score * (matched / words.length) ** 2);
    }
  }
  // Files the question names lift what is in them.
  const files = Object.keys(graph.files || {}), named = new Set();
  for (const [name] of raw.matchAll(/[\w./-]+\.[A-Za-z]{1,6}\b/g)) { const rel = graph.files?.[name] ? name : files.find(file => file.endsWith('/' + name)); if (rel) named.add(rel); }
  if (named.size) for (const [item, score] of scored) if (named.has(item.unit.file)) scored.set(item, score * 1.5);
  // Each exact name in the question is an answer of its own (the best-matching
  // one when several share it); constants only count that way.
  for (const name of identifiers) {
    // Class.method matches that method; only if none does, any method of that name.
    let same = items.filter(item => item.unit.label === name || (!name.includes('.') && item.unit.name === name));
    if (!same.length && name.includes('.')) same = items.filter(item => item.unit.name === name.split('.').pop());
    if (!same.length) continue;
    const best = same.reduce((a, b) => ((scored.get(b) || 0) + (named.has(b.unit.file) ? 1 : 0)) > ((scored.get(a) || 0) + (named.has(a.unit.file) ? 1 : 0)) ? b : a);
    for (const item of same) scored.set(item, (scored.get(item) || 0) + (item === best ? 100 : 5));
  }
  const ranked = [...scored].sort((a, b) => b[1] - a[1] || (a[0].unit.end - a[0].unit.start) - (b[0].unit.end - b[0].unit.start)).map(([item]) => item);
  const out = [];
  for (const item of ranked) {
    if (out.length >= limit) break;
    if (out.some(kept => kept.unit.file === item.unit.file && kept.unit.start === item.unit.start && kept.unit.end === item.unit.end)) continue;
    out.push(item);
  }
  return { words, hits: out };
}

// The lines worth showing: the start of the unit, then lines that mention the
// question's words, with gaps marked.
function excerpt(lines, unit, words, max = CODE_LINES) {
  const from = unit.start, to = Math.min(unit.end, lines.length);
  if (to - from + 1 <= max) return lines.slice(from - 1, to).map((text, i) => (from + i) + ': ' + text).join('\n');
  const keep = new Set();
  for (let n = from; n < from + Math.floor(max / 2); n++) keep.add(n);
  for (let n = from; n <= to && keep.size < max; n++) if (words.length && tokensOf(lines[n - 1]).some(token => words.some(word => close(word, token)))) { keep.add(n); if (n + 1 <= to) keep.add(n + 1); }
  const shown = [...keep].filter(n => n <= to).sort((a, b) => a - b), out = [];
  let last = from - 1;
  for (const n of shown) { if (n > last + 1) out.push('   …'); out.push(n + ': ' + lines[n - 1]); last = n; }
  if (last < to) out.push(`   … (${to - last} more lines)`);
  return out.join('\n');
}

// Who calls a unit and what it calls, from the code, so a result says how it
// fits in without another search.
function contextOf(unit, { graph, units, sourceOf }) {
  const callable = units.filter(item => item.kind !== 'constant' && item.kind !== 'block');
  const body = (sourceOf(unit.file) || []).slice(unit.start - 1, unit.end).join('\n');
  const calls = [...new Set([...body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]))]
    .filter(name => name !== unit.name).map(name => callable.find(item => item.name === name && item.file === unit.file) || callable.find(item => item.name === name)).filter(Boolean).slice(0, 5);
  const callers = [];
  if (unit.kind !== 'block') {
    const call = new RegExp('(?:^|[^\\w$.])' + unit.name.replace(/[$]/g, '\\$') + '\\s*\\(|\\.' + unit.name.replace(/[$]/g, '\\$') + '\\s*\\(');
    for (const [file, info] of Object.entries(graph.files || {})) {
      if (callers.length >= 4 || info.language !== graph.files[unit.file]?.language || !(file === unit.file || (info.refs || []).some(([ref]) => ref === unit.name))) continue;
      const lines = sourceOf(file) || [];
      lines.forEach((text, index) => {
        const line = index + 1;
        // Code lines only: not definitions, imports, comments or docstrings.
        if (callers.length >= 4 || (file === unit.file && line >= unit.start && line <= unit.end) || !call.test(text) || /^\s*(def|function|class|async def|from|import|#|\/\/|\*|"""|''')/.test(text)) return;
        const where = units.filter(item => item.file === file && item.kind !== 'constant' && item.start <= line && item.end >= line).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
        callers.push(file + ':' + line + (where ? ' (' + where.label + ')' : ''));
      });
    }
  }
  return [callers.length ? 'Called from: ' + callers.join(', ') : '', calls.length ? 'Calls: ' + calls.map(item => item.label + ' (' + item.file + ':' + item.start + ')').join(', ') : ''].filter(Boolean).join(' · ');
}

function findText({ graph, explanations, steps, readText, query, limit = 3, code = true }) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('Give a question or a name, such as "where is the loss computed" or get_lr.');
  const cache = new Map();
  const sourceOf = file => { if (!cache.has(file)) { let lines; try { lines = readText(file).split('\n'); } catch {} cache.set(file, lines); } return cache.get(file); };
  const { words, hits } = rank({ graph, explanations, steps, sourceOf, query, limit: Math.max(1, Math.min(10, Number.isInteger(limit) ? limit : 3)) });
  if (!hits.length) return `Nothing in the map matches "${query.trim().slice(0, 120)}". Try fewer or different words, or an exact name (a function, class or constant).`;
  const units = unitsOf(graph), blocks = [];
  let size = 0;
  hits.forEach(({ unit, fields }, index) => {
    const step = fields.find(field => field.step)?.step;
    const head = `${unit.file}:${unit.start}-${unit.end} · ${unit.label}${unit.kind === 'block' ? ' (script section)' : unit.kind === 'constant' ? ' (constant)' : ''}` + (step ? ` · ${step.part} › ${step.stage}` + (step.what ? ' — ' + step.what : '') : '');
    const context = unit.kind === 'constant' ? '' : contextOf(unit, { graph, units, sourceOf });
    // The best two come whole (up to a screen); the rest as the lines that match.
    const lines = code && size < BUDGET ? sourceOf(unit.file) : undefined;
    const text = [head, context, lines ? excerpt(lines, unit, words, index < 2 ? FULL_LINES : CODE_LINES) : ''].filter(Boolean).join('\n');
    size += text.length; blocks.push(text);
  });
  return 'Current source, read just now.\n\n' + blocks.join('\n\n') + (code ? '' : '\n\nPass code: true to include the source lines.');
}

module.exports = { findText, rank, unitsOf };

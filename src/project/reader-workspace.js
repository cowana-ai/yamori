'use strict';

const { hash, PROMPT_FORMAT_VERSION } = require('../ai/engine');
const { parseCard, EDGE_CASE_LIMIT } = require('../ai/cards');
const { sectionHash, linePlan } = require('../storage/cache');
const { compareBlockSteps } = require('./diff-review');
const { render, text: promptText } = require('../prompts');

const SPEC_VERSION = 'yamori-workspace-1';
const DEFINITION = new Set(['function', 'method', 'class']);
const MISSING = '# Waiting for pseudocode.';
const isMissing = section => section?.pseudocode === MISSING || /^# New source block\./.test(section?.pseudocode || '');

function definitions(source, syntax) {
  const offset = source.startLine - 1;
  return (syntax?.defs || []).filter(def => DEFINITION.has(def.kind) && Number.isInteger(def.end))
    .map(def => ({ ...def, start: (def.start || def.line) + offset, line: def.line + offset, end: def.end + offset }));
}

function scaffold(source, syntax) {
  const defs = definitions(source, syntax);
  const methods = defs.filter(def => def.kind !== 'class');
  if (!defs.length && Array.isArray(syntax?.defs) && source.text.trim()) return [{
    title: 'File body', startLine: source.startLine, endLine: source.startLine + source.text.split(/\r?\n/).length - 1,
    pseudocode: MISSING, lineMap: []
  }];
  const sections = (methods.length ? methods : defs).map(def => ({
    title: def.name, startLine: def.start, endLine: def.end, pseudocode: MISSING, lineMap: []
  }));
  if (!defs.length) return sections;
  const lines = source.text.split(/\r?\n/);
  const owned = new Set();
  for (const def of defs) for (let line = def.start; line <= def.end; line++) owned.add(line);
  for (let index = 0; index < lines.length;) {
    const start = index;
    if (owned.has(index + source.startLine)) { index++; continue; }
    while (index < lines.length && !owned.has(index + source.startLine)) index++;
    const scope = lines.slice(start, index), executable = scope.findIndex(line => line.trim() && !/^\s*(?:#|\/\/|import\b|from\s)/.test(line));
    if (executable < 0) continue;
    const last = scope.findLastIndex(line => line.trim());
    sections.push({ title: 'Module setup', startLine: start + source.startLine + executable,
      endLine: start + source.startLine + last, pseudocode: MISSING, lineMap: [] });
  }
  return sections.sort((a,b) => a.startLine - b.startLine);
}

function blockRecords(source, sections, syntax, opts = {}) {
  const defs = definitions(source, syntax);
  const lines = (source.fullText ?? source.text).split(/\r?\n/);
  const offset = source.fullText === undefined ? source.startLine - 1 : 0;
  const used = new Map();
  return sections.map((section, index) => {
    const contained = defs.filter(def => def.line >= section.startLine && def.end <= section.endLine);
    const exact = contained.filter(def => def.start === section.startLine && def.end === section.endLine);
    const def = exact.length === 1 ? exact[0] : contained.length === 1 ? contained[0] : undefined;
    const owners = def ? defs.filter(owner => owner.start <= def.start && owner.end >= def.end &&
      (owner.start < def.start || owner.end > def.end)).sort((a, b) => a.start - b.start || b.end - a.end) : [];
    const symbol = def && [...owners.map(owner => owner.name), def.name].join('.');
    const kind = def?.kind || 'other';
    const name = kind + ':' + (symbol || section.title);
    const occurrence = (used.get(name) || 0) + 1;
    used.set(name, occurrence);
    const identity = occurrence === 1 ? name : name + '#' + occurrence;
    const code = lines.slice(section.startLine - 1 - offset, section.endLine - offset);
    const contentHash = sectionHash(source, section);
    const terms = new Set(code.join('\n').match(/[A-Za-z_$][\w$]*/g) || []);
    const external = (source.callContext?.definitions || [])
      .filter(item => terms.has(item.symbol.split('.').at(-1)))
      .map(item => [item.uri, item.symbol, item.watchSignature || item.fullHash]).sort();
    const local = defs.filter(item => terms.has(item.name) && (item.end < section.startLine || item.start > section.endLine))
      .map(item => [item.kind, item.name, hash(lines.slice(item.start - 1 - offset, item.end - offset).join('\n'))]).sort();
    const imports = (syntax?.imports || []).filter(item => item.names?.some(name => terms.has(name)) ||
      String(item.spec).split(/[./]/).some(name => terms.has(name))).map(item => [item.kind, item.spec, item.names]).sort();
    const depsHash = hash(JSON.stringify([external, local, imports]));
    if (def) {
      const at = def.line - section.startLine;
      const name = def.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const identifier = new RegExp('(^|[^\\w$])' + name + '(?![\\w$])');
      code[at] = code[at]?.replace(identifier, '$1@symbol') || '';
    }
    const bodyHash = hash(code.join('\n'));
    const keyParts = [source.relPath || source.uri, identity, contentHash, depsHash, PROMPT_FORMAT_VERSION,
      opts.provider || '', opts.model || '', SPEC_VERSION];
    return { index, identity, kind, symbol, contentHash, depsHash, bodyHash, local, key: hash(JSON.stringify(keyParts)) };
  });
}

function reviewMatches(reviews, records, record) {
  const exact = reviews[record.identity];
  if (exact) return !exact.unreviewed && exact.contentHash === record.contentHash && (!exact.depsHash || exact.depsHash === record.depsHash);
  if (records.filter(item => item.bodyHash === record.bodyHash && item.kind === record.kind).length !== 1) return false;
  const old = Object.entries(reviews).filter(([id, saved]) => !records.some(item => item.identity === id) &&
    !saved.unreviewed && saved.bodyHash === record.bodyHash && saved.kind === record.kind);
  return old.length === 1;
}

function workspaceRows(source, result, skeleton, syntax, opts, stale, reviews) {
  const sections = result?.sections || skeleton;
  const records = blockRecords(source, sections, syntax, opts);
  return sections.map((section, index) => {
    const record = records[index], card = parseCard(section.pseudocode || ''), missing = isMissing(section);
    return { ...record, index, startLine: section.startLine, endLine: section.endLine,
      title: record.symbol && section.title === record.symbol.split('.').at(-1) ? card?.purpose || section.title : section.title,
      riskCount: card?.riskCount || 0, missing, changed: !missing && stale.has(index),
      reviewed: !missing && reviewMatches(reviews, records, record) };
  });
}

const STAGES = ['Setup', 'Schedule', 'Prepare', 'Process', 'Evaluate', 'Save'];
function stageFor(symbol, index, count) {
  if (/checkpoint|save|restore|export/.test(symbol)) return 'Save';
  if (/evaluat|validat|score|metric|test/.test(symbol)) return 'Evaluate';
  if (/schedul|warmup/.test(symbol)) return 'Schedule';
  if (/seed|setup|config|init/.test(symbol)) return 'Setup';
  if (/load|build|prepare|pool/.test(symbol)) return 'Prepare';
  if (/step|run|update|train|predict/.test(symbol)) return 'Process';
  return STAGES[Math.min(STAGES.length - 1, Math.floor(index * STAGES.length / Math.max(1, count)))];
}

function blockSteps(section) {
  if (!section || isMissing(section)) return [];
  const card = parseCard(section.pseudocode);
  if (card) return card.rows.flatMap((row, i) => row.kind === 'card-step' ?
    [{ text: row.text.trim(), pseudocodeLine: i + 1 }] : []);
  return section.pseudocode.split('\n').flatMap((text, i) => text.trim() && !/^\s*#/.test(text) ?
    [{ text: text.trim(), pseudocodeLine: i + 1 }] : []);
}

function blockEdges(sections, records, syntax, source) {
  const byName = new Map();
  const bounds = new Map(sections.map((section, index) => [section.startLine + ':' + section.endLine, index]));
  const scopes = sections.map((section, index) => ({ section, index })).sort((a,b) =>
    (a.section.endLine - a.section.startLine) - (b.section.endLine - b.section.startLine));
  for (const def of definitions(source || { startLine: 1 }, syntax)) {
    const index = bounds.get(def.start + ':' + def.end) ??
      scopes.find(({ section }) => section.startLine <= def.line && section.endLine >= def.end)?.index;
    if (index === undefined) continue;
    const key = def.kind + ':' + def.name;
    const indices = byName.get(key) || new Set(); indices.add(index); byName.set(key, indices);
  }
  const outgoing = new Map(), seen = new Set();
  const lines = source?.text.split(/\r?\n/) || [];
  const result = [];
  for (const record of records) {
    const to = record.index, section = sections[to];
    if (!section) continue;
    const code = lines.slice(section.startLine - (source?.startLine || 1), section.endLine - (source?.startLine || 1) + 1).join('\n');
    const words = new Map();
    for (const word of code.match(/[A-Za-z_$][\w$]*/g) || []) words.set(word, (words.get(word) || 0) + 1);
    for (const [type, name] of record.local || []) {
      const indices = byName.get(type + ':' + name);
      if (indices?.size !== 1) continue;
      const [from] = indices, key = from + ':' + to + ':' + name;
      if (from === to || seen.has(key)) continue;
      seen.add(key);
      result.push({ from, to, name, kind: ['function', 'method'].includes(type) ? 'call' : 'data', weight: words.get(name) || 1 });
    }
  }
  return result.sort((a,b) => b.weight - a.weight || a.from - b.from || a.to - b.to).filter(edge => {
    const count = outgoing.get(edge.from) || 0;
    if (count >= 3) return false;
    outgoing.set(edge.from, count + 1); return true;
  }).slice(0, 40);
}

function blockBehavior(row, section, reviews, head) {
  if (!section || isMissing(section)) return undefined;
  const moved = Object.values(reviews).filter(item => item.kind === row.kind && item.bodyHash === row.bodyHash);
  const reviewed = reviews[row.identity] || (moved.length === 1 ? moved[0] : undefined);
  if (Array.isArray(reviewed?.steps)) return compareBlockSteps(reviewed.steps, blockSteps(section), 'review');
  if (!head) return undefined;
  const added = Object.values(head.marks || {}).map(change => ({ kind: 'added', after: change.text, pseudocodeLine: change.pseudocodeLine }));
  const removed = Object.entries(head.removed || {}).flatMap(([line, changes]) => changes.map(change => ({
    kind: 'removed', before: change.text, pseudocodeLine: line === 'end' ? 'end' : Number(line)
  })));
  if (!added.length && !removed.length) return undefined;
  return { base: 'head', kind: added.length && removed.length ? 'touched' : added.length ? 'added' : 'removed',
    was: removed[0]?.before, now: added[0]?.after, steps: [...removed, ...added] };
}

function flowRows(rows, sections, gist, reviews, head) {
  return rows.map((row, index) => {
    const section = sections[row.index];
    const candidates = gist?.blocks || {};
    const entry = Object.hasOwn(candidates, row.identity) ? candidates[row.identity] : undefined;
    const current = entry && entry.contentHash === row.contentHash && entry.depsHash === row.depsHash ? entry : undefined;
    const steps = blockSteps(section);
    const card = section && !row.missing ? parseCard(section.pseudocode) : undefined;
    const risk = card?.rows.find(item => item.kind === 'card-risk')?.text;
    return { ...row, stage: current?.stage || stageFor((row.symbol || row.title).toLowerCase(), index, rows.length),
      title: current?.title || row.title, keyStep: current?.step || steps[0]?.text,
      risk: current?.risk || risk, riskCount: Math.max(row.riskCount, current?.risk ? 1 : 0),
      behavior: blockBehavior(row, section, reviews, head?.[row.index]), gistMissing: !current };
  });
}

function unchangedChecks(origin, next, source) {
  const prior = origin?.section;
  if (!prior || isMissing(prior)) return [];
  const card = parseCard(prior.pseudocode);
  if (!card) return [];
  const before = origin.source.text.split(/\r?\n/).slice(prior.startLine - origin.source.startLine, prior.endLine - origin.source.startLine + 1);
  const after = source.text.split(/\r?\n/).slice(next.startLine - source.startLine, next.endLine - source.startLine + 1);
  const plan = linePlan(before.join('\n'), after.join('\n'));
  if (plan.unknown) return [];
  const raw = prior.pseudocode.split('\n');
  return (prior.lineMap || []).flatMap(link => {
    const row = card.rows[link.pseudocodeLine - 1];
    if (!row || !['card-handled', 'card-risk'].includes(row.kind)) return [];
    const start = link.startLine - prior.startLine + 1, end = link.endLine - prior.startLine + 1;
    if (start < 1 || end > before.length || plan.changed.some(change => change.oldEnd < change.oldStart
      ? change.oldStart > start && change.oldStart <= end : change.oldStart <= end && change.oldEnd >= start)) return [];
    const startLine = next.startLine + plan.map(start) - 1, endLine = next.startLine + plan.map(end) - 1;
    if (startLine > endLine || endLine > next.endLine) return [];
    return [{ text: raw[link.pseudocodeLine - 1], startLine, endLine }];
  });
}

function reuseChecks(section, checks) {
  const card = checks.length && parseCard(section.pseudocode);
  if (!card || section.endLine - section.startLine + 1 < 12) return section;
  const raw = section.pseudocode.split('\n'), edgeStart = raw.indexOf('EDGE CASES:');
  const text = edgeStart < 0 ? raw : raw.slice(0, edgeStart);
  const links = (section.lineMap || []).filter(link => edgeStart < 0 || link.pseudocodeLine <= edgeStart);
  const nextChecks = edgeStart < 0 ? [] : (section.lineMap || []).filter(link => link.pseudocodeLine > edgeStart)
    .map(link => ({ ...link, text: raw[link.pseudocodeLine - 1] })).filter(check => /^[✓⚠]/.test(check.text || ''));
  const key = check => check.text.replace(/\*\*/g, '').trim();
  text.push('EDGE CASES:');
  for (const { text: line, startLine, endLine } of [...checks, ...nextChecks.filter(next => !checks.some(previous => key(previous) === key(next) ||
    next.startLine <= previous.endLine && next.endLine >= previous.startLine))].slice(0, EDGE_CASE_LIMIT)) {
    text.push(line);
    links.push({ pseudocodeLine: text.length, startLine, endLine });
  }
  return { ...section, pseudocode: text.join('\n'), lineMap: links };
}

const PROPOSAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { message: { type: 'string' }, replacement: { type: 'string' }, edit: { type: 'boolean' } },
  required: ['message', 'replacement', 'edit']
};

function proposalPrompt({ file, language, before, context, step, instruction, test, question }) {
  if (question) return render('reader/question', {
    lookupRule: context?.lookup ? promptText('reader/question-lookup') + '\n' : '',
    data_json: JSON.stringify({ file, language, input: question.input, context, instruction })
  });
  return render('reader/proposal', {
    task: promptText(test ? 'reader/proposal-test' : 'reader/proposal-source'),
    lookupRule: context?.lookup ? promptText('reader/proposal-lookup') + '\n' : '',
    data_json: JSON.stringify({ file, language, before, context, step, instruction })
  });
}

function parseProposal(raw) {
  let value;
  try { value = JSON.parse(raw.trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '')); }
  catch { throw new Error('The provider returned an invalid preview.'); }
  if (typeof value?.edit !== 'boolean' || typeof value.message !== 'string' || typeof value.replacement !== 'string' ||
      Buffer.byteLength(value.replacement) > 120000 || value.replacement.includes('\0')) throw new Error('The provider returned an invalid preview.');
  return { ...value, message: value.message.slice(0, 4000) };
}

function sourcePreview(source, startLine, endLine, replacement) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  if (startLine < 1 || endLine < startLine || endLine > lines.length) throw new Error('The source range changed. Preview it again.');
  const after = [...lines.slice(0, startLine - 1), ...(replacement === '' ? [] : replacement.replace(/\r\n/g, '\n').split('\n')), ...lines.slice(endLine)].join(eol);
  const changes = linePlan(source, after);
  const updated = after.split(/\r?\n/);
  const ghosts = changes.changed.flatMap(change => updated.slice(change.newStart - 1, change.newEnd).filter(line => line.trim())
    .map(line => ({ line: Math.max(1, Math.min(lines.length, change.oldStart)), text: line.trimEnd() })));
  return { after, ghosts };
}

module.exports = { SPEC_VERSION, MISSING, PROPOSAL_SCHEMA, blockRecords, isMissing, scaffold, workspaceRows, reviewMatches, blockSteps, blockEdges, blockBehavior, flowRows, unchangedChecks, reuseChecks, proposalPrompt, parseProposal, sourcePreview };

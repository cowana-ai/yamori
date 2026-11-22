'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { diffArrays } = require('../../vendor/diff.min');
const { hash, parseResult } = require('../ai/engine');
const linesOf = text => text.replace(/\r\n/g, '\n').split('\n');

// Dates are the cheap signal; content determines whether an explanation is old.
// Myers alignment is bounded so a large rewrite cannot freeze the editor.
function linePlan(before, after) {
  const old = linesOf(before), next = linesOf(after);
  const parts = diffArrays(old, next, { timeout: 100, maxEditLength: 4000 });
  const mapped = new Map(), changed = [], removed = new Set();
  if (!parts) return { unknown: true, changed: [{ oldStart: 1, oldEnd: old.length, newStart: 1, newEnd: next.length, meaningful: true }], map: line => Math.max(1, Math.min(line, next.length)), removed };
  let a = 1, b = 1;
  for (let i = 0; i < parts.length;) {
    const part = parts[i];
    if (!part.added && !part.removed) { for (let n = 0; n < part.count; n++) mapped.set(a++, b++); i++; continue; }
    const oldStart = a, newStart = b, oldValues = [], newValues = [];
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      const chunk = parts[i++];
      if (chunk.removed) { oldValues.push(...chunk.value); a += chunk.count; }
      else { newValues.push(...chunk.value); b += chunk.count; }
    }
    changed.push({ oldStart, oldEnd: a - 1, newStart, newEnd: b - 1, meaningful: [...oldValues, ...newValues].some(line => line.trim()) });
    for (let n = oldStart; n < a; n++) {
      mapped.set(n, Math.max(1, Math.min(next.length, newStart + Math.min(n - oldStart, Math.max(0, b - newStart - 1)))));
      if (!newValues.length) removed.add(n);
    }
  }
  return { unknown: false, changed, removed, map: line => Math.max(1, Math.min(next.length, mapped.get(line) ?? next.length)) };
}
function currentSnapshot(previous, fullText, stamp = {}) {
  const full = linesOf(fullText), plan = linePlan(previous.fullText ?? previous.text, fullText);
  const startLine = previous.selected ? previous.fullText ? plan.map(previous.startLine) : Math.min(previous.startLine, full.length) : 1;
  const endLine = previous.selected ? Math.max(startLine, previous.fullText ? plan.map(previous.endLine) : Math.min(previous.endLine, full.length)) : full.length;
  const selectionMappingUnknown = !!previous.selected && (plan.unknown || !!previous.fullText && Array.from({ length: previous.endLine - previous.startLine + 1 }, (_, index) => previous.startLine + index).every(line => plan.removed.has(line)));
  return { ...previous, selectionMappingUnknown, text: previous.selected ? full.slice(startLine - 1, endLine).join(fullText.includes('\r\n') ? '\r\n' : '\n') : fullText, startLine, endLine, fullText, fullHash: hash(fullText), stamp, observedAt: Date.now() };
}
function analyzeSource(before, after, value, previousStale = []) {
  const selectedWithoutBaseline = before.selected && (!before.fullText || !after.fullText);
  const plan = linePlan(before.fullText ?? before.text, after.fullText ?? after.text);
  const offset = before.fullText ? 0 : before.startLine - 1;
  const affected = new Set(previousStale), removed = [], meaningful = plan.changed.filter(change => change.meaningful);
  const afterLines = linesOf(after.fullText ?? after.text);
  const addsDefinition = change => change.oldEnd < change.oldStart && /^(?:async\s+)?(?:def|class|function|export\s+(?:default\s+)?function)\b/.test(afterLines.slice(change.newStart - 1, change.newEnd).find(line => line.trim() && !/^\s*(#|\/\/|@)/.test(line)) || '');
  let shared = plan.unknown || selectedWithoutBaseline;
  const sections = value.sections.map((section, index) => {
    const start = section.startLine - offset, end = section.endLine - offset;
    const touches = meaningful.some(change => change.oldEnd < change.oldStart ? change.oldStart >= start && (change.oldStart !== start || !addsDefinition(change)) && (change.oldStart <= end || change.oldStart === end + 1 && !addsDefinition(change)) : change.oldStart <= end && change.oldEnd >= start);
    if (touches || shared) affected.add(index);
    if (Array.from({ length: Math.max(0, end - start + 1) }, (_, n) => start + n).every(line => plan.removed.has(line))) removed.push(index);
    let startLine = Math.max(after.startLine, Math.min(after.endLine, plan.map(start) + (after.fullText ? 0 : after.startLine - 1)));
    let endLine = Math.max(startLine, Math.min(after.endLine, plan.map(end) + (after.fullText ? 0 : after.startLine - 1)));
    const full = linesOf(after.fullText ?? after.text), baseOffset = after.fullText ? 0 : after.startLine - 1;
    const first = full[startLine - baseOffset - 1] || '';
    if (/^\s*(?:async\s+)?(?:def|class)\b/.test(first)) {
      const indent = first.match(/^\s*/)[0].length;
      for (const change of meaningful) if (change.oldEnd < change.oldStart && change.oldStart === end + 1) {
        const inserted = full.slice(change.newStart - 1, change.newEnd).filter(line => line.trim());
        if (inserted.length && inserted.every(line => line.match(/^\s*/)[0].length > indent)) endLine = Math.min(after.endLine, Math.max(endLine, change.newEnd));
      }
      while (startLine > after.startLine && /^\s*@/.test(full[startLine - baseOffset - 2] || '')) startLine--;
    }
    const lineMap = (section.lineMap || []).flatMap(mapping => {
      const hit = meaningful.some(change => change.oldStart <= mapping.endLine - offset && change.oldEnd >= mapping.startLine - offset);
      if (hit || affected.has(index)) return [];
      const a = plan.map(mapping.startLine - offset) + (after.fullText ? 0 : after.startLine - 1), b = plan.map(mapping.endLine - offset) + (after.fullText ? 0 : after.startLine - 1);
      return a < after.startLine || b > after.endLine ? [] : [{ ...mapping, startLine: a, endLine: Math.max(a, b) }];
    });
    return { ...section, startLine, endLine, lineMap };
  });
  // Changes outside named blocks may alter globals, imports or introduce a new
  // idea. Be conservative instead of declaring unrelated-looking blocks fresh.
  for (const change of meaningful) {
    if (addsDefinition(change) && !sections.some(section => change.newStart <= section.endLine && change.newEnd >= section.startLine)) {
      const code = afterLines.slice(change.newStart - 1, change.newEnd).join('\n');
      const name = code.match(/\b(?:def|class|function)\s+([A-Za-z_]\w*)/)?.[1];
      affected.add(sections.length);
      sections.push({ title: 'New code' + (name ? ': ' + name : ''), startLine: change.newStart, endLine: change.newEnd, pseudocode: '# New source block. Update this block to explain its behavior.', lineMap: [] });
      continue;
    }
    if (!value.sections.some((section, index) => change.oldStart + offset >= section.startLine && Math.max(change.oldStart, change.oldEnd) + offset <= section.endLine + (change.oldEnd < change.oldStart && change.newStart >= sections[index].startLine && change.newEnd <= sections[index].endLine ? 1 : 0))) shared = true;
    if (change.newEnd >= change.newStart && !sections.some(section => change.newStart >= section.startLine && change.newEnd <= section.endLine)) shared = true;
  }
  if (removed.length) shared = true;
  if (shared) sections.forEach((_, index) => affected.add(index));
  // A changed helper can invalidate a caller even when that caller's own
  // lines did not move. Follow named definitions and simple aliases; when a
  // conceptual fragment has no identifiable boundary, prefer a full review.
  const sourceLines = linesOf(after.text), oldLines = linesOf(before.text);
  const namesIn = text => [...text.matchAll(/\b(?:def|function|class|fn|func)\s+([A-Za-z_]\w*)/g)].map(match => match[1]);
  const dependencies = new Set();
  for (const index of affected) {
    const section = sections[index]; if (!section) continue;
    const oldSection = value.sections[index];
    const text = sourceLines.slice(section.startLine - after.startLine, section.endLine - after.startLine + 1).join('\n');
    const previousText = oldSection ? oldLines.slice(oldSection.startLine - before.startLine, oldSection.endLine - before.startLine + 1).join('\n') : '';
    const names = [...namesIn(text), ...namesIn(previousText)];
    if (!names.length) {
      const assigned = [...(text + '\n' + previousText).matchAll(/^\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*(?:\[[^\n]*?\])?\s*(?:=|\+=|-=)/gm)].map(match => match[1].split('.').at(-1));
      names.push(...assigned);
      if (!assigned.length) shared = true;
    }
    names.forEach(name => dependencies.add(name));
  }
  for (let pass = 0; pass < sections.length + 1; pass++) {
    let added = false;
    for (const match of after.text.matchAll(/^\s*(?:(?:const|let|var)\s+)?([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\b/gm)) if (dependencies.has(match[2]) && !dependencies.has(match[1])) { dependencies.add(match[1]); added = true; }
    sections.forEach((section, index) => {
      if (affected.has(index)) return;
      const text = sourceLines.slice(section.startLine - after.startLine, section.endLine - after.startLine + 1).join('\n');
      if ([...dependencies].some(name => new RegExp('\\b' + name + '\\b').test(text))) { affected.add(index); namesIn(text).forEach(name => dependencies.add(name)); added = true; }
    });
    if (!added) break;
  }
  if (shared) sections.forEach((_, index) => affected.add(index));
  for (const index of affected) if (sections[index]) sections[index].lineMap = [];
  return { value: { ...value, views: undefined, sections }, staleBlocks: [...affected].filter(index => index < sections.length), removedBlocks: removed, shared, changedRanges: plan.changed };
}
function dependencyBlocks(source, value, symbol) {
  const leaf = symbol.split('.').at(-1), escaped = leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), pattern = new RegExp('\\b' + escaped + '\\b');
  const lines = linesOf(source.text);
  const found = value.sections.flatMap((section, index) => lines.slice(Math.max(0, section.startLine - source.startLine), section.endLine - source.startLine + 1).some(line => pattern.test(line)) ? [index] : []);
  return found;
}
// Dependency signatures follow parsed definitions, rather than invalidating every
// caller whenever an unrelated function in the supporting file changes.
function dependencyFingerprint(text, defs, name, kind) {
  const lines = linesOf(text), callable = defs.filter(def => ['function', 'class', 'method'].includes(def.kind));
  const roots = callable.filter(def => def.name === name && (!kind || def.kind === kind));
  if (roots.length !== 1 || !Number.isInteger(roots[0].end)) return undefined;
  const reached = new Set(roots), pending = [...roots];
  while (pending.length) {
    const def = pending.pop(); if (!Number.isInteger(def.end)) return undefined;
    const body = lines.slice((def.start || def.line) - 1, def.end || def.line).join('\n');
    for (const next of callable) if (!reached.has(next) && new RegExp('\\b' + next.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(body)) { reached.add(next); pending.push(next); }
  }
  const global = lines.filter((_, i) => !callable.some(def => i + 1 >= (def.start || def.line) && i + 1 <= (def.end || def.line))).join('\n');
  return hash(JSON.stringify([global.trim(), [...reached].map(def => [def.kind, def.name, lines.slice((def.start || def.line) - 1, def.end || def.line).join('\n').trim()]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
}

function refreshSupport(source, sections, defs, budget = 10000) {
  const lines = linesOf(source.text), blocks = defs.filter(def => ['function','class','method'].includes(def.kind));
  if (blocks.some(def => !Number.isInteger(def.end))) return 'Full definition boundaries are unavailable. Treat unsupplied custom-function behavior as unknown.';
  const numbered = (start,end) => lines.slice(start - source.startLine, end - source.startLine + 1).map((line,i) => (start + i) + ': ' + line).join('\n');
  let search = sections.map(section => numbered(section.startLine, section.endLine)).join('\n'), used = 0;
  const pieces = [], included = new Set(), missing = new Set();
  for (let pass = 0; pass <= blocks.length; pass++) {
    let added = false;
    for (const def of blocks) {
      const start = def.start || def.line, end = def.end || def.line;
      if (included.has(def) || sections.some(section => start >= section.startLine && end <= section.endLine) || !new RegExp('\\b' + def.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(search)) continue;
      if ([...included].some(parent => start >= (parent.start || parent.line) && end <= (parent.end || parent.line))) continue;
      const snippet = numbered(start,end);
      if (used + snippet.length > budget) { missing.add(def.name); continue; }
      pieces.push(snippet); included.add(def); missing.delete(def.name); used += snippet.length; search += '\n' + snippet; added = true;
    }
    if (!added) break;
  }
  const globals = lines.flatMap((line,i) => blocks.some(def => i + source.startLine >= (def.start || def.line) && i + source.startLine <= (def.end || def.line)) ? [] : [(source.startLine + i) + ': ' + line]).join('\n');
  const room = Math.max(0, budget - used);
  if (globals) pieces.push('MODULE CONTEXT:\n' + globals.slice(0, room) + (globals.length > room ? '\n[Module context shortened; omitted values are unknown.]' : ''));
  if (missing.size) pieces.push('Definitions omitted by the context budget; do not invent their internals: ' + [...missing].join(', '));
  return pieces.join('\n\n');
}

// Rebuild block ownership locally after moves/deletions. Historical source is
// evidence only when the SAME cached explanation was fresh for that source.
async function reconcileRefresh(source, value, origins, indexer) {
  const records = await indexer.extract(source.name || new URL(source.uri).pathname, source.text);
  const top = defs => defs.filter(def => ['function', 'class', 'method'].includes(def.kind) && !defs.some(parent => parent !== def && ['function', 'class', 'method'].includes(parent.kind) && parent.line <= def.line && (parent.end || parent.line) >= (def.end || def.line) && (parent.line < def.line || (parent.end || parent.line) > (def.end || def.line))));
  const current = top(records.defs || []), parsed = new Map();
  if (source.selected || !current.length || current.some(def => !Number.isInteger(def.end))) return undefined;
  const body = (snapshot, def) => linesOf(snapshot.text).slice((def.start || def.line) - snapshot.startLine, (def.end || def.line) - snapshot.startLine + 1).join('\n').trim();
  const key = def => def.kind + ':' + def.name;
  const occupied = new Set(), rows = [], changedNames = new Set(), changedGlobalLines = new Set(); let recovered = 0, removed = 0;
  const dependencies = snapshot => JSON.stringify((snapshot.callContext?.definitions || []).map(def => [def.uri, def.symbol, def.watchSignature || def.fullHash]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const currentDependencies = dependencies(source);
  for (let index = 0; index < value.sections.length; index++) {
    const section = value.sections[index], origin = origins.get(index);
    if (!origin) {
      // Scaffolds carry no user explanation and are reconstructed from syntax.
      if (/^# New source block\. Update this block to explain its behavior\.$/.test(section.pseudocode)) { removed++; continue; }
      rows.push({ section, dirty: true }); continue;
    }
    // A successful batch is already grounded in this exact source and helper
    // context. Older unfinished blocks must not invalidate it again on retry.
    // Preserve its conceptual boundaries, including sub-blocks of one function.
    if (origin.source.fullHash === source.fullHash && origin.source.text === source.text && origin.source.startLine === source.startLine && dependencies(origin.source) === currentDependencies) {
      const owners = current.filter(def => (def.start || def.line) <= section.endLine && def.end >= section.startLine);
      owners.forEach(def => occupied.add(key(def)));
      rows.push({ section, origin, dirty: false, currentBaseline: true, names: owners.map(def => def.name) }); recovered++; continue;
    }
    if (!parsed.has(origin.source.fullHash)) parsed.set(origin.source.fullHash, await indexer.extract(origin.source.name || source.name || new URL(source.uri).pathname, origin.source.text));
    const oldDefs = top(parsed.get(origin.source.fullHash).defs || []).filter(def => def.line >= origin.section.startLine && def.line <= origin.section.endLine);
    if (!oldDefs.length) {
      const oldText = linesOf(origin.source.text).slice(origin.section.startLine - origin.source.startLine, origin.section.endLine - origin.source.startLine + 1).join('\n');
      const nextLines = linesOf(source.text), length = linesOf(oldText).length, hits = [];
      if (oldText.trim()) for (let line = 0; line + length <= nextLines.length; line++) if (nextLines.slice(line, line + length).join('\n') === oldText) hits.push(line + source.startLine);
      const oldOwner = top(parsed.get(origin.source.fullHash).defs || []).find(def => def.line <= origin.section.startLine && (def.end || def.line) >= origin.section.endLine);
      const nextOwner = hits.length === 1 && current.find(def => def.line <= hits[0] && (def.end || def.line) >= hits[0] + length - 1);
      const sameOwner = !oldOwner && !nextOwner || oldOwner && nextOwner && key(oldOwner) === key(nextOwner) && Number.isInteger(oldOwner.end) && body(origin.source, oldOwner) === body(source, nextOwner);
      if (hits.length === 1 && sameOwner) {
        const shift = hits[0] - origin.section.startLine;
        rows.push({ section: { ...section, startLine: hits[0], endLine: hits[0] + length - 1, lineMap: (origin.section.lineMap || []).map(link => ({ ...link, startLine: link.startLine + shift, endLine: link.endLine + shift })) }, origin, dirty: false }); recovered++;
      } else rows.push({ section, dirty: true });
      continue;
    }
    if (oldDefs.some(def => !Number.isInteger(def.end))) { rows.push({ section, dirty: true }); continue; }
    const matched = oldDefs.flatMap(def => { const matches = current.filter(next => key(next) === key(def)); return matches.length === 1 ? [{ old: def, next: matches[0] }] : []; });
    for (const def of oldDefs) if (!matched.some(pair => pair.old === def)) changedNames.add(def.name);
    if (!matched.length) { removed++; recovered++; continue; }
    const startLine = Math.min(...matched.map(pair => pair.next.start || pair.next.line)), endLine = Math.max(...matched.map(pair => pair.next.end || pair.next.line));
    const inside = current.filter(def => def.line >= startLine && def.line <= endLine);
    matched.forEach(pair => occupied.add(key(pair.next))); inside.forEach(def => occupied.add(key(def)));
    const identical = matched.length === oldDefs.length && inside.length === matched.length && matched.every((pair,i) => i === 0 || pair.next.line > matched[i - 1].next.line) && matched.every(pair => body(origin.source, pair.old) === body(source, pair.next));
    if (!identical) oldDefs.forEach(def => changedNames.add(def.name));
    const alignment = linePlan(origin.source.fullText || origin.source.text, source.fullText || source.text);
    const lineMap = identical ? (origin.section.lineMap || []).map(link => ({ ...link, startLine: alignment.map(link.startLine), endLine: alignment.map(link.endLine) })).filter(link => link.startLine >= startLine && link.endLine <= endLine) : [];
    rows.push({ section: { ...section, startLine, endLine, lineMap }, dirty: !identical, origin, names: matched.map(pair => pair.next.name) }); recovered++;
  }
  if (!recovered) return undefined;
  for (const def of current) if (!occupied.has(key(def)) && !rows.some(row => row.section.startLine <= def.line && row.section.endLine >= (def.end || def.line))) {
    rows.push({ section: { title: def.name, startLine: def.start || def.line, endLine: def.end || def.line, pseudocode: '# New source block. Update this block to explain its behavior.', lineMap: [] }, dirty: true, names: [def.name] }); changedNames.add(def.name);
  }
  // Changes to imported names/constants may affect definitions whose bodies did
  // not change. Ignore unreferenced import removals, but propagate actual uses.
  for (const origin of origins.values()) {
    const oldRecords = parsed.get(origin.source.fullHash); if (!oldRecords) continue;
    const oldDefs = top(oldRecords.defs || []);
    const oldGlobal = linesOf(origin.source.text).filter((_,i) => !oldDefs.some(def => i + origin.source.startLine >= (def.start || def.line) && i + origin.source.startLine <= (def.end || def.line)));
    const nextGlobalRows = linesOf(source.text).map((text,i) => ({ text, line: i + source.startLine })).filter(row => !current.some(def => row.line >= (def.start || def.line) && row.line <= (def.end || def.line)));
    const nextGlobal = nextGlobalRows.map(row => row.text);
    for (const change of linePlan(oldGlobal.join('\n'), nextGlobal.join('\n')).changed.filter(change => change.meaningful)) {
      for (const row of nextGlobalRows.slice(change.newStart - 1, change.newEnd)) if (row.text.trim()) changedGlobalLines.add(row.line);
      const words = oldGlobal.slice(change.oldStart - 1, change.oldEnd).join('\n') + '\n' + nextGlobal.slice(change.newStart - 1, change.newEnd).join('\n');
      for (const name of words.match(/[A-Za-z_$][\w$]*/g) || []) if (!['from','import','as','export','const','let','var','def','class','function'].includes(name)) changedNames.add(name);
    }
  }
  // New module-level statements also need an explanation; they cannot be
  // declared covered merely because every function body stayed unchanged.
  const uncovered = [...changedGlobalLines].filter(line => !rows.some(row => line >= row.section.startLine && line <= row.section.endLine)).sort((a,b) => a-b);
  const spans = [];
  for (const line of uncovered) { const last = spans.at(-1); if (last && line === last[1] + 1) last[1] = line; else spans.push([line,line]); }
  for (const [startLine,endLine] of spans) rows.push({ section: { title: 'Module setup', startLine, endLine, pseudocode: '# New source block. Update this block to explain its behavior.', lineMap: [] }, dirty: true });
  // Main-source equality does not imply external helpers stayed the same.
  for (const row of rows) if (!row.dirty && row.origin) {
    const code = linesOf(source.text).slice(row.section.startLine - source.startLine, row.section.endLine - source.startLine + 1).join('\n');
    for (const old of row.origin.source.callContext?.definitions || []) {
      const name = old.symbol.split('.').at(-1);
      if (!new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(code)) continue;
      const next = source.callContext?.definitions?.find(def => def.uri === old.uri && def.symbol === old.symbol);
      if (!next || (old.watchSignature && next.watchSignature ? old.watchSignature !== next.watchSignature : old.fullHash !== next.fullHash)) { row.dirty = true; (row.names || []).forEach(name => changedNames.add(name)); }
    }
  }

  for (let pass = 0; pass <= rows.length; pass++) {
    let added = false;
    for (const row of rows) {
      if (row.dirty || row.currentBaseline) continue;
      const code = linesOf(source.text).slice(row.section.startLine - source.startLine, row.section.endLine - source.startLine + 1).map((line,i) => {
        // A declaration's own name is not a use of a changed global. Keep
        // parameter defaults and recursive calls, which are real references.
        for (const def of current.filter(def => def.line === row.section.startLine + i)) line = line.replace(new RegExp('\\b' + def.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'), '');
        return line;
      }).join('\n');
      if ([...changedNames].some(name => new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(code))) { row.dirty = true; (row.names || []).forEach(name => changedNames.add(name)); added = true; }
    }
    if (!added) break;
  }
  rows.sort((a,b) => a.section.startLine - b.section.startLine || a.section.endLine - b.section.endLine);
  return { value: { ...value, views: undefined, sections: rows.map(row => row.dirty ? { ...row.section, lineMap: [] } : row.section) }, staleBlocks: rows.flatMap((row,i) => row.dirty ? [i] : []), removed };
}

class LocalCache {
  constructor(root) { this.root = root; this.writes = new Map(); this.versions = new Map(); }
  async json(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return undefined; } }
  write(file, value) {
    const previous = this.writes.get(file) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = file + '.' + randomUUID() + '.tmp';
      try { await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temp, file); }
      finally { await fs.unlink(temp).catch(() => {}); }
    });
    this.writes.set(file, next);
    return next.finally(() => { if (this.writes.get(file) === next) this.writes.delete(file); });
  }
  variant(source, opts) { return hash(JSON.stringify([source.uri, source.selected ? [source.startLine, source.endLine] : null, opts.provider, opts.level, opts.model || '', opts.effort ?? null, ...(opts.refinementSteps ? ['refinement-v1', opts.refinementSteps] : [])])); }
  draftScope(source, opts) { return hash(JSON.stringify([source.uri, opts.provider, opts.level, opts.model || ''])); }
  async entry(key, source) {
    if (!/^[a-f0-9]{64}$/.test(key || '')) return undefined;
    const raw = await this.json(path.join(this.root, key + '.json'));
    if (!raw) return undefined;
    const snapshot = source || raw._yamori?.source;
    if (!snapshot || typeof snapshot.text !== 'string' || typeof snapshot.uri !== 'string') return undefined;
    try { return { value: parseResult(JSON.stringify(raw), snapshot), meta: raw._yamori }; } catch { return undefined; }
  }
  async origins(source, opts, value) {
    const result = new Map(), signatures = value.sections.map(section => JSON.stringify([section.title, section.pseudocode])), wanted = new Map(signatures.flatMap((key,index) => signatures.indexOf(key) === signatures.lastIndexOf(key) ? [[key,index]] : []));
    const files = (await fs.readdir(this.root).catch(() => [])).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    for (const file of files) {
      const raw = await this.json(path.join(this.root, file)), meta = raw?._yamori;
      if (meta?.source?.uri !== source.uri || meta.opts?.level !== opts.level || !Array.isArray(raw.sections)) continue;
      raw.sections.forEach((section,index) => {
        const target = wanted.get(JSON.stringify([section.title, section.pseudocode]));
        if (target === undefined || meta.staleBlocks?.includes(index) || meta.sourceMissing || raw.sections.filter(other => other.title === section.title && other.pseudocode === section.pseudocode).length !== 1) return;
        if (!result.has(target) || (result.get(target).at || 0) < meta.savedAt) result.set(target, { source: meta.source, section, at: meta.savedAt });
      });
    }
    return result;
  }
  async latest(source, opts, legacy = false) {
    const pointer = await this.json(path.join(this.root, 'latest', this.variant(source, opts) + '.json'));
    const entry = pointer && await this.entry(pointer.key);
    if (!entry && legacy && opts.refinementSteps) return this.latest(source, { ...opts, refinementSteps: 0 });
    if (entry?.meta?.source.uri !== source.uri || entry.meta.opts?.provider !== opts.provider || entry.meta.opts?.level !== opts.level || (entry.meta.opts?.model || '') !== (opts.model || '') || (entry.meta.opts?.effort ?? null) !== (opts.effort ?? null) || (entry.meta.opts?.refinementSteps || 0) !== (opts.refinementSteps || 0)) return undefined;
    return entry;
  }
  async save(source, opts, value, key, status = {}) {
    const variant = this.variant(source, opts), version = (this.versions.get(variant) || 0) + 1;
    this.versions.set(variant, version);
    const meta = { version: 1, source, opts: { provider: opts.provider, level: opts.level, model: opts.model || '', effort: opts.effort ?? null, refinementSteps: opts.refinementSteps || 0 }, savedAt: Date.now(), staleBlocks: [], removedBlocks: [], ...status };
    await this.write(path.join(this.root, key + '.json'), { ...value, _yamori: meta });
    if (this.versions.get(variant) === version) await this.write(path.join(this.root, 'latest', variant + '.json'), { key });
    return meta;
  }
  async drafts(scope) { return await this.json(path.join(this.root, 'drafts', scope + '.json')) || []; }
  saveDrafts(scope, rows) { return this.write(path.join(this.root, 'drafts', scope + '.json'), rows); }
  async flush() { while (this.writes.size) await Promise.all([...this.writes.values()].map(promise => promise.catch(() => {}))); }
}
module.exports = { refreshSupport, dependencyFingerprint, reconcileRefresh, LocalCache, linePlan, currentSnapshot, analyzeSource, dependencyBlocks };
